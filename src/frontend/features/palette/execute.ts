/**
 * Command palette execution engine.
 *
 * Merges static {@link PaletteItem} rows from `paletteCommands.ts` with
 * runtime menu rows fetched from the main process, runs fuzzy matching via
 * `fuzzysort`, and dispatches the selected command. This module is the single
 * place that maps palette item IDs to their side-effecting handler callbacks —
 * UI components only call `executeItem(id)` and never inspect the action
 * directly.
 *
 * Renderer-process only. IPC calls go through `window.electronAPI.invoke`.
 */

import fuzzysort from 'fuzzysort';
import type { FileTreeNode } from '../explorer/types';
import {
  parseDiffPaletteArgs,
  resolveDiffPaletteFileRelative,
  stripDiffPalettePrefix,
} from './diffPaletteResolver';
import type {
  CommandPaletteExecuteResult,
  CommandPalettePreviewRow,
  FlatMenuRow,
  PaletteItem,
} from './types';
import { isWin32 } from './platform';
import { toRepoRelativePath } from './palettePathUtils';
import { buildCuratedPaletteItems } from './paletteCommands';
import type { PalettePrereqs } from './palettePrereqStore';

export interface BuildPaletteItemsOptions {
  rootPath: string;
  selectedFile: string | null;
  fileTree: FileTreeNode | null;
  hasDiffOpen: boolean;
  prereqs: PalettePrereqs;
  runOpenFolder: () => Promise<void>;
  runRefreshTree: () => Promise<void>;
  runOpenAiTab: () => void;
  runOpenVersionControlTab: () => void;
  runCloseDiff: () => void;
  runOpenGitDiff: (args: { filePath: string; hash1: string; hash2: string }) => void;
  runOpenCommitMessagePalette: () => void;
}

const MAX_EMPTY_QUERY_ITEMS = 80;
const MAX_FUZZY_QUERY_ITEMS = 60;

const DEFAULT_QUERY_ERROR = 'No matching command for this query.';

function collectFileRelatives(node: FileTreeNode | null, rootPath: string, out: string[]): void {
  if (node === null) {
    return;
  }
  if (node.isDirectory && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectFileRelatives(child, rootPath, out);
    }
    return;
  }
  if (!node.isDirectory) {
    const relative = toRepoRelativePath(node.path, rootPath);
    if (relative !== null && relative !== '') {
      out.push(relative);
    }
  }
}

export function getWorkspaceKnownFileRelatives(
  fileTree: FileTreeNode | null,
  rootPath: string,
): string[] {
  const out: string[] = [];
  collectFileRelatives(fileTree, rootPath, out);
  const seen = new Set<string>();
  return out.filter((relativePath) => {
    const key = isWin32() ? relativePath.toLowerCase() : relativePath;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const DUPLICATE_MENU_PALETTE_IDS = new Set([
  'id:file-open-folder',
  'id:file-new-markdown',
  'id:file-save',
  'id:file-save-as',
  'id:file-export-copy',
  'id:file-close-tab',
  'id:file-quick-open',
]);

function menuPaletteItems(rows: FlatMenuRow[]): PaletteItem[] {
  const filtered = rows.filter((row) => {
    const key = row.label.trim().toLowerCase();
    return key !== '' && key !== 'command' && !DUPLICATE_MENU_PALETTE_IDS.has(row.id);
  });
  return filtered.map((row) => ({
    id: `menu-${row.id}`,
    label: row.label,
    detail: row.pathLabel,
    shortcut: row.accelerator,
    searchText: `${row.label} ${row.pathLabel}`,
    disabled: !row.enabled,
    run: async () => {
      await window.electronAPI?.invoke('menu-provider', {
        command: 'click-menu-item',
        payload: row.id,
      });
    },
  }));
}

export function buildDiffPaletteLineItemForQuery(
  query: string,
  rootPath: string,
  knownFileRelatives: string[],
  openDiff: (args: { filePath: string; hash1: string; hash2: string }) => void,
): PaletteItem | null {
  const restAfterPrefix = stripDiffPalettePrefix(query);
  if (restAfterPrefix === null) {
    return null;
  }
  if (rootPath.trim() === '') {
    return {
      id: 'diff-palette-no-workspace',
      label: 'Open diff',
      detail: 'Open a workspace first',
      searchText: 'diff',
      disabled: true,
      run: () => {},
    };
  }

  const parsed = parseDiffPaletteArgs(restAfterPrefix);
  if (parsed.kind === 'error') {
    return {
      id: 'diff-palette-parse-error',
      label: 'Diff command',
      detail: parsed.message,
      searchText: 'diff command',
      disabled: true,
      run: () => {},
    };
  }

  const resolved = resolveDiffPaletteFileRelative(
    parsed.value.relativePath,
    rootPath,
    knownFileRelatives,
  );
  if (!resolved.ok) {
    return {
      id: 'diff-palette-path-error',
      label: 'Diff command',
      detail: resolved.message,
      searchText: 'diff command',
      disabled: true,
      run: () => {},
    };
  }

  const rel = resolved.value.relative;
  const fileLabel = rel.split('/').pop() ?? rel;

  return {
    id: 'diff-palette-line',
    label: `Open diff: ${fileLabel}`,
    detail: resolved.value.matchedExact ? parsed.value.summary : `${parsed.value.summary} · ${rel}`,
    searchText: `diff ${rel} ${parsed.value.hash1} ${parsed.value.hash2} compare`,
    run: () => {
      openDiff({
        filePath: rel,
        hash1: parsed.value.hash1,
        hash2: parsed.value.hash2,
      });
    },
  };
}

export function buildCommandPaletteAllItems(
  menuRows: FlatMenuRow[],
  options: BuildPaletteItemsOptions,
): PaletteItem[] {
  return [...buildCuratedPaletteItems(options), ...menuPaletteItems(menuRows)];
}

export function filterCommandPaletteItemsForQuery(
  query: string,
  allItems: PaletteItem[],
  diffLineItem: PaletteItem | null,
): PaletteItem[] {
  const activeItems = allItems.filter((item) => item.disabled !== true);
  const trimmed = query.trim();
  const prepend = diffLineItem !== null ? [diffLineItem] : [];

  if (trimmed === '') {
    return [...prepend, ...activeItems.slice(0, MAX_EMPTY_QUERY_ITEMS)];
  }

  const results = fuzzysort.go(trimmed, activeItems, {
    keys: ['searchText', 'label', 'detail'],
    threshold: -8000,
    limit: MAX_FUZZY_QUERY_ITEMS,
  });
  return [...prepend, ...results.map((result) => result.obj as PaletteItem)];
}

export async function loadFlatApplicationMenuForPalette(): Promise<FlatMenuRow[]> {
  const invoke = window.electronAPI?.invoke;
  if (typeof invoke !== 'function') {
    return [];
  }
  try {
    const rows = (await invoke('menu-provider', {
      command: 'get-flat-application-menu-items',
    })) as unknown;
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.filter((row): row is FlatMenuRow => {
      return (
        row !== null &&
        typeof row === 'object' &&
        typeof (row as FlatMenuRow).id === 'string' &&
        typeof (row as FlatMenuRow).label === 'string' &&
        typeof (row as FlatMenuRow).pathLabel === 'string' &&
        typeof (row as FlatMenuRow).enabled === 'boolean'
      );
    });
  } catch {
    return [];
  }
}

export async function executeCommandPaletteQuery(
  query: string,
  allItems: PaletteItem[],
  diffLineItem: PaletteItem | null,
): Promise<CommandPaletteExecuteResult> {
  const trimmed = query.trim();
  if (trimmed === '') {
    return { ok: false, error: 'query is empty' };
  }
  const visible = filterCommandPaletteItemsForQuery(trimmed, allItems, diffLineItem);
  if (visible.length === 0) {
    return { ok: false, error: DEFAULT_QUERY_ERROR };
  }
  const first = visible[0];
  if (first == null) {
    return { ok: false, error: DEFAULT_QUERY_ERROR };
  }
  if (first.disabled === true) {
    return { ok: false, error: `Command is not available: ${first.detail ?? first.label}` };
  }
  try {
    await first.run();
    return { ok: true, executedLabel: first.label, detail: first.detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Command failed: ${message}` };
  }
}

export async function previewCommandPaletteQuery(
  query: string,
  allItems: PaletteItem[],
  diffLineItem: PaletteItem | null,
  limit = 8,
): Promise<CommandPalettePreviewRow[]> {
  const trimmed = query.trim();
  if (trimmed === '') {
    return [];
  }
  const visible = filterCommandPaletteItemsForQuery(trimmed, allItems, diffLineItem);
  const safeLimit = Math.max(1, limit);
  return visible.slice(0, safeLimit).map((item, index) => ({
    id: item.id,
    label: item.label,
    detail: item.detail,
    disabled: item.disabled === true,
    rank: index,
  }));
}

import fuzzysort from 'fuzzysort';
import { isWin32 } from './platform';

const NORM = (p: string): string => p.replace(/\\/g, '/');

function comparePathKey(pathValue: string): string {
  const normalized = NORM(pathValue);
  return isWin32() ? normalized.toLowerCase() : normalized;
}

export function parseShellLikeArgs(line: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  const source = line.trim();

  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index] ?? '')) {
      index += 1;
    }
    if (index >= source.length) {
      break;
    }
    if ((source[index] ?? '') === '"') {
      index += 1;
      let buffer = '';
      while (index < source.length && (source[index] ?? '') !== '"') {
        if ((source[index] ?? '') === '\\' && index + 1 < source.length) {
          buffer += source[index + 1] ?? '';
          index += 2;
        } else {
          buffer += source[index] ?? '';
          index += 1;
        }
      }
      if ((source[index] ?? '') === '"') {
        index += 1;
      }
      tokens.push(buffer);
      continue;
    }
    const start = index;
    while (index < source.length && !/\s/.test(source[index] ?? '')) {
      index += 1;
    }
    tokens.push(source.slice(start, index));
  }

  return tokens;
}

function resolvePathUnderWorkspace(
  input: string,
  workspaceRoot: string,
): { ok: true; relative: string } | { ok: false; message: string } {
  const root = NORM(workspaceRoot).replace(/\/+$/, '');
  let pathValue = NORM(input).trim().replace(/\/+$/, '');
  if (pathValue === '') {
    return { ok: false, message: 'Specify a file path.' };
  }
  if (root !== '') {
    const rootKey = comparePathKey(root);
    const pathKey = comparePathKey(pathValue);
    if (pathKey === rootKey) {
      pathValue = '';
    } else if (pathKey.startsWith(`${rootKey}/`)) {
      pathValue = pathValue.slice(root.length + 1);
    }
  }
  pathValue = pathValue.replace(/^\.\//, '');
  const parts = pathValue.split('/').filter((part) => part !== '' && part !== '.');
  let depth = 0;
  for (const part of parts) {
    if (part === '..') {
      depth -= 1;
      if (depth < 0) {
        return { ok: false, message: 'Path escapes workspace root.' };
      }
    } else {
      depth += 1;
    }
  }
  if (parts.length === 0) {
    return { ok: false, message: 'Specify a file path.' };
  }
  return { ok: true, relative: parts.join('/') };
}

export interface ParsedDiffPaletteLine {
  relativePath: string;
  hash1: string;
  hash2: string;
  summary: string;
}

export type DiffPaletteParseResult =
  | { kind: 'ok'; value: ParsedDiffPaletteLine }
  | { kind: 'error'; message: string };

export function parseDiffPaletteArgs(rest: string): DiffPaletteParseResult {
  const args = parseShellLikeArgs(rest);
  if (args.length === 0) {
    return { kind: 'error', message: 'Add a file path (optional: up to two revision refs).' };
  }
  if (args.length > 3) {
    return { kind: 'error', message: 'Too many arguments (path + up to two refs).' };
  }
  const relativePath = args[0] ?? '';
  let hash1 = '';
  let hash2 = '';
  if (args.length === 2) {
    hash1 = args[1] ?? '';
    hash2 = hash1 === '' ? '' : 'HEAD';
  } else if (args.length === 3) {
    hash1 = args[1] ?? '';
    hash2 = args[2] ?? '';
  }
  const summary = hash1 === '' && hash2 === '' ? 'Working tree vs HEAD' : `${hash1} -> ${hash2}`;
  return { kind: 'ok', value: { relativePath, hash1, hash2, summary } };
}

export function stripDiffPalettePrefix(query: string): string | null {
  const trimmed = query.trimStart();
  const match = /^(diffview|diff|dv)(\s+|$)/i.exec(trimmed);
  if (match === null) {
    return null;
  }
  return trimmed.slice(match[0].length).trim();
}

export interface ResolveDiffPaletteFileResult {
  relative: string;
  matchedExact: boolean;
}

export function resolveDiffPaletteFileRelative(
  userPath: string,
  workspaceRoot: string,
  knownFileRelatives: string[],
): { ok: true; value: ResolveDiffPaletteFileResult } | { ok: false; message: string } {
  const logical = resolvePathUnderWorkspace(userPath, workspaceRoot);
  if (!logical.ok) {
    return logical;
  }
  const target = logical.relative;
  if (knownFileRelatives.length === 0) {
    return { ok: true, value: { relative: target, matchedExact: true } };
  }

  const targetKey = comparePathKey(target);
  for (const candidate of knownFileRelatives) {
    if (comparePathKey(candidate) === targetKey) {
      return { ok: true, value: { relative: candidate, matchedExact: true } };
    }
  }

  if (target.includes('/')) {
    return { ok: true, value: { relative: target, matchedExact: true } };
  }

  const prepared = knownFileRelatives.map((relativePath) => ({
    relativePath,
    searchText: `${relativePath} ${relativePath.split('/').pop() ?? relativePath}`,
  }));

  const best = fuzzysort.go(target, prepared, {
    keys: ['searchText', 'relativePath'],
    threshold: -8000,
    limit: 1,
  })[0];

  if (best === undefined) {
    return { ok: false, message: `No workspace file matches "${target}".` };
  }

  return {
    ok: true,
    value: {
      relative: best.obj.relativePath,
      matchedExact: false,
    },
  };
}

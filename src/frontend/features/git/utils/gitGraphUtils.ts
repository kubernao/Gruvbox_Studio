/**
 * Git graph utilities — import payload, IPC helpers, re-exports from archive-aligned modules.
 */

import type { GitLogEntry } from '../types/git';
import type { GraphEdgeConnectivity } from './gitTabGraphModel';
import {
  buildCommitGraphModel,
  DEFAULT_GRAPH_EDGE_CONNECTIVITY,
  importParentHashesForGitgraph,
} from './gitTabGraphModel';
import {
  commitDisplayBranchByHash,
  ensureBranchRefsForGitgraphImport,
  sortGitgraphDecorationRefs,
} from './gitTabGraphBranchColors';
import { parseGitDecorationRefs } from './gitDecorationParse';
import { paletteColorForBranchName } from './gitTabGraphHeatmapColors';

export type { GitLogFileGraphContext } from './gitTabGraphBranchColors';
export {
  buildGitLogFileGraphContext,
  buildGitgraphBranchColorByNameMap,
  compareGitgraphBranchNames,
  mergeBranchDecorationAndGraphRefs,
} from './gitTabGraphBranchColors';
export { GRUVBOX_BRANCH_PALETTE } from './gitTabGraphHeatmapColors';

/** Soft cap for composed commit line (hash — subject); keeps tooltips/DOM payloads bounded. */
const MAX_COMMIT_GRAPH_MESSAGE_CHARS = 256;

function truncateWithEllipsis(s: string, maxChars: number): string {
  if (s.length <= maxChars) {
    return s;
  }
  const ellipsis = '…';
  if (maxChars <= ellipsis.length) {
    return ellipsis;
  }
  return `${s.slice(0, maxChars - ellipsis.length)}${ellipsis}`;
}

export interface BuildGit2JsonImportPayloadOptions {
  onCommitActivate: (hash: string) => void;
  displayByHash?: ReadonlyMap<string, string>;
  graphEdgeConnectivity?: GraphEdgeConnectivity;
}

export interface CommitGraphParent {
  sha: string;
}

export interface CommitGraphCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      date: Date;
      email?: string;
    };
    message: string;
  };
  parents: CommitGraphParent[];
}

export interface CommitGraphBranchHead {
  name: string;
  commit: {
    sha: string;
  };
}

export interface CommitGraphImportData {
  commits: CommitGraphCommit[];
  branchHeads: CommitGraphBranchHead[];
  currentBranch?: string;
}

function toDateFromUnixTimestampMaybeSeconds(value: number): Date {
  const ms = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(ms);
}

function parseCurrentBranchFromDecorations(raw: string): string | undefined {
  const match = raw.match(/(?:^|,\s*)HEAD\s*->\s*([^,]+)/);
  const branchName = match?.[1]?.trim();
  return branchName !== undefined && branchName !== '' ? branchName : undefined;
}

function isGitBranchRefName(ref: string): boolean {
  const trimmed = ref.trim();
  if (trimmed === '' || trimmed === 'HEAD') {
    return false;
  }
  if (trimmed.startsWith('tag: ')) {
    return false;
  }
  return true;
}

export function buildCommitGraphImportData(
  entries: GitLogEntry[],
  options?: Pick<BuildGit2JsonImportPayloadOptions, 'graphEdgeConnectivity'>,
): CommitGraphImportData {
  const connectivity = options?.graphEdgeConnectivity ?? DEFAULT_GRAPH_EDGE_CONNECTIVITY;
  const model = buildCommitGraphModel(entries, connectivity);
  const commits: CommitGraphCommit[] = entries.map((entry) => {
    const vertex = model.vertices.get(entry.hash);
    const parents = vertex !== undefined ? importParentHashesForGitgraph(vertex) : [];
    const subject =
      entry.subject.trim() === '' ? '(no commit message)' : entry.subject.trim();
    const message = truncateWithEllipsis(
      `${entry.abbrevHash} — ${subject}`,
      MAX_COMMIT_GRAPH_MESSAGE_CHARS,
    );

    return {
      sha: entry.hash,
      commit: {
        author: {
          name: entry.author,
          email: entry.authorEmail,
          date: toDateFromUnixTimestampMaybeSeconds(entry.authorDate),
        },
        message,
      },
      parents: parents.map((sha) => ({ sha })),
    };
  });

  const branchHeadsByName = new Map<string, CommitGraphBranchHead>();
  for (const entry of entries) {
    const refs = sortGitgraphDecorationRefs(parseGitDecorationRefs(entry.decorations ?? ''));
    for (const ref of refs) {
      if (!isGitBranchRefName(ref) || branchHeadsByName.has(ref)) {
        continue;
      }
      branchHeadsByName.set(ref, {
        name: ref,
        commit: { sha: entry.hash },
      });
    }
  }

  if (branchHeadsByName.size === 0 && commits.length > 0) {
    branchHeadsByName.set('history', {
      name: 'history',
      commit: { sha: commits[0].sha },
    });
  }

  const currentBranch =
    entries
      .map((entry) => parseCurrentBranchFromDecorations(entry.decorations ?? ''))
      .find((name) => name !== undefined) ??
    branchHeadsByName.keys().next().value;

  return {
    commits,
    branchHeads: [...branchHeadsByName.values()],
    currentBranch,
  };
}

/** git2json-shaped rows for GitgraphUserApi.import (newest-first order like git log). */
export function buildGit2JsonImportPayload(
  entries: GitLogEntry[],
  options: BuildGit2JsonImportPayloadOptions,
): unknown[] {
  const connectivity =
    options.graphEdgeConnectivity ?? DEFAULT_GRAPH_EDGE_CONNECTIVITY;
  const chronOpts = { graphEdgeConnectivity: connectivity };
  const displayByHash =
    options.displayByHash ??
    commitDisplayBranchByHash(entries, chronOpts);
  const model = buildCommitGraphModel(entries, connectivity);

  const rows: Record<string, unknown>[] = entries.map((e) => {
    const vertex = model.vertices.get(e.hash);
    const parents =
      vertex !== undefined ? importParentHashesForGitgraph(vertex) : [];
    const refs = sortGitgraphDecorationRefs(parseGitDecorationRefs(e.decorations ?? ''));
    const parentsAbbrev = parents.map((h) => h.substring(0, 7));
    const subj = e.subject.trim();
    const subject = subj === '' ? '(no commit message)' : subj;
    const displayBranch = displayByHash.get(e.hash) ?? '';
    const dotColor =
      displayBranch !== ''
        ? paletteColorForBranchName(displayBranch)
        : undefined;

    const row: Record<string, unknown> = {
      refs,
      hash: e.hash,
      hashAbbrev: e.abbrevHash,
      tree: '',
      treeAbbrev: '',
      parents,
      parentsAbbrev,
      author: {
        name: e.author,
        email: e.authorEmail,
        timestamp: e.authorDate,
      },
      committer: {
        name: e.committer,
        email: e.committerEmail,
        timestamp: e.committerDate,
      },
      subject,
      body: e.body ?? '',
      notes: '',
      stats: [],
      onClick: () => {
        options.onCommitActivate(e.hash);
      },
      onMessageClick: () => {
        options.onCommitActivate(e.hash);
      },
    };
    if (dotColor !== undefined && dotColor !== '') {
      row.style = { dot: { color: dotColor } };
    }
    return row;
  });

  ensureBranchRefsForGitgraphImport(rows);
  return rows;
}

export function remotesIncludeGithub(remotes: Array<{ fetchUrl: string }>): boolean {
  return remotes.some((r) => /github\.com/i.test(r.fetchUrl));
}

export function isNonDeletableLocalBranchName(branchName: string): boolean {
  const protected_branches = ['main', 'master', 'develop', 'dev'];
  return protected_branches.includes(branchName.toLowerCase());
}

/**
 * Git provider IPC utilities
 */

import type { GitLogEntry } from '../types/git';

export function normalizeGitLogEntry(
  row: Omit<GitLogEntry, 'parents'> & { parents?: string[] },
): GitLogEntry {
  return {
    ...row,
    parents: Array.isArray(row.parents) ? row.parents : [],
  };
}

export function readGitProviderError(result: unknown): string | null {
  if (
    !Array.isArray(result) &&
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    typeof (result as { error: unknown }).error === 'string'
  ) {
    return (result as { error: string }).error;
  }
  return null;
}

export function readGitProviderBooleanResult(result: unknown): boolean {
  if (typeof result === 'boolean') {
    return result;
  }
  if (Array.isArray(result)) {
    return true;
  }
  return false;
}

export function readGitProviderArray<T>(
  result: unknown,
  typeguard: (x: unknown) => x is T,
): T[] | null {
  if (Array.isArray(result)) {
    const filtered = result.filter((x): x is T => typeguard(x));
    return filtered.length > 0 ? filtered : null;
  }
  return null;
}

export function readGitProviderResolvedRepoRoot(result: unknown): string | null {
  if (typeof result === 'string') {
    return result;
  }
  if (
    typeof result === 'object' &&
    result !== null &&
    'root' in result &&
    typeof (result as { root: unknown }).root === 'string'
  ) {
    return (result as { root: string }).root;
  }
  return null;
}

export function isGitProviderGitLogEntryRow(x: unknown): x is {
  hash: string;
  abbrevHash: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  authorDate: number;
  committer: string;
  committerEmail: string;
  committerDate: number;
  decorations: string;
  parents: string[];
} {
  if (typeof x !== 'object' || x === null) return false;
  const obj = x as Record<string, unknown>;
  const parentsOk =
    !('parents' in obj) ||
    (Array.isArray((obj as { parents?: unknown }).parents) &&
      (obj as { parents: unknown[] }).parents.every((p) => typeof p === 'string'));
  return (
    typeof obj.hash === 'string' &&
    typeof obj.abbrevHash === 'string' &&
    typeof obj.subject === 'string' &&
    typeof obj.body === 'string' &&
    typeof obj.author === 'string' &&
    typeof obj.authorEmail === 'string' &&
    typeof obj.authorDate === 'number' &&
    typeof obj.committer === 'string' &&
    typeof obj.committerEmail === 'string' &&
    typeof obj.committerDate === 'number' &&
    typeof obj.decorations === 'string' &&
    parentsOk
  );
}

export function normalizeGitStatusInvokeResult(result: unknown): Array<{ file: string; status: string }> {
  if (!Array.isArray(result)) {
    return [];
  }
  return result
    .filter(
      (x): x is { file: string; status: string } =>
        typeof x === 'object' &&
        x !== null &&
        typeof (x as Record<string, unknown>).file === 'string' &&
        typeof (x as Record<string, unknown>).status === 'string',
    );
}

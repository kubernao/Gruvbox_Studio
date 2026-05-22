import { GIT_INDEX_REVISION } from './gitIndexRevision';

function normalizeRepoRelativePath(filePath: string): string {
  let s = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (s.startsWith('@')) {
    s = s.slice(1).trim();
  }
  return s;
}

export type GitShowFileResult =
  | { ok: true; content: string }
  | { ok: false; reason?: string; error?: string };

function normalizeErrorText(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function isMissingGitShowFileRevision(result: GitShowFileResult | null | undefined): boolean {
  if (!result || result.ok !== false) {
    return false;
  }
  if (result.reason === 'not_found') {
    return true;
  }
  const lowered = `${normalizeErrorText(result.reason)} ${normalizeErrorText(result.error)}`;
  return (
    lowered.includes('path') && lowered.includes('does not exist')
  ) || (
    lowered.includes('exists on disk') && lowered.includes('not in')
  );
}

/**
 * Loads UTF-8 text for a repo-relative file at a git revision, working tree, or index.
 *
 * @param revision - Commit/branch ref for `git show rev:path`, `''` for working tree,
 *                   or {@link GIT_INDEX_REVISION} for the staged index blob.
 */
export async function fetchRepoFileRevision(args: {
  repoPath: string;
  filePath: string;
  revision: string | typeof GIT_INDEX_REVISION;
}): Promise<GitShowFileResult> {
  const invoke = window.electronAPI?.invoke;
  if (typeof invoke !== 'function') {
    return { ok: false, error: 'Electron invoke is not available.' };
  }
  const rel = normalizeRepoRelativePath(args.filePath.trim());
  if (!rel) {
    return { ok: false, reason: 'invalid_path', error: 'filePath required' };
  }
  const raw = await invoke('git-provider', {
    command: 'git-show-file',
    repoPath: args.repoPath.trim(),
    filePath: rel,
    revision: args.revision === GIT_INDEX_REVISION ? GIT_INDEX_REVISION : args.revision.trim(),
  });
  const result = raw as GitShowFileResult;
  if (result && typeof result === 'object' && result.ok === true && typeof result.content === 'string') {
    return { ok: true, content: result.content };
  }
  if (result && typeof result === 'object' && result.ok === false) {
    return result;
  }
  return { ok: false, error: 'Unexpected git-show-file response' };
}

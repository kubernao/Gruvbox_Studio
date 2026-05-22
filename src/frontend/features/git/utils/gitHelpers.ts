/**
 * Git helper utilities
 */

export function shortPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? filePath;
}

export function shortGitHash(hash: string): string {
  return hash.length >= 7 ? hash.slice(0, 7) : hash;
}

export function statusClass(status: string): string {
  if (status.startsWith('A') || status === '??') {
    return 'status-added';
  }
  if (status.startsWith('M') || status.startsWith('R')) {
    return 'status-modified';
  }
  if (status.startsWith('D')) {
    return 'status-deleted';
  }
  return 'status-other';
}

export function versionDistanceLabel(index: number): string {
  if (index <= 0) {
    return 'Current version';
  }
  return `${index} back`;
}

export function branchSwitchErrorForDisplay(gitMessage: string): string {
  const m = gitMessage.trim();
  if (m === '') {
    return m;
  }
  if (/already used by worktree/i.test(m)) {
    return (
      'That branch is already checked out in another Git worktree. ' +
      'Switch or remove that worktree first (see "git worktree list" in a terminal), ' +
      'then try again.\n\n' +
      m
    );
  }
  return m;
}

export function gitDocumentRowId(rowIndex: number): string {
  return `git-document-row-${rowIndex}`;
}

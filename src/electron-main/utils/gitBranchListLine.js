/**
 * Git prints local branch rows with a leading asterisk when the branch is checked out in the
 * current worktree, and with a leading plus when it is checked out in another worktree. Consumers
 * that only strip the star end up with branch names that still begin with plus and a space, which
 * breaks `git switch`, `git branch -D`, and UI pickers. This module centralizes that parsing so every
 * caller strips both markers consistently and can detect the current branch without misclassifying
 * worktree-checked-out rows as current.
 */

/**
 * Normalize one line from `git branch` style output after trimming outer whitespace. Rows that are
 * empty, whitespace-only, or contain only a marker with no branch name are discarded (returns
 * null). The current-branch flag follows Git’s star convention: only a leading `*` after trim means
 * checked out here; a leading `+` means checked out elsewhere and must not be treated as current.
 * Remote-tracking lines such as `remotes/origin/foo` pass through unchanged because they do not begin
 * with `*` or `+`.
 *
 * @param {string} line Raw line from `git branch`, `git branch -a`, etc.
 * @returns {{ name: string, isCurrent: boolean } | null} Parsed branch name and current flag, or null to skip the row.
 */
function normalizeGitBranchListLine(line) {
  const trimmed = typeof line === 'string' ? line.trim() : '';
  if (!trimmed) {
    return null;
  }
  const isCurrent = trimmed.startsWith('*');
  const name = trimmed.replace(/^[*+]\s*/, '').trim();
  if (!name) {
    return null;
  }
  return { name, isCurrent };
}

module.exports = {
  normalizeGitBranchListLine,
};

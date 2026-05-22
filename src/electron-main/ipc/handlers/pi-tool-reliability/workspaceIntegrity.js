const fs = require('node:fs');
const path = require('node:path');

const repoGitMutex = new Map();
const MUTATING_GIT_COMMANDS = new Set([
  'worktree',
  'branch',
  'checkout',
  'switch',
  'commit',
  'add',
  'reset',
  'cherry-pick',
  'apply',
  'am',
]);

/**
 * Determine whether the provided git argument list mutates repository state.
 * This classification intentionally errs on the side of safety for commands
 * that can rewrite refs, index entries, or worktree files.
 * @param {string[]} args
 * @returns {boolean}
 */
function isMutatingGitArgs(args) {
  const sub = String(Array.isArray(args) ? args[0] : '').trim().toLowerCase();
  if (!sub) return false;
  if (!MUTATING_GIT_COMMANDS.has(sub)) return false;
  if (sub === 'worktree') {
    const op = String(args[1] ?? '').toLowerCase();
    return op === 'add' || op === 'remove' || op === 'prune';
  }
  return true;
}

/**
 * Execute `work` under a per-repository mutex. This ensures mutating git
 * commands cannot interleave in-process for the same repository path while
 * still allowing full concurrency across unrelated repositories.
 * @param {string} repoPath
 * @param {() => Promise<unknown>} work
 * @returns {Promise<unknown>}
 */
async function runWithRepoGitMutex(repoPath, work) {
  const key = path.resolve(String(repoPath ?? ''));
  const prior = repoGitMutex.get(key) ?? Promise.resolve();
  const next = prior
    .catch(() => undefined)
    .then(async () => await work());
  repoGitMutex.set(
    key,
    next.finally(() => {
      if (repoGitMutex.get(key) === next) {
        repoGitMutex.delete(key);
      }
    }),
  );
  return await next;
}

/**
 * Validate that `cwd` exists and is a directory before process spawn.
 * Throws a typed error (`code = "cwd_missing"`) so callers can perform
 * targeted workspace recovery without relying on string parsing.
 * @param {string} cwd
 * @returns {Promise<string>}
 */
async function assertValidCwd(cwd) {
  const resolved = path.resolve(String(cwd ?? ''));
  try {
    const stat = await fs.promises.stat(resolved);
    if (!stat.isDirectory()) {
      throw new Error('cwd is not a directory');
    }
    return resolved;
  } catch {
    const error = new Error(`Workspace directory is missing: ${resolved}`);
    error.code = 'cwd_missing';
    error.workspacePath = resolved;
    throw error;
  }
}

/**
 * Build a capped depth-1 directory snapshot suitable for orientation prompts.
 * The result is deterministic, excludes `.git`, and marks directories with `/`.
 * @param {string} cwd
 * @param {number} maxEntries
 * @returns {Promise<string[]>}
 */
async function listTopLevelEntries(cwd, maxEntries = 50) {
  const dirents = await fs.promises.readdir(cwd, { withFileTypes: true });
  return dirents
    .filter((entry) => entry.name !== '.git')
    .slice(0, Math.max(1, maxEntries))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
}

module.exports = {
  assertValidCwd,
  isMutatingGitArgs,
  listTopLevelEntries,
  runWithRepoGitMutex,
};

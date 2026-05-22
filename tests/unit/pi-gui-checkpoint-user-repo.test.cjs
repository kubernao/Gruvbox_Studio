/**
 * Unit tests for `checkpointUserRepoIfDirty` in `pi-gui.js`.
 *
 * The checkpoint helper is the foundation of the AI worktree git-safety
 * design: before any AI worktree branches off the user's repository, it
 * captures the current uncommitted work as a real commit so the resulting
 * branch always starts from a saved version. These tests exercise the
 * helper directly against a temporary on-disk git repository so we can
 * assert the actual git history shape rather than relying on mocks.
 *
 * Coverage:
 *   - Clean working tree returns `{ committed: false }` and does not add
 *     a commit to history.
 *   - Dirty tracked files are committed before any further work happens.
 *   - Untracked files are also captured, so AI edits cannot lose user work
 *     that simply was never `git add`ed.
 *   - The returned `head` matches `git rev-parse HEAD`, which is what
 *     `prepareAiWorktreeSession` records as the AI worktree base commit.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { checkpointUserRepoIfDirty } = require('../../src/electron-main/ipc/handlers/pi-gui');

/**
 * Skip the entire suite when `git` is not available on PATH so the unit
 * step never produces a misleading red on machines without git installed.
 */
function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const GIT_AVAILABLE = gitAvailable();
const skipWhenNoGit = GIT_AVAILABLE ? null : { skip: 'git binary not available' };

/**
 * Create a temporary git repository with one initial commit and return its
 * absolute path. Configures local user identity so `git commit` works in
 * environments without a global git config.
 */
function createTempRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gruvbox-checkpoint-test-'));
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Gruvbox Test'], { cwd: repoPath, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoPath, 'README.md'), 'initial\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoPath, stdio: 'ignore' });
  return repoPath;
}

function rmTempRepo(repoPath) {
  try {
    fs.rmSync(repoPath, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

function gitOut(repoPath, args) {
  return execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' }).toString();
}

function commitCount(repoPath) {
  return Number(gitOut(repoPath, ['rev-list', '--count', 'HEAD']).trim());
}

test('checkpointUserRepoIfDirty returns committed:false on a clean tree', skipWhenNoGit, async () => {
  const repoPath = createTempRepo();
  try {
    const before = commitCount(repoPath);
    const result = await checkpointUserRepoIfDirty(repoPath);
    assert.equal(result.committed, false);
    assert.equal(commitCount(repoPath), before);
  } finally {
    rmTempRepo(repoPath);
  }
});

test('checkpointUserRepoIfDirty commits modified tracked files', skipWhenNoGit, async () => {
  const repoPath = createTempRepo();
  try {
    fs.writeFileSync(path.join(repoPath, 'README.md'), 'modified by user\n', 'utf8');
    const before = commitCount(repoPath);
    const result = await checkpointUserRepoIfDirty(repoPath);
    assert.equal(result.committed, true);
    assert.equal(commitCount(repoPath), before + 1);
    assert.equal(result.head, gitOut(repoPath, ['rev-parse', 'HEAD']).trim());
    assert.deepEqual(result.changedRelativePaths, ['README.md']);
    const status = gitOut(repoPath, ['status', '--porcelain']).trim();
    assert.equal(status, '');
  } finally {
    rmTempRepo(repoPath);
  }
});

test('checkpointUserRepoIfDirty captures untracked files in the checkpoint commit', skipWhenNoGit, async () => {
  const repoPath = createTempRepo();
  try {
    fs.writeFileSync(path.join(repoPath, 'notes.txt'), 'unsaved idea\n', 'utf8');
    const before = commitCount(repoPath);
    const result = await checkpointUserRepoIfDirty(repoPath);
    assert.equal(result.committed, true);
    assert.equal(commitCount(repoPath), before + 1);
    assert.deepEqual(result.changedRelativePaths, ['notes.txt']);
    const status = gitOut(repoPath, ['status', '--porcelain']).trim();
    assert.equal(status, '');
    const lastCommitFiles = gitOut(repoPath, ['show', '--name-only', '--pretty=format:', 'HEAD'])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    assert.ok(lastCommitFiles.includes('notes.txt'));
  } finally {
    rmTempRepo(repoPath);
  }
});

test('checkpointUserRepoIfDirty returned head matches HEAD used for AI worktree base', skipWhenNoGit, async () => {
  const repoPath = createTempRepo();
  try {
    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'a\n', 'utf8');
    fs.writeFileSync(path.join(repoPath, 'b.txt'), 'b\n', 'utf8');
    const result = await checkpointUserRepoIfDirty(repoPath);
    assert.equal(result.committed, true);
    const headAfter = gitOut(repoPath, ['rev-parse', 'HEAD']).trim();
    assert.equal(result.head, headAfter);
    assert.deepEqual(result.changedRelativePaths, ['a.txt', 'b.txt']);
  } finally {
    rmTempRepo(repoPath);
  }
});

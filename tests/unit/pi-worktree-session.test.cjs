const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const {
  isMutatingGitArgs,
  runWithRepoGitMutex,
} = require('../../src/electron-main/ipc/handlers/pi-tool-reliability/workspaceIntegrity');
const {
  prepareAiWorktreeSession,
} = require('../../src/electron-main/ipc/handlers/pi-gui');

test('isMutatingGitArgs detects mutating and read-only commands', () => {
  assert.equal(isMutatingGitArgs(['worktree', 'add']), true);
  assert.equal(isMutatingGitArgs(['worktree', 'prune']), true);
  assert.equal(isMutatingGitArgs(['status', '--porcelain']), false);
  assert.equal(isMutatingGitArgs(['rev-parse', '--is-inside-work-tree']), false);
});

test('runWithRepoGitMutex serializes work on same repo key', async () => {
  const events = [];
  const repoPath = '/tmp/repo-a';
  const first = runWithRepoGitMutex(repoPath, async () => {
    events.push('first-start');
    await new Promise((resolve) => setTimeout(resolve, 25));
    events.push('first-end');
  });
  const second = runWithRepoGitMutex(repoPath, async () => {
    events.push('second-start');
    events.push('second-end');
  });
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second-start', 'second-end']);
});

/**
 * Skip the real-git suite when `git` is not on PATH. The integration tests
 * boot a real on-disk repository to verify the checkpoint commit and
 * worktree branch base commit are wired correctly inside
 * `prepareAiWorktreeSession`.
 */
function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const skipWhenNoGit = gitAvailable() ? null : { skip: 'git binary not available' };

function createTempRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gruvbox-prepare-test-'));
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Gruvbox Test'], { cwd: repoPath, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoPath, 'README.md'), 'initial\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoPath, stdio: 'ignore' });
  return repoPath;
}

function makeFakeApp(userDataDir) {
  return {
    getPath: (name) => {
      if (name === 'userData') {
        return userDataDir;
      }
      if (name === 'home') {
        return userDataDir;
      }
      return userDataDir;
    },
  };
}

test('prepareAiWorktreeSession records checkpoint metadata when user repo is dirty', skipWhenNoGit, async () => {
  const repoPath = createTempRepo();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gruvbox-prepare-userdata-'));
  try {
    fs.writeFileSync(path.join(repoPath, 'README.md'), 'user edited before AI\n', 'utf8');
    fs.writeFileSync(path.join(repoPath, 'untracked.md'), 'never saved\n', 'utf8');
    const app = makeFakeApp(userDataDir);
    const session = await prepareAiWorktreeSession(app, 1234, repoPath, 'chat-checkpoint');
    assert.ok(session, 'expected a session to be returned');
    assert.equal(typeof session.userCheckpointCommit, 'string');
    assert.notEqual(session.userCheckpointCommit, '', 'checkpoint commit should be recorded');
    assert.deepEqual(session.userCheckpointChangedRelativePaths.sort(), ['README.md', 'untracked.md']);
    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' }).trim();
    assert.equal(session.baseCommit, headAfter);
    assert.equal(session.userCheckpointCommit, headAfter);
  } finally {
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: repoPath, stdio: 'ignore' });
    } catch {
      // best effort
    }
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('prepareAiWorktreeSession leaves checkpoint metadata empty when tree is clean', skipWhenNoGit, async () => {
  const repoPath = createTempRepo();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gruvbox-prepare-userdata-'));
  try {
    const app = makeFakeApp(userDataDir);
    const session = await prepareAiWorktreeSession(app, 5678, repoPath, 'chat-clean');
    assert.ok(session, 'expected a session to be returned');
    assert.equal(session.userCheckpointCommit, '');
    assert.deepEqual(session.userCheckpointChangedRelativePaths, []);
  } finally {
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: repoPath, stdio: 'ignore' });
    } catch {
      // best effort
    }
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

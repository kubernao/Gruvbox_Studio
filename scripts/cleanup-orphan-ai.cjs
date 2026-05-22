#!/usr/bin/env node
/**
 * This maintenance script removes stale AI worktrees and `ai/pi/w*` branches.
 * It safely deletes branches already merged into main/master and requires
 * `--force` for orphan branches that still contain unmerged commits.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeGitBranchListLine } = require('../src/electron-main/utils/gitBranchListLine');

function runGit(repoPath, args) {
  return execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' }).trim();
}

function parseArgs() {
  const repoPath = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const force = process.argv.includes('--force');
  return { repoPath, force };
}

function getAiBranches(repoPath) {
  const out = runGit(repoPath, ['branch', '--list', 'ai/pi/w*']);
  return out
    .split(/\r?\n/)
    .map((line) => normalizeGitBranchListLine(line))
    .map((p) => (p !== null ? p.name : ''))
    .filter(Boolean);
}

function getWorktreeMap(repoPath) {
  const out = runGit(repoPath, ['worktree', 'list', '--porcelain']);
  const blocks = out.split(/\r?\n\r?\n/);
  const result = new Map();
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const worktreeLine = lines.find((line) => line.startsWith('worktree '));
    const branchLine = lines.find((line) => line.startsWith('branch refs/heads/'));
    if (!worktreeLine || !branchLine) continue;
    result.set(branchLine.slice('branch refs/heads/'.length).trim(), worktreeLine.slice('worktree '.length).trim());
  }
  return result;
}

function getDefaultBaseBranch(repoPath) {
  const candidates = ['main', 'master'];
  for (const candidate of candidates) {
    try {
      runGit(repoPath, ['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      // try next
    }
  }
  return 'main';
}

function isMerged(repoPath, branchName, baseBranch) {
  try {
    runGit(repoPath, ['merge-base', '--is-ancestor', branchName, baseBranch]);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const { repoPath, force } = parseArgs();
  const branches = getAiBranches(repoPath);
  const worktrees = getWorktreeMap(repoPath);
  const baseBranch = getDefaultBaseBranch(repoPath);

  const orphanWithUnmerged = [];
  for (const branchName of branches) {
    const worktreePath = worktrees.get(branchName);
    const worktreeMissing = !worktreePath || !fs.existsSync(worktreePath);
    if (worktreePath && fs.existsSync(worktreePath)) {
      try {
        runGit(repoPath, ['worktree', 'remove', '--force', worktreePath]);
      } catch {
        // best effort
      }
    }

    if (!worktreeMissing && !String(worktreePath).includes(path.join('Application Support'))) {
      continue;
    }

    if (isMerged(repoPath, branchName, baseBranch)) {
      runGit(repoPath, ['branch', '-D', branchName]);
      continue;
    }

    if (force) {
      runGit(repoPath, ['branch', '-D', branchName]);
    } else {
      orphanWithUnmerged.push(branchName);
    }
  }

  if (orphanWithUnmerged.length > 0) {
    console.error('Found orphan AI branches with unmerged commits:');
    for (const branch of orphanWithUnmerged) {
      console.error(` - ${branch}`);
    }
    console.error('Re-run with --force to delete these branches.');
    process.exitCode = 2;
  } else {
    console.log('AI branch/worktree cleanup complete.');
  }
}

main();

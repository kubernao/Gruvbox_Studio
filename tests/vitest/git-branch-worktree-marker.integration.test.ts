/**
 * Exercises {@link normalizeGitBranchListLine} against real local `git branch` output lines that include Git’s `+`
 * (“checked out elsewhere”) markers and Pi-style slashes. Scripted worktrees behave most predictably under
 * POSIX path layout; Git for Windows varies enough that this suite is gated off win32 unless we later add native
 * path fixtures.
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLEANUP_SCRIPT = path.resolve(THIS_DIR, '../../scripts/cleanup-orphan-ai.cjs');

const nodeRequire = createRequire(import.meta.url);
const { normalizeGitBranchListLine } = nodeRequire(
  '../../src/electron-main/utils/gitBranchListLine.js',
) as {
  normalizeGitBranchListLine: (line: string) => { name: string; isCurrent: boolean } | null;
};

const describeWorktrees = process.platform === 'win32' ? describe.skip : describe;

describeWorktrees('normalizeGitBranchListLine (+ worktree markers, real git)', () => {
  let scratchBase: string | undefined;

  afterEach(() => {
    if (scratchBase !== undefined) {
      try {
        rmSync(scratchBase, { recursive: true, force: true });
      } catch {
        /* best effort teardown */
      }
      scratchBase = undefined;
    }
  });

  /**
   * Seeds a deterministic throwaway repo with an initial tracked file commit and renames HEAD to main so subsequent
   * worktree setups target a predictable default branch naming convention.
   */
  function initRepoWithMainCommit(repoDir: string): void {
    execFileSync('git', ['init'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'vitest-integration@localhost'], {
      cwd: repoDir,
    });
    execFileSync('git', ['config', 'user.name', 'vitest'], { cwd: repoDir });
    writeFileSync(path.join(repoDir, 'f.txt'), 'x\n');
    execFileSync('git', ['add', 'f.txt'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['branch', '-M', 'main'], { cwd: repoDir, stdio: 'pipe' });
  }

  /**
   * Confirms stdout lines emitted from the clone’s perspective keep `feature` as the trimmed name even when Git
   * marks the row checked out under another linked worktree (`+`).
   */
  it('parses sibling worktree branch rows without leaking the plus marker into the name field', () => {
    scratchBase = mkdtempSync(path.join(os.tmpdir(), 'gruvbox-branch-marker-'));
    const mainRepo = path.join(scratchBase, 'repo');
    const wtFeature = path.join(scratchBase, 'wt-feature');

    mkdirSync(mainRepo);
    initRepoWithMainCommit(mainRepo);
    mkdirSync(wtFeature);
    execFileSync('git', ['worktree', 'add', wtFeature, '-b', 'feature'], {
      cwd: mainRepo,
      stdio: 'pipe',
    });

    const stdout = execFileSync('git', ['branch', '--list'], {
      cwd: mainRepo,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const featureRaw = stdout.split(/\r?\n/).find((l) => l.includes('feature'));
    expect(featureRaw, 'branch list line for feature').toBeDefined();

    const featureParsed = normalizeGitBranchListLine(String(featureRaw).trimEnd());
    expect(featureParsed).not.toBeNull();
    expect(featureParsed!.name).toBe('feature');
    expect(featureParsed!.name.startsWith('+')).toBe(false);
    expect(featureParsed!.isCurrent).toBe(false);

    const mainRaw = stdout
      .split(/\r?\n/)
      .find((l) => String(l).trimStart().startsWith('*') && /\bmain\b/.test(l));
    expect(mainRaw, 'branch list row for main').toBeDefined();
    const mainParsed = normalizeGitBranchListLine(String(mainRaw).trimEnd());
    expect(mainParsed!.name.endsWith('main')).toBe(true);
    expect(mainParsed!.isCurrent).toBe(true);
  });

  /**
   * Pi names include slashes; verifying `+ normalization` survives that shape prevents accidental truncation when
   * branch labels echo through merge flows.
   */
  it('parses Pi-style branch names referenced from another worktree', () => {
    scratchBase = mkdtempSync(path.join(os.tmpdir(), 'gruvbox-branch-marker-ai-'));
    const mainRepo = path.join(scratchBase, 'repo');
    const wtAi = path.join(scratchBase, 'wt-ai');
    const aiBranch = 'ai/pi/w1/main/case/integration';

    mkdirSync(mainRepo);
    initRepoWithMainCommit(mainRepo);
    mkdirSync(wtAi);
    execFileSync('git', ['branch', aiBranch], { cwd: mainRepo, stdio: 'pipe' });
    execFileSync('git', ['worktree', 'add', wtAi, aiBranch], {
      cwd: mainRepo,
      stdio: 'pipe',
    });

    const stdout = execFileSync('git', ['branch', '--list', 'ai/pi/w*'], {
      cwd: mainRepo,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const line = stdout.split(/\r?\n/).find((l) => l.includes('ai/pi/w1'));
    expect(line, 'matching ai/pi line').toBeDefined();
    const parsed = normalizeGitBranchListLine(String(line).trimEnd());
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe(aiBranch);
    expect(parsed!.name.startsWith('+')).toBe(false);
  });

  /**
   * Mirrors the scripted smoke expectation from the hygiene plan so CI can catch regressions in how the orphan
   * cleanup script parses branch rows before iterating deletes.
   */
  it('cleanup-orphan-ai.cjs exits successfully on repos without ai/pi branches', () => {
    scratchBase = mkdtempSync(path.join(os.tmpdir(), 'gruvbox-cleanup-ai-smoke-'));
    const repo = path.join(scratchBase, 'repo');
    mkdirSync(repo);
    initRepoWithMainCommit(repo);

    execFileSync(process.execPath, [CLEANUP_SCRIPT, repo], {
      cwd: repo,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });
});

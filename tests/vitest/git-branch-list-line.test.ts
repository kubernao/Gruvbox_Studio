import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const nodeRequire = createRequire(import.meta.url);
const { normalizeGitBranchListLine } = nodeRequire(
  '../../src/electron-main/utils/gitBranchListLine.js',
) as {
  normalizeGitBranchListLine: (line: string) => { name: string; isCurrent: boolean } | null;
};

describe('normalizeGitBranchListLine', () => {
  it('returns null for empty or whitespace-only lines', () => {
    expect(normalizeGitBranchListLine('')).toBeNull();
    expect(normalizeGitBranchListLine('   ')).toBeNull();
    expect(normalizeGitBranchListLine('\t\n')).toBeNull();
  });

  it('parses current branch lines with leading star', () => {
    expect(normalizeGitBranchListLine('* main')).toEqual({ name: 'main', isCurrent: true });
    expect(normalizeGitBranchListLine(' * main')).toEqual({ name: 'main', isCurrent: true });
  });

  it('parses other-worktree checkout lines with leading plus', () => {
    expect(normalizeGitBranchListLine('+ ai/pi/w1/foo/123')).toEqual({
      name: 'ai/pi/w1/foo/123',
      isCurrent: false,
    });
  });

  it('parses plain local branches without markers', () => {
    expect(normalizeGitBranchListLine('  feature')).toEqual({ name: 'feature', isCurrent: false });
    expect(normalizeGitBranchListLine('feature')).toEqual({ name: 'feature', isCurrent: false });
  });

  it('leaves remotes lines unchanged when they have no git marker prefix', () => {
    expect(normalizeGitBranchListLine('remotes/origin/foo')).toEqual({
      name: 'remotes/origin/foo',
      isCurrent: false,
    });
  });

  it('returns null when only a marker remains after stripping', () => {
    expect(normalizeGitBranchListLine('*')).toBeNull();
    expect(normalizeGitBranchListLine('+')).toBeNull();
    expect(normalizeGitBranchListLine('* ')).toBeNull();
  });

  it('handles tabs or multiple spaces after the current-branch marker', () => {
    expect(normalizeGitBranchListLine('*\tmain')).toEqual({ name: 'main', isCurrent: true });
    expect(normalizeGitBranchListLine('*  main')).toEqual({ name: 'main', isCurrent: true });
  });

  it('parses padded plus-marker worktree rows without marking current', () => {
    expect(normalizeGitBranchListLine('  + ai/pi/w1/x/1')).toEqual({
      name: 'ai/pi/w1/x/1',
      isCurrent: false,
    });
  });

  it('never treats a plus-prefixed line as current even with padding', () => {
    expect(normalizeGitBranchListLine(' + wip')).toMatchObject({
      name: 'wip',
      isCurrent: false,
    });
  });
});

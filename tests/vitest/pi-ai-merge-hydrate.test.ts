import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  selectPrimaryTouchedFile,
  hydrateAiMergeOpenPaths,
} = require('../../src/electron-main/ipc/handlers/pi-ai-merge-hydrate.cjs') as {
  selectPrimaryTouchedFile: (gitDerivedTouchedFiles: string[], toolTouchedFiles: string[], bridgedRelativePaths: string[]) => string;
  hydrateAiMergeOpenPaths: (
    runGit: (cwd: string, args: string[]) => Promise<{ stdout: string }>,
    ctx: {
      gitDerivedTouchedFiles: string[];
      toolTouchedFiles: string[];
      bridgedRelativePaths: string[];
      repoPath: string;
      targetBranch: string;
      aiBranch: string;
      worktreePath: string;
    },
  ) => Promise<{ primaryRelativePath: string; changedRelativePaths: string[] }>;
};

/**
 * These tests lock the merge-open path precedence contract used by AI merge
 * hydration so tool-authored paths remain authoritative even when Git-derived
 * candidates include markdown files that would otherwise win heuristic ranking.
 */
describe('pi-ai-merge-hydrate path selection', () => {
  it('prioritizes tool-touched files over heuristic markdown preference', () => {
    const selected = selectPrimaryTouchedFile(
      ['docs/readme.md'],
      ['notes/chapter.md'],
      [],
    );
    expect(selected).toBe('notes/chapter.md');
  });

  it('keeps hydrated primary path aligned with tool-touched files', async () => {
    const runGit = async () => ({ stdout: '' });
    const result = await hydrateAiMergeOpenPaths(runGit, {
      gitDerivedTouchedFiles: ['docs/readme.md'],
      toolTouchedFiles: ['notes/chapter.md'],
      bridgedRelativePaths: [],
      repoPath: '/repo',
      targetBranch: 'main',
      aiBranch: 'ai-branch',
      worktreePath: '/repo/.wt',
    });

    expect(result.primaryRelativePath).toBe('notes/chapter.md');
    expect(result.changedRelativePaths).toEqual(['docs/readme.md', 'notes/chapter.md']);
  });

  it('does not allow bridged score to override ordered tool priority', () => {
    const selected = selectPrimaryTouchedFile(
      ['story/chapter_1.md', 'notes/chapter.md'],
      ['notes/chapter.md', 'story/chapter_1.md'],
      ['story/chapter_1.md'],
    );
    expect(selected).toBe('notes/chapter.md');
  });
});

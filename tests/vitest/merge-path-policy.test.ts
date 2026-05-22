import { describe, expect, it } from 'vitest';
import {
  buildMergeQueuePaths,
  isPlausibleMergePath,
  partitionMergePaths,
} from '../../src/frontend/features/assistant/utils/mergePathPolicy';
import { chooseMergeOpenPath } from '../../src/frontend/features/assistant/utils/mergeOpenPath';

describe('mergePathPolicy', () => {
  it('rejects bare tokens like drone', () => {
    expect(isPlausibleMergePath('drone')).toBe(false);
    expect(isPlausibleMergePath('notes')).toBe(false);
  });

  it('allows conventional file paths', () => {
    expect(isPlausibleMergePath('src/app.ts')).toBe(true);
    expect(isPlausibleMergePath('README.md')).toBe(true);
    expect(isPlausibleMergePath('Makefile')).toBe(true);
  });

  it('partitions plausible and rejected paths', () => {
    const { plausible, rejected } = partitionMergePaths(['drone', 'src/a.ts', 'notes']);
    expect(plausible).toEqual(['src/a.ts']);
    expect(rejected).toEqual(['drone', 'notes']);
  });

  it('buildMergeQueuePaths excludes spurious entries', () => {
    const { queue, rejected } = buildMergeQueuePaths(['drone', 'docs/readme.md', 'lib/x.ts']);
    expect(queue).toEqual(['docs/readme.md', 'lib/x.ts']);
    expect(rejected).toEqual(['drone']);
  });

  it('chooseMergeOpenPath skips implausible changed paths', () => {
    expect(chooseMergeOpenPath('', ['drone', 'src/main.ts'])).toBe('src/main.ts');
    expect(chooseMergeOpenPath('drone', ['src/main.ts'])).toBe('src/main.ts');
  });
});

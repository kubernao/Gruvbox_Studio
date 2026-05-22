import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistMergeResult } from '../../src/frontend/components/DiffViewer/utils/diffMergePersistence';

const completeBranchMergeSaveMock = vi.fn();
const writeRepoRelativeFileMock = vi.fn();

const saveIntermediateMergeFileToTargetMock = vi.fn();

vi.mock('../../src/frontend/components/DiffViewer/utils/branchMergeSave', () => ({
  completeBranchMergeSave: (...args: unknown[]) => completeBranchMergeSaveMock(...args),
  saveIntermediateMergeFileToTarget: (...args: unknown[]) => saveIntermediateMergeFileToTargetMock(...args),
}));

vi.mock('../../src/frontend/components/DiffViewer/utils/writeRepoRelativeFile', () => ({
  writeRepoRelativeFile: (...args: unknown[]) => writeRepoRelativeFileMock(...args),
}));

/**
 * Routing tests for persistMergeResult.
 * Verifies branch/file paths and fallback behavior without touching disk/git.
 */
describe('diffMergePersistence', () => {
  beforeEach(() => {
    completeBranchMergeSaveMock.mockReset();
    saveIntermediateMergeFileToTargetMock.mockReset();
    writeRepoRelativeFileMock.mockReset();
  });

  it('routes branch intent with branchFinalize false to intermediate save', async () => {
    saveIntermediateMergeFileToTargetMock.mockResolvedValue({
      ok: true,
      statusMessage: 'Saved src/a.ts to main. Continue reviewing remaining files.',
    });

    const out = await persistMergeResult({
      mergeIntent: 'branch',
      branchFinalize: false,
      repoPath: '/repo',
      filePath: 'src/a.ts',
      mergeTargetBranch: 'main',
      mergeSourceBranch: 'ai/pi/w1/main/1',
      mergedContent: 'resolved',
    });

    expect(out.ok).toBe(true);
    expect(saveIntermediateMergeFileToTargetMock).toHaveBeenCalledOnce();
    expect(completeBranchMergeSaveMock).not.toHaveBeenCalled();
  });

  it('routes branch intent to completeBranchMergeSave and returns success', async () => {
    completeBranchMergeSaveMock.mockResolvedValue({
      ok: true,
      statusMessage: 'Branch merge completed.',
    });

    const out = await persistMergeResult({
      mergeIntent: 'branch',
      repoPath: '/repo',
      filePath: 'src/a.ts',
      mergeTargetBranch: 'main',
      mergeSourceBranch: 'feature',
      mergedContent: 'resolved',
    });

    expect(out).toEqual({ ok: true, statusMessage: 'Branch merge completed.', branchDeleteWarning: undefined });
    expect(completeBranchMergeSaveMock).toHaveBeenCalledOnce();
    expect(writeRepoRelativeFileMock).not.toHaveBeenCalled();
  });

  it('maps branch failure to normalized error shape', async () => {
    completeBranchMergeSaveMock.mockResolvedValue({
      ok: false,
      statusMessage: 'Tree is dirty.',
      reason: 'dirty_tree',
      retryable: true,
    });

    const out = await persistMergeResult({
      mergeIntent: 'branch',
      repoPath: '/repo',
      filePath: 'src/a.ts',
      mergeTargetBranch: 'main',
      mergeSourceBranch: 'feature',
      mergedContent: 'resolved',
    });

    expect(out).toEqual({
      ok: false,
      statusMessage: 'Tree is dirty.',
      reason: 'dirty_tree',
      retryable: true,
    });
  });

  it('uses onSave callback for file intent when provided', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    const out = await persistMergeResult({
      mergeIntent: 'file',
      repoPath: '/repo',
      filePath: 'src/a.ts',
      mergeTargetBranch: '',
      mergeSourceBranch: '',
      mergedContent: 'resolved',
      onSave,
    });

    expect(onSave).toHaveBeenCalledWith('resolved', 'src/a.ts');
    expect(writeRepoRelativeFileMock).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, statusMessage: 'Merge saved successfully!' });
  });

  it('falls back to writeRepoRelativeFile for file intent', async () => {
    writeRepoRelativeFileMock.mockResolvedValue({ ok: true });

    const out = await persistMergeResult({
      mergeIntent: 'file',
      repoPath: '/repo',
      filePath: 'src/a.ts',
      mergeTargetBranch: '',
      mergeSourceBranch: '',
      mergedContent: 'resolved',
    });

    expect(writeRepoRelativeFileMock).toHaveBeenCalledWith('/repo', 'src/a.ts', 'resolved');
    expect(out).toEqual({ ok: true, statusMessage: 'Merge result saved successfully.' });
  });

  it('returns save error when writeRepoRelativeFile fails', async () => {
    writeRepoRelativeFileMock.mockResolvedValue({ ok: false, error: 'permission denied' });

    const out = await persistMergeResult({
      mergeIntent: 'file',
      repoPath: '/repo',
      filePath: 'src/a.ts',
      mergeTargetBranch: '',
      mergeSourceBranch: '',
      mergedContent: 'resolved',
    });

    expect(out).toEqual({ ok: false, statusMessage: 'Error saving file: permission denied' });
  });

  it('does not attach branch retry metadata for file-intent failures', async () => {
    writeRepoRelativeFileMock.mockResolvedValue({ ok: false, error: 'disk full' });

    const out = await persistMergeResult({
      mergeIntent: 'file',
      repoPath: '/repo',
      filePath: 'src/a.ts',
      mergeTargetBranch: '',
      mergeSourceBranch: '',
      mergedContent: 'resolved',
    });

    expect(out.ok).toBe(false);
    if (out.ok) {
      throw new Error('Expected file-intent save to fail in this branch');
    }
    expect(out.reason).toBeUndefined();
    expect(out.retryable).toBeUndefined();
    expect(out.statusMessage).toBe('Error saving file: disk full');
  });
});

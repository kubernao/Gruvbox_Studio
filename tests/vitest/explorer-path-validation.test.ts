import { describe, expect, it } from 'vitest';
import {
  getParentPath,
  hasPathSeparator,
  isSamePath,
  isSelfOrDescendantPath,
  validateRenameName,
} from '../../src/frontend/features/explorer/pathValidation';

describe('explorer path validation helpers', () => {
  it('normalizes slash direction and case for path comparison', () => {
    expect(isSamePath('C:\\Foo\\Bar\\', 'c:/foo/bar')).toBe(true);
  });

  it('detects self and descendant targets', () => {
    expect(isSelfOrDescendantPath('C:\\workspace\\folder', 'C:\\workspace\\folder')).toBe(true);
    expect(isSelfOrDescendantPath('C:\\workspace\\folder', 'C:\\workspace\\folder\\nested')).toBe(true);
    expect(isSelfOrDescendantPath('C:\\workspace\\folder', 'C:\\workspace\\other')).toBe(false);
  });

  it('validates rename names and rejects separators', () => {
    expect(validateRenameName('new-name.txt', 'old-name.txt')).toBe('new-name.txt');
    expect(() => validateRenameName('old-name.txt', 'old-name.txt')).toThrow();
    expect(() => validateRenameName('folder/new.txt', 'old-name.txt')).toThrow();
    expect(() => validateRenameName(' ', 'old-name.txt')).toThrow();
    expect(hasPathSeparator('a\\b')).toBe(true);
    expect(hasPathSeparator('a/b')).toBe(true);
  });

  it('computes parent paths across separators and roots', () => {
    expect(getParentPath('C:\\workspace\\folder\\child.txt')).toBe('C:/workspace/folder');
    expect(getParentPath('C:/workspace/folder/child.txt')).toBe('C:/workspace/folder');
    expect(getParentPath('C:\\workspace\\folder\\')).toBe('C:/workspace');
    expect(getParentPath('/workspace')).toBe('');
    expect(getParentPath('')).toBe('');
  });
});

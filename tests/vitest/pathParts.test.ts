import { describe, expect, it } from 'vitest';
import { fileNameFromPath, parentDirectoryFromFilePath } from '../../src/frontend/shared/utils/pathParts';

describe('parentDirectoryFromFilePath', () => {
  it('returns parent for POSIX absolute paths', () => {
    expect(parentDirectoryFromFilePath('/Users/me/Documents/Notes/foo.md')).toBe(
      '/Users/me/Documents/Notes',
    );
  });

  it('returns empty when no directory segment', () => {
    expect(parentDirectoryFromFilePath('foo.md')).toBe('');
  });

  it('returns root for file at filesystem root', () => {
    expect(parentDirectoryFromFilePath('/foo.md')).toBe('/');
  });

  it('handles Windows-style paths', () => {
    expect(parentDirectoryFromFilePath('C:\\Users\\dev\\repo\\x.ts')).toBe('C:\\Users\\dev\\repo');
  });
});

describe('fileNameFromPath', () => {
  it('returns basename for POSIX paths', () => {
    expect(fileNameFromPath('/Users/a/b/c.txt')).toBe('c.txt');
  });

  it('returns whole string when no separator', () => {
    expect(fileNameFromPath('README.md')).toBe('README.md');
  });

  it('handles Windows-style paths', () => {
    expect(fileNameFromPath('D:\\proj\\src\\main.ts')).toBe('main.ts');
  });

  it('strips trailing separators before basename', () => {
    expect(fileNameFromPath('/tmp/out/')).toBe('out');
  });
});

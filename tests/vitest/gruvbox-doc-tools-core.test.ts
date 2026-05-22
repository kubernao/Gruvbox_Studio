import { describe, expect, it } from 'vitest';
import {
	assertInsideProjectRoot,
	computeAppend,
	computeInsertAfterText,
	computeInsertAtLine,
	computePrepend,
	countOccurrences,
	normalizeInsertAnchor,
	resolveDocPath,
} from '../../submodules/pi-mono/.pi/extensions/gruvbox-doc-tools-core';

describe('gruvbox-doc-tools-core', () => {
  const root = '/project';

  it('resolveDocPath resolves relative to cwd', () => {
    expect(resolveDocPath('notes/a.md', root)).toBe('/project/notes/a.md');
  });

  it('resolveDocPath strips leading @ from workspace-style paths', () => {
    expect(resolveDocPath('@notes/a.md', root)).toBe('/project/notes/a.md');
  });

  it('resolveDocPath strips leading @/ from workspace-style paths', () => {
    expect(resolveDocPath('@/notes/a.md', root)).toBe('/project/notes/a.md');
  });

  it('assertInsideProjectRoot rejects traversal', () => {
    expect(() => assertInsideProjectRoot('/outside/file', root)).toThrow(/escapes project root/);
  });

  it('computeAppend preserves existing body and appends fragment', () => {
    const existing = '# Title\n\nPara one.\n';
    const next = computeAppend(existing, 'Para two.', { ensureTrailingNewline: true });
    expect(next.startsWith('# Title')).toBe(true);
    expect(next).toContain('Para one.');
    expect(next).toContain('Para two.');
    expect(next.endsWith('\n')).toBe(true);
  });

  it('computeAppend simulates mistaken write that would truncate — append keeps prefix', () => {
    const existing = 'A\n'.repeat(100);
    const fragment = 'NEW ONLY';
    const next = computeAppend(existing, fragment, { ensureTrailingNewline: false });
    expect(next.startsWith('A\n')).toBe(true);
    expect(next.endsWith('NEW ONLY')).toBe(true);
    expect(next.length).toBeGreaterThan(existing.length);
  });

  it('computeAppend preserves CRLF', () => {
    const existing = 'Line1\r\nLine2\r\n';
    const next = computeAppend(existing, 'Line3', { ensureTrailingNewline: true });
    expect(next.includes('\r\n')).toBe(true);
    expect(next.endsWith('\r\n')).toBe(true);
  });

  it('computePrepend inserts before existing', () => {
    const next = computePrepend('body\n', 'front\n');
    expect(next.startsWith('front')).toBe(true);
    expect(next.endsWith('body\n')).toBe(true);
  });

  it('computeInsertAtLine inserts before line and supports append-after-last', () => {
    const existing = 'a\nb\nc\n';
    const mid = computeInsertAtLine(existing, 2, 'x');
    expect(mid).toMatch(/a\nx\nb\nc/);
    const end = computeInsertAtLine(existing, 4, 'z');
    expect(end.includes('c\nz') || end.endsWith('z\n')).toBe(true);
  });

  it('computeInsertAfterText requires unique marker', () => {
    expect(() => computeInsertAfterText('aba', 'a', 'x')).toThrow(/exactly once/);
    expect(computeInsertAfterText('hello world', 'world', '!')).toBe('hello world!');
  });

  it('normalizeInsertAnchor validates exclusivity', () => {
    expect(() => normalizeInsertAnchor({})).toThrow(/exactly one/);
    expect(normalizeInsertAnchor({ line: 3 })).toEqual({ line: 3 });
    expect(normalizeInsertAnchor({ afterText: 'uniq' })).toEqual({ afterText: 'uniq' });
  });

  it('countOccurrences matches non-overlapping convention', () => {
    expect(countOccurrences('aaa', 'aa')).toBe(1);
  });
});

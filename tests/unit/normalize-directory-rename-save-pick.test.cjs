const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  normalizeDirectoryRenameSavePick,
} = require('../../src/electron-main/utils/normalizeDirectoryRenameSavePick');

test('rewrites nested macOS-style pick to sibling of directory being renamed', () => {
  const source = '/Users/me/Documents/Essays';
  const picked = '/Users/me/Documents/Essays/Papers';
  const out = normalizeDirectoryRenameSavePick(path.resolve(source), path.resolve(picked));
  assert.equal(out, path.join('/Users/me/Documents', 'Papers'));
});

test('leaves already-sibling pick unchanged', () => {
  const source = '/Users/me/Documents/Essays';
  const picked = '/Users/me/Documents/Papers';
  const resolvedSource = path.resolve(source);
  const resolvedPick = path.resolve(picked);
  assert.equal(
    normalizeDirectoryRenameSavePick(resolvedSource, resolvedPick),
    resolvedPick
  );
});

test('leaves identical paths unchanged for NO_OP downstream', () => {
  const p = path.resolve('/Users/me/Documents/Essays');
  assert.equal(normalizeDirectoryRenameSavePick(p, p), p);
});

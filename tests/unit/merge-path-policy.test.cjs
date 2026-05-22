const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPlausibleMergePath,
  partitionMergePaths,
} = require('../../src/electron-main/utils/mergePathPolicy.cjs');

test('main-process mergePathPolicy rejects drone', () => {
  assert.equal(isPlausibleMergePath('drone'), false);
  assert.equal(isPlausibleMergePath('src/x.ts'), true);
});

test('partitionMergePaths splits spurious paths', () => {
  const { plausible, rejected } = partitionMergePaths(['drone', 'lib/a.js']);
  assert.deepEqual(plausible, ['lib/a.js']);
  assert.deepEqual(rejected, ['drone']);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { __testables } = require('../../src/electron-main/ipc/rust-bridge.js');

test('resolveNativeMethod returns first available method', () => {
  const nativeModule = {
    nope: () => {},
    napiRename: () => true,
  };
  const resolved = __testables.resolveNativeMethod(nativeModule, ['napiRenamePath', 'napiRename']);
  assert.equal(typeof resolved, 'function');
});

test('normalizePathForCompare lowercases and normalizes separators', () => {
  const normalized = __testables.normalizePathForCompare('C:\\Users\\isick\\Folder\\');
  assert.equal(normalized, normalized.toLowerCase());
  assert.match(normalized, /folder$/);
});

test('isSelfOrDescendantPath detects descendants safely', () => {
  assert.equal(
    __testables.isSelfOrDescendantPath('C:\\Users\\isick\\Folder', 'C:\\Users\\isick\\Folder\\nested'),
    true
  );
  assert.equal(
    __testables.isSelfOrDescendantPath('C:\\Users\\isick\\Folder', 'C:\\Users\\isick\\Other'),
    false
  );
});

test('isSameFilesystemEntry returns true when dev and ino match', () => {
  assert.equal(
    __testables.isSameFilesystemEntry(
      { dev: 1, ino: 42 },
      { dev: 1, ino: 42 }
    ),
    true
  );
});

test('isSameFilesystemEntry returns false when ino differs', () => {
  assert.equal(
    __testables.isSameFilesystemEntry(
      { dev: 1, ino: 42 },
      { dev: 1, ino: 43 }
    ),
    false
  );
});

test('isSameFilesystemEntry returns false when ino is missing or zero', () => {
  assert.equal(__testables.isSameFilesystemEntry({ dev: 1 }, { dev: 1, ino: 5 }), false);
  assert.equal(
    __testables.isSameFilesystemEntry(
      { dev: 1, ino: 0 },
      { dev: 1, ino: 0 }
    ),
    false
  );
});

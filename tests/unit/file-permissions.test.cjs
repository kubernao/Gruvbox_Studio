'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getPermissionsReadonly } = require('../../src/electron-main/ipc/handlers/file-permissions.js');

describe('getPermissionsReadonly', () => {
  test('writable temp file is not readonly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-ed-'));
    const f = path.join(dir, 'writable.txt');
    fs.writeFileSync(f, 'hello');
    try {
      const stats = fs.statSync(f);
      assert.strictEqual(getPermissionsReadonly(f, stats), false);
    } finally {
      fs.unlinkSync(f);
      fs.rmdirSync(dir);
    }
  });

  test('directories are not treated as file-readonly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-ed-dir-'));
    try {
      const stats = fs.statSync(dir);
      assert.strictEqual(stats.isDirectory(), true);
      assert.strictEqual(getPermissionsReadonly(dir, stats), false);
    } finally {
      fs.rmdirSync(dir);
    }
  });

  test('chmod 0444 file is readonly on Unix', (t) => {
    if (process.platform === 'win32') {
      t.skip('chmod read-only is not portable on Windows in this test');
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-ed-ro-'));
    const f = path.join(dir, 'locked.txt');
    fs.writeFileSync(f, 'x');
    fs.chmodSync(f, 0o444);
    try {
      const stats = fs.statSync(f);
      assert.strictEqual(getPermissionsReadonly(f, stats), true);
    } finally {
      fs.chmodSync(f, 0o644);
      fs.unlinkSync(f);
      fs.rmdirSync(dir);
    }
  });
});

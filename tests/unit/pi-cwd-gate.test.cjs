const test = require('node:test');
const assert = require('node:assert/strict');

const { assertValidCwd } = require('../../src/electron-main/ipc/handlers/pi-tool-reliability/workspaceIntegrity');

test('assertValidCwd returns resolved path for existing directory', async () => {
  const resolved = await assertValidCwd(process.cwd());
  assert.equal(typeof resolved, 'string');
  assert.equal(resolved.length > 0, true);
});

test('assertValidCwd throws cwd_missing for missing directory', async () => {
  await assert.rejects(
    () => assertValidCwd('/definitely/missing/workspace/path'),
    (error) => error && error.code === 'cwd_missing',
  );
});

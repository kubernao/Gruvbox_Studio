/**
 * credentials-store unit tests — file-backed fallback persistence.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCredentialsStore, createFileCredentialsStore } = require('../../src/electron-main/credentials/credentials-store');

async function withTempStore(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gruvbox-cred-test-'));
  const filePath = path.join(dir, 'credentials.json');
  const keytar = createFileCredentialsStore(filePath);
  const store = createCredentialsStore({ keytarClient: keytar });
  try {
    await run(store, filePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testRoundTrip() {
  await withTempStore(async (store) => {
    await store.setOpenRouterKey('or-secret');
    await store.setOpenAiKey('oai-secret');
    assert.equal(await store.getOpenRouterKey(), 'or-secret');
    assert.equal(await store.getOpenAiKey(), 'oai-secret');
    const status = await store.getStatus();
    assert.equal(status.openRouter.configured, true);
    assert.equal(status.openAi.configured, true);
    await store.clearOpenRouterKey();
    assert.equal(await store.getOpenRouterKey(), null);
    const after = await store.getStatus();
    assert.equal(after.openRouter.configured, false);
    assert.equal(after.openAi.configured, true);
  });
}

async function main() {
  await testRoundTrip();
  console.log('credentials-store.test.cjs: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { repoHasAgentQaRunner } = require('../../src/electron-main/ipc/handlers/pi-agent-qa-eligibility.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-elig-'));
}

test('repoHasAgentQaRunner: false for empty path', () => {
  assert.equal(repoHasAgentQaRunner(''), false);
  assert.equal(repoHasAgentQaRunner('   '), false);
});

test('repoHasAgentQaRunner: false when script and package both missing', () => {
  const dir = tempDir();
  assert.equal(repoHasAgentQaRunner(dir), false);
});

test('repoHasAgentQaRunner: false when only package.json exists', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  assert.equal(repoHasAgentQaRunner(dir), false);
});

test('repoHasAgentQaRunner: true when script and package exist', () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(dir, 'scripts/run-agent-qa.cjs'), '// stub', 'utf8');
  assert.equal(repoHasAgentQaRunner(dir), true);
});

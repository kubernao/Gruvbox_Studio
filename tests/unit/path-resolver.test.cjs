const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveFuzzyPath } = require('../../src/electron-main/ipc/handlers/pi-tool-reliability/pathResolver');

test('resolves high-confidence fuzzy path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gvx-path-'));
  const file = path.join(root, 'src', 'feature', 'story.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'hello', 'utf8');
  const result = resolveFuzzyPath({
    queryPath: 'src/featur/stroy.md',
    cwd: root,
    highConfidenceThreshold: 0.4,
    confidenceMargin: 0,
  });
  assert.equal(result.resolved, file);
});

test('does not auto-resolve low confidence fuzzy path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gvx-path-'));
  const file = path.join(root, 'docs', 'guide.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'hello', 'utf8');
  const result = resolveFuzzyPath({
    queryPath: 'something/completely-different.ts',
    cwd: root,
    highConfidenceThreshold: 0.95,
    confidenceMargin: 0.2,
  });
  assert.equal(result.resolved, null);
  assert.ok(Array.isArray(result.candidates));
});

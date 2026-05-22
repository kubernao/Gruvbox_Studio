const test = require('node:test');
const assert = require('node:assert/strict');

const { parsePorcelainZ } = require('../../src/electron-main/ipc/handlers/pi-gui');

test('parsePorcelainZ parses leading-space modified entries correctly', () => {
  const raw = ' M .gruvbox/memory/project-memory.json\0 M untitled-2.md\0';
  const entries = parsePorcelainZ(raw);
  assert.deepEqual(entries, [
    { status: ' M', path: '.gruvbox/memory/project-memory.json' },
    { status: ' M', path: 'untitled-2.md' },
  ]);
});

test('parsePorcelainZ handles paths with spaces', () => {
  const raw = ' M docs/my story.md\0?? notes/new idea.md\0';
  const entries = parsePorcelainZ(raw);
  assert.deepEqual(entries, [
    { status: ' M', path: 'docs/my story.md' },
    { status: '??', path: 'notes/new idea.md' },
  ]);
});

test('parsePorcelainZ skips rename source token and keeps destination', () => {
  const raw = 'R  old-name.md\0new-name.md\0';
  const entries = parsePorcelainZ(raw);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'R ');
  assert.ok(entries[0].path === 'old-name.md' || entries[0].path === 'new-name.md');
});

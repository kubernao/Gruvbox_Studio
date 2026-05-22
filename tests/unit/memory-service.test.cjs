'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  composeMemoryPreamble,
  upsertProjectEntry,
  getProjectStats,
  clearProjectEntries,
  requestProjectRescan,
  consumeOrientPending,
  isOrientPending,
  REMEMBER_DIRECTIVE,
  ORIENT_DIRECTIVE,
} = require('../../src/electron-main/memory/memory-service.js');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gb-mem-'));
}

describe('composeMemoryPreamble', () => {
  test('emits remember directive when project scope is set', () => {
    const text = composeMemoryPreamble({ style: '', rules: '' }, { hits: [] }, {
      hasProjectScope: true,
      projectEmpty: false,
      orientationMode: 'auto',
    });
    assert.ok(text.includes(REMEMBER_DIRECTIVE), 'remember directive expected');
    assert.ok(!text.includes(ORIENT_DIRECTIVE), 'orient directive should not appear when not empty');
  });

  test('emits orient directive only when projectEmpty + auto', () => {
    const empty = composeMemoryPreamble({ style: '', rules: '' }, { hits: [] }, {
      hasProjectScope: true,
      projectEmpty: true,
      orientationMode: 'auto',
    });
    assert.ok(empty.includes(ORIENT_DIRECTIVE));
    const nonEmpty = composeMemoryPreamble({ style: '', rules: '' }, { hits: [] }, {
      hasProjectScope: true,
      projectEmpty: false,
      orientationMode: 'auto',
    });
    assert.ok(!nonEmpty.includes(ORIENT_DIRECTIVE));
  });

  test('rescan mode forces orient directive even when project not empty', () => {
    const text = composeMemoryPreamble({ style: '', rules: '' }, { hits: [] }, {
      hasProjectScope: true,
      projectEmpty: false,
      orientationMode: 'rescan',
    });
    assert.ok(text.includes(ORIENT_DIRECTIVE));
  });

  test('no project scope -> no directives', () => {
    const text = composeMemoryPreamble({ style: '', rules: '' }, { hits: [] }, {
      hasProjectScope: false,
    });
    assert.ok(!text.includes(REMEMBER_DIRECTIVE));
    assert.ok(!text.includes(ORIENT_DIRECTIVE));
    assert.strictEqual(text, '');
  });

  test('global style + rules render in fixed order', () => {
    const text = composeMemoryPreamble({ style: 'voice: terse', rules: 'no semicolons' }, { hits: [] }, {
      hasProjectScope: true,
      projectEmpty: true,
      orientationMode: 'auto',
    });
    const styleAt = text.indexOf('<gruvbox:style>');
    const rulesAt = text.indexOf('<gruvbox:rules>');
    assert.ok(styleAt >= 0 && rulesAt > styleAt, 'style precedes rules');
    assert.ok(text.includes('voice: terse'));
    assert.ok(text.includes('no semicolons'));
  });

  test('hits render with kind/score/source attributes', () => {
    const text = composeMemoryPreamble({ style: '', rules: '' }, {
      hits: [
        { kind: 'character', score: 0.42, source: 'ai', title: 'Alice', body: 'green eyes' },
      ],
    }, { hasProjectScope: true });
    assert.ok(text.includes('<gruvbox:hit kind="character" score="0.42" source="ai">'));
    assert.ok(text.includes('Alice'));
    assert.ok(text.includes('green eyes'));
  });
});

describe('project stats and clearing', () => {
  test('getProjectStats reflects entry count and last updatedAt', async () => {
    const root = tempProject();
    try {
      let stats = await getProjectStats(root);
      assert.deepStrictEqual(stats, { count: 0, lastUpdated: null });

      await upsertProjectEntry(root, { kind: 'note', title: 'A', body: 'first' });
      await upsertProjectEntry(root, { kind: 'fact', title: 'B', body: 'second' });

      stats = await getProjectStats(root);
      assert.strictEqual(stats.count, 2);
      assert.ok(typeof stats.lastUpdated === 'number' && stats.lastUpdated > 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('clearProjectEntries empties entries but preserves manuscript config', async () => {
    const root = tempProject();
    try {
      await upsertProjectEntry(root, { kind: 'note', title: 'A', body: 'first' });
      const dbPath = path.join(root, '.gruvbox', 'memory', 'project-memory.json');
      const before = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      assert.strictEqual(before.entries.length, 1);
      assert.ok(before.manuscript && Array.isArray(before.manuscript.includeGlobs));

      const result = await clearProjectEntries(root);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.cleared, 1);

      const after = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      assert.strictEqual(after.entries.length, 0);
      assert.deepStrictEqual(after.manuscript, before.manuscript);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('orient-pending marker', () => {
  test('request -> isOrientPending true -> consume returns true and clears flag', async () => {
    const root = tempProject();
    try {
      assert.strictEqual(await isOrientPending(root), false);
      await requestProjectRescan(root);
      assert.strictEqual(await isOrientPending(root), true);
      const consumed = await consumeOrientPending(root);
      assert.strictEqual(consumed, true);
      assert.strictEqual(await isOrientPending(root), false);
      const second = await consumeOrientPending(root);
      assert.strictEqual(second, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTurnQaPolicy } = require('../../src/electron-main/ipc/handlers/pi-turn-qa-policy.cjs');

test('legacy: git-derived alone requests QA', () => {
  const r = resolveTurnQaPolicy({
    touchedRelativeFiles: [],
    gitDerivedTouchedFiles: ['a.md'],
    toolStartCount: 0,
  });
  assert.equal(r.runQa, true);
});

test('worktree gate: git-derived alone does not request QA', () => {
  const r = resolveTurnQaPolicy({
    touchedRelativeFiles: [],
    gitDerivedTouchedFiles: ['a.md'],
    toolStartCount: 0,
    useWorktreeHeadGate: true,
    headChangedThisTurn: false,
  });
  assert.equal(r.runQa, false);
  assert.equal(r.skipReason, 'qa_skipped_read_only_turn');
});

test('worktree gate: tool-touched requests QA', () => {
  const r = resolveTurnQaPolicy({
    touchedRelativeFiles: ['x.md'],
    gitDerivedTouchedFiles: [],
    toolStartCount: 1,
    useWorktreeHeadGate: true,
    headChangedThisTurn: false,
  });
  assert.equal(r.runQa, true);
});

test('worktree gate: HEAD advance without tool paths requests QA', () => {
  const r = resolveTurnQaPolicy({
    touchedRelativeFiles: [],
    gitDerivedTouchedFiles: ['a.md'],
    toolStartCount: 0,
    useWorktreeHeadGate: true,
    headChangedThisTurn: true,
  });
  assert.equal(r.runQa, true);
});

test('worktree gate: tools ran but no mutation signal uses worktree skip reason', () => {
  const r = resolveTurnQaPolicy({
    touchedRelativeFiles: [],
    gitDerivedTouchedFiles: [],
    toolStartCount: 2,
    useWorktreeHeadGate: true,
    headChangedThisTurn: false,
  });
  assert.equal(r.runQa, false);
  assert.equal(r.skipReason, 'qa_skipped_worktree_no_mutation_this_turn');
});

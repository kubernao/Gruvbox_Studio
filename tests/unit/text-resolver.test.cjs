const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveFuzzyText } = require('../../src/electron-main/ipc/handlers/pi-tool-reliability/textResolver');

test('returns exact fuzzy text match when present', () => {
  const fileText = 'const x = 1;\nconsole.log(x);\n';
  const result = resolveFuzzyText({
    oldText: 'console.log(x);',
    fileText,
  });
  assert.equal(result.ok, true);
  assert.equal(result.exact, true);
});

test('marks ambiguous text as not ok when score gap is low', () => {
  const fileText = 'value = 1\nvalue = 2\nvalue = 3\n';
  const result = resolveFuzzyText({
    oldText: 'valu =',
    fileText,
    highThreshold: 0.99,
    minGap: 0.2,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ambiguous, true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  classifyQaFailure,
  executeQaTier,
  QA_STEPS_BY_TIER,
  parseArgs,
} = require('../../scripts/run-agent-qa.cjs');

test('parseArgs reads tier, cwd and output path', () => {
  const parsed = parseArgs(['--tier=smoke', '--cwd', '.', '--out', 'tmp/report.json']);
  assert.equal(parsed.tier, 'smoke');
  assert.equal(typeof parsed.cwd, 'string');
  assert.equal(parsed.out.endsWith(path.join('tmp', 'report.json')), true);
});

test('parseArgs enables continue-on-fail when passed', () => {
  const parsed = parseArgs(['--tier=fast', '--continue-on-fail']);
  assert.equal(parsed.continueOnFail, true);
});

test('classifyQaFailure returns deterministic failure by default', () => {
  const failureType = classifyQaFailure({
    status: 'failed',
    stdout: 'Test suite failed',
    stderr: 'AssertionError: expected 1 to equal 2',
  });
  assert.equal(failureType, 'deterministic_test_failure');
});

test('classifyQaFailure detects infra failure patterns', () => {
  const failureType = classifyQaFailure({
    status: 'failed',
    stdout: '',
    stderr: 'spawn ENOENT npm',
  });
  assert.equal(failureType, 'infra_failure');
});

test('classifyQaFailure keeps assertion output deterministic even when it mentions network', () => {
  const failureType = classifyQaFailure({
    status: 'failed',
    stdout: 'AssertionError: expected network request mock to be called once',
    stderr: '',
  });
  assert.equal(failureType, 'deterministic_test_failure');
});

test('classifyQaFailure detects concrete network infra outage patterns', () => {
  const failureType = classifyQaFailure({
    status: 'failed',
    stdout: '',
    stderr: 'Fetch failed with ECONNREFUSED and socket hang up',
  });
  assert.equal(failureType, 'infra_failure');
});

test('classifyQaFailure detects policy failures from warning-only output', () => {
  const failureType = classifyQaFailure({
    status: 'failed',
    stdout: '1 warning found',
    stderr: '',
  });
  assert.equal(failureType, 'policy_failure');
});

test('tmp report parent path can be created by caller flow', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-runner-'));
  const nested = path.join(parent, 'nested', 'qa-report.json');
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, '{"ok":true}', 'utf8');
  assert.equal(fs.existsSync(nested), true);
});

test('executeQaTier continues steps when continue-on-fail is enabled', () => {
  const original = QA_STEPS_BY_TIER.fast;
  QA_STEPS_BY_TIER.fast = [
    { name: 'fail-step', command: 'node -e "process.exit(1)"' },
    { name: 'pass-step', command: 'node -e "console.log(123)"' },
  ];
  try {
    const outPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-report-')), 'report.json');
    const report = executeQaTier({
      tier: 'fast',
      cwd: process.cwd(),
      out: outPath,
      continueOnFail: true,
    });
    assert.equal(report.steps.length, 2);
    assert.equal(report.passed, false);
    assert.equal(Array.isArray(report.issues), true);
  } finally {
    QA_STEPS_BY_TIER.fast = original;
  }
});

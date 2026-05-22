const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBacklog,
  classifyTier,
} = require('../../scripts/generate-e2e-scenario-backlog.cjs');

test('classifyTier returns expected buckets', () => {
  assert.equal(classifyTier(82), 'critical');
  assert.equal(classifyTier(56), 'high');
  assert.equal(classifyTier(40), 'medium');
  assert.equal(classifyTier(20), 'low');
});

test('buildBacklog ranks higher-risk journeys first and maps tests', () => {
  const signals = [
    {
      journeyId: 'stable_flow',
      title: 'Stable flow',
      sessions: 200,
      rageClicks: 1,
      deadClicks: 2,
      abandonmentRate: 0.02,
      completionTimeMsP95: 4200,
      impactedUsers: 15,
      severity: 2,
    },
    {
      journeyId: 'risky_flow',
      title: 'Risky flow',
      sessions: 120,
      rageClicks: 32,
      deadClicks: 44,
      abandonmentRate: 0.34,
      completionTimeMsP95: 48000,
      impactedUsers: 90,
      severity: 5,
    },
  ];
  const catalog = [
    {
      journeyId: 'stable_flow',
      owner: 'core',
      hasDeterministicFixture: true,
      tests: ['tests/e2e/stable-flow.test.ts'],
    },
    {
      journeyId: 'risky_flow',
      owner: 'core',
      hasDeterministicFixture: false,
      tests: [],
    },
  ];

  const backlog = buildBacklog(signals, catalog);
  assert.equal(backlog.length, 2);
  assert.equal(backlog[0].journeyId, 'risky_flow');
  assert.equal(backlog[0].score > backlog[1].score, true);
  assert.deepEqual(backlog[1].mappedTests, ['tests/e2e/stable-flow.test.ts']);
});

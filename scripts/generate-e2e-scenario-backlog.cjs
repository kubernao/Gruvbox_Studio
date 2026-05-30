#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_INPUT_PATH = path.resolve(process.cwd(), 'tests/fixtures/ux-signals/production-signals.sample.json');
const DEFAULT_CATALOG_PATH = path.resolve(process.cwd(), 'tests/e2e/scenario-catalog.json');
const DEFAULT_OUTPUT_JSON_PATH = path.resolve(process.cwd(), '.cursor/reports/e2e-scenario-backlog.json');
const DEFAULT_OUTPUT_MD_PATH = path.resolve(process.cwd(), '.cursor/reports/e2e-scenario-backlog.md');

function toNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function scoreJourney(signal, catalogEntry) {
  const deadClicks = toNumber(signal.deadClicks);
  const rageClicks = toNumber(signal.rageClicks);
  const abandonmentRate = toNumber(signal.abandonmentRate);
  const completionTimeMsP95 = toNumber(signal.completionTimeMsP95);
  const sessions = Math.max(1, toNumber(signal.sessions));
  const impactedUsers = toNumber(signal.impactedUsers);
  const severity = Math.max(1, toNumber(signal.severity));

  const normalizedAbandonment = Math.min(1, Math.max(0, abandonmentRate));
  const completionPenalty = Math.min(1, completionTimeMsP95 / 60_000);
  const rageRate = rageClicks / sessions;
  const deadRate = deadClicks / sessions;
  const impactedWeight = Math.min(1, impactedUsers / 1000);

  const behaviorRisk = rageRate * 35 + deadRate * 20 + normalizedAbandonment * 30 + completionPenalty * 15;
  const businessRisk = severity * 12 + impactedWeight * 20;
  const confidenceBoost = catalogEntry?.hasDeterministicFixture ? 5 : 0;
  const score = Math.round((behaviorRisk + businessRisk + confidenceBoost) * 10) / 10;

  return score;
}

function classifyTier(score) {
  if (score >= 80) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function buildBacklog(signals, catalog) {
  const catalogMap = new Map(catalog.map((entry) => [entry.journeyId, entry]));

  const ranked = signals
    .map((signal) => {
      const entry = catalogMap.get(signal.journeyId) || null;
      const score = scoreJourney(signal, entry);
      return {
        journeyId: signal.journeyId,
        title: signal.title || signal.journeyId,
        score,
        tier: classifyTier(score),
        signals: {
          sessions: toNumber(signal.sessions),
          rageClicks: toNumber(signal.rageClicks),
          deadClicks: toNumber(signal.deadClicks),
          abandonmentRate: toNumber(signal.abandonmentRate),
          completionTimeMsP95: toNumber(signal.completionTimeMsP95),
          impactedUsers: toNumber(signal.impactedUsers),
          severity: Math.max(1, toNumber(signal.severity)),
        },
        mappedTests: entry?.tests ?? [],
        owner: entry?.owner ?? 'unassigned',
        hasDeterministicFixture: Boolean(entry?.hasDeterministicFixture),
        notes: signal.notes || '',
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked;
}

function toMarkdown(backlog) {
  const lines = [];
  lines.push('# E2E Scenario Backlog');
  lines.push('');
  lines.push('Generated from production UX signals. Highest score should be converted into deterministic Playwright coverage first.');
  lines.push('');
  lines.push('| Priority | Journey | Score | Tier | Mapped tests | Deterministic fixture |');
  lines.push('| --- | --- | ---: | --- | --- | --- |');
  backlog.forEach((item, index) => {
    const tests = item.mappedTests.length > 0 ? item.mappedTests.join('<br/>') : '_none_';
    lines.push(
      `| ${index + 1} | ${item.title} (\`${item.journeyId}\`) | ${item.score} | ${item.tier} | ${tests} | ${item.hasDeterministicFixture ? 'yes' : 'no'} |`
    );
  });
  lines.push('');
  lines.push('## Action rules');
  lines.push('');
  lines.push('- Convert all `critical` and `high` items into deterministic E2E/visual checks.');
  lines.push('- If a critical journey has no mapped test, add a new test spec in `tests/e2e` before release.');
  lines.push('- Keep fixture-backed setup for every newly added journey.');
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT_PATH,
    catalog: DEFAULT_CATALOG_PATH,
    outputJson: DEFAULT_OUTPUT_JSON_PATH,
    outputMd: DEFAULT_OUTPUT_MD_PATH,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input' && argv[i + 1]) args.input = path.resolve(process.cwd(), argv[++i]);
    if (token === '--catalog' && argv[i + 1]) args.catalog = path.resolve(process.cwd(), argv[++i]);
    if (token === '--out-json' && argv[i + 1]) args.outputJson = path.resolve(process.cwd(), argv[++i]);
    if (token === '--out-md' && argv[i + 1]) args.outputMd = path.resolve(process.cwd(), argv[++i]);
  }
  return args;
}

function generateBacklogFiles(args) {
  const signalPayload = readJson(args.input);
  const catalogPayload = readJson(args.catalog);
  const signals = Array.isArray(signalPayload?.journeys) ? signalPayload.journeys : [];
  const catalog = Array.isArray(catalogPayload?.journeys) ? catalogPayload.journeys : [];
  const generatedAt = new Date().toISOString();
  const backlog = buildBacklog(signals, catalog);

  const jsonReport = {
    generatedAt,
    source: {
      input: args.input,
      catalog: args.catalog,
    },
    backlog,
  };
  writeText(args.outputJson, JSON.stringify(jsonReport, null, 2));
  writeText(args.outputMd, toMarkdown(backlog));

  return {
    generatedAt,
    total: backlog.length,
    criticalOrHigh: backlog.filter((item) => item.tier === 'critical' || item.tier === 'high').length,
    outputJson: args.outputJson,
    outputMd: args.outputMd,
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const result = generateBacklogFiles(args);
  process.stdout.write(
    `Generated scenario backlog (${result.total} journeys, ${result.criticalOrHigh} high-priority) at ${result.outputMd}\n`
  );
}

module.exports = {
  buildBacklog,
  classifyTier,
  generateBacklogFiles,
  parseArgs,
  scoreJourney,
  toMarkdown,
};

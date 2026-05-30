#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[key] = value;
    }
  }
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function runPlanner(args) {
  const feature = String(args.feature || '').trim();
  if (!feature) {
    throw new Error('planner requires --feature "<description>"');
  }
  const journeys = String(args.journeys || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const slug = slugify(feature) || `plan-${Date.now()}`;
  const outDir = path.resolve(process.cwd(), '.cursor/reports/playwright-plans');
  ensureDir(outDir);
  const outPath = path.join(outDir, `${slug}.md`);
  const plan = [
    `# Playwright Plan: ${feature}`,
    '',
    '## Critical journeys',
    ...(journeys.length > 0 ? journeys.map((j, i) => `${i + 1}. ${j}`) : ['1. Define critical user journey']),
    '',
    '## Test implementation',
    '- Add/update deterministic specs in `tests/e2e`.',
    '- Reuse `tests/e2e/helpers/electronApp.ts`.',
    '- Use stable selectors and condition-based assertions.',
    '',
    '## Validation commands',
    '- `npm run test:e2e:smoke`',
    '- `npm run test:visual` (if visual checkpoints are touched)',
    '- `npm run qa:smoke`',
    '',
  ].join('\n');
  fs.writeFileSync(outPath, plan, 'utf8');
  process.stdout.write(`Planner output: ${outPath}\n`);
}

function runGenerator(args) {
  const name = String(args.name || '').trim();
  if (!name) {
    throw new Error('generator requires --name "<spec-name>"');
  }
  const targetDir = path.resolve(process.cwd(), String(args.dir || 'tests/e2e'));
  ensureDir(targetDir);
  const fileName = `${slugify(name) || 'new-e2e'}.test.ts`;
  const filePath = path.join(targetDir, fileName);
  if (fs.existsSync(filePath)) {
    process.stdout.write(`Generator skipped (exists): ${filePath}\n`);
    return;
  }
  const content = `import { test, expect } from '@playwright/test';
import { launchElectronApp } from './helpers/electronApp';

test.describe('${name}', () => {
  test.describe.configure({ timeout: 120_000 });

  test('validates critical user outcome', async () => {
    const { app, page } = await launchElectronApp();
    try {
      await expect(page.locator('.app-root')).toBeVisible();
      // TODO: implement deterministic steps + assertions for "${name}".
    } finally {
      await app.close();
    }
  });
});
`;
  fs.writeFileSync(filePath, content, 'utf8');
  process.stdout.write(`Generator output: ${filePath}\n`);
}

function runHealer(args) {
  const spec = String(args.spec || '').trim();
  if (!spec) {
    throw new Error('healer requires --spec "<tests/e2e/file.test.ts>"');
  }
  const specPath = path.resolve(process.cwd(), spec);
  const reportDir = path.resolve(process.cwd(), '.cursor/reports/playwright-heal');
  ensureDir(reportDir);
  const jsonReport = path.join(reportDir, `${slugify(path.basename(spec)) || 'heal'}.json`);
  const proc = spawnSync(
    `node scripts/ensure-e2e-package.cjs && npx playwright test "${specPath}" --reporter=json`,
    {
    cwd: process.cwd(),
    shell: true,
    encoding: 'utf8',
    env: process.env,
    },
  );
  const raw = `${proc.stdout || ''}\n${proc.stderr || ''}`;
  let parsed = null;
  try {
    parsed = JSON.parse(proc.stdout || '{}');
  } catch {
    parsed = null;
  }
  const summary = {
    spec: specPath,
    exitCode: typeof proc.status === 'number' ? proc.status : -1,
    passed: proc.status === 0,
    generatedAt: new Date().toISOString(),
    report: parsed,
    rawPreview: raw.slice(0, 5000),
  };
  fs.writeFileSync(jsonReport, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  process.stdout.write(`Healer report: ${jsonReport}\n`);
  if (proc.status !== 0) process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const role = String(args.role || '').trim();
  if (role === 'planner') return runPlanner(args);
  if (role === 'generator') return runGenerator(args);
  if (role === 'healer') return runHealer(args);
  throw new Error('Usage: node scripts/run-playwright-agent.cjs --role <planner|generator|healer> [...]');
}

main();

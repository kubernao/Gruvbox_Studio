#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_REPORT_PATH = path.resolve(process.cwd(), '.cursor/reports/qa-session-report.json');

const QA_STEPS_BY_TIER = {
  fast: [
    { name: 'typecheck', command: 'npm run typecheck' },
    { name: 'lint:bridge', command: 'npm run lint:bridge' },
    { name: 'lint:generated', command: 'npm run lint:generated' },
    { name: 'test:unit', command: 'npm run test:unit' },
  ],
  smoke: [
    { name: 'test:smoke', command: 'npm run test:smoke' },
    { name: 'test:e2e:smoke', command: 'npm run test:e2e:smoke' },
    { name: 'lint:pi', command: 'npm run lint:pi' },
  ],
  full: [
    { name: 'quality:ci', command: 'npm run quality:ci' },
    { name: 'test:e2e', command: 'npm test' },
  ],
};

const PRE_QA_STEPS_BY_TIER = {
  smoke: [
    {
      name: 'preflight:e2e-package',
      command: 'node scripts/ensure-e2e-package.cjs',
    },
  ],
  full: [
    {
      name: 'preflight:e2e-package',
      command: 'node scripts/ensure-e2e-package.cjs',
    },
  ],
};

function parseArgs(argv) {
  const result = {
    tier: 'fast',
    cwd: process.cwd(),
    out: DEFAULT_REPORT_PATH,
    continueOnFail: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--tier=')) result.tier = token.slice('--tier='.length).trim();
    else if (token === '--tier' && argv[i + 1]) result.tier = String(argv[++i]).trim();
    else if (token.startsWith('--cwd=')) result.cwd = path.resolve(process.cwd(), token.slice('--cwd='.length));
    else if (token === '--cwd' && argv[i + 1]) result.cwd = path.resolve(process.cwd(), String(argv[++i]));
    else if (token.startsWith('--out=')) result.out = path.resolve(process.cwd(), token.slice('--out='.length));
    else if (token === '--out' && argv[i + 1]) result.out = path.resolve(process.cwd(), String(argv[++i]));
    else if (token === '--continue-on-fail') result.continueOnFail = true;
  }
  return result;
}

function classifyQaFailure(step) {
  const output = `${step.stdout}\n${step.stderr}`.toLowerCase();
  if (step.status === 'passed') return 'none';
  if (/error ts\d+:/.test(output)) return 'deterministic_test_failure';
  if (/assertionerror|failing test|failed [0-9]+ tests?/.test(output)) return 'deterministic_test_failure';
  if (/cannot find module/.test(output)) return 'deterministic_test_failure';
  if (/enoent|command not found|eacces|permission denied/.test(output)) return 'infra_failure';
  if (/webpack output is missing|cannot start the app without a built renderer|packaged app missing|no packaged app found under out\//.test(
    output,
  ))
    return 'infra_failure';
  if (
    /timed out|temporarily unavailable|econnrefused|econnreset|enotfound|network is unreachable|socket hang up|dns lookup failed|unable to reach/.test(
      output,
    )
  )
    return 'infra_failure';
  if (/warning/.test(output) && !/error/.test(output)) return 'policy_failure';
  if (/flaky|retry|on-first-retry/.test(output)) return 'flaky_retry_pass';
  return 'deterministic_test_failure';
}

function extractIssues(step) {
  const text = `${step.stdout}\n${step.stderr}`;
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const issues = [];
  const pushIssue = (kind, message) => {
    if (!message || message.length < 4) return;
    const normalized = message.replace(/\s+/g, ' ').trim();
    if (!issues.some((issue) => issue.kind === kind && issue.message === normalized)) {
      issues.push({ kind, message: normalized });
    }
  };
  for (const line of lines) {
    if (/error ts\d+:/i.test(line)) pushIssue('typescript', line);
    else if (/assertionerror|expected .* to .*|failing test|failed [0-9]+ tests?/i.test(line)) pushIssue('test', line);
    else if (/eslint|biome|lint/i.test(line) && /error|warning/i.test(line)) pushIssue('lint', line);
    else if (/cannot find module|module not found|missing script/i.test(line)) pushIssue('configuration', line);
  }
  return issues.slice(0, 30);
}

function runStep(step, cwd) {
  const startedAt = Date.now();
  const proc = spawnSync(step.command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    env: process.env,
  });
  const endedAt = Date.now();
  const output = `${proc.stdout || ''}\n${proc.stderr || ''}`.trim();
  const status = proc.status === 0 ? 'passed' : 'failed';
  const result = {
    name: step.name,
    command: step.command,
    status,
    exitCode: typeof proc.status === 'number' ? proc.status : -1,
    durationMs: endedAt - startedAt,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    outputPreview: output.slice(0, 2400),
  };
  result.failureType = classifyQaFailure(result);
  result.issues = extractIssues(result);
  return result;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function executeQaTier(options) {
  const steps = QA_STEPS_BY_TIER[options.tier];
  if (!steps) {
    throw new Error(`Unknown QA tier: ${options.tier}`);
  }
  const preSteps = PRE_QA_STEPS_BY_TIER[options.tier] || [];
  const startedAt = Date.now();
  const results = [];
  for (const step of preSteps) {
    const res = runStep(step, options.cwd);
    results.push(res);
    if (res.status === 'failed' && !options.continueOnFail) break;
  }
  if (results.some((step) => step.status === 'failed') && !options.continueOnFail) {
    const endedAt = Date.now();
    const failedStep = results.find((step) => step.status === 'failed') || null;
    const report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      tier: options.tier,
      cwd: options.cwd,
      durationMs: endedAt - startedAt,
      passed: false,
      failureType: failedStep ? failedStep.failureType : 'none',
      stopReason: 'required_check_failed',
      issues: results.flatMap((step) => step.issues || []).slice(0, 100),
      steps: results.map((step) => ({
        name: step.name,
        command: step.command,
        status: step.status,
        exitCode: step.exitCode,
        durationMs: step.durationMs,
        failureType: step.failureType,
        outputPreview: step.outputPreview,
        issues: step.issues,
      })),
    };
    ensureParentDir(options.out);
    fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return report;
  }
  for (const step of steps) {
    const res = runStep(step, options.cwd);
    results.push(res);
    if (res.status === 'failed' && !options.continueOnFail) break;
  }
  const endedAt = Date.now();
  const failedStep = results.find((step) => step.status === 'failed') || null;
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    tier: options.tier,
    cwd: options.cwd,
    durationMs: endedAt - startedAt,
    passed: failedStep === null,
    failureType: failedStep ? failedStep.failureType : 'none',
    stopReason: failedStep
      ? options.continueOnFail
        ? 'completed_with_failures'
        : 'required_check_failed'
      : 'all_required_checks_passed',
    issues: results.flatMap((step) => step.issues || []).slice(0, 100),
    steps: results.map((step) => ({
      name: step.name,
      command: step.command,
      status: step.status,
      exitCode: step.exitCode,
      durationMs: step.durationMs,
      failureType: step.failureType,
      outputPreview: step.outputPreview,
      issues: step.issues,
    })),
  };
  ensureParentDir(options.out);
  fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  const report = executeQaTier(options);
  process.stdout.write(
    `${report.passed ? 'PASS' : 'FAIL'} tier=${report.tier} steps=${report.steps.length} issues=${report.issues.length} report=${options.out}\n`,
  );
  if (!report.passed) {
    process.exitCode = 1;
  }
}

module.exports = {
  QA_STEPS_BY_TIER,
  classifyQaFailure,
  executeQaTier,
  parseArgs,
};

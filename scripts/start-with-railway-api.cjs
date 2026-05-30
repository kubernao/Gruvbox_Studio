#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const STUDIO_ROOT = path.resolve(__dirname, '..');
const API_ROOT = path.resolve(STUDIO_ROOT, '..', 'Gruvbox_api');
const API_SERVICE_NAME = process.env.GRUVBOX_API_RAILWAY_SERVICE || 'Gruvbox_api';
const FALLBACK_API_BASE_URL = 'https://gruvboxapi-production.up.railway.app';

function runRailway(args) {
  const proc = spawnSync('railway', args, {
    cwd: API_ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  if (proc.status !== 0) {
    const stderr = String(proc.stderr || '').trim();
    const stdout = String(proc.stdout || '').trim();
    throw new Error(stderr || stdout || `railway ${args.join(' ')} failed`);
  }
  return String(proc.stdout || '').trim();
}

function parseJson(raw, source) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse JSON from ${source}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function toHttpsUrl(domain) {
  const value = String(domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!value) return '';
  return `https://${value}`;
}

function resolveFromStatus(statusJson) {
  const envEdges = statusJson?.environments?.edges;
  if (!Array.isArray(envEdges)) return '';
  for (const envEdge of envEdges) {
    const serviceEdges = envEdge?.node?.serviceInstances?.edges;
    if (!Array.isArray(serviceEdges)) continue;
    for (const serviceEdge of serviceEdges) {
      const node = serviceEdge?.node;
      if (node?.serviceName !== API_SERVICE_NAME) continue;
      const custom = Array.isArray(node?.domains?.customDomains) ? node.domains.customDomains : [];
      if (custom[0]?.domain) return toHttpsUrl(custom[0].domain);
      const service = Array.isArray(node?.domains?.serviceDomains) ? node.domains.serviceDomains : [];
      if (service[0]?.domain) return toHttpsUrl(service[0].domain);
    }
  }
  return '';
}

function resolveFromDomain(serviceName) {
  const raw = runRailway(['domain', '--service', serviceName, '--json']);
  const payload = parseJson(raw, 'railway domain --json');
  if (typeof payload?.domain === 'string' && payload.domain.trim() !== '') {
    return toHttpsUrl(payload.domain);
  }
  if (typeof payload?.hostname === 'string' && payload.hostname.trim() !== '') {
    return toHttpsUrl(payload.hostname);
  }
  throw new Error('Railway domain command did not return a domain.');
}

function resolveApiBaseUrl() {
  const status = parseJson(runRailway(['status', '--json']), 'railway status --json');
  const fromStatus = resolveFromStatus(status);
  if (fromStatus) return fromStatus;
  return resolveFromDomain(API_SERVICE_NAME);
}

function main() {
  let apiBase = '';
  try {
    apiBase = resolveApiBaseUrl();
  } catch (error) {
    const fallback = String(process.env.GRUVBOX_API_BASE_URL || '').trim() || FALLBACK_API_BASE_URL;
    process.stderr.write(
      `[gruvbox] Railway API auto-resolution failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.stderr.write(`[gruvbox] Falling back to API base URL: ${fallback}\n`);
    apiBase = fallback;
  }

  process.stdout.write(`[gruvbox] Using Railway API: ${apiBase}\n`);
  process.stdout.write('[gruvbox] Launching Studio with GRUVBOX_API_BASE_URL and explicit-base guard enabled.\n');
  process.stdout.write('[gruvbox] Startup route: start-railway.sh (includes EMFILE polling fallback).\n');

  const child = spawnSync('bash', ['./start-railway.sh'], {
    cwd: STUDIO_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      GRUVBOX_API_BASE_URL: apiBase,
      GRUVBOX_API_REQUIRE_EXPLICIT: '1',
    },
  });

  process.exitCode = typeof child.status === 'number' ? child.status : 1;
}

main();

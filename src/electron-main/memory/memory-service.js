const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EMBEDDING_DIM = 128;
const DEFAULT_RETRIEVAL_K = 8;
const DEFAULT_RETRIEVAL_MIN_SCORE = 0.15;
const DEFAULT_MAX_HITS_TOKENS = 2200;

function estimateTokens(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

function normalizeText(input) {
  return typeof input === 'string' ? input.trim() : '';
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
    .slice(0, 4096);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < EMBEDDING_DIM; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA <= 0 || magB <= 0) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function makeEmbedding(text) {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const h = crypto.createHash('sha1').update(token).digest();
    const idx = h[0] % EMBEDDING_DIM;
    const sign = h[1] % 2 === 0 ? 1 : -1;
    vec[idx] += sign;
  }
  return vec;
}

function globalDir(app) {
  return path.join(app.getPath('userData'), 'gruvbox-memory');
}

function globalPath(app, kind) {
  const file = kind === 'rules' ? 'rules.md' : 'style.md';
  return path.join(globalDir(app), file);
}

function projectDir(rootPath) {
  return path.join(rootPath, '.gruvbox', 'memory');
}

function projectDbPath(rootPath) {
  return path.join(projectDir(rootPath), 'project-memory.json');
}

function projectOrientPendingPath(rootPath) {
  return path.join(projectDir(rootPath), 'orient-pending.json');
}

function ensureProjectShape(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const entries = Array.isArray(base.entries) ? base.entries : [];
  const nextEntries = entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const title = normalizeText(entry.title);
      const body = normalizeText(entry.body);
      const kind = normalizeText(entry.kind || 'note') || 'note';
      if (!title && !body) return null;
      const text = `${title}\n${body}`.trim();
      return {
        id: typeof entry.id === 'string' && entry.id ? entry.id : `m-${crypto.randomUUID()}`,
        kind,
        title: title || 'Untitled',
        body,
        source: normalizeText(entry.source || 'manual') || 'manual',
        sourceRef: normalizeText(entry.sourceRef || ''),
        embedding: Array.isArray(entry.embedding) ? entry.embedding.slice(0, EMBEDDING_DIM) : makeEmbedding(text),
        updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
      };
    })
    .filter(Boolean);
  return {
    version: 1,
    entries: nextEntries,
    manuscript: base.manuscript && typeof base.manuscript === 'object' ? base.manuscript : { includeGlobs: ['**/*.md', '**/*.mdx'] },
  };
}

async function readUtf8IfExists(filePath) {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function readGlobalMemory(app) {
  const [style, rules] = await Promise.all([
    readUtf8IfExists(globalPath(app, 'style')),
    readUtf8IfExists(globalPath(app, 'rules')),
  ]);
  return { style, rules };
}

async function writeGlobalMemory(app, kind, content) {
  const cleanKind = kind === 'rules' ? 'rules' : 'style';
  await fs.promises.mkdir(globalDir(app), { recursive: true });
  await fs.promises.writeFile(globalPath(app, cleanKind), typeof content === 'string' ? content : '', 'utf8');
  return { ok: true };
}

async function ensureGlobalMemoryFiles(app) {
  await fs.promises.mkdir(globalDir(app), { recursive: true });
  const stylePath = globalPath(app, 'style');
  const rulesPath = globalPath(app, 'rules');
  for (const filePath of [stylePath, rulesPath]) {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
    } catch {
      await fs.promises.writeFile(filePath, '', 'utf8');
    }
  }
  return { stylePath, rulesPath };
}

async function bootstrapProjectMemory(rootPath) {
  const dir = projectDir(rootPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const db = projectDbPath(rootPath);
  try {
    await fs.promises.access(db, fs.constants.F_OK);
  } catch {
    await fs.promises.writeFile(db, JSON.stringify({ version: 1, entries: [], manuscript: { includeGlobs: ['**/*.md', '**/*.mdx'] } }, null, 2), 'utf8');
  }
  return { ok: true, path: db };
}

async function readProjectMemory(rootPath) {
  const dbPath = projectDbPath(rootPath);
  try {
    const raw = await fs.promises.readFile(dbPath, 'utf8');
    return ensureProjectShape(JSON.parse(raw));
  } catch {
    try {
      if (fs.existsSync(dbPath)) {
        const corruptPath = `${dbPath}.corrupt-${Date.now()}`;
        await fs.promises.rename(dbPath, corruptPath);
      }
    } catch {
      // best effort corrupt-file preservation
    }
    return ensureProjectShape({});
  }
}

async function writeProjectMemory(rootPath, data) {
  await fs.promises.mkdir(projectDir(rootPath), { recursive: true });
  const normalized = ensureProjectShape(data);
  const dbPath = projectDbPath(rootPath);
  const tmpPath = `${dbPath}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(normalized, null, 2), 'utf8');
  await fs.promises.rename(tmpPath, dbPath);
  return normalized;
}

async function upsertProjectEntry(rootPath, entry) {
  const current = await readProjectMemory(rootPath);
  const id = typeof entry?.id === 'string' && entry.id.trim() ? entry.id.trim() : `m-${crypto.randomUUID()}`;
  const title = normalizeText(entry?.title) || 'Untitled';
  const body = normalizeText(entry?.body);
  const kind = normalizeText(entry?.kind) || 'note';
  const source = normalizeText(entry?.source) || 'manual';
  const sourceRef = normalizeText(entry?.sourceRef);
  const text = `${title}\n${body}`.trim();
  const next = {
    id,
    title,
    body,
    kind,
    source,
    sourceRef,
    embedding: makeEmbedding(text),
    updatedAt: Date.now(),
  };
  const idx = current.entries.findIndex((candidate) => candidate.id === id);
  if (idx === -1) current.entries.push(next);
  else current.entries[idx] = next;
  const saved = await writeProjectMemory(rootPath, current);
  return { ok: true, entry: saved.entries.find((candidate) => candidate.id === id) || next };
}

async function deleteProjectEntry(rootPath, id) {
  const current = await readProjectMemory(rootPath);
  const nextEntries = current.entries.filter((entry) => entry.id !== id);
  const changed = nextEntries.length !== current.entries.length;
  if (changed) {
    await writeProjectMemory(rootPath, { ...current, entries: nextEntries });
  }
  return { ok: true, deleted: changed };
}

async function getProjectStats(rootPath) {
  const project = await readProjectMemory(rootPath);
  let lastUpdated = null;
  for (const entry of project.entries) {
    if (typeof entry.updatedAt === 'number' && (lastUpdated === null || entry.updatedAt > lastUpdated)) {
      lastUpdated = entry.updatedAt;
    }
  }
  return { count: project.entries.length, lastUpdated };
}

async function clearProjectEntries(rootPath) {
  const current = await readProjectMemory(rootPath);
  const cleared = { ...current, entries: [] };
  await writeProjectMemory(rootPath, cleared);
  return { ok: true, cleared: current.entries.length };
}

async function requestProjectRescan(rootPath) {
  await fs.promises.mkdir(projectDir(rootPath), { recursive: true });
  const payload = { requestedAt: Date.now() };
  await fs.promises.writeFile(projectOrientPendingPath(rootPath), JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true };
}

async function consumeOrientPending(rootPath) {
  const file = projectOrientPendingPath(rootPath);
  try {
    await fs.promises.access(file, fs.constants.F_OK);
  } catch {
    return false;
  }
  try {
    await fs.promises.unlink(file);
  } catch {
    // best-effort: still report pending
  }
  return true;
}

async function isOrientPending(rootPath) {
  try {
    await fs.promises.access(projectOrientPendingPath(rootPath), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function retrieveProjectMemory(rootPath, query, options = {}) {
  const q = normalizeText(query);
  if (!q) return { hits: [], totalTokens: 0 };
  const project = await readProjectMemory(rootPath);
  const queryEmbedding = makeEmbedding(q);
  const k = Number.isFinite(options.k) ? Math.max(1, Number(options.k)) : DEFAULT_RETRIEVAL_K;
  const minScore = Number.isFinite(options.minScore) ? Number(options.minScore) : DEFAULT_RETRIEVAL_MIN_SCORE;
  const maxTokens = Number.isFinite(options.maxTokens) ? Number(options.maxTokens) : DEFAULT_MAX_HITS_TOKENS;
  const ranked = project.entries
    .map((entry) => ({
      ...entry,
      score: cosineSimilarity(Array.isArray(entry.embedding) ? entry.embedding : makeEmbedding(`${entry.title}\n${entry.body}`), queryEmbedding),
      tokens: estimateTokens(`${entry.title}\n${entry.body}`),
    }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score);
  const hits = [];
  let totalTokens = 0;
  for (const item of ranked) {
    if (hits.length >= k) break;
    if (totalTokens + item.tokens > maxTokens) continue;
    hits.push({
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      score: Number(item.score.toFixed(4)),
      source: item.source,
      sourceRef: item.sourceRef,
      tokens: item.tokens,
    });
    totalTokens += item.tokens;
  }
  return { hits, totalTokens };
}

const REMEMBER_DIRECTIVE =
  'Use the memory_remember(kind, title, body) tool to persist any new important fact you learn or decide that is worth remembering for future sessions on this project. Keep entries short and factual; one entry per discrete idea.';

const ORIENT_DIRECTIVE =
  "This project's memory store is empty. Before answering, briefly inspect key files (READMEs, outlines, character lists, recent chapters) and call memory_remember for the salient characters, locations, plot threads, and world rules. Keep each entry short and factual.";

function composeMemoryPreamble(globalMemory, retrieval, options = {}) {
  const style = normalizeText(globalMemory?.style);
  const rules = normalizeText(globalMemory?.rules);
  const hits = Array.isArray(retrieval?.hits) ? retrieval.hits : [];
  const orientationMode = typeof options.orientationMode === 'string' ? options.orientationMode : 'none';
  const projectEmpty = options.projectEmpty === true;
  const hasProjectScope = options.hasProjectScope === true;
  const parts = [];
  const hasMemoryContent = Boolean(style || rules || hits.length > 0);
  if (hasMemoryContent) {
    parts.push('You are assisting a writer. Treat memory blocks as authoritative context.');
  }
  if (style) parts.push(`<gruvbox:style>\n${style}\n</gruvbox:style>`);
  if (rules) parts.push(`<gruvbox:rules>\n${rules}\n</gruvbox:rules>`);
  if (hits.length > 0) {
    const hitsBody = hits
      .map((hit) => `<gruvbox:hit kind="${hit.kind}" score="${hit.score}" source="${hit.source}">\n${hit.title}\n${hit.body}\n</gruvbox:hit>`)
      .join('\n');
    parts.push(`<gruvbox:project-memory>\n${hitsBody}\n</gruvbox:project-memory>`);
  }
  if (hasProjectScope) {
    parts.push(REMEMBER_DIRECTIVE);
    if (orientationMode === 'rescan' || (orientationMode === 'auto' && projectEmpty)) {
      parts.push(ORIENT_DIRECTIVE);
    }
  }
  return parts.join('\n\n').trim();
}

module.exports = {
  readGlobalMemory,
  writeGlobalMemory,
  ensureGlobalMemoryFiles,
  bootstrapProjectMemory,
  readProjectMemory,
  upsertProjectEntry,
  deleteProjectEntry,
  retrieveProjectMemory,
  composeMemoryPreamble,
  writeProjectMemory,
  getProjectStats,
  clearProjectEntries,
  requestProjectRescan,
  consumeOrientPending,
  isOrientPending,
  REMEMBER_DIRECTIVE,
  ORIENT_DIRECTIVE,
};

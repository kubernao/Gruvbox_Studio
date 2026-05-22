/**
 * openrouter-models — fetch and cache the OpenRouter model catalog for Gruvbox Studio.
 *
 * Lists models from https://openrouter.ai/api/v1/models using the user's API key. Results are
 * cached in memory for a short TTL to avoid hammering the API on every settings refresh.
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const PROVIDER_PREFIX = 'openrouter';

let cachedModels = [];
let cachedAtMs = 0;

/**
 * normalizeOpenRouterModelId converts a catalog entry id to Pi's provider-prefixed model id.
 */
function normalizeOpenRouterModelId(rawId) {
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id) {
    return '';
  }
  if (id.startsWith(`${PROVIDER_PREFIX}/`)) {
    return id;
  }
  return `${PROVIDER_PREFIX}/${id}`;
}

/**
 * stripOpenRouterPrefix returns the bare OpenRouter model id from a Pi model string.
 */
function stripOpenRouterPrefix(modelId) {
  const raw = typeof modelId === 'string' ? modelId.trim() : '';
  if (!raw) {
    return '';
  }
  if (raw.startsWith(`${PROVIDER_PREFIX}/`)) {
    return raw.slice(PROVIDER_PREFIX.length + 1).trim();
  }
  if (raw.startsWith('gruvbox-api/')) {
    return raw.slice('gruvbox-api/'.length).trim();
  }
  return raw;
}

/**
 * fetchWithTimeout performs a GET with an AbortSignal timeout.
 */
async function fetchWithTimeout(url, init, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetchOpenRouterModels loads chat models from OpenRouter and maps them to AIModelOption shape.
 */
async function fetchOpenRouterModels(apiKey, options = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) {
    throw new Error('OpenRouter API key is not configured. Add it in Gruvie settings.');
  }
  const ttlMs =
    typeof options.cacheTtlMs === 'number' && options.cacheTtlMs > 0
      ? options.cacheTtlMs
      : DEFAULT_CACHE_TTL_MS;
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();
  if (!forceRefresh && cachedModels.length > 0 && now - cachedAtMs < ttlMs) {
    return cachedModels;
  }

  const response = await fetchWithTimeout(OPENROUTER_MODELS_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  const rawText = await response.text().catch(() => '');
  let json = {};
  try {
    json = rawText !== '' ? JSON.parse(rawText) : {};
  } catch {
    json = {};
  }
  if (!response.ok) {
    const detail =
      typeof json?.error?.message === 'string'
        ? json.error.message
        : rawText || `OpenRouter models request failed (${response.status})`;
    throw new Error(detail);
  }

  const rows = Array.isArray(json.data) ? json.data : [];
  const models = rows
    .map((entry) => {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
      if (!id) {
        return null;
      }
      const name =
        typeof entry?.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : id;
      return {
        id: normalizeOpenRouterModelId(id),
        name,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  cachedModels = models;
  cachedAtMs = now;
  return models;
}

/**
 * clearOpenRouterModelsCache drops the in-memory catalog (e.g. after key rotation).
 */
function clearOpenRouterModelsCache() {
  cachedModels = [];
  cachedAtMs = 0;
}

module.exports = {
  fetchOpenRouterModels,
  clearOpenRouterModelsCache,
  normalizeOpenRouterModelId,
  stripOpenRouterPrefix,
  PROVIDER_PREFIX,
};

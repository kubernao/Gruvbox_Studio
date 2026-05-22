/**
 * credentials-store — secure persistence for user-supplied API keys in the Electron main process.
 *
 * Stores OpenRouter and OpenAI keys via keytar (OS keychain) with a JSON file fallback when
 * native bindings are unavailable. Keys are never sent to the renderer after save; callers
 * receive only configured / missing status.
 */

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const noopKeytar = {
  getPassword: async () => null,
  setPassword: async () => {},
  deletePassword: async () => {},
};

/**
 * resolveFallbackCredentialsPath returns the file path used when keytar is unavailable.
 */
function resolveFallbackCredentialsPath() {
  const explicitPath = process.env.GRUVBOX_CREDENTIALS_STORE_PATH;
  if (explicitPath && explicitPath.trim()) {
    return explicitPath.trim();
  }
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'api-credentials.json');
    }
  } catch (_error) {
    // fall through
  }
  return path.join(os.homedir(), '.gruvbox-studio', 'api-credentials.json');
}

/**
 * createFileCredentialsStore implements per-account get/set/delete using one JSON object on disk.
 */
function createFileCredentialsStore(filePath = resolveFallbackCredentialsPath()) {
  async function readAll() {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  async function writeAll(data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  return {
    async getPassword(_serviceName, accountName) {
      const all = await readAll();
      const value = all[accountName];
      return typeof value === 'string' && value.length > 0 ? value : null;
    },
    async setPassword(_serviceName, accountName, secret) {
      const all = await readAll();
      all[accountName] = String(secret ?? '');
      await writeAll(all);
    },
    async deletePassword(_serviceName, accountName) {
      const all = await readAll();
      if (!(accountName in all)) {
        return false;
      }
      delete all[accountName];
      await writeAll(all);
      return true;
    },
  };
}

let keytarBinding = noopKeytar;
let isKeytarAvailable = true;
try {
  keytarBinding = require('keytar');
} catch (err) {
  isKeytarAvailable = false;
  const msg = err instanceof Error ? err.message : String(err);
  keytarBinding = createFileCredentialsStore();
  console.warn('[credentials-store] keytar disabled; using file fallback:', msg);
}

const SERVICE_NAME = 'gruvbox-studio';
const ACCOUNT_OPENROUTER = 'openrouter-api-key';
const ACCOUNT_OPENAI = 'openai-api-key';

/**
 * createCredentialsStore exposes load/save/clear/status for each supported provider key.
 */
function createCredentialsStore({
  keytarClient = keytarBinding,
  serviceName = SERVICE_NAME,
} = {}) {
  async function getKey(accountName) {
    const raw = await keytarClient.getPassword(serviceName, accountName);
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
  }

  async function setKey(accountName, secret) {
    const trimmed = typeof secret === 'string' ? secret.trim() : '';
    if (!trimmed) {
      await keytarClient.deletePassword(serviceName, accountName);
      return;
    }
    await keytarClient.setPassword(serviceName, accountName, trimmed);
  }

  async function clearKey(accountName) {
    await keytarClient.deletePassword(serviceName, accountName);
  }

  return {
    async getOpenRouterKey() {
      const stored = await getKey(ACCOUNT_OPENROUTER);
      if (stored) {
        return stored;
      }
      const fromEnv = typeof process.env.OPENROUTER_API_KEY === 'string' ? process.env.OPENROUTER_API_KEY.trim() : '';
      return fromEnv.length > 0 ? fromEnv : null;
    },
    async setOpenRouterKey(secret) {
      await setKey(ACCOUNT_OPENROUTER, secret);
    },
    async clearOpenRouterKey() {
      await clearKey(ACCOUNT_OPENROUTER);
    },
    async getOpenAiKey() {
      const stored = await getKey(ACCOUNT_OPENAI);
      if (stored) {
        return stored;
      }
      const fromEnv = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
      return fromEnv.length > 0 ? fromEnv : null;
    },
    async setOpenAiKey(secret) {
      await setKey(ACCOUNT_OPENAI, secret);
    },
    async clearOpenAiKey() {
      await clearKey(ACCOUNT_OPENAI);
    },
    async getStatus() {
      const [openRouter, openAi] = await Promise.all([this.getOpenRouterKey(), this.getOpenAiKey()]);
      return {
        openRouter: { configured: Boolean(openRouter) },
        openAi: { configured: Boolean(openAi) },
      };
    },
  };
}

module.exports = {
  createCredentialsStore,
  createFileCredentialsStore,
  isKeytarAvailable,
  SERVICE_NAME,
  ACCOUNT_OPENROUTER,
  ACCOUNT_OPENAI,
};

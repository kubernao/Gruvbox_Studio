/**
 * register-credentials-ipc — IPC handlers for user API key configuration.
 *
 * Exposes get-status, set, and clear operations for OpenRouter and OpenAI keys. Secrets are
 * handled only in the main process; the renderer never receives key material after save.
 */

const { IPC_EVENT_CHANNELS } = require('../../shared/ipc/channels');
const { clearOpenRouterModelsCache } = require('./openrouter-models');

/**
 * registerCredentialsIpc wires credentials:* invoke handlers and optional change events.
 */
function registerCredentialsIpc(ipcMain, credentialsStore) {
  const broadcastChanged = (payload) => {
    for (const win of require('electron').BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_EVENT_CHANNELS.credentialsChanged, payload);
      }
    }
  };

  ipcMain.handle('credentials:get-status', async () => {
    try {
      const status = await credentialsStore.getStatus();
      return { ok: true, ...status };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        openRouter: { configured: false },
        openAi: { configured: false },
      };
    }
  });

  ipcMain.handle('credentials:set', async (_event, request) => {
    const provider =
      request && typeof request === 'object' && typeof request.provider === 'string'
        ? request.provider.trim()
        : '';
    const secret =
      request && typeof request === 'object' && typeof request.secret === 'string'
        ? request.secret
        : '';
    try {
      if (provider === 'openrouter') {
        await credentialsStore.setOpenRouterKey(secret);
        clearOpenRouterModelsCache();
      } else if (provider === 'openai') {
        await credentialsStore.setOpenAiKey(secret);
      } else {
        return { ok: false, error: 'Unknown provider. Use openrouter or openai.' };
      }
      const status = await credentialsStore.getStatus();
      broadcastChanged(status);
      return { ok: true, ...status };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('credentials:clear', async (_event, request) => {
    const provider =
      request && typeof request === 'object' && typeof request.provider === 'string'
        ? request.provider.trim()
        : '';
    try {
      if (provider === 'openrouter') {
        await credentialsStore.clearOpenRouterKey();
        clearOpenRouterModelsCache();
      } else if (provider === 'openai') {
        await credentialsStore.clearOpenAiKey();
      } else {
        return { ok: false, error: 'Unknown provider. Use openrouter or openai.' };
      }
      const status = await credentialsStore.getStatus();
      broadcastChanged(status);
      return { ok: true, ...status };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

module.exports = {
  registerCredentialsIpc,
};

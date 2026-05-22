const { randomUUID } = require('node:crypto');

/**
 * Creates a request coordinator for command-palette round-trips.
 * @param {object} options
 * @param {number} options.timeoutMs
 * @param {string} options.requestChannel
 * @returns {{
 *   handleResultPayload: (payload: unknown) => { ok: boolean; error?: string },
 *   requestRendererPalette: (BrowserWindowCtor: Electron.BrowserWindowConstructor, payload: {mode?: string, query?: string}) => Promise<{ok:boolean, error?: string, [key:string]: unknown}>
 * }}
 */
function createPaletteRequestCoordinator({ timeoutMs, requestChannel }) {
  const pendingByRequestId = new Map();

  return {
    handleResultPayload(payload) {
      const requestId =
        payload && typeof payload === 'object' && typeof payload.requestId === 'string'
          ? payload.requestId
          : '';
      if (requestId === '') {
        return { ok: false, error: 'Missing requestId.' };
      }
      const resolver = pendingByRequestId.get(requestId);
      if (resolver) {
        resolver(payload);
        pendingByRequestId.delete(requestId);
      }
      return { ok: true };
    },

    requestRendererPalette(BrowserWindowCtor, payload) {
      const win = BrowserWindowCtor.getAllWindows()[0];
      if (!win || win.isDestroyed()) {
        return Promise.resolve({ ok: false, error: 'Main window is not available.' });
      }
      const requestId = randomUUID();
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          pendingByRequestId.delete(requestId);
          resolve({ ok: false, error: 'Command palette request timed out.' });
        }, timeoutMs);
        pendingByRequestId.set(requestId, (result) => {
          clearTimeout(timeout);
          resolve(result);
        });
        win.webContents.send(requestChannel, {
          requestId,
          mode: payload.mode,
          query: payload.query,
        });
      });
    },
  };
}

module.exports = {
  createPaletteRequestCoordinator,
};

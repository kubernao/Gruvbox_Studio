/**
 * This module persists the AI tab mascot state in the Electron userData directory.
 * It provides a tiny get/set IPC surface with schema-safe defaults so renderer code
 * can evolve pet state without direct filesystem access.
 */

const fs = require('node:fs');
const path = require('node:path');

function mascotSettingsPath(app) {
  return path.join(app.getPath('userData'), 'pi-mascot.json');
}

function createDefaultMascotState(now = Date.now()) {
  return {
    version: 1,
    name: 'Gruvie',
    stage: 'egg',
    hatchedAt: null,
    bornAt: now,
    happiness: 70,
    energy: 75,
    bondXp: 0,
    totalPrompts: 0,
    lastTickAt: now,
    lastFedAt: null,
    lastPettedAt: null,
  };
}

async function readMascotState(app) {
  const filePath = mascotSettingsPath(app);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return createDefaultMascotState();
    }
    return {
      ...createDefaultMascotState(),
      ...parsed,
      version: 1,
    };
  } catch {
    return createDefaultMascotState();
  }
}

async function writeMascotState(app, state) {
  const filePath = mascotSettingsPath(app);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function registerPiMascotHandlers(ipcMain, app) {
  ipcMain.handle('pi-mascot', async (_event, request) => {
    const op = request && typeof request === 'object' && typeof request.op === 'string' ? request.op : 'get';
    if (op === 'get') {
      const state = await readMascotState(app);
      return { ok: true, state };
    }
    if (op === 'set') {
      if (!request || typeof request !== 'object' || !request.state || typeof request.state !== 'object') {
        return { ok: false, error: 'Invalid mascot state payload.' };
      }
      const merged = { ...createDefaultMascotState(), ...request.state, version: 1 };
      await writeMascotState(app, merged);
      return { ok: true };
    }
    return { ok: false, error: 'Unknown pi-mascot op.' };
  });
}

module.exports = {
  registerPiMascotHandlers,
};

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { registerPiGui } = require('../../src/electron-main/ipc/handlers/pi-gui');

/**
 * This helper creates a minimal Electron-like app object backed by a temporary
 * user-data directory so pi-gui history persistence can be exercised in
 * isolation. The mocked shape mirrors only the methods used by registerPiGui,
 * which keeps the test focused on session-history behavior rather than broader
 * Electron integration concerns.
 */
function createMockApp(userDataDir) {
  return {
    getPath(name) {
      if (name === 'userData') {
        return userDataDir;
      }
      if (name === 'home') {
        return userDataDir;
      }
      return userDataDir;
    },
    getAppPath() {
      return process.cwd();
    },
    isPackaged: false,
  };
}

/**
 * This helper wires registerPiGui against a fake ipcMain and returns the
 * registered channel handlers so tests can invoke them directly. The function
 * supplies a minimal credentials-store mock because the E2E Pi stub path does not
 * require real OpenRouter credentials.
 */
function setupPiGuiHandlers(userDataDir) {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
  };
  const app = createMockApp(userDataDir);
  registerPiGui(ipcMain, app, {
    async getStatus() {
      return { openRouter: { configured: true }, openAi: { configured: false } };
    },
    async getOpenRouterKey() {
      return 'unit-test-openrouter-key';
    },
    async getOpenAiKey() {
      return null;
    },
  });
  return handlers;
}

test('pi-gui list/get chat history returns persisted sessions', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gruvbox-pi-history-test-'));
  const prevE2E = process.env.GRUVBOX_E2E;
  const prevStub = process.env.E2E_PI_STUB;
  process.env.GRUVBOX_E2E = '1';
  process.env.E2E_PI_STUB = '1';

  try {
    const handlers = setupPiGuiHandlers(userDataDir);
    const piGui = handlers.get('pi-gui');
    assert.equal(typeof piGui, 'function');

    const sentEvents = [];
    const sender = {
      id: 77,
      isDestroyed() {
        return false;
      },
      send(channel, payload) {
        sentEvents.push([channel, payload]);
      },
    };
    const event = { sender };

    const sendResult = await piGui(event, {
      command: 'send-message',
      payload: {
        chatInstanceId: 'chat-history-unit',
        messages: [{ role: 'user', content: 'Unit test history prompt' }],
        requestId: 'rq-unit-1',
      },
    });
    assert.equal(sendResult.ok, true);
    assert.ok(sentEvents.length > 0);

    const listResult = await piGui(event, { command: 'list-chat-sessions', payload: {} });
    assert.equal(listResult.ok, true);
    assert.equal(Array.isArray(listResult.sessions), true);
    assert.equal(listResult.sessions.length, 1);
    assert.equal(listResult.sessions[0].chatInstanceId, 'chat-history-unit');
    assert.match(listResult.sessions[0].previewText, /Unit test history prompt/);

    const getResult = await piGui(event, {
      command: 'get-chat-session',
      payload: { chatInstanceId: 'chat-history-unit' },
    });
    assert.equal(getResult.ok, true);
    assert.equal(getResult.session.chatInstanceId, 'chat-history-unit');
    assert.equal(Array.isArray(getResult.session.messages), true);
    assert.ok(getResult.session.messages.some((m) => m.role === 'user' && /Unit test history/.test(m.content)));
    assert.ok(getResult.session.messages.some((m) => m.role === 'assistant'));
  } finally {
    process.env.GRUVBOX_E2E = prevE2E;
    process.env.E2E_PI_STUB = prevStub;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('pi-gui save-chat-session persists explicit transcript', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gruvbox-pi-save-session-'));
  try {
    const handlers = setupPiGuiHandlers(userDataDir);
    const piGui = handlers.get('pi-gui');
    const sender = {
      id: 42,
      isDestroyed() {
        return false;
      },
      send() {},
    };
    const event = { sender };

    const saveResult = await piGui(event, {
      command: 'save-chat-session',
      payload: {
        chatInstanceId: 'explicit-snap',
        messages: [
          { role: 'user', content: 'Save me' },
          { role: 'assistant', content: 'Saved snapshot reply' },
        ],
      },
    });
    assert.equal(saveResult.ok, true);
    assert.equal(saveResult.saved, true);

    const getResult = await piGui(event, {
      command: 'get-chat-session',
      payload: { chatInstanceId: 'explicit-snap' },
    });
    assert.equal(getResult.ok, true);
    assert.equal(getResult.session.messages.length, 2);
    assert.equal(getResult.session.messages[0].content, 'Save me');
    assert.equal(getResult.session.messages[1].content, 'Saved snapshot reply');
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

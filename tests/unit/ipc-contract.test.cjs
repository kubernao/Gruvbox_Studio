const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { IPC_INVOKE_ALLOWED_CHANNELS, IPC_EVENT_CHANNELS } = require('../../src/shared/ipc/channels');

test('ipc contract defines required invoke channels', () => {
  const expected = [
    'git-provider',
    'github-git-auth-provider',
    'pi-gui',
    'pi-settings',
    'pi-mascot',
    'application',
    'menu-provider',
    'command-palette-provider',
    'ai-assistant-command-palette-result',
    'editor-export-provider',
    'editor-export-file-provider',
    'speech-tts-provider',
    'audiobook-export-provider',
    'audiobook-export-cancel',
    'memory-provider',
  ];
  assert.deepEqual([...IPC_INVOKE_ALLOWED_CHANNELS], expected);
});

test('ipc contract defines required event channels', () => {
  assert.equal(IPC_EVENT_CHANNELS.fileEvent, 'file-event');
  assert.equal(IPC_EVENT_CHANNELS.watcherError, 'watcher-error');
  assert.equal(IPC_EVENT_CHANNELS.aiAssistantCommandPalette, 'ai-assistant-command-palette');
  assert.equal(IPC_EVENT_CHANNELS.piChatDone, 'pi-chat-done');
});

test('preload bridge references shared ipc contract', () => {
  const preloadPath = path.join(__dirname, '../../src/electron-main/ipc/preload.js');
  const preload = fs.readFileSync(preloadPath, 'utf8');

  assert.match(preload, /IPC_INVOKE_ALLOWED_CHANNELS/);
  assert.match(preload, /IPC_EVENT_CHANNELS/);
  assert.doesNotMatch(preload, /const allowed = \[/);
});

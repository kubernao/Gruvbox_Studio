/**
 * Single source-of-truth for cross-process IPC channel names.
 * Keep this file runtime-friendly for Electron main/preload and renderer.
 */

const IPC_INVOKE_ALLOWED_CHANNELS = Object.freeze([
  'credentials:get-status',
  'credentials:set',
  'credentials:clear',
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
]);

const IPC_EVENT_CHANNELS = Object.freeze({
  fileEvent: 'file-event',
  watcherError: 'watcher-error',
  credentialsChanged: 'credentials:changed',
  aiAssistantCommandPalette: 'ai-assistant-command-palette',
  piChatChunk: 'pi-chat-chunk',
  piChatActivity: 'pi-chat-activity',
  piChatStreamEnd: 'pi-chat-stream-end',
  piChatDone: 'pi-chat-done',
  piChatError: 'pi-chat-error',
  piChatTool: 'pi-chat-tool',
  piChatToolcallDelta: 'pi-chat-toolcall-delta',
  piChatToolUpdate: 'pi-chat-tool-update',
  piChatToolEnd: 'pi-chat-tool-end',
  piExtensionUi: 'pi-extension-ui',
  audiobookExportProgress: 'audiobook-export-progress',
});

module.exports = {
  IPC_INVOKE_ALLOWED_CHANNELS,
  IPC_EVENT_CHANNELS,
};

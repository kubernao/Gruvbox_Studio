// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');
const { IPC_INVOKE_ALLOWED_CHANNELS, IPC_EVENT_CHANNELS } = require('../../shared/ipc/channels');
const { ELECTRON_API_INVOKE_METHOD_CHANNELS } = require('../../shared/ipc/electronApiContract');

const invokeContract = (method, ...args) => {
  const channel = ELECTRON_API_INVOKE_METHOD_CHANNELS[method];
  return ipcRenderer.invoke(channel, ...args);
};

// Expose safe IPC methods to the renderer process via window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  readFile: (path) => invokeContract('readFile', path),
  readFileBase64: (path) => invokeContract('readFileBase64', path),
  writeFile: (path, content) => invokeContract('writeFile', path, content),
  listDirectory: (path) => invokeContract('listDirectory', path),
  getMetadata: (path) => invokeContract('getMetadata', path),
  deleteFile: (path) => invokeContract('deleteFile', path),
  deleteDirectory: (path) => invokeContract('deleteDirectory', path),
  createDirectory: (path) => invokeContract('createDirectory', path),
  renamePath: (sourcePath, targetPath) => invokeContract('renamePath', sourcePath, targetPath),
  openExternal: (path) => invokeContract('openExternal', path),

  // File watching
  startWatching: (path) => invokeContract('startWatching', path),
  stopWatching: () => invokeContract('stopWatching'),
  isWatching: () => invokeContract('isWatching'),

  // Dialog operations
  showOpenDialog: (options) => invokeContract('showOpenDialog', options),
  pickExplorerSavePath: (payload) => invokeContract('pickExplorerSavePath', payload),
  confirmExplorerDelete: (payload) => invokeContract('confirmExplorerDelete', payload),
  confirmUnsavedClose: (payload) => invokeContract('confirmUnsavedClose', payload),

  // Listen for file events from the main process
  onFileEvent: (callback) => ipcRenderer.on(IPC_EVENT_CHANNELS.fileEvent, (event, data) => callback(data)),
  onWatcherError: (callback) => ipcRenderer.on(IPC_EVENT_CHANNELS.watcherError, (event, data) => callback(data)),
  // Remove listeners
  removeFileEventListener: () => ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.fileEvent),
  removeWatcherErrorListener: () => ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.watcherError),

  // System information
  getPlatform: () => process.platform,

  credentialsGetStatus: () => invokeContract('credentialsGetStatus'),
  credentialsSet: (payload) => invokeContract('credentialsSet', payload),
  credentialsClear: (provider) => invokeContract('credentialsClear', { provider }),
  onCredentialsChanged: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const channel = IPC_EVENT_CHANNELS.credentialsChanged;
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

  onAudiobookExportProgress: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const channel = IPC_EVENT_CHANNELS.audiobookExportProgress;
    const wrapped = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

  onMenuPaletteAction: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const channel = IPC_EVENT_CHANNELS.menuPaletteAction;
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

  // Generic invoke for channels without a dedicated preload wrapper (Git tab, AI, etc.)
  invoke: (channel, ...args) => {
    if (typeof channel === 'string' && channel.startsWith('rust:')) {
      return ipcRenderer.invoke(channel, ...args);
    }
    if (!IPC_INVOKE_ALLOWED_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  onCommandPaletteRequest: (callback) => {
    const channel = IPC_EVENT_CHANNELS.aiAssistantCommandPalette;
    const wrapped = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

  sendCommandPaletteResult: (payload) =>
    invokeContract('sendCommandPaletteResult', payload),

  subscribePiChat: (handlers) => {
    const entries = [];
    const add = (channel, fn) => {
      if (typeof fn !== 'function') {
        return;
      }
      const wrapped = (_event, payload) => {
        fn(payload);
      };
      ipcRenderer.on(channel, wrapped);
      entries.push([channel, wrapped]);
    };
    add(IPC_EVENT_CHANNELS.piChatChunk, handlers.onChunk);
    add(IPC_EVENT_CHANNELS.piChatActivity, handlers.onActivity);
    add(IPC_EVENT_CHANNELS.piChatStreamEnd, handlers.onStreamEnd);
    add(IPC_EVENT_CHANNELS.piChatDone, handlers.onDone);
    add(IPC_EVENT_CHANNELS.piChatError, handlers.onError);
    add(IPC_EVENT_CHANNELS.piChatTool, handlers.onTool);
    add(IPC_EVENT_CHANNELS.piChatToolcallDelta, handlers.onToolcallDelta);
    add(IPC_EVENT_CHANNELS.piChatToolUpdate, handlers.onToolUpdate);
    add(IPC_EVENT_CHANNELS.piChatToolEnd, handlers.onToolEnd);
    add(IPC_EVENT_CHANNELS.piExtensionUi, handlers.onExtensionUi);
    return () => {
      for (const [channel, wrapped] of entries) {
        ipcRenderer.removeListener(channel, wrapped);
      }
    };
  },

  /** E2E: auto-open fixture folder when GRUVBOX_E2E + E2E_FIXTURE_ROOT are set (Playwright). */
  e2eGetFixtureRoot: () => invokeContract('e2eGetFixtureRoot'),
});


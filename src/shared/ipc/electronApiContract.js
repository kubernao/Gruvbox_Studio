const ELECTRON_API_INVOKE_METHOD_CHANNELS = {
  readFile: 'file:read',
  readFileBase64: 'file:read-base64',
  writeFile: 'file:write',
  listDirectory: 'file:list-directory',
  getMetadata: 'file:metadata',
  deleteFile: 'file:delete',
  deleteDirectory: 'file:delete-directory',
  createDirectory: 'file:create-directory',
  renamePath: 'file:rename',
  openExternal: 'file:open-external',
  startWatching: 'watcher:start',
  stopWatching: 'watcher:stop',
  isWatching: 'watcher:status',
  showOpenDialog: 'dialog:openDirectory',
  pickExplorerSavePath: 'explorer:pick-save-path',
  confirmExplorerDelete: 'explorer:confirm-delete',
  confirmUnsavedClose: 'explorer:confirm-unsaved-close',
  credentialsGetStatus: 'credentials:get-status',
  credentialsSet: 'credentials:set',
  credentialsClear: 'credentials:clear',
  sendCommandPaletteResult: 'ai-assistant-command-palette-result',
  e2eGetFixtureRoot: 'e2e:get-fixture-root',
};

module.exports = {
  ELECTRON_API_INVOKE_METHOD_CHANNELS,
};

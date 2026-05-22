const { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { fileURLToPath } = require('node:url');
const os = require('node:os');
const { execFile } = require('node:child_process');
const util = require('node:util');
const execFileAsync = util.promisify(execFile);
const htmlToDocx = require('html-to-docx');
const { createCredentialsStore } = require('./credentials/credentials-store');
const { registerCredentialsIpc } = require('./credentials/register-credentials-ipc');
const { IPC_INVOKE_ALLOWED_CHANNELS, IPC_EVENT_CHANNELS } = require('../shared/ipc/channels');
const { enqueueGitMutation } = require('./ipc/git-mutation-queue');
const { normalizeGitBranchListLine } = require('./utils/gitBranchListLine');
const { createPaletteRequestCoordinator } = require('./ipc/palette-requests');
const { normalizeDirectoryRenameSavePick } = require('./utils/normalizeDirectoryRenameSavePick');

/**
 * Canonical human-facing desktop product name (macOS About / menu shell, Dock
 * activity, Notifications). Mirrors `productName` in package.json so the app
 * is not labelled `Electron`, especially during `electron-forge start`.
 */
const GRUVBOX_DESKTOP_PRODUCT_NAME = 'Gruvbox Studio';
app.setName(GRUVBOX_DESKTOP_PRODUCT_NAME);

const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';

/** Generation IDs passed to {@link ipcMain.handle} `audiobook-export-cancel`. */
const audiobookExportCancelledIds = new Set();

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Calls OpenAI `POST /v1/audio/speech` with the user's OpenAI API key and returns MP3 bytes.
 *
 * @param {object} options
 * @param {{ getOpenAiKey: () => Promise<string | null> }} options.credentialsStore
 * @param {string} options.text
 * @param {string} [options.voice]
 * @param {string} [options.model]
 * @param {number} [options.speed]
 * @returns {Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }>}
 */
async function fetchSpeechTtsMp3Buffer(options) {
  const { credentialsStore, text, voice, model, speed } = options;
  const apiKey = await credentialsStore.getOpenAiKey();
  if (!apiKey) {
    return { ok: false, error: 'Add an OpenAI API key in Gruvie settings for cloud audio.' };
  }
  const voiceNorm = typeof voice === 'string' && voice.trim() !== '' ? voice.trim() : 'alloy';
  const modelNorm = typeof model === 'string' && model.trim() !== '' ? model.trim() : 'tts-1';
  const speedNum =
    typeof speed === 'number' && Number.isFinite(speed) ? Math.min(4, Math.max(0.25, speed)) : 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let response;
  try {
    response = await fetch(OPENAI_SPEECH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        input: String(text ?? '').slice(0, 4096),
        voice: voiceNorm,
        model: modelNorm,
        speed: speedNum,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      detail = '';
    }
    return {
      ok: false,
      error: detail.trim() !== '' ? detail : `Speech request failed (${response.status}).`,
    };
  }
  const arrayBuffer = await response.arrayBuffer();
  return { ok: true, buffer: Buffer.from(arrayBuffer) };
}

/**
 * Builds a filesystem-safe chapter filename using a 1-based index and optional title slug.
 *
 * @param {number} indexZeroBased
 * @param {string} [title]
 */
function safeChapterFilename(indexZeroBased, title) {
  const slug =
    typeof title === 'string' && title.trim() !== ''
      ? title
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 48)
      : '';
  const suffix = slug !== '' ? `-${slug}` : '';
  return `chapter-${String(indexZeroBased + 1).padStart(2, '0')}${suffix}.mp3`;
}

/**
 * Notifies the renderer of audiobook export progress (non-blocking).
 *
 * @param {import('electron').WebContents} webContents
 * @param {object} detail
 */
function sendAudiobookExportProgress(webContents, detail) {
  try {
    webContents.send('audiobook-export-progress', detail);
  } catch {
    /* ignore */
  }
}

/** Maximum entries returned by `git log` in the repo-wide view. */
const GIT_LOG_MAX_ENTRIES = 100;

/** Milliseconds before a renderer palette request is considered timed out. */
const PALETTE_REQUEST_TIMEOUT_MS = 15_000;
const EXPORT_HTML_TITLE = 'Gruvbox Export';

const MAIN_WINDOW_FALLBACK_FILE = path.join(app.getAppPath(), '.webpack/renderer/main_window/index.html');
/** Same path resolved from the webpack main bundle dir (covers odd `getAppPath()` layouts). */
const MAIN_WINDOW_FALLBACK_NEAR_MAIN = path.join(__dirname, '..', 'renderer', 'main_window', 'index.html');

/** When the main bundle was built for production it points at `file://…/index.html`, which may not exist on disk until `npm run package`. If `npm start` is running, load from the dev server instead (must match [forge.config.js] plugin-webpack port). */
const WEBPACK_DEV_SERVER_PORT =
  typeof process.env.GRUVBOX_WEBPACK_PORT === 'string' && process.env.GRUVBOX_WEBPACK_PORT.trim() !== ''
    ? process.env.GRUVBOX_WEBPACK_PORT.trim()
    : '3001';
const WEBPACK_DEV_RENDERER_URL = `http://127.0.0.1:${WEBPACK_DEV_SERVER_PORT}/main_window/index.html`;

/**
 * Whether the renderer can be loaded from this URL.
 * - `file://` (packaged / static builds): check the path exists.
 * - `http(s)://` (forge dev server): retry — Electron often starts before webpack-dev-server is ready.
 */
async function isRendererEntryLoadable(url) {
  if (typeof url !== 'string' || url.trim() === '') {
    return false;
  }
  if (/^file:\/\//i.test(url)) {
    try {
      return fs.existsSync(fileURLToPath(url));
    } catch {
      return false;
    }
  }
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }
  const attempts = 25;
  const pauseMs = 400;
  const fetchTimeoutMs = 3000;
  for (let i = 0; i < attempts; i += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      if (response.ok) {
        return true;
      }
    } catch {
      /* dev server not up yet */
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, pauseMs);
    });
  }
  return false;
}

/**
 * Whether a disk renderer HTML is safe to load directly from `file://`.
 * Dev-server outputs may reference absolute /main_window/* assets that require HTTP.
 */
function isDiskRendererHtmlLoadable(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    const html = fs.readFileSync(filePath, 'utf8');
    if (/src\s*=\s*["']\/main_window\//i.test(html) || /href\s*=\s*["']\/main_window\//i.test(html)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizePathInput(input) {
  if (typeof input !== 'string') {
    return '';
  }
  return input.trim();
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// Rust integration via IPC bridge
const { RustBridge } = require('./ipc/rust-bridge');
const { rasterizeMermaidSvgsInHtml } = require('./ipc/mermaid-export-rasterizer');
const rustBridge = new RustBridge();
const credentialsStore = createCredentialsStore();
registerCredentialsIpc(ipcMain, credentialsStore);

async function autoCommitWorkspaceChange(filePath, actionDescription) {
  try {
    const { stdout: rootPath } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: path.dirname(filePath) });
    const repoRoot = rootPath.trim();
    if (repoRoot) {
      await enqueueGitMutation(repoRoot, 'auto-commit', async () => {
        try {
          await execFileAsync('git', ['add', '-A'], { cwd: repoRoot });
          const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: repoRoot });
          if (status.trim().length > 0) {
            await execFileAsync('git', [
              '-c', 'user.name=Gruvbox Studio',
              '-c', 'user.email=studio@gruvbox.local',
              'commit', 
              '-m', `Auto-commit: ${actionDescription}`
            ], { cwd: repoRoot });
          }
        } catch (commitErr) {
          console.error('Auto-commit failed:', commitErr);
          try {
            const lockPath = path.join(repoRoot, '.git', 'index.lock');
            if (fs.existsSync(lockPath)) {
              fs.unlinkSync(lockPath);
              await execFileAsync('git', ['add', '-A'], { cwd: repoRoot });
              await execFileAsync('git', [
                '-c', 'user.name=Gruvbox Studio',
                '-c', 'user.email=studio@gruvbox.local',
                'commit', 
                '-m', `Auto-commit: ${actionDescription}`
              ], { cwd: repoRoot });
            }
          } catch (retryErr) {
            console.error('Auto-commit retry failed:', retryErr);
          }
        }
        return { ok: true };
      });
    }
  } catch (gitErr) {
    // Not a git repo or no git installed
  }
}

// Set up IPC handlers for file operations
ipcMain.handle('file:read', async (event, filePath) => {
  try {
    return await rustBridge.readFile(filePath);
  } catch (error) {
    console.error('IPC file:read error:', error);
    throw error;
  }
});

ipcMain.handle('file:read-base64', async (_event, filePath) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return buffer.toString('base64');
  } catch (error) {
    console.error('IPC file:read-base64 error:', error);
    throw error;
  }
});

/** E2E: fixture folder path for Playwright (see tests/e2e/editor-file-loading.test.ts). */
ipcMain.handle('e2e:get-fixture-root', () => {
  if (process.env.GRUVBOX_E2E !== '1') {
    return null;
  }
  return typeof process.env.E2E_FIXTURE_ROOT === 'string' ? process.env.E2E_FIXTURE_ROOT : null;
});

ipcMain.handle('file:write', async (event, filePath, content) => {
  try {
    const result = await rustBridge.writeFile(filePath, content);
    await autoCommitWorkspaceChange(filePath, `saved ${path.basename(filePath)}`);
    return result;
  } catch (error) {
    console.error('IPC file:write error:', error);
    throw error;
  }
});

ipcMain.handle('file:list-directory', async (event, dirPath) => {
  try {
    return await rustBridge.listDirectory(dirPath);
  } catch (error) {
    console.error('IPC file:list-directory error:', error);
    throw error;
  }
});

ipcMain.handle('file:metadata', async (event, filePath) => {
  try {
    return await rustBridge.getMetadata(filePath);
  } catch (error) {
    console.error('IPC file:metadata error:', error);
    throw error;
  }
});

ipcMain.handle('file:delete', async (event, filePath) => {
  try {
    const result = await rustBridge.deleteFile(filePath);
    await autoCommitWorkspaceChange(filePath, `deleted ${path.basename(filePath)}`);
    return result;
  } catch (error) {
    console.error('IPC file:delete error:', error);
    throw error;
  }
});

ipcMain.handle('file:delete-directory', async (_event, dirPath) => {
  try {
    const result = await rustBridge.deleteDirectory(dirPath);
    await autoCommitWorkspaceChange(dirPath, `deleted directory ${path.basename(dirPath)}`);
    return result;
  } catch (error) {
    console.error('IPC file:delete-directory error:', error);
    throw error;
  }
});

ipcMain.handle('file:create-directory', async (_event, dirPath) => {
  try {
    const result = await rustBridge.createDirectory(dirPath);
    await autoCommitWorkspaceChange(dirPath, `created directory ${path.basename(dirPath)}`);
    return result;
  } catch (error) {
    console.error('IPC file:create-directory error:', error);
    throw error;
  }
});

ipcMain.handle('file:rename', async (_event, sourcePath, targetPath) => {
  const normalizedSource = normalizePathInput(sourcePath);
  const normalizedTarget = normalizePathInput(targetPath);
  if (!normalizedSource || !normalizedTarget) {
    const error = new Error('Source and target paths are required');
    error.code = 'INVALID_PATH';
    throw error;
  }
  if (path.resolve(normalizedSource) === path.resolve(normalizedTarget)) {
    const error = new Error('Source and target paths are identical');
    error.code = 'NO_OP';
    throw error;
  }
  try {
    const result = await rustBridge.renamePath(normalizedSource, normalizedTarget);
    await autoCommitWorkspaceChange(normalizedTarget, `renamed ${path.basename(normalizedSource)} to ${path.basename(normalizedTarget)}`);
    return result;
  } catch (error) {
    console.error('IPC file:rename error:', error);
    throw error;
  }
});

ipcMain.handle('file:open-external', async (_event, filePath) => {
  try {
    const result = await shell.openPath(filePath);
    if (typeof result === 'string' && result.trim() !== '') {
      return { ok: false, error: result };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
});

// Set up IPC handlers for file watching
ipcMain.handle('watcher:start', async (event, dirPath) => {
  try {
    return await rustBridge.startWatching(dirPath);
  } catch (error) {
    console.error('IPC watcher:start error:', error);
    throw error;
  }
});

ipcMain.handle('watcher:stop', async (event) => {
  try {
    return await rustBridge.stopWatching();
  } catch (error) {
    console.error('IPC watcher:stop error:', error);
    throw error;
  }
});

ipcMain.handle('watcher:status', async (event) => {
  try {
    return await rustBridge.isWatching();
  } catch (error) {
    console.error('IPC watcher:status error:', error);
    throw error;
  }
});

ipcMain.handle('rust:parseDiff', async (event, diffText) => {
  try {
    return rustBridge.parseDiff(typeof diffText === 'string' ? diffText : '');
  } catch (error) {
    console.error('IPC rust:parseDiff error:', error);
    throw error;
  }
});

ipcMain.handle('rust:buildMergeResult', async (event, payload) => {
  try {
    return rustBridge.buildMergeResult(payload ?? {});
  } catch (error) {
    console.error('IPC rust:buildMergeResult error:', error);
    throw error;
  }
});

ipcMain.handle('rust:buildCommitGraph', async (event, payload) => {
  try {
    return rustBridge.buildCommitGraph(payload ?? {});
  } catch (error) {
    console.error('IPC rust:buildCommitGraph error:', error);
    throw error;
  }
});

ipcMain.handle('rust:renderMarkdown', async (event, source) => {
  try {
    return rustBridge.renderMarkdown(typeof source === 'string' ? source : '');
  } catch (error) {
    console.error('IPC rust:renderMarkdown error:', error);
    throw error;
  }
});

// Dialog handler for folder selection
ipcMain.handle('dialog:openDirectory', async (event) => {
  try {
    const result = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0], {
      properties: ['openDirectory'],
    });
    return result;
  } catch (error) {
    console.error('Dialog error:', error);
    throw error;
  }
});

/**
 * Resolves the BrowserWindow that should own modal dialogs for an IPC sender.
 * Prefer the window hosting the webContents that invoked the handler so dialogs
 * stack correctly; fall back to focused or any app window when that lookup fails.
 */
function getWindowForIpcEvent(event) {
  return (
    BrowserWindow.fromWebContents(event.sender) ??
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows()[0] ??
    null
  );
}

/**
 * Normalizes a user-supplied default filename to a single path segment so joining
 * it under a parent directory cannot escape that directory via ".." or separators.
 */
function explorerSafeBasename(name, fallback) {
  const t = typeof name === 'string' ? name.trim() : '';
  if (!t || /[/\\]/.test(t) || t === '.' || t === '..') {
    return fallback;
  }
  return t.replace(/[/\\]/g, '');
}

ipcMain.handle('explorer:pick-save-path', async (event, payload) => {
  const intent = typeof payload?.intent === 'string' ? payload.intent : '';
  if (!['new-file', 'new-folder', 'rename'].includes(intent)) {
    return { canceled: true };
  }
  const win = getWindowForIpcEvent(event);
  if (!win) {
    throw new Error('No BrowserWindow available for explorer save dialog.');
  }

  const directoryPath = typeof payload?.directoryPath === 'string' ? payload.directoryPath.trim() : '';
  const currentPath = typeof payload?.currentPath === 'string' ? payload.currentPath.trim() : '';
  const rawSuggested = typeof payload?.suggestedName === 'string' ? payload.suggestedName : '';

  let defaultPath = '';
  if (intent === 'rename') {
    if (!currentPath) {
      return { canceled: true };
    }
    defaultPath = currentPath;
  } else {
    if (!directoryPath) {
      return { canceled: true };
    }
    const fallback = intent === 'new-folder' ? 'new-folder' : 'untitled.md';
    const base = explorerSafeBasename(rawSuggested, fallback);
    defaultPath = path.join(directoryPath, base);
  }

  const titles = {
    'new-file': 'Create new file',
    'new-folder': 'Create new folder',
    rename: 'Rename',
  };

  const result = await dialog.showSaveDialog(win, {
    title: titles[intent] ?? 'Save',
    defaultPath,
    buttonLabel: intent === 'rename' ? 'Rename' : 'Create',
    showsTagField: false,
  });

  if (result.canceled || typeof result.filePath !== 'string' || result.filePath.trim() === '') {
    return { canceled: true };
  }
  let filePath = result.filePath.trim();
  if (intent === 'rename' && currentPath) {
    try {
      const entryStat = await fs.promises.stat(currentPath);
      if (entryStat.isDirectory()) {
        const resolvedSource = path.resolve(currentPath);
        const resolvedPick = path.resolve(filePath);
        filePath = normalizeDirectoryRenameSavePick(resolvedSource, resolvedPick);
      }
    } catch {
      // Non-existent or unreadable paths are handled later by renamePath.
    }
  }
  return { canceled: false, filePath };
});

ipcMain.handle('explorer:confirm-delete', async (event, payload) => {
  const message =
    typeof payload?.message === 'string' && payload.message.trim() !== ''
      ? payload.message.trim()
      : 'Delete this item?';
  const detail =
    typeof payload?.detail === 'string' && payload.detail.trim() !== '' ? payload.detail.trim() : undefined;
  const win = getWindowForIpcEvent(event);
  if (!win) {
    throw new Error('No BrowserWindow available for delete confirmation.');
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    message,
    detail,
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  return { ok: response === 0 };
});

function buildExportDocumentHtml(renderedHtml, css = '') {
  const safeBody = typeof renderedHtml === 'string' ? renderedHtml : '';
  const safeCss = typeof css === 'string' ? css : '';
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${EXPORT_HTML_TITLE}</title>
    <style>${safeCss}</style>
  </head>
  <body>${safeBody}</body>
</html>`;
}

async function exportRenderedPdf(htmlDocument) {
  const tempWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  });
  try {
    await tempWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDocument)}`);
    return await tempWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    if (!tempWindow.isDestroyed()) {
      tempWindow.destroy();
    }
  }
}

/**
 * Builds filename filters for “export a copy” so the dialog suggests the same
 * extension as the source file while still offering an all-files option.
 * @param {string} sourcePath
 * @returns {Electron.FileFilter[]}
 */
function buildExportFileCopyFilters(sourcePath) {
  const extWithDot = path.extname(typeof sourcePath === 'string' ? sourcePath : '');
  const ext = extWithDot.replace(/^\./, '').toLowerCase();
  const filters = [];
  if (ext) {
    filters.push({ name: `${ext.toUpperCase()} file`, extensions: [ext] });
  }
  filters.push({ name: 'All Files', extensions: ['*'] });
  return filters;
}

/**
 * Shows a save dialog and writes either UTF-8 text or raw bytes (base64) to the
 * chosen path. The renderer supplies file contents so text exports include
 * unsaved editor changes; PDFs use base64 from a disk read in the renderer.
 */
ipcMain.handle('editor-export-file-provider', async (event, payload) => {
  try {
    const sourcePath = typeof payload?.sourcePath === 'string' ? payload.sourcePath.trim() : '';
    const utf8Raw = payload?.contentUtf8;
    const b64Raw = payload?.contentBase64;
    const hasUtf8 = typeof utf8Raw === 'string';
    const hasB64 = typeof b64Raw === 'string';

    if (!sourcePath) {
      return { error: 'Missing source path for export.' };
    }
    if (hasUtf8 === hasB64) {
      return { error: 'Provide exactly one of contentUtf8 or contentBase64.' };
    }

    const sourceDir = path.dirname(sourcePath);
    const defaultPath = path.join(sourceDir, path.basename(sourcePath));
    const win = getWindowForIpcEvent(event);
    if (!win) {
      throw new Error('No BrowserWindow available for export dialog.');
    }
    const saveResult = await dialog.showSaveDialog(win, {
      title: 'Export file copy',
      defaultPath,
      filters: buildExportFileCopyFilters(sourcePath),
    });
    if (saveResult.canceled || typeof saveResult.filePath !== 'string' || saveResult.filePath.trim() === '') {
      return { canceled: true };
    }
    const targetPath = saveResult.filePath.trim();
    if (hasUtf8) {
      await fs.promises.writeFile(targetPath, utf8Raw, 'utf8');
    } else {
      const buf = Buffer.from(b64Raw, 'base64');
      await fs.promises.writeFile(targetPath, buf);
    }
    return { canceled: false, outputPath: targetPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('IPC editor-export-file-provider error:', error);
    return { error: message };
  }
});

ipcMain.handle('editor-export-provider', async (_event, payload) => {
  try {
    const format = typeof payload?.format === 'string' ? payload.format : '';
    const sourcePath = typeof payload?.sourcePath === 'string' ? payload.sourcePath : '';
    const renderedHtml = typeof payload?.renderedHtml === 'string' ? payload.renderedHtml : '';
    const css = typeof payload?.css === 'string' ? payload.css : '';

    if (!['html', 'pdf', 'docx'].includes(format)) {
      return { error: 'Unsupported export format.' };
    }

    const sourceDir = sourcePath ? path.dirname(sourcePath) : os.homedir();
    const baseName = sourcePath ? path.basename(sourcePath, path.extname(sourcePath)) : 'document';
    const defaultExtension = format === 'html' ? 'html' : format;
    const defaultPath = path.join(sourceDir, `${baseName}.rendered.${defaultExtension}`);
    const filters = {
      html: [{ name: 'HTML Document', extensions: ['html'] }],
      pdf: [{ name: 'PDF Document', extensions: ['pdf'] }],
      docx: [{ name: 'Word Document', extensions: ['docx'] }],
    };

    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const saveResult = await dialog.showSaveDialog(win, {
      defaultPath,
      filters: filters[format],
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true };
    }

    let htmlForExport = renderedHtml;
    const warnings = [];
    const rasterized = await rasterizeMermaidSvgsInHtml(htmlForExport, {
      BrowserWindow,
      scale: 2,
    });
    htmlForExport = rasterized.html;
    if (Array.isArray(rasterized.warnings) && rasterized.warnings.length > 0) {
      warnings.push(...rasterized.warnings);
    }

    const htmlDocument = buildExportDocumentHtml(htmlForExport, css);
    if (format === 'html') {
      await fs.promises.writeFile(saveResult.filePath, htmlDocument, 'utf8');
      return { canceled: false, outputPath: saveResult.filePath, warnings };
    }
    if (format === 'pdf') {
      const pdfBuffer = await exportRenderedPdf(htmlDocument);
      await fs.promises.writeFile(saveResult.filePath, pdfBuffer);
      return { canceled: false, outputPath: saveResult.filePath, warnings };
    }

    const docxBuffer = await htmlToDocx(htmlDocument);
    await fs.promises.writeFile(saveResult.filePath, docxBuffer);
    return { canceled: false, outputPath: saveResult.filePath, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('IPC editor-export-provider error:', error);
    return { error: message };
  }
});

ipcMain.handle('speech-tts-provider', async (_event, payload) => {
  try {
    const text = typeof payload?.text === 'string' ? payload.text : '';
    const voiceRaw = typeof payload?.voice === 'string' ? payload.voice.trim() : '';
    const voice = voiceRaw !== '' ? voiceRaw : 'alloy';
    const modelRaw = typeof payload?.model === 'string' ? payload.model.trim() : '';
    const model = modelRaw !== '' ? modelRaw : 'tts-1';
    const speedRaw = payload?.speed;
    const speed =
      typeof speedRaw === 'number' && Number.isFinite(speedRaw) ? speedRaw : 1;
    if (!text.trim()) {
      return { ok: false, error: 'No text to synthesize.' };
    }
    const result = await fetchSpeechTtsMp3Buffer({
      app,
      credentialsStore,
      text,
      voice,
      model,
      speed,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return {
      ok: true,
      audioBase64: result.buffer.toString('base64'),
      mimeType: 'audio/mpeg',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
});

ipcMain.handle('audiobook-export-cancel', (_event, payload) => {
  const id = typeof payload?.generationId === 'string' ? payload.generationId.trim() : '';
  if (id !== '') {
    audiobookExportCancelledIds.add(id);
  }
  return { ok: true };
});

ipcMain.handle('audiobook-export-provider', async (event, payload) => {
  try {
    const generationIdRaw = typeof payload?.generationId === 'string' ? payload.generationId.trim() : '';
    const generationId =
      generationIdRaw !== ''
        ? generationIdRaw
        : `ab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    audiobookExportCancelledIds.delete(generationId);

    const outputDir = typeof payload?.outputDir === 'string' ? payload.outputDir.trim() : '';
    const sourceDocumentPath =
      typeof payload?.sourceDocumentPath === 'string' ? payload.sourceDocumentPath.trim() : '';
    const segments = Array.isArray(payload?.segments) ? payload.segments : [];
    const voiceRaw = typeof payload?.voice === 'string' ? payload.voice.trim() : '';
    const voice = voiceRaw !== '' ? voiceRaw : 'alloy';
    const modelRaw = typeof payload?.model === 'string' ? payload.model.trim() : '';
    const model = modelRaw !== '' ? modelRaw : 'tts-1';
    const speedRaw = payload?.speed;
    const speed =
      typeof speedRaw === 'number' && Number.isFinite(speedRaw) ? speedRaw : 1;

    if (outputDir === '') {
      return { ok: false, error: 'Missing output folder.' };
    }
    if (segments.length === 0) {
      return { ok: false, error: 'No segments to synthesize.' };
    }

    const normalizedSegments = segments
      .map((seg, idx) => {
        const rawText = typeof seg?.text === 'string' ? seg.text : '';
        const title = typeof seg?.title === 'string' ? seg.title.trim() : '';
        return {
          index: idx,
          title: title !== '' ? title : undefined,
          text: rawText.trim(),
        };
      })
      .filter((s) => s.text !== '');

    if (normalizedSegments.length === 0) {
      return { ok: false, error: 'All segments were empty after trimming.' };
    }

    const chapterManifest = [];
    const sender = event.sender;

    sendAudiobookExportProgress(sender, {
      generationId,
      phase: 'starting',
      index: 0,
      total: normalizedSegments.length,
    });

    for (let i = 0; i < normalizedSegments.length; i += 1) {
      if (audiobookExportCancelledIds.has(generationId)) {
        audiobookExportCancelledIds.delete(generationId);
        sendAudiobookExportProgress(sender, {
          generationId,
          phase: 'cancelled',
          index: i,
          total: normalizedSegments.length,
        });
        return { ok: false, cancelled: true, generationId };
      }

      const seg = normalizedSegments[i];
      const filename = safeChapterFilename(i, seg.title);
      const outPath = path.join(outputDir, filename);

      sendAudiobookExportProgress(sender, {
        generationId,
        phase: 'synthesizing',
        index: i + 1,
        total: normalizedSegments.length,
        segmentTitle: seg.title ?? null,
        filename,
      });

      let attempt = 0;
      let synthResult;
      while (attempt < 3) {
        synthResult = await fetchSpeechTtsMp3Buffer({
          app,
          credentialsStore,
          text: seg.text,
          voice,
          model,
          speed,
        });
        if (synthResult.ok) {
          break;
        }
        const retriable =
          typeof synthResult.error === 'string' &&
          (synthResult.error.includes('429') || synthResult.error.includes('503'));
        if (!retriable || attempt === 2) {
          break;
        }
        attempt += 1;
        await sleepMs(800 * attempt);
      }

      if (!synthResult.ok) {
        sendAudiobookExportProgress(sender, {
          generationId,
          phase: 'error',
          index: i + 1,
          total: normalizedSegments.length,
          error: synthResult.error,
        });
        return {
          ok: false,
          error: synthResult.error,
          generationId,
          failedSegmentIndex: i + 1,
        };
      }

      await fs.promises.writeFile(outPath, synthResult.buffer);

      chapterManifest.push({
        index: i + 1,
        title: seg.title ?? null,
        file: filename,
      });

      sendAudiobookExportProgress(sender, {
        generationId,
        phase: 'segment_done',
        index: i + 1,
        total: normalizedSegments.length,
        filename,
      });
    }

    const manifestPath = path.join(outputDir, 'audiobook-manifest.json');
    const manifestBody = {
      version: 1,
      generatedAt: new Date().toISOString(),
      sourceDocumentPath: sourceDocumentPath !== '' ? sourceDocumentPath : null,
      voice,
      model,
      speed,
      generationId,
      chapters: chapterManifest,
    };
    await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifestBody, null, 2)}\n`, 'utf8');

    audiobookExportCancelledIds.delete(generationId);
    sendAudiobookExportProgress(sender, {
      generationId,
      phase: 'done',
      index: normalizedSegments.length,
      total: normalizedSegments.length,
      manifestPath,
      outputDir,
    });

    return {
      ok: true,
      manifestPath,
      outputDir,
      generationId,
      chapterCount: normalizedSegments.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
});

/**
 * Remove Windows-style mnemonic markers (`&`) from a menu label.
 * Returns an empty string when `label` is not a string.
 * @param {string} label
 * @returns {string}
 */
function stripMenuLabelMnemonic(label) {
  if (typeof label !== 'string') {
    return '';
  }
  return label.replace(/&/g, '').trim();
}

/**
 * Walk the Electron `MenuItem` tree depth-first and populate `outRows` with
 * flat command descriptors and `idToMenuItemMap` with `id → MenuItem` pairs.
 * Separators are skipped; submenus are recursed into without producing a row.
 * @param {Electron.MenuItem[]} items
 * @param {string[]} parentLabels - breadcrumb path from the menu root
 * @param {Array<{id:string, label:string, pathLabel:string, accelerator?:string, enabled:boolean}>} outRows
 * @param {Map<string, Electron.MenuItem>} idToMenuItemMap
 */
function flattenMenuItems(items, parentLabels, outRows, idToMenuItemMap) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.type === 'separator') {
      continue;
    }
    const rawLabel = stripMenuLabelMnemonic(item.label);
    const label =
      rawLabel !== ''
        ? rawLabel
        : typeof item.role === 'string' && item.role.trim() !== ''
          ? item.role.trim()
          : 'Command';
    const nextParents = [...parentLabels, label];

    if (item.submenu && Array.isArray(item.submenu.items) && item.submenu.items.length > 0) {
      flattenMenuItems(item.submenu.items, nextParents, outRows, idToMenuItemMap);
      continue;
    }

    const id =
      typeof item.id === 'string' && item.id.trim() !== ''
        ? `id:${item.id.trim()}`
        : `path:${nextParents.join(' > ')}:${index}`;
    const pathLabel = parentLabels.length > 0 ? parentLabels.join(' > ') : 'Application menu';
    const accelerator =
      typeof item.accelerator === 'string' && item.accelerator.trim() !== ''
        ? item.accelerator
        : undefined;

    outRows.push({
      id,
      label,
      pathLabel,
      accelerator,
      enabled: item.enabled !== false,
    });
    idToMenuItemMap.set(id, item);
  }
}

/**
 * Return all currently-registered application-menu commands as a flat list
 * suitable for the command palette, together with a live `MenuItem` map keyed
 * by the same IDs so clicks can be dispatched back to Electron.
 * @returns {{ rows: Array<{id:string, label:string, pathLabel:string, accelerator?:string, enabled:boolean}>, idToMenuItemMap: Map<string, Electron.MenuItem> }}
 */
function getFlatApplicationMenuItems() {
  const menu = Menu.getApplicationMenu();
  if (!menu || !Array.isArray(menu.items)) {
    return { rows: [], idToMenuItemMap: new Map() };
  }
  const rows = [];
  const idToMenuItemMap = new Map();
  flattenMenuItems(menu.items, [], rows, idToMenuItemMap);
  return { rows, idToMenuItemMap };
}

/** Application menu so the palette can list native items on all platforms. */
function buildGruvboxApplicationMenuTemplate() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          id: 'file-new-markdown',
          label: 'New Markdown File',
          click: () => {
            void requestRendererPalette({ mode: 'run', query: 'New Markdown file' });
          },
        },
        {
          id: 'file-export-copy',
          label: 'Export File Copy…',
          click: () => {
            void requestRendererPalette({ mode: 'run', query: 'Export file copy' });
          },
        },
        { type: 'separator' },
        { role: isMac ? 'close' : 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : []),
      ],
    },
  ];
  return template;
}

ipcMain.handle('menu-provider', async (_event, payload) => {
  const command = payload && typeof payload === 'object' ? payload.command : '';
  if (command === 'get-flat-application-menu-items') {
    return getFlatApplicationMenuItems().rows;
  }
  if (command === 'click-menu-item') {
    const targetId =
      payload &&
      typeof payload === 'object' &&
      typeof payload.payload === 'string'
        ? payload.payload
        : '';
    if (targetId === '') {
      return { ok: false, error: 'Missing menu item id.' };
    }
    const { idToMenuItemMap } = getFlatApplicationMenuItems();
    const target = idToMenuItemMap.get(targetId);
    if (!target) {
      return { ok: false, error: 'Menu item not found.' };
    }
    if (target.enabled === false) {
      return { ok: false, error: 'Menu item is disabled.' };
    }
    if (typeof target.click === 'function') {
      try {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        target.click(target, win ?? undefined, undefined);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    }
    return { ok: false, error: 'Menu item is not invokable.' };
  }
  return { ok: false, error: `Unknown menu-provider command: ${command}` };
});

const AI_ASSISTANT_COMMAND_PALETTE_CHANNEL = IPC_EVENT_CHANNELS.aiAssistantCommandPalette;
const AI_ASSISTANT_PALETTE_RESULT_CHANNEL =
  IPC_INVOKE_ALLOWED_CHANNELS.find((channel) => channel === 'ai-assistant-command-palette-result') ||
  'ai-assistant-command-palette-result';
const paletteCoordinator = createPaletteRequestCoordinator({
  timeoutMs: PALETTE_REQUEST_TIMEOUT_MS,
  requestChannel: AI_ASSISTANT_COMMAND_PALETTE_CHANNEL,
});

ipcMain.handle(AI_ASSISTANT_PALETTE_RESULT_CHANNEL, async (_event, payload) => {
  return paletteCoordinator.handleResultPayload(payload);
});

/**
 * Ask the renderer to open the command palette with `payload` and wait for the
 * user's selection. Resolves with `{ ok: true, ... }` on success or
 * `{ ok: false, error }` on timeout ({@link PALETTE_REQUEST_TIMEOUT_MS}) or
 * window unavailability.
 * @param {{ mode?: string, query?: string }} payload
 * @returns {Promise<{ok:boolean, error?:string, [key:string]:unknown}>}
 */
function requestRendererPalette(payload) {
  return paletteCoordinator.requestRendererPalette(BrowserWindow, payload);
}

ipcMain.handle('command-palette-provider', async (_event, payload) => {
  const query =
    payload && typeof payload === 'object' && typeof payload.query === 'string'
      ? payload.query
      : '';
  const mode =
    payload && typeof payload === 'object' && payload.mode === 'preview'
      ? 'preview'
      : 'run';
  return requestRendererPalette({ query, mode });
});

const GIT_LOG_FIELD_SEP = '\x1f';
const GIT_LOG_RECORD_SEP = '\x1e';

/**
 * Parse `git log` output produced by {@link GIT_LOG_PRETTY}.
 *
 * We use control-character separators so multiline commit bodies cannot shift
 * columns and corrupt hash fields.
 *
 * @param {string} stdout - raw stdout from `git log --pretty=GIT_LOG_PRETTY`
 * @returns {Array<{hash:string, abbrevHash:string, subject:string, body:string,
 *   author:string, authorEmail:string, authorDate:number,
 *   committer:string, committerEmail:string, committerDate:number,
 *   decorations:string, parents:string[]}>}
 */
function parseGitLogStdout(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    return [];
  }

  const records = stdout.split(GIT_LOG_RECORD_SEP).map((r) => r.trim()).filter(Boolean);
  return records.map((record) => {
    const fields = record.split(GIT_LOG_FIELD_SEP);
    const [
      hash = '',
      abbrevHash = '',
      subject = '',
      body = '',
      author = '',
      authorEmail = '',
      authorDateIso = '',
      committer = '',
      committerEmail = '',
      committerDateIso = '',
      decorations = '',
      parentsLine = '',
    ] = fields;
    const parents = parentsLine.trim()
      ? parentsLine.trim().split(/\s+/).filter(Boolean)
      : [];

    return {
      hash,
      abbrevHash,
      subject,
      body: body.trim(),
      author,
      authorEmail,
      authorDate: new Date(authorDateIso).getTime() || 0,
      committer,
      committerEmail,
      committerDate: new Date(committerDateIso).getTime() || 0,
      decorations,
      parents,
    };
  });
}

const GIT_LOG_PRETTY =
  `format:%H%x1f%h%x1f%s%x1f%B%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%d%x1f%P%x1e`;

/**
 * Resolve a repo-relative file path to an absolute path that stays inside repoPath.
 * Returns null if invalid or escapes the repository.
 */
/**
 * Resolve a repo-relative file path to an absolute path that is guaranteed to
 * remain inside `repoPath`. Returns `null` if the path is invalid or attempts
 * to escape the repository root.
 *
 * Two-stage traversal check:
 * 1. Pre-resolve — catches literal `..` segments in the raw input before any
 *    OS path normalization runs.
 * 2. Post-resolve — catches symlink-based traversal that only becomes apparent
 *    after `path.resolve()` follows the symlink chain on disk.
 */
function resolveSafeRepoRelativeFile(repoPath, relativeFilePath) {
  const raw = typeof relativeFilePath === 'string' ? relativeFilePath.trim() : '';
  if (!raw || path.isAbsolute(raw)) {
    return null;
  }
  // Stage 1: reject literal traversal sequences before OS normalization.
  let normalizedRel = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalizedRel.startsWith('@')) {
    normalizedRel = normalizedRel.slice(1).trim();
  }
  if (!normalizedRel || normalizedRel.includes('..') || path.isAbsolute(normalizedRel)) {
    return null;
  }
  const absRepo = path.resolve(repoPath);
  const absTarget = path.resolve(absRepo, normalizedRel);
  // Stage 2: re-check after resolve catches symlink-followed paths that escape.
  const rel = path.relative(absRepo, absTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return absTarget;
}

/**
 * Normalize a repo-relative file path to forward slashes without a leading `./`.
 * Returns an empty string for non-string input.
 * @param {string | unknown} filePath
 * @returns {string}
 */
function normalizeRepoRelativePath(filePath) {
  if (typeof filePath !== 'string') return '';
  let s = filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (s.startsWith('@')) {
    s = s.slice(1).trim();
  }
  return s;
}

/**
 * Map a raw git error (from `execFile`) to a structured `{ error, code, hint }`
 * object. The `code` values are stable strings consumed by the renderer to
 * show actionable guidance; `hint` is a human-readable suggestion.
 *
 * See also {@link mapNativeError} in `rust-bridge.js` which performs a similar
 * mapping for Rust addon errors — the two differ in output shape intentionally
 * (git errors carry a `hint`, native errors carry a numeric `code`).
 *
 * @param {Error | { stderr?: string, message?: string } | string} err
 * @param {string} [fallbackCode]
 * @returns {{ error: string, code: string, hint: string }}
 */
function mapGitError(err, fallbackCode = 'git_error') {
  const message = String(err?.stderr ? err.stderr : err?.message ?? err ?? 'Unknown git error').trim();
  const lowered = message.toLowerCase();
  let code = fallbackCode;
  let hint = '';
  if (lowered.includes('not something we can merge') || lowered.includes('not a commit')) {
    code = 'missing_source_ref';
    hint = 'The source branch/ref is missing. Regenerate AI changes and retry.';
  } else if (lowered.includes('your local changes') || lowered.includes('would be overwritten')) {
    code = 'dirty_tree';
    hint = 'Commit, stash, or discard local changes before retrying.';
  } else if (lowered.includes('you have not concluded your merge') || lowered.includes('merge_head exists')) {
    code = 'merge_in_progress';
    hint = 'Finish or abort the current merge before retrying.';
  } else if (lowered.includes('pathspec') && lowered.includes('did not match any file')) {
    code = 'pathspec_not_found';
    hint = 'One or more file paths could not be staged. Verify generated paths exist in the repo.';
  } else if (lowered.includes('unknown revision') || lowered.includes('not a commit')) {
    code = 'ref_not_found';
    hint = 'Verify the target branch/ref still exists.';
  }
  return { error: message, code, hint };
}

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  console.error('[main] Unhandled promise rejection:', { message, stack });
});

// Git provider IPC handlers with actual git command execution
ipcMain.handle('git-provider', async (event, { command, repoPath, ...payload }) => {
  try {
    // fs, execFileAsync, path are all module-level; no per-call require needed.
    const fsPromises = fs.promises;

    if (!repoPath || typeof repoPath !== 'string' || repoPath.trim() === '') {
      console.error(`[git-provider] ${command} - invalid repoPath: "${repoPath}"`);
      return { error: 'No repository path provided' };
    }

    switch (command) {
      case 'is-git-repo': {
        const gitPath = path.join(repoPath, '.git');
        return fs.existsSync(gitPath);
      }

      case 'resolve-git-repo-root': {
        // Try to find git root by running git rev-parse --show-toplevel
        if (!payload.directoryPath) return null;
        try {
          const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
            cwd: payload.directoryPath,
          });
          return stdout.trim();
        } catch (err) {
          // Fallback to provided directory
          return payload.directoryPath;
        }
      }

      case 'git-init': {
        // Initialize a new git repository
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            await execFileAsync('git', ['init'], { cwd: repoPath });
            return { ok: true };
          } catch (err) {
            return mapGitError(err, 'git_init_failed');
          }
        });
      }

      case 'git-status': {
        // Get status in porcelain format
        try {
          const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
            cwd: repoPath,
          });
          const lines = stdout.trim().split('\n').filter(line => line.length > 0);
          return lines.map(line => {
            const status = line.substring(0, 2).trim();
            const file = line.substring(3);
            return { status, file };
          });
        } catch (err) {
          return mapGitError(err, 'git_status_failed');
        }
      }

      case 'git-log': {
        try {
          const { stdout } = await execFileAsync('git', [
            'log',
            '--all',
            `--pretty=${GIT_LOG_PRETTY}`,
            '-n', String(GIT_LOG_MAX_ENTRIES),
          ], {
            cwd: repoPath,
          });
          return parseGitLogStdout(stdout);
        } catch (err) {
          console.error('[git-provider] git-log error:', err);
          return mapGitError(err, 'git_log_failed');
        }
      }

      case 'git-tracked-files': {
        // Get all tracked files
        try {
          const { stdout } = await execFileAsync('git', ['ls-files'], {
            cwd: repoPath,
          });
          return stdout.trim().split('\n').filter(line => line.length > 0);
        } catch (err) {
          return mapGitError(err, 'git_ls_files_failed');
        }
      }

      case 'git-log-file': {
        const filePath = payload.filePath;
        if (!filePath) {
          return { error: 'filePath required', code: 'invalid_input' };
        }

        try {
          const { stdout } = await execFileAsync('git', [
            'log',
            '--all',
            `--pretty=${GIT_LOG_PRETTY}`,
            '--', filePath,
          ], {
            cwd: repoPath,
          });
          return parseGitLogStdout(stdout);
        } catch (err) {
          return mapGitError(err, 'git_log_file_failed');
        }
      }

      case 'git-switch-branch': {
        const branchName = typeof payload.branchName === 'string' ? payload.branchName.trim() : '';
        if (!branchName) {
          return { error: 'branchName required', code: 'invalid_input' };
        }
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            await execFileAsync('git', ['switch', branchName], { cwd: repoPath });
            return { ok: true };
          } catch (err) {
            return mapGitError(err, 'switch_failed');
          }
        });
      }

      case 'git-branch-create': {
        const branchName = typeof payload.branchName === 'string' ? payload.branchName.trim() : '';
        const baseRef = typeof payload.baseRef === 'string' ? payload.baseRef.trim() : '';
        if (!branchName) {
          return { error: 'branchName required', code: 'invalid_input' };
        }
        if (!baseRef) {
          return { error: 'baseRef required', code: 'invalid_input' };
        }
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            await execFileAsync('git', ['branch', branchName, baseRef], { cwd: repoPath });
            return { ok: true };
          } catch (err) {
            return mapGitError(err, 'branch_create_failed');
          }
        });
      }

      case 'git-branch-delete': {
        const branchName = typeof payload.branchName === 'string' ? payload.branchName.trim() : '';
        if (!branchName) {
          return { error: 'branchName required', code: 'invalid_input' };
        }
        const force = payload.force === true;
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            await execFileAsync('git', ['branch', force ? '-D' : '-d', branchName], { cwd: repoPath });
            return { ok: true };
          } catch (err) {
            return mapGitError(err, 'branch_delete_failed');
          }
        });
      }

      case 'git-worktree-remove': {
        const worktreePath = typeof payload.worktreePath === 'string' ? payload.worktreePath.trim() : '';
        if (!worktreePath) {
          return { error: 'worktreePath required', code: 'invalid_input' };
        }
        const force = payload.force === true;
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            const args = force
              ? ['worktree', 'remove', '--force', worktreePath]
              : ['worktree', 'remove', worktreePath];
            await execFileAsync('git', args, { cwd: repoPath });
            return { ok: true };
          } catch (err) {
            return mapGitError(err, 'worktree_remove_failed');
          }
        });
      }

      case 'git-ref-exists': {
        const refName = typeof payload.refName === 'string' ? payload.refName.trim() : '';
        if (!refName) {
          return { error: 'refName required', code: 'invalid_input' };
        }
        try {
          await execFileAsync('git', ['rev-parse', '--verify', '--quiet', refName], { cwd: repoPath });
          return { ok: true, exists: true };
        } catch (_) {
          return { ok: true, exists: false };
        }
      }

      case 'git-current-op-state': {
        try {
          const gitPath = async (name) => {
            const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', name], { cwd: repoPath });
            return stdout.trim();
          };
          const mergeHeadPath = await gitPath('MERGE_HEAD');
          const rebaseApplyPath = await gitPath('rebase-apply');
          const rebaseMergePath = await gitPath('rebase-merge');
          const cherryPickHeadPath = await gitPath('CHERRY_PICK_HEAD');
          const revertHeadPath = await gitPath('REVERT_HEAD');
          const bisectLogPath = await gitPath('BISECT_LOG');
          return {
            merge: fs.existsSync(mergeHeadPath),
            rebase: fs.existsSync(rebaseApplyPath) || fs.existsSync(rebaseMergePath),
            cherryPick: fs.existsSync(cherryPickHeadPath),
            revert: fs.existsSync(revertHeadPath),
            bisect: fs.existsSync(bisectLogPath),
          };
        } catch (err) {
          return mapGitError(err, 'op_state_failed');
        }
      }

      case 'git-branch-list-for-file': {
        // Get branches that touch a specific file
        const filePath = payload.filePath;
        if (!filePath) return { error: 'filePath required' };

        try {
          // Get all branches
          const { stdout: branchOutput } = await execFileAsync('git', ['branch', '-a'], {
            cwd: repoPath,
          });

          const branchNames = branchOutput
            .split('\n')
            .map((line) => normalizeGitBranchListLine(line))
            .filter((parsed) => parsed !== null)
            .map((parsed) => parsed.name);

          // Get current branch
          let currentBranch = 'HEAD';
          try {
            const { stdout: currentOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
              cwd: repoPath,
            });
            currentBranch = currentOut.trim();
          } catch (err) {
            // Ignore
          }

          // Check which branches have touched this file
          const branches = [];
          for (const branchName of branchNames) {
            try {
              const { stdout: hasFileOutput } = await execFileAsync('git', [
                'log', '-1', '--pretty=%H', branchName, '--', filePath,
              ], {
                cwd: repoPath,
              });

              if (hasFileOutput.trim()) {
                // Get commit message for this branch
                const { stdout: commitMsg } = await execFileAsync('git', [
                  'log', '-1', '--pretty=%s', branchName,
                ], {
                  cwd: repoPath,
                });

                branches.push({
                  name: branchName,
                  isCurrent: branchName === currentBranch,
                  commit: hasFileOutput.trim(),
                  commitMessage: commitMsg.trim(),
                });
              }
            } catch (err) {
              // Skip branches where the command fails
            }
          }

          return { branches };
        } catch (err) {
          return { branches: [], error: err.message };
        }
      }

      case 'git-remote-list': {
        // Get configured remotes
        try {
          const { stdout } = await execFileAsync('git', ['remote', '-v'], {
            cwd: repoPath,
          });

          const remotes = {};
          const lines = stdout.trim().split('\n').filter(line => line.length > 0);

          for (const line of lines) {
            const [name, url, type] = line.split(/\s+/);
            if (!remotes[name]) {
              remotes[name] = { name, fetchUrl: '', pushUrl: '' };
            }
            if (type === '(fetch)') {
              remotes[name].fetchUrl = url;
            } else if (type === '(push)') {
              remotes[name].pushUrl = url;
            }
          }

          return { remotes: Object.values(remotes) };
        } catch (err) {
          return { remotes: [], error: err.message };
        }
      }

      case 'git-commit-all': {
        const message = typeof payload.message === 'string' ? payload.message.trim() : '';
        if (!message) return { error: 'Commit message is required' };
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
              cwd: repoPath,
            });
            if (statusOut.trim() === '') {
              return { ok: false, noChanges: true };
            }

            await execFileAsync('git', ['add', '-A'], { cwd: repoPath });
            await execFileAsync('git', ['commit', '-m', message], { cwd: repoPath });

            const { stdout: hashOut } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
              cwd: repoPath,
            });
            return { ok: true, hash: hashOut.trim(), message };
          } catch (err) {
            return mapGitError(err, 'commit_all_failed');
          }
        });
      }

      case 'git-commit-staged': {
        const message = typeof payload.message === 'string' ? payload.message.trim() : '';
        if (!message) return { error: 'Commit message is required' };
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            const { stdout: statusOut } = await execFileAsync('git', ['diff', '--cached', '--name-only'], {
              cwd: repoPath,
            });
            if (statusOut.trim() === '') {
              return { ok: false, noChanges: true };
            }
            await execFileAsync('git', ['commit', '-m', message], { cwd: repoPath });
            const { stdout: hashOut } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
              cwd: repoPath,
            });
            return { ok: true, hash: hashOut.trim(), message };
          } catch (err) {
            return mapGitError(err, 'commit_staged_failed');
          }
        });
      }

      case 'git-diff': {
        const hash1 = typeof payload.hash1 === 'string' ? payload.hash1.trim() : '';
        const hash2 = typeof payload.hash2 === 'string' ? payload.hash2.trim() : '';
        const filePath = normalizeRepoRelativePath(payload.filePath);
        const fullContext = payload.fullContext === true;
        const useWorkingTree = hash1 === '' && hash2 === '';
        if (!useWorkingTree && (!hash1 || !hash2)) {
          return { error: 'hash1 and hash2 are required unless both are empty' };
        }

        try {
          const args = ['diff'];
          if (fullContext) {
            // Show full file context (effectively no truncation).
            args.push('--unified=999999');
          }
          if (!useWorkingTree) {
            args.push(hash1, hash2);
          }
          if (filePath) {
            args.push('--', filePath);
          }

          const { stdout } = await execFileAsync('git', args, { cwd: repoPath, maxBuffer: 1024 * 1024 * 50 });
          return stdout;
        } catch (err) {
          return { error: err.stderr ? String(err.stderr) : err.message };
        }
      }

      case 'git-show-file': {
        const revision = typeof payload.revision === 'string' ? payload.revision.trim() : '';
        const filePath = normalizeRepoRelativePath(payload.filePath);
        if (!filePath) {
          return { ok: false, reason: 'invalid_path', error: 'filePath required' };
        }
        try {
          // Staged index blob (used with working-tree `git diff`, which compares index vs worktree).
          if (revision === '__git_index__') {
            const { stdout } = await execFileAsync(
              'git',
              ['show', `:${filePath}`],
              { cwd: repoPath, maxBuffer: 1024 * 1024 * 50 },
            );
            return { ok: true, content: stdout };
          }
          if (!revision) {
            const absTarget = resolveSafeRepoRelativeFile(repoPath, filePath);
            if (!absTarget) {
              return { ok: false, reason: 'invalid_path', error: 'Invalid or unsafe filePath' };
            }
            const content = await fsPromises.readFile(absTarget, 'utf8');
            return { ok: true, content };
          }
          const { stdout } = await execFileAsync(
            'git',
            ['show', `${revision}:${filePath}`],
            { cwd: repoPath, maxBuffer: 1024 * 1024 * 50 },
          );
          return { ok: true, content: stdout };
        } catch (err) {
          const message = err.stderr ? String(err.stderr) : err.message;
          const lowered = String(message).toLowerCase();
          const reason =
            (lowered.includes('path') && lowered.includes('does not exist')) ||
            (lowered.includes('exists on disk') && lowered.includes('not in'))
            ? 'not_found'
            : lowered.includes('binary')
              ? 'binary_or_decode_error'
              : 'git_error';
          return { ok: false, reason, error: message };
        }
      }

      case 'write-file': {
        const relativeFilePath = typeof payload.relativeFilePath === 'string' ? payload.relativeFilePath : '';
        const content = typeof payload.content === 'string' ? payload.content : '';
        const absTarget = resolveSafeRepoRelativeFile(repoPath, relativeFilePath);
        if (!absTarget) {
          return { error: 'Invalid or unsafe relativeFilePath' };
        }
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            await fsPromises.mkdir(path.dirname(absTarget), { recursive: true });
            // Atomic write: stage to a same-directory temp file then rename. The rename is
            // atomic on the same filesystem, so a crash mid-write cannot leave a half-written
            // target file. The temp file is colocated with the target so the rename never
            // crosses filesystems.
            const tmpTarget = `${absTarget}.tmp-${process.pid}-${Date.now()}`;
            try {
              await fsPromises.writeFile(tmpTarget, content, 'utf8');
              await fsPromises.rename(tmpTarget, absTarget);
            } catch (writeErr) {
              try {
                await fsPromises.unlink(tmpTarget);
              } catch {
                // best effort temp cleanup
              }
              throw writeErr;
            }
            return { ok: true };
          } catch (err) {
            return mapGitError(err, 'write_file_failed');
          }
        });
      }

      case 'git-branch-list': {
        try {
          const { stdout } = await execFileAsync('git', ['branch', '--list'], { cwd: repoPath });
          const branches = [];
          for (const line of stdout.split('\n')) {
            const parsed = normalizeGitBranchListLine(line);
            if (!parsed) continue;
            branches.push({ name: parsed.name, isCurrent: parsed.isCurrent });
          }
          return { branches };
        } catch (err) {
          return { branches: [], error: err.stderr ? String(err.stderr) : err.message };
        }
      }

      case 'git-merge-no-commit': {
        const branchName = typeof payload.branchName === 'string' ? payload.branchName.trim() : '';
        if (!branchName) return { error: 'branchName required' };
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            await execFileAsync('git', ['merge', '--no-ff', '--no-commit', branchName], {
              cwd: repoPath,
            });
            return { ok: true };
          } catch (err) {
            return mapGitError(err, 'merge_no_commit_failed');
          }
        });
      }

      case 'git-merge-abort': {
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', 'MERGE_HEAD'], { cwd: repoPath });
            const mergeHeadPath = stdout.trim();
            if (!fs.existsSync(mergeHeadPath)) {
              return { ok: true, skipped: true };
            }
            await execFileAsync('git', ['merge', '--abort'], { cwd: repoPath });
            return { ok: true };
          } catch (err) {
            return mapGitError(err, 'merge_abort_failed');
          }
        });
      }

      case 'git-unmerged-paths': {
        try {
          const { stdout } = await execFileAsync(
            'git',
            ['diff', '--name-only', '--diff-filter=U'],
            { cwd: repoPath },
          );
          const paths = stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          return { paths };
        } catch (err) {
          return { paths: [], error: err.stderr ? String(err.stderr) : err.message };
        }
      }

      case 'git-add-path': {
        const relativeFilePath = typeof payload.relativeFilePath === 'string' ? payload.relativeFilePath : '';
        const absTarget = resolveSafeRepoRelativeFile(repoPath, relativeFilePath);
        if (!absTarget) {
          return { error: 'Invalid or unsafe relativeFilePath' };
        }
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            const relForGit = normalizeRepoRelativePath(relativeFilePath);
            await execFileAsync('git', ['add', '--', relForGit], { cwd: repoPath });
            return { ok: true };
          } catch (err) {
            return mapGitError(err, 'git_add_failed');
          }
        });
      }

      case 'git-commit-merge': {
        return enqueueGitMutation(repoPath, command, async () => {
          try {
            await execFileAsync('git', ['commit', '--no-edit'], { cwd: repoPath });
            return { ok: true };
          } catch (err) {
            return mapGitError(err, 'merge_commit_failed');
          }
        });
      }

      default:
        return { error: `Unknown command: ${command}` };
    }
  } catch (error) {
    console.error(`[git-provider] ${command} error:`, error);
    return { error: error.message };
  }
});

// GitHub auth provider IPC handlers
ipcMain.handle('github-git-auth-provider', async (event, { command, payload }) => {
  try {
    console.log(`[github-git-auth-provider] ${command}`, payload);

    switch (command) {
      case 'get-status': {
        // For now, return not_configured
        // In production, this would check stored credentials
        return {
          connected: false,
          encryptionAvailable: true,
          reason: 'not_configured', // TODO: Implement GitHub auth
        };
      }

      case 'start-device-flow': {
        // TODO: Implement GitHub device flow authentication
        return { ok: false, error: 'GitHub authentication not yet implemented' };
      }

      case 'poll-device': {
        // TODO: Implement GitHub device flow polling
        return { pending: true };
      }

      case 'logout': {
        // TODO: Implement logout
        return { ok: true };
      }

      default:
        return { error: `Unknown command: ${command}` };
    }
  } catch (error) {
    console.error(`[github-git-auth-provider] ${command} error:`, error);
    return { error: error.message };
  }
});

const { registerPiGui } = require('./ipc/handlers/pi-gui');
const { registerPiMascotHandlers } = require('./ipc/handlers/pi-mascot');
const { registerMemoryHandlers } = require('./ipc/handlers/memory');
registerPiGui(ipcMain, app, credentialsStore);
registerPiMascotHandlers(ipcMain, app);
registerMemoryHandlers(ipcMain, app);

// Forward file events from RustBridge to the renderer process
const mainWindow = () => BrowserWindow.getAllWindows()[0];

/**
 * This startup recovery pass scans repositories referenced by persisted AI
 * worktree sessions and offers to abort any leftover merge state that no
 * active restore flow is handling. It keeps repos from staying wedged after
 * unexpected app exits during AI merge operations.
 */
async function recoverInterruptedAiMerges() {
  try {
    const sessionsPath = path.join(app.getPath('userData'), 'ai-worktree-sessions.json');
    if (!fs.existsSync(sessionsPath)) {
      return;
    }
    const raw = await fs.promises.readFile(sessionsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const repoPaths = new Set(
      Object.values(parsed || {})
        .map((session) => (session && typeof session.repoPath === 'string' ? session.repoPath.trim() : ''))
        .filter(Boolean),
    );
    for (const repoPath of repoPaths) {
      try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', 'MERGE_HEAD'], { cwd: repoPath });
        const mergeHeadPath = stdout.trim();
        if (!mergeHeadPath || !fs.existsSync(mergeHeadPath)) {
          continue;
        }
        const response = await dialog.showMessageBox(BrowserWindow.getAllWindows()[0] ?? null, {
          type: 'warning',
          buttons: ['Abort merge', 'Keep merge state'],
          defaultId: 0,
          cancelId: 1,
          title: 'Interrupted AI merge detected',
          message: `A previous AI merge appears interrupted in:\n${repoPath}`,
          detail: 'Run "git merge --abort" now?',
        });
        if (response.response === 0) {
          await execFileAsync('git', ['merge', '--abort'], { cwd: repoPath });
        }
      } catch {
        // best effort
      }
    }
  } catch {
    // best effort
  }
}
rustBridge.on('file-event', (event) => {
  const win = mainWindow();
  if (win) {
    win.webContents.send('file-event', event);
  }
});

rustBridge.on('watcher-error', (error) => {
  const win = mainWindow();
  if (win) {
    win.webContents.send('watcher-error', error);
  }
});

/**
 * Locates the PNG used for Dock and BrowserWindow branding. On macOS, when
 * `app-icon-macos.png` is present (squircle-margin raster from Icon Composer),
 * it is preferred so the tile matches Finder weight; packaged builds resolve
 * under `process.resourcesPath`, otherwise `resources/` beside the webpack
 * output. Linux and Windows always use `app-icon.png`; the Electron renderer
 * tab favicon still imports `app-icon.png` via webpack independently.
 *
 * @returns {string} Absolute filesystem path to the PNG icon.
 */
function resolveAppIconPngPath() {
  const resourcesDir = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../resources');
  if (process.platform === 'darwin') {
    const macPng = path.join(resourcesDir, 'app-icon-macos.png');
    if (fs.existsSync(macPng)) {
      return macPng;
    }
  }
  return path.join(resourcesDir, 'app-icon.png');
}

/**
 * Sets the macOS Dock tile from the same PNG used for BrowserWindow icons on
 * other platforms, ignoring failures so startup never depends on optional
 * branding assets being present on disk.
 *
 * @param {string} iconPath Absolute path to a PNG suitable for Dock display.
 * @returns {void}
 */
function applyDockIconIfAvailable(iconPath) {
  if (process.platform !== 'darwin' || !iconPath || !fs.existsSync(iconPath)) {
    return;
  }
  try {
    app.dock.setIcon(iconPath);
  } catch (error) {
    console.warn('[Gruvbox] Failed to set Dock icon:', error);
  }
}

const createWindow = async () => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const appIconPath = resolveAppIconPngPath();
  const windowIcon = fs.existsSync(appIconPath) ? appIconPath : undefined;

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width,
    height,
    fullscreen: false,
    fullscreenable: true,
    autoHideMenuBar: true,
    icon: windowIcon,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  console.log('[Gruvbox] Preload entry:', MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY);

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[Gruvbox] Preload script failed:', {
      preloadPath,
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    });
  });

  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false);
  }

  let loadedFallback = false;
  const loadFallback = async () => {
    if (loadedFallback) {
      return;
    }
    loadedFallback = true;
    if (isDiskRendererHtmlLoadable(MAIN_WINDOW_FALLBACK_FILE)) {
      await mainWindow.loadFile(MAIN_WINDOW_FALLBACK_FILE);
      return;
    }
    if (isDiskRendererHtmlLoadable(MAIN_WINDOW_FALLBACK_NEAR_MAIN)) {
      await mainWindow.loadFile(MAIN_WINDOW_FALLBACK_NEAR_MAIN);
      return;
    }
    const hint = `<!doctype html><html><head><meta charset="utf-8"/><title>Gruvbox Studio</title></head><body style="font-family:system-ui,Segoe UI,sans-serif;padding:24px;line-height:1.5;max-width:42rem">
<h2>Gruvbox Studio failed to start renderer.</h2>
<p><strong>Dev startup:</strong> from the repo root run <code>npm start</code> (Electron Forge serves the renderer on port ${WEBPACK_DEV_SERVER_PORT}).</p>
<p><strong>If you launched</strong> <code>.webpack/main/index.js</code> <strong>directly:</strong> rebuild first with <code>rm -rf .webpack && npm run package</code>, or use <code>npm start</code> instead.</p>
</body></html>`;
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(hint)}`);
  };

  mainWindow.webContents.on('did-fail-load', async (_event, errorCode, errorDescription) => {
    console.error('[Gruvbox] Renderer failed to load:', errorCode, errorDescription);
    await loadFallback();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    void mainWindow.webContents
      .executeJavaScript('({ hasElectronAPI: Boolean(window.electronAPI), location: String(window.location.href) })', true)
      .then((value) => {
        console.log('[Gruvbox] Renderer preload bridge check:', value);
      })
      .catch((error) => {
        console.error('[Gruvbox] Renderer preload bridge check failed:', error);
      });
  });

  // E2E / Playwright: no webpack-dev-server — load the on-disk renderer bundle first.
  const e2eDiskHtml = [MAIN_WINDOW_FALLBACK_NEAR_MAIN, MAIN_WINDOW_FALLBACK_FILE].filter((p) =>
    isDiskRendererHtmlLoadable(p),
  );
  if (process.env.GRUVBOX_E2E === '1' && e2eDiskHtml.length > 0) {
    await mainWindow.loadFile(e2eDiskHtml[0]);
  } else if (await isRendererEntryLoadable(MAIN_WINDOW_WEBPACK_ENTRY)) {
    await mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  } else if (
    process.env.GRUVBOX_E2E !== '1' &&
    (await isRendererEntryLoadable(WEBPACK_DEV_RENDERER_URL))
  ) {
    console.warn(
      '[Gruvbox] Primary renderer entry is unavailable; loading from webpack dev server:',
      WEBPACK_DEV_RENDERER_URL,
    );
    await mainWindow.loadURL(WEBPACK_DEV_RENDERER_URL);
  } else {
    console.error('[Gruvbox] Renderer not loadable:', {
      entry: MAIN_WINDOW_WEBPACK_ENTRY,
      diskNearMain: MAIN_WINDOW_FALLBACK_NEAR_MAIN,
      diskExistsNearMain: fs.existsSync(MAIN_WINDOW_FALLBACK_NEAR_MAIN),
      devFallback: WEBPACK_DEV_RENDERER_URL,
    });
    await loadFallback();
  }

  if (process.env.NODE_ENV !== 'production' || process.env.GRUVBOX_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }
  // Open as a standard (non-fullscreen) window at full size.
  mainWindow.maximize();
  return mainWindow;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  console.log('[Gruvbox] Main process cwd:', process.cwd());
  console.log('[Gruvbox] App path:', app.getAppPath());
  console.log(
    '[Gruvbox] Restart Electron after editing main.js, preload.js, or rust-bridge.js (renderer HMR does not reload main).'
  );

  applyDockIconIfAvailable(resolveAppIconPngPath());

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildGruvboxApplicationMenuTemplate()));
  } else {
    Menu.setApplicationMenu(null);
  }

  const windowRef = await createWindow();
  void recoverInterruptedAiMerges();
  windowRef.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void rustBridge.init().catch((err) => {
        console.error('Failed to initialize Rust bridge:', err);
      });
    }, 0);
  });

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

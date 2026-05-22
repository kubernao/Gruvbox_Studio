/**
 * rust-bridge — Electron main-process adapter for the Rust native addon.
 *
 * Loads `dist-rust/gruvbox-file-ops.node` via {@link resolveNativeAddonPath}
 * and exposes file read/write/watch operations through the {@link RustBridge}
 * class. Falls back to Node.js `fs` implementations when the native addon is
 * absent (e.g., first-time dev setup before `npm run build:rust`).
 *
 * Main-process only. The preload script in `preload.js` re-exposes a subset
 * of these operations to the renderer via `window.electronAPI`.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const util = require('util');
const { createRequire } = require('module');
const EventEmitter = require('events');
const { TextDecoder } = require('util');
const { getPermissionsReadonly } = require('./handlers/file-permissions');
const fsp = fs.promises;
const execFileAsync = util.promisify(execFile);

const NATIVE_ADDON_NAME = 'gruvbox-file-ops.node';
const NATIVE_CREATE_DIRECTORY_METHODS = ['napiCreateDirectory', 'napiMkdir'];
const NATIVE_RENAME_METHODS = ['napiRenamePath', 'napiRename', 'napiMovePath'];

/**
 * Locate the compiled Rust native addon on disk.
 *
 * Webpack bundles the main process with a synthetic `__dirname`, making
 * relative paths unreliable. Resolution order:
 *   1. `process.resourcesPath/dist-rust/` — production (packaged) build.
 *   2. `process.cwd()/dist-rust/` — development (Forge `npm start`).
 *   3. `app.getAppPath()/dist-rust/` — alternative dev layout.
 *   4. `__dirname/../../dist-rust/` — fallback for non-Webpack test runners.
 *
 * Duplicate resolved paths are skipped via the `seen` set. Returns `null`
 * when no candidate exists on disk.
 *
 * @returns {string | null}
 */
function resolveNativeAddonPath() {
  const candidates = [];
  try {
    const { app } = require('electron');
    if (app?.isPackaged) {
      candidates.push(path.join(process.resourcesPath, 'dist-rust', NATIVE_ADDON_NAME));
    } else {
      candidates.push(path.join(process.cwd(), 'dist-rust', NATIVE_ADDON_NAME));
      try {
        const ap = app.getAppPath();
        if (ap && ap !== process.cwd()) {
          candidates.push(path.join(ap, 'dist-rust', NATIVE_ADDON_NAME));
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* non-Electron (e.g. tests) */
  }
  candidates.push(path.join(process.cwd(), 'dist-rust', NATIVE_ADDON_NAME));
  candidates.push(path.join(__dirname, '../../dist-rust', NATIVE_ADDON_NAME));

  // Deduplicate resolved paths; the same absolute path can appear more than
  // once when process.cwd() and app.getAppPath() are identical.
  const seen = new Set();
  for (const p of candidates) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function resolveNativeMethod(nativeModule, methodNames) {
  if (!nativeModule || typeof nativeModule !== 'object') {
    return null;
  }
  for (const methodName of methodNames) {
    if (typeof nativeModule[methodName] === 'function') {
      return nativeModule[methodName].bind(nativeModule);
    }
  }
  return null;
}

function normalizePathForCompare(inputPath) {
  if (typeof inputPath !== 'string') {
    return '';
  }
  return inputPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function isSelfOrDescendantPath(parentPath, childPath) {
  const parent = normalizePathForCompare(parentPath);
  const child = normalizePathForCompare(childPath);
  if (!parent || !child) {
    return false;
  }
  if (parent === child) {
    return true;
  }
  return child.startsWith(`${parent}/`);
}

/**
 * Decide whether two `fs.Stats` objects refer to the same on-disk entry.
 *
 * On case-insensitive filesystems (default macOS APFS, Windows NTFS) the
 * source path of a case-only rename (e.g. `Readme.md`) and the target path
 * (e.g. `README.md`) both stat successfully and resolve to the same physical
 * file. The renamePath flow needs to allow the operation in that case rather
 * than rejecting it with `TARGET_EXISTS`, because the target "exists" only
 * because it is the source. Two stats refer to the same entry when both
 * `dev` and `ino` match; either being undefined or zero means the runtime did
 * not provide reliable inode information and the safer answer is `false`.
 *
 * @param {import('fs').Stats} a
 * @param {import('fs').Stats} b
 * @returns {boolean}
 */
function isSameFilesystemEntry(a, b) {
  if (!a || !b) {
    return false;
  }
  if (typeof a.ino !== 'number' || typeof b.ino !== 'number') {
    return false;
  }
  if (a.ino === 0 || b.ino === 0) {
    return false;
  }
  return a.dev === b.dev && a.ino === b.ino;
}

let native = null;
try {
  const addonPath = resolveNativeAddonPath();
  if (addonPath) {
    // Webpack rewrites `require()` in the main bundle; use createRequire so the .node loads by path.
    const requireDisk = createRequire(path.join(process.cwd(), 'package.json'));
    native = requireDisk(path.resolve(addonPath));
  } else {
    console.warn(
      '[RustBridge] Native addon missing (run `npm run build:rust`). Using JS fallback.',
    );
  }
} catch (e) {
  console.warn('[RustBridge] Native module not loaded, using JS fallback:', e.message);
}

/**
 * Parse a Rust addon error into a structured JavaScript `Error`.
 *
 * The Rust side encodes errors as `"CODE|human-readable message"`. When the
 * pipe delimiter is present the leading token becomes `error.code`; otherwise
 * `error.code` defaults to `'NATIVE_ERROR'`. All mapped errors also carry
 * `error.rustError = true` so callers can distinguish native failures from
 * JS-side ones.
 *
 * See also {@link mapGitError} in `main.js` which performs a similar mapping
 * for git stderr — the two intentionally differ in output shape.
 *
 * @param {Error | string} err
 * @returns {Error & { code: string, rustError: true }}
 */
function mapNativeError(err) {
  const msg = err && err.message != null ? String(err.message) : String(err);
  const i = msg.indexOf('|');
  if (i > 0) {
    const code = msg.slice(0, i);
    const rest = msg.slice(i + 1);
    const error = new Error(rest);
    error.code =
      code === 'IO_ERROR' && /valid utf-?8/i.test(rest) ? 'INVALID_UTF8' : code;
    error.rustError = true;
    return error;
  }
  const error = new Error(msg);
  error.code = /valid utf-?8/i.test(msg) ? 'INVALID_UTF8' : 'NATIVE_ERROR';
  error.rustError = true;
  return error;
}

/**
 * Decode a UTF-16BE buffer by swapping byte pairs and decoding as UTF-16LE.
 * @param {Buffer} input
 * @returns {string}
 */
function decodeUtf16BeBuffer(input) {
  const len = input.length - (input.length % 2);
  const swapped = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 2) {
    swapped[i] = input[i + 1];
    swapped[i + 1] = input[i];
  }
  return swapped.toString('utf16le');
}

/**
 * Heuristic score for "human-readable textness" in decoded output.
 * @param {string} text
 * @returns {number}
 */
function textScore(text) {
  if (!text) return 0;
  let printable = 0;
  let controls = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const isWhitespace = code === 9 || code === 10 || code === 13;
    const isPrintable = (code >= 32 && code !== 127) || isWhitespace;
    if (isPrintable) printable += 1;
    else controls += 1;
  }
  const replacementPenalty = (text.match(/\uFFFD/g) || []).length / Math.max(1, text.length);
  return printable / Math.max(1, printable + controls) - replacementPenalty;
}

/**
 * Decode text from bytes using UTF-8 first, then common fallback encodings.
 * Returns null when content likely isn't textual.
 * @param {Buffer} buffer
 * @returns {{ text: string, encoding: string } | null}
 */
function decodeBufferWithFallbacks(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { text: '', encoding: 'utf-8' };
  }

  // UTF-8 strict pass first.
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (textScore(utf8) >= 0.7) {
      return { text: utf8, encoding: 'utf-8' };
    }
  } catch {
    // continue to fallback decoding
  }

  /** @type {Array<{ text: string, encoding: string, score: number }>} */
  const candidates = [];

  // UTF-16 BOM handling.
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    const decoded = buffer.slice(2).toString('utf16le');
    candidates.push({ text: decoded, encoding: 'utf-16le', score: textScore(decoded) });
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const decoded = decodeUtf16BeBuffer(buffer.slice(2));
    candidates.push({ text: decoded, encoding: 'utf-16be', score: textScore(decoded) });
  } else {
    // No BOM: attempt both UTF-16 variants.
    const le = buffer.toString('utf16le');
    const be = decodeUtf16BeBuffer(buffer);
    candidates.push({ text: le, encoding: 'utf-16le', score: textScore(le) });
    candidates.push({ text: be, encoding: 'utf-16be', score: textScore(be) });
  }

  // ANSI legacy text fallback.
  try {
    const cp1252 = new TextDecoder('windows-1252', { fatal: false }).decode(buffer);
    candidates.push({ text: cp1252, encoding: 'windows-1252', score: textScore(cp1252) });
  } catch {
    // environment may not expose this decoder
  }
  const latin1 = buffer.toString('latin1');
  candidates.push({ text: latin1, encoding: 'latin1', score: textScore(latin1) });

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < 0.7) {
    return null;
  }
  return { text: best.text, encoding: best.encoding };
}

/**
 * RustBridge: file ops + watcher. Uses `dist-rust/gruvbox-file-ops.node` when present.
 */
class RustBridge extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.watchingPath = null;
    this.watcher = null;
    this.watchDebounceTimer = null;
    this.debounceDelay = 100;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._nativePollTimer = null;
  }

  async init() {
    this.initialized = true;
    console.log(native ? 'RustBridge initialized (native)' : 'RustBridge initialized (JS fallback)');
  }

  _nativeOr(fnNative, fnJs) {
    if (native) {
      try {
        return fnNative(native);
      } catch (e) {
        throw mapNativeError(e);
      }
    }
    return fnJs();
  }

  async readFile(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      throw this._createError('INVALID_PATH', 'Invalid path provided');
    }
    if (process.env.GRUVBOX_E2E === '1') {
      const delayMs = parseInt(process.env.E2E_DELAY_MS || '0', 10);
      if (Number.isFinite(delayMs) && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    let stats;
    try {
      stats = await fsp.stat(filePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw this._createError('FILE_NOT_FOUND', `File not found: ${filePath}`);
      }
      throw error;
    }
    if (stats.isDirectory()) {
      throw this._createError('INVALID_PATH', `Path is not a file: ${filePath}`);
    }
    if (native) {
      try {
        return native.napiReadFile(filePath);
      } catch (e) {
        const nativeError = mapNativeError(e);
        if (nativeError.code !== 'INVALID_UTF8') {
          throw nativeError;
        }
      }
    }
    const buffer = await fsp.readFile(filePath);
    const decoded = decodeBufferWithFallbacks(buffer);
    if (!decoded) {
      throw this._createError('BINARY_FILE', `File appears binary and is not text-decodable: ${filePath}`);
    }
    if (decoded.encoding !== 'utf-8') {
      console.info(`[RustBridge] Decoded non-UTF8 file "${filePath}" using ${decoded.encoding}`);
    }
    return decoded.text;
  }

  async writeFile(filePath, content) {
    if (!filePath || typeof filePath !== 'string') {
      throw this._createError('INVALID_PATH', 'Invalid path provided');
    }
    return this._nativeOr(
      (n) => {
        n.napiWriteFile(filePath, content);
        return true;
      },
      async () => {
        const dir = path.dirname(filePath);
        await fsp.mkdir(dir, { recursive: true });
        // Atomic write fallback: stage to a same-directory temp file and rename
        // into place. Same-filesystem rename is atomic on POSIX and Windows, so
        // a crash mid-write cannot leave the target file half-written.
        const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
        try {
          await fsp.writeFile(tmpPath, content, 'utf-8');
          await fsp.rename(tmpPath, filePath);
        } catch (err) {
          try {
            await fsp.unlink(tmpPath);
          } catch {
            // best effort temp cleanup
          }
          throw err;
        }
        return true;
      },
    );
  }

  async listDirectory(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') {
      throw this._createError('INVALID_PATH', 'Invalid path provided');
    }
    return this._nativeOr(
      (n) =>
        n.napiListDirectory(dirPath).map((e) => ({
          name: e.name,
          path: e.path,
          is_directory: e.isDirectory,
          size: e.size,
          modified_at: Math.floor(e.modifiedAt ?? e.modified_at ?? 0),
        })),
      async () => {
        let stats;
        try {
          stats = await fsp.stat(dirPath);
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            throw this._createError('FILE_NOT_FOUND', `Path not found: ${dirPath}`);
          }
          throw error;
        }
        if (!stats.isDirectory()) {
          throw this._createError('INVALID_PATH', `Path is not a directory: ${dirPath}`);
        }
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        const files = [];
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          try {
            const entryStats = await fsp.stat(fullPath);
            files.push({
              name: entry.name,
              path: fullPath,
              is_directory: entry.isDirectory(),
              size: entryStats.size,
              modified_at: Math.floor(entryStats.mtimeMs / 1000),
            });
          } catch (err) {
            if (err.code !== 'EACCES') {
              throw err;
            }
          }
        }
        files.sort((a, b) => {
          if (a.is_directory !== b.is_directory) {
            return a.is_directory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
        return files;
      },
    );
  }

  async getMetadata(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      throw this._createError('INVALID_PATH', 'Invalid path provided');
    }
    return this._nativeOr(
      (n) => {
        const m = n.napiGetFileMetadata(filePath);
        return {
          path: filePath,
          is_directory: m.isDirectory,
          size: m.size,
          is_file: m.isFile,
          is_symlink: m.isSymlink,
          modified_at: Math.floor(m.modifiedAt ?? m.modified_at ?? 0),
          created_at: Math.floor(m.createdAt ?? m.created_at ?? 0),
          permissions_readonly: m.permissionsReadonly ?? m.permissions_readonly ?? false,
        };
      },
      async () => {
        let stats;
        try {
          stats = await fsp.stat(filePath);
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            throw this._createError('FILE_NOT_FOUND', `Path not found: ${filePath}`);
          }
          throw error;
        }
        const permissionsReadonly = getPermissionsReadonly(filePath, stats);
        return {
          path: filePath,
          is_directory: stats.isDirectory(),
          size: stats.size,
          is_file: stats.isFile(),
          is_symlink: stats.isSymbolicLink(),
          modified_at: Math.floor(stats.mtimeMs / 1000),
          created_at: Math.floor((stats.birthtimeMs || stats.mtimeMs) / 1000),
          permissions_readonly: permissionsReadonly,
        };
      },
    );
  }

  async deleteFile(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      throw this._createError('INVALID_PATH', 'Invalid path provided');
    }
    return this._nativeOr(
      (n) => {
        n.napiDeleteFile(filePath);
        return true;
      },
      async () => {
        let stats;
        try {
          stats = await fsp.stat(filePath);
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            throw this._createError('FILE_NOT_FOUND', `File not found: ${filePath}`);
          }
          throw error;
        }
        if (stats.isDirectory()) {
          throw this._createError('INVALID_PATH', 'Use delete_directory for directories');
        }
        await fsp.unlink(filePath);
        return true;
      },
    );
  }

  async deleteDirectory(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') {
      throw this._createError('INVALID_PATH', 'Invalid path provided');
    }
    return this._nativeOr(
      (n) => {
        n.napiDeleteDirectory(dirPath);
        return true;
      },
      async () => {
        let stats;
        try {
          stats = await fsp.stat(dirPath);
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            throw this._createError('FILE_NOT_FOUND', `Path not found: ${dirPath}`);
          }
          throw error;
        }
        if (!stats.isDirectory()) {
          throw this._createError('INVALID_PATH', 'Path is not a directory');
        }
        await fsp.rm(dirPath, { recursive: true, force: true });
        return true;
      },
    );
  }

  async createDirectory(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') {
      throw this._createError('INVALID_PATH', 'Invalid path provided');
    }
    const nativeCreateDirectory = resolveNativeMethod(native, NATIVE_CREATE_DIRECTORY_METHODS);
    if (nativeCreateDirectory) {
      try {
        nativeCreateDirectory(dirPath);
        return true;
      } catch (error) {
        // Native addon behavior may vary by build; fall back to JS path for reliability.
        const nativeError = mapNativeError(error);
        const existing = await this._safeStat(dirPath);
        if (existing?.isDirectory()) {
          return true;
        }
        if (nativeError?.code !== 'NATIVE_ERROR' && nativeError?.code !== 'INVALID_PATH') {
          // Keep original error for clear FS failures.
          throw nativeError;
        }
      }
    }
    try {
      await fsp.mkdir(dirPath, { recursive: false });
      return true;
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        throw this._createError('TARGET_EXISTS', `Target already exists: ${dirPath}`);
      }
      throw error;
    }
  }

  async renamePath(sourcePath, targetPath) {
    if (!sourcePath || typeof sourcePath !== 'string' || !targetPath || typeof targetPath !== 'string') {
      throw this._createError('INVALID_PATH', 'Invalid source or target path');
    }
    const sourcePathResolved = path.resolve(sourcePath);
    const targetPathResolved = path.resolve(targetPath);
    // Strict, case-preserving equality. A case-only rename like
    // `Readme.md` → `README.md` is a legitimate operation that the OS supports
    // on every supported filesystem (case-insensitive volumes such as macOS
    // APFS and Windows NTFS rewrite the filename in-place; case-sensitive
    // volumes rename to a new entry). Lower-casing before comparison would
    // incorrectly reject these renames as `NO_OP`.
    if (sourcePathResolved === targetPathResolved) {
      throw this._createError('NO_OP', 'Source and target paths are identical');
    }

    const sourceStat = await this._waitForSourceStat(sourcePathResolved);
    if (!sourceStat) {
      throw this._createError('FILE_NOT_FOUND', `Path not found: ${sourcePathResolved}`);
    }
    if (sourceStat.isDirectory() && isSelfOrDescendantPath(sourcePathResolved, targetPathResolved)) {
      throw this._createError('INVALID_MOVE', 'Cannot move a directory into itself or one of its descendants');
    }
    const targetStat = await this._safeStat(targetPathResolved);
    if (targetStat && !isSameFilesystemEntry(sourceStat, targetStat)) {
      throw this._createError('TARGET_EXISTS', `Target already exists: ${targetPathResolved}`);
    }

    const nativeRenamePath = resolveNativeMethod(native, NATIVE_RENAME_METHODS);
    if (nativeRenamePath) {
      try {
        nativeRenamePath(sourcePathResolved, targetPathResolved);
        return true;
      } catch (error) {
        // Native addon behavior may vary by build; verify if operation already succeeded.
        const sourceAfterNative = await this._safeStat(sourcePathResolved);
        const targetAfterNative = await this._safeStat(targetPathResolved);
        if (!sourceAfterNative && targetAfterNative) {
          return true;
        }
      }
    }

    return this._renameWithFallback(sourcePathResolved, targetPathResolved, sourceStat.isDirectory());
  }

  async _safeStat(targetPath) {
    try {
      return await fsp.stat(targetPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async _waitForSourceStat(sourcePath) {
    const retryDelaysMs = [40, 90, 180, 320, 550];
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      const stat = await this._safeStat(sourcePath);
      if (stat) {
        return stat;
      }
      if (attempt === retryDelaysMs.length) {
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
    return null;
  }

  async _renameWithFallback(sourcePath, targetPath, isDirectory) {
    const performRename = async () => {
      try {
        await fsp.rename(sourcePath, targetPath);
        return true;
      } catch (error) {
        if (!(error && error.code === 'EXDEV')) {
          throw error;
        }
        if (isDirectory) {
          await fsp.cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true });
          await fsp.rm(sourcePath, { recursive: true, force: false });
          return true;
        }
        await fsp.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
        await fsp.unlink(sourcePath);
        return true;
      }
    };

    const retryableCodes = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOENT']);
    // Some editors/processes momentarily hold exclusive handles on Windows.
    // Keep retries long enough to pass short-lived lock windows.
    const retryDelaysMs = [
      60, 120, 200, 300, 420, 560, 720, 900, 1100, 1300, 1500, 1800, 2100, 2400, 2800, 3200, 3600, 4200,
    ];
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      try {
        return await performRename();
      } catch (error) {
        const code = error?.code;
        const isRetryable = retryableCodes.has(code);
        if (!isRetryable || attempt === retryDelaysMs.length) {
          if (isRetryable) {
            // Last-resort Windows fallback: PowerShell Move-Item occasionally succeeds
            // when Node rename keeps hitting transient sharing races.
            if (process.platform === 'win32' && !isDirectory) {
              const moved = await this._renameWithPowerShell(sourcePath, targetPath);
              if (moved) {
                return true;
              }
            }
            if (code === 'ENOENT') {
              throw this._createError('FILE_NOT_FOUND', `Path not found during rename: ${sourcePath}`);
            }
            throw this._createError('FILE_IN_USE', `File is currently in use and cannot be renamed: ${sourcePath}`);
          }
          throw error;
        }
        // Add small jitter to avoid harmonizing with external writer cadence.
        const delay = retryDelaysMs[attempt] + Math.floor(Math.random() * 40);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async _renameWithPowerShell(sourcePath, targetPath) {
    const script = [
      `$src = '${sourcePath.replace(/'/g, "''")}'`,
      `$dst = '${targetPath.replace(/'/g, "''")}'`,
      `if (Test-Path -LiteralPath $dst) { throw 'Target exists.' }`,
      `Move-Item -LiteralPath $src -Destination $dst -ErrorAction Stop`,
    ].join('; ');
    try {
      await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
        windowsHide: true,
        timeout: 10_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  _emitNativeFileEvents() {
    if (!native) return;
    let raw;
    try {
      raw = native.napiGetAllEventsJson();
    } catch (e) {
      this.emit('watcher-error', { code: 'WATCHER_ERROR', message: e.message });
      return;
    }
    let events;
    try {
      events = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(events)) return;
    for (const ev of events) {
      const ts = Date.now();
      if (
        ev.type === 'renamed' &&
        (ev.oldPath || ev.old_path) &&
        (ev.newPath || ev.new_path)
      ) {
        const oldP = ev.oldPath ?? ev.old_path;
        const newP = ev.newPath ?? ev.new_path;
        this.emit('file-event', {
          type: 'renamed',
          path: newP,
          old_path: oldP,
          new_path: newP,
          timestamp: ts,
        });
      } else if (ev.path) {
        this.emit('file-event', {
          type: ev.type,
          path: ev.path,
          timestamp: ts,
        });
      }
    }
  }

  async startWatching(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') {
      throw this._createError('INVALID_PATH', 'Invalid path provided');
    }
    if (native) {
      if (this._nativePollTimer) {
        clearInterval(this._nativePollTimer);
        this._nativePollTimer = null;
      }
      if (this.watcher) {
        this.watcher.close();
        this.watcher = null;
      }
      try {
        native.napiStartWatching(dirPath);
      } catch (e) {
        throw mapNativeError(e);
      }
      this.watchingPath = dirPath;
      this._nativePollTimer = setInterval(() => this._emitNativeFileEvents(), 80);
      return { watching: true, path: dirPath };
    }

    let stats;
    try {
      stats = await fsp.stat(dirPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw this._createError('FILE_NOT_FOUND', `Path not found: ${dirPath}`);
      }
      throw error;
    }
    if (!stats.isDirectory()) {
      throw this._createError('INVALID_PATH', `Path is not a directory: ${dirPath}`);
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.watchingPath = dirPath;
    this.watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const fullPath = path.join(dirPath, filename);
      if (this.watchDebounceTimer) {
        clearTimeout(this.watchDebounceTimer);
      }
      this.watchDebounceTimer = setTimeout(() => {
        void (async () => {
          try {
            await fsp.access(fullPath);
            const event = this._getFileEvent(eventType, fullPath, true);
            this.emit('file-event', event);
          } catch {
            const event = this._getFileEvent(eventType, fullPath, false);
            this.emit('file-event', event);
          }
        })();
      }, this.debounceDelay);
    });
    this.watcher.on('error', (error) => {
      console.error('Watcher error:', error);
      this.emit('watcher-error', { code: 'WATCHER_ERROR', message: error.message });
    });
    return { watching: true, path: dirPath };
  }

  async stopWatching() {
    if (native) {
      if (this._nativePollTimer) {
        clearInterval(this._nativePollTimer);
        this._nativePollTimer = null;
      }
      let wasWatching = this.watchingPath;
      try {
        native.napiStopWatching();
      } catch (e) {
        throw mapNativeError(e);
      }
      this.watchingPath = null;
      return { watching: false, wasWatching };
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
      this.watchDebounceTimer = null;
    }
    const wasWatching = this.watchingPath;
    this.watchingPath = null;
    return { watching: false, wasWatching };
  }

  async isWatching() {
    if (native) {
      const w = native.napiIsWatching();
      const p = w ? native.napiGetWatchedPath() : null;
      return { watching: w, path: p ?? undefined };
    }
    return {
      watching: this.watcher !== null && this.watchingPath !== null,
      path: this.watchingPath,
    };
  }

  parseDiff(diffText) {
    if (!native) {
      throw this._createError('NATIVE_ERROR', 'parseDiff requires native module');
    }
    try {
      const json = native.napiParseDiffJson(diffText);
      return JSON.parse(json);
    } catch (e) {
      throw mapNativeError(e);
    }
  }

  buildMergeResult(payload) {
    if (!native) {
      throw this._createError('NATIVE_ERROR', 'buildMergeResult requires native module');
    }
    try {
      const { diffRows, changeSelections, changeBlocks } = payload;
      return native.napiBuildMergeResult(
        JSON.stringify(diffRows),
        JSON.stringify(changeSelections),
        JSON.stringify(changeBlocks),
      );
    } catch (e) {
      throw mapNativeError(e);
    }
  }

  buildCommitGraph(payload) {
    if (!native) {
      throw this._createError('NATIVE_ERROR', 'buildCommitGraph requires native module');
    }
    try {
      const { entries, connectivity, palette } = payload;
      const palJson = palette != null ? JSON.stringify(palette) : undefined;
      const json = native.napiBuildCommitGraphJson(
        JSON.stringify(entries),
        connectivity || 'nextRowWhenNoGitParents',
        palJson,
      );
      if (json === 'null') {
        return null;
      }
      return JSON.parse(json);
    } catch (e) {
      throw mapNativeError(e);
    }
  }

  renderMarkdown(source) {
    if (!native) {
      throw this._createError('NATIVE_ERROR', 'renderMarkdown requires native module');
    }
    try {
      return native.napiRenderMarkdown(source);
    } catch (e) {
      throw mapNativeError(e);
    }
  }

  _getFileEvent(eventType, filePath, exists) {
    let type;
    if (eventType === 'rename') {
      type = exists ? 'created' : 'deleted';
    } else {
      type = 'modified';
    }
    return {
      type,
      path: filePath,
      timestamp: Date.now(),
    };
  }

  _createError(code, message) {
    const error = new Error(message);
    error.code = code;
    error.rustError = true;
    return error;
  }
}

module.exports = {
  RustBridge,
  __testables: {
    resolveNativeMethod,
    normalizePathForCompare,
    isSelfOrDescendantPath,
    isSameFilesystemEntry,
  },
};

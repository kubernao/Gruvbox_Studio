/**
 * IPC Utilities for communicating with the Electron main process
 */

import type {
  PiChatChunkPayload,
  PiChatDonePayload,
  PiChatStreamEndPayload,
  PiExtensionUiRequest,
  PiToolcallDeltaPayload,
  PiToolUpdatePayload,
} from '../assistant-protocol/piEventTypes';
import * as ipcChannels from '../../../shared/ipc/channels.js';
import * as electronApiContract from '../../../shared/ipc/electronApiContract.js';

const { IPC_INVOKE_ALLOWED_CHANNELS } = ipcChannels as unknown as { IPC_INVOKE_ALLOWED_CHANNELS: string[] };
const { ELECTRON_API_INVOKE_METHOD_CHANNELS } = electronApiContract as unknown as {
  ELECTRON_API_INVOKE_METHOD_CHANNELS: Record<string, string>;
};
export type ElectronApiInvokeMethod = keyof typeof ELECTRON_API_INVOKE_METHOD_CHANNELS;

export type CredentialsStatusPayload = {
  openRouter: { configured: boolean };
  openAi: { configured: boolean };
};

export type PiChatHistorySessionSummary = {
  chatInstanceId: string;
  previewText: string;
  updatedAtMs: number;
  createdAtMs: number;
};

export type PiChatHistorySessionDetail = PiChatHistorySessionSummary & {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

declare global {
  interface Window {
    electronAPI: {
      readFile: (path: string) => Promise<string>;
      readFileBase64: (path: string) => Promise<string>;
      writeFile: (path: string, content: string) => Promise<boolean>;
      listDirectory: (path: string) => Promise<FileInfo[]>;
      getMetadata: (path: string) => Promise<FileMetadata>;
      deleteFile: (path: string) => Promise<boolean>;
      deleteDirectory: (path: string) => Promise<boolean>;
      createDirectory: (path: string) => Promise<boolean>;
      renamePath: (sourcePath: string, targetPath: string) => Promise<boolean>;
      openExternal: (path: string) => Promise<{ ok: boolean; error?: string }>;
      startWatching: (path: string) => Promise<WatcherStatus>;
      stopWatching: () => Promise<WatcherStatus>;
      isWatching: () => Promise<WatcherStatus>;
      showOpenDialog: (options?: any) => Promise<{ canceled: boolean; filePaths: string[] }>;
      pickExplorerSavePath: (payload: PickExplorerSavePathPayload) => Promise<PickExplorerSavePathResult>;
      confirmExplorerDelete: (payload: ConfirmExplorerDeletePayload) => Promise<{ ok: boolean }>;
      confirmUnsavedClose: (payload: ConfirmUnsavedClosePayload) => Promise<ConfirmUnsavedCloseResult>;
      onFileEvent: (callback: (event: FileEvent) => void) => void;
      onWatcherError: (callback: (error: IPCError) => void) => void;
      removeFileEventListener: () => void;
      removeWatcherErrorListener: () => void;
      getPlatform: () => string;
      credentialsGetStatus?: () => Promise<{ ok: boolean; error?: string } & CredentialsStatusPayload>;
      credentialsSet?: (payload: {
        provider: 'openrouter' | 'openai';
        secret: string;
      }) => Promise<{ ok: boolean; error?: string } & CredentialsStatusPayload>;
      credentialsClear?: (payload: { provider: 'openrouter' | 'openai' }) => Promise<{
        ok: boolean;
        error?: string;
      } & CredentialsStatusPayload>;
      onCredentialsChanged?: (callback: (payload: CredentialsStatusPayload) => void) => () => void;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      onAudiobookExportProgress?: (
        callback: (payload: AudiobookExportProgressPayload) => void,
      ) => () => void;
      onMenuPaletteAction?: (callback: (payload: { kind?: string }) => void) => () => void;
      subscribePiChat?: (handlers: {
        onChunk?: (chunk: PiChatChunkPayload) => void;
        onStreamEnd?: (payload: PiChatStreamEndPayload) => void;
        onDone?: (payload: PiChatDonePayload | unknown) => void;
        onError?: (err: string) => void;
        onTool?: (ev: { tool: string; inputPreview: string }) => void;
        onToolcallDelta?: (payload: PiToolcallDeltaPayload) => void;
        onToolUpdate?: (payload: PiToolUpdatePayload) => void;
        onToolEnd?: (ev: {
          tool: string;
          result: string;
          isError: boolean;
          reliabilityHint?: string;
          reliabilityMeta?: {
            schemaFailures?: number;
            repairedOnce?: boolean;
            repairCount?: number;
            repairCountByType?: Record<string, number>;
            errorType?: string | null;
            retriable?: boolean;
            normalizationNotes?: string[];
            validationErrors?: Array<{ field: string; code: string; message: string }>;
          };
          toolEnvelope?: {
            toolName: string;
            ok: boolean;
            errorType: string | null;
            message: string;
            suggestedAction: string;
            missingFields: string[];
            exampleValidCall: string[];
            retriable: boolean;
          };
        }) => void;
        onExtensionUi?: (ev: PiExtensionUiRequest) => void;
      }) => () => void;
      onCommandPaletteRequest?: (
        callback: (payload: { requestId: string; mode?: 'run' | 'preview'; query: string }) => void,
      ) => () => void;
      sendCommandPaletteResult?: (payload: {
        requestId: string;
        ok: boolean;
        error?: string;
        executedLabel?: string;
        detail?: string;
        preview?: Array<{
          id: string;
          label: string;
          detail?: string;
          disabled: boolean;
          rank: number;
        }>;
      }) => Promise<unknown>;
      /** E2E: returns fixture folder path or null */
      e2eGetFixtureRoot?: () => Promise<string | null>;
    };
  }
}

export interface FileInfo {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  modified_at: number;
}

export interface FileMetadata {
  path: string;
  is_directory: boolean;
  size: number;
  is_file: boolean;
  is_symlink: boolean;
  modified_at: number;
  created_at: number;
  permissions_readonly: boolean;
}

export interface IPCError {
  code: string;
  message: string;
}

export interface FileEvent {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;
  timestamp: number;
  old_path?: string;
  new_path?: string;
}

export interface WatcherStatus {
  watching: boolean;
  path?: string;
}

/** Intent passed to the main-process save dialog for explorer create/rename flows. */
export type ExplorerSavePickIntent = 'new-file' | 'new-folder' | 'rename' | 'save-as';

/** Payload for {@link IPCService.pickExplorerSavePath}: chooses default path and dialog title. */
export interface PickExplorerSavePathPayload {
  intent: ExplorerSavePickIntent;
  directoryPath?: string;
  currentPath?: string;
  suggestedName?: string;
}

/** Result of {@link IPCService.pickExplorerSavePath}: either a chosen absolute path or cancel. */
export type PickExplorerSavePathResult =
  | { canceled: true }
  | { canceled: false; filePath: string };

/** Labels for the native delete confirmation shown from the file explorer. */
export interface ConfirmExplorerDeletePayload {
  message: string;
  detail?: string;
}

/** Labels for unsaved-close confirmation when closing a document tab. */
export interface ConfirmUnsavedClosePayload {
  message: string;
  detail?: string;
}

export type ConfirmUnsavedCloseResult = {
  choice: 'save' | 'discard' | 'cancel';
};

export interface EditorExportPayload {
  format: 'html' | 'pdf' | 'docx';
  sourcePath: string;
  markdown: string;
  renderedHtml: string;
  css?: string;
}

/**
 * Payload for {@link IPCService.editorExportFileCopy}: save the active document
 * to a user-chosen path. Pass either UTF-8 string content (text tabs, including
 * unsaved edits) or base64 file bytes (e.g. PDF read from disk in the renderer).
 */
export type EditorExportFilePayload =
  | { sourcePath: string; contentUtf8: string; contentBase64?: never }
  | { sourcePath: string; contentBase64: string; contentUtf8?: never };

/** Result of {@link IPCService.speechTtsProxy} (main-process OpenAI speech API). */
export type SpeechTtsProxyResult =
  | { ok: true; audioBase64: string; mimeType: string }
  | { ok: false; error: string };

/** Payload segment for {@link IPCService.audiobookExport}. */
export type AudiobookExportSegmentInput = {
  text: string;
  title?: string;
};

/** Progress events from main during multi-chapter synthesis (`audiobook-export-progress`). */
export type AudiobookExportProgressPayload = {
  generationId: string;
  phase: string;
  index: number;
  total: number;
  segmentTitle?: string | null;
  filename?: string;
  manifestPath?: string;
  outputDir?: string;
  error?: string;
};

/** Result of {@link IPCService.audiobookExport}. */
export type AudiobookExportResult =
  | {
      ok: true;
      manifestPath: string;
      outputDir: string;
      generationId: string;
      chapterCount: number;
    }
  | {
      ok: false;
      cancelled?: boolean;
      error?: string;
      generationId?: string;
      failedSegmentIndex?: number;
    };

export class IPCService {
  private static api = (window as any).electronAPI;

  /**
   * Resolve the Electron preload API lazily from `window` at call time.
   * This avoids stale `undefined` captures during early module evaluation
   * (for example during hot reload or renderer boot timing edges).
   */
  private static getAPI() {
    const runtimeApi = (window as any).electronAPI;
    if (runtimeApi) {
      this.api = runtimeApi;
    }
    return this.api;
  }

  private static ensureAPI() {
    const api = this.getAPI();
    if (!api) {
      const debugLocation =
        typeof window !== 'undefined' && window?.location
          ? window.location.href
          : 'unknown';
      throw new Error(
        `Electron IPC API not available. Make sure preload script is loaded. location=${debugLocation}`
      );
    }
    return api;
  }

  private static async invokeAllowed(channel: string, payload: unknown): Promise<unknown> {
    const api = this.ensureAPI();
    if (!api.invoke) {
      throw new Error('Electron invoke bridge is unavailable in this build.');
    }
    if (!IPC_INVOKE_ALLOWED_CHANNELS.includes(channel)) {
      throw new Error(`IPC channel is not in the allowed contract: ${channel}`);
    }
    return api.invoke(channel, payload);
  }

  /**
   * Read file contents as a string
   */
  static async readFile(path: string): Promise<string> {
    const api = this.ensureAPI();
    try {
      const content = await api.readFile(path);
      return content;
    } catch (error) {
      throw this.mapError(error, 'Failed to read file');
    }
  }

  /**
   * Read file bytes encoded as base64.
   */
  static async readFileBase64(path: string): Promise<string> {
    const api = this.ensureAPI();
    try {
      const content = await api.readFileBase64(path);
      return content;
    } catch (error) {
      throw this.mapError(error, 'Failed to read file bytes');
    }
  }

  /**
   * Write content to a file
   */
  static async writeFile(path: string, content: string): Promise<boolean> {
    const api = this.ensureAPI();
    try {
      await api.writeFile(path, content);
      return true;
    } catch (error) {
      throw this.mapError(error, 'Failed to write file');
    }
  }

  /**
   * List directory contents
   */
  static async listDirectory(path: string): Promise<FileInfo[]> {
    const api = this.ensureAPI();
    try {
      const files = await api.listDirectory(path);
      return files;
    } catch (error) {
      throw this.mapError(error, 'Failed to list directory');
    }
  }

  /**
   * Get file metadata
   */
  static async getMetadata(path: string): Promise<FileMetadata> {
    const api = this.ensureAPI();
    try {
      const metadata = await api.getMetadata(path);
      return metadata;
    } catch (error) {
      throw this.mapError(error, 'Failed to get metadata');
    }
  }

  /**
   * Delete a file
   */
  static async deleteFile(path: string): Promise<boolean> {
    const api = this.ensureAPI();
    try {
      await api.deleteFile(path);
      return true;
    } catch (error) {
      throw this.mapError(error, 'Failed to delete file');
    }
  }

  /**
   * Delete a directory recursively
   */
  static async deleteDirectory(path: string): Promise<boolean> {
    const api = this.ensureAPI();
    try {
      await api.deleteDirectory(path);
      return true;
    } catch (error) {
      throw this.mapError(error, 'Failed to delete directory');
    }
  }

  /**
   * Create a directory
   */
  static async createDirectory(path: string): Promise<boolean> {
    const api = this.ensureAPI();
    try {
      await api.createDirectory(path);
      return true;
    } catch (error) {
      throw this.mapError(error, 'Failed to create directory');
    }
  }

  /**
   * Rename or move a file/directory
   */
  static async renamePath(sourcePath: string, targetPath: string): Promise<boolean> {
    const api = this.ensureAPI();
    try {
      await api.renamePath(sourcePath, targetPath);
      return true;
    } catch (error) {
      throw this.mapError(error, 'Failed to rename path');
    }
  }

  /**
   * Open file with the OS default application.
   */
  static async openExternal(path: string): Promise<{ ok: boolean; error?: string }> {
    const api = this.ensureAPI();
    if (!api.openExternal) {
      return { ok: false, error: 'Open external is not available in this build.' };
    }
    try {
      const result = await api.openExternal(path);
      if (!result || typeof result.ok !== 'boolean') {
        return { ok: false, error: 'Invalid response from open external bridge.' };
      }
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Start watching a directory for file changes
   */
  static async startWatching(path: string): Promise<WatcherStatus> {
    const api = this.ensureAPI();
    try {
      const result = await api.startWatching(path);
      return result;
    } catch (error) {
      throw this.mapError(error, 'Failed to start file watcher');
    }
  }

  /**
   * Stop watching for file changes
   */
  static async stopWatching(): Promise<WatcherStatus> {
    const api = this.ensureAPI();
    try {
      const result = await api.stopWatching();
      return result;
    } catch (error) {
      throw this.mapError(error, 'Failed to stop file watcher');
    }
  }

  /**
   * Get watcher status
   */
  static async getWatcherStatus(): Promise<WatcherStatus> {
    const api = this.ensureAPI();
    try {
      const result = await api.isWatching();
      return result;
    } catch (error) {
      throw this.mapError(error, 'Failed to get watcher status');
    }
  }

  /**
   * Show open directory dialog
   */
  static async showOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
    const api = this.ensureAPI();
    try {
      const result = await api.showOpenDialog();
      return result;
    } catch (error) {
      throw this.mapError(error, 'Failed to open folder dialog');
    }
  }

  /**
   * Opens a native save dialog in the main process so the renderer never relies on
   * `window.prompt`, which is unreliable under Electron sandboxing and security
   * settings. Used for new file, new folder (path + name), and rename-as-save flows.
   */
  static async pickExplorerSavePath(payload: PickExplorerSavePathPayload): Promise<PickExplorerSavePathResult> {
    const api = this.ensureAPI();
    if (!api.pickExplorerSavePath) {
      throw new Error('Explorer save dialog is not available in this build.');
    }
    try {
      const result: unknown = await api.pickExplorerSavePath(payload);
      if (!result || typeof result !== 'object') {
        return { canceled: true };
      }
      const r = result as { canceled?: unknown; filePath?: unknown };
      if (r.canceled === true || typeof r.filePath !== 'string' || r.filePath.trim() === '') {
        return { canceled: true };
      }
      return { canceled: false, filePath: r.filePath.trim() };
    } catch (error) {
      throw this.mapError(error, 'Failed to open save dialog');
    }
  }

  /**
   * Shows a native delete confirmation in the main process so delete operations do
   * not depend on `window.confirm`, which can be blocked or return immediately in
   * hardened Electron configurations.
   */
  static async confirmExplorerDelete(payload: ConfirmExplorerDeletePayload): Promise<{ ok: boolean }> {
    const api = this.ensureAPI();
    if (!api.confirmExplorerDelete) {
      return { ok: false };
    }
    try {
      const result: unknown = await api.confirmExplorerDelete(payload);
      if (!result || typeof result !== 'object' || typeof (result as { ok?: unknown }).ok !== 'boolean') {
        return { ok: false };
      }
      return { ok: (result as { ok: boolean }).ok };
    } catch (error) {
      throw this.mapError(error, 'Failed to show delete confirmation');
    }
  }

  static async confirmUnsavedClose(payload: ConfirmUnsavedClosePayload): Promise<ConfirmUnsavedCloseResult> {
    const api = this.ensureAPI();
    if (!api.confirmUnsavedClose) {
      return { choice: 'cancel' };
    }
    try {
      const result: unknown = await api.confirmUnsavedClose(payload);
      if (
        !result ||
        typeof result !== 'object' ||
        (result as { choice?: unknown }).choice !== 'save' &&
          (result as { choice?: unknown }).choice !== 'discard' &&
          (result as { choice?: unknown }).choice !== 'cancel'
      ) {
        return { choice: 'cancel' };
      }
      return { choice: (result as ConfirmUnsavedCloseResult).choice };
    } catch (error) {
      throw this.mapError(error, 'Failed to show unsaved changes confirmation');
    }
  }

  /**
   * Subscribe to file events
   */
  static onFileEvent(callback: (event: FileEvent) => void): void {
    if (window.electronAPI?.onFileEvent) {
      window.electronAPI.onFileEvent(callback);
    }
  }

  /**
   * Subscribe to watcher errors
   */
  static onWatcherError(callback: (error: IPCError) => void): void {
    if (window.electronAPI?.onWatcherError) {
      window.electronAPI.onWatcherError(callback);
    }
  }

  /**
   * Unsubscribe from file events
   */
  static removeFileEventListener(): void {
    if (window.electronAPI?.removeFileEventListener) {
      window.electronAPI.removeFileEventListener();
    }
  }

  /**
   * Unsubscribe from watcher errors
   */
  static removeWatcherErrorListener(): void {
    if (window.electronAPI?.removeWatcherErrorListener) {
      window.electronAPI.removeWatcherErrorListener();
    }
  }

  static async getCredentialsStatus(): Promise<CredentialsStatusPayload> {
    const api = this.ensureAPI();
    if (!api.credentialsGetStatus) {
      return {
        openRouter: { configured: false },
        openAi: { configured: false },
      };
    }
    const raw = await api.credentialsGetStatus();
    return {
      openRouter: raw?.openRouter ?? { configured: false },
      openAi: raw?.openAi ?? { configured: false },
    };
  }

  static async setCredentials(
    provider: 'openrouter' | 'openai',
    secret: string,
  ): Promise<{ ok: boolean; error?: string } & CredentialsStatusPayload> {
    const api = this.ensureAPI();
    if (!api.credentialsSet) {
      return {
        ok: false,
        error: 'Credentials API is not available in this build.',
        openRouter: { configured: false },
        openAi: { configured: false },
      };
    }
    const raw = await api.credentialsSet({ provider, secret });
    return {
      ok: raw?.ok !== false,
      error: raw?.error,
      openRouter: raw?.openRouter ?? { configured: provider === 'openrouter' },
      openAi: raw?.openAi ?? { configured: provider === 'openai' },
    };
  }

  static async clearCredentials(
    provider: 'openrouter' | 'openai',
  ): Promise<{ ok: boolean; error?: string } & CredentialsStatusPayload> {
    const api = this.ensureAPI();
    if (!api.credentialsClear) {
      return {
        ok: false,
        error: 'Credentials API is not available in this build.',
        openRouter: { configured: false },
        openAi: { configured: false },
      };
    }
    const raw = await api.credentialsClear({ provider });
    return {
      ok: raw?.ok !== false,
      error: raw?.error,
      openRouter: raw?.openRouter ?? { configured: false },
      openAi: raw?.openAi ?? { configured: false },
    };
  }

  static onCredentialsChanged(callback: (payload: CredentialsStatusPayload) => void): () => void {
    const api = this.ensureAPI();
    if (!api.onCredentialsChanged) {
      return () => {};
    }
    return api.onCredentialsChanged(callback);
  }

  static async editorExport(
    payload: EditorExportPayload,
  ): Promise<{ canceled: boolean; outputPath?: string; warnings?: string[] }> {
    this.ensureAPI();
    const response = (await this.invokeAllowed('editor-export-provider', payload)) as {
      canceled?: boolean;
      outputPath?: string;
      warnings?: string[];
      error?: string;
    };
    if (response?.error) {
      throw new Error(response.error);
    }
    return {
      canceled: response?.canceled === true,
      outputPath: typeof response?.outputPath === 'string' ? response.outputPath : undefined,
      warnings: Array.isArray(response?.warnings)
        ? response.warnings.filter((entry): entry is string => typeof entry === 'string')
        : [],
    };
  }

  /**
   * Opens a native save dialog and writes the given content to the path the user
   * selects. Used for “export a copy” without replacing the workspace file.
   */
  static async editorExportFileCopy(
    payload: EditorExportFilePayload,
  ): Promise<{ canceled: boolean; outputPath?: string }> {
    this.ensureAPI();
    const response = (await this.invokeAllowed('editor-export-file-provider', payload)) as {
      canceled?: boolean;
      outputPath?: string;
      error?: string;
    };
    if (response?.error) {
      throw new Error(response.error);
    }
    return {
      canceled: response?.canceled === true,
      outputPath: typeof response?.outputPath === 'string' ? response.outputPath : undefined,
    };
  }

  /**
   * Proxies neural TTS through the Electron main process so bearer tokens stay off the renderer.
   */
  static async speechTtsProxy(payload: {
    text: string;
    voice?: string;
    model?: string;
    speed?: number;
  }): Promise<SpeechTtsProxyResult> {
    this.ensureAPI();
    const response = (await this.invokeAllowed('speech-tts-provider', payload)) as {
      ok?: boolean;
      error?: string;
      audioBase64?: string;
      mimeType?: string;
    };
    if (response?.ok === true && typeof response.audioBase64 === 'string') {
      return {
        ok: true,
        audioBase64: response.audioBase64,
        mimeType: typeof response.mimeType === 'string' ? response.mimeType : 'audio/mpeg',
      };
    }
    return {
      ok: false,
      error:
        typeof response?.error === 'string' && response.error.trim() !== ''
          ? response.error
          : 'Speech synthesis failed.',
    };
  }

  /**
   * Writes chapter MP3 files and `audiobook-manifest.json` under `outputDir` via the main process.
   */
  static async audiobookExport(payload: {
    generationId: string;
    outputDir: string;
    sourceDocumentPath: string;
    segments: AudiobookExportSegmentInput[];
    voice: string;
    model: string;
    speed: number;
  }): Promise<AudiobookExportResult> {
    this.ensureAPI();
    const response = (await this.invokeAllowed('audiobook-export-provider', payload)) as Record<
      string,
      unknown
    >;
    if (response?.ok === true && typeof response.manifestPath === 'string') {
      return {
        ok: true,
        manifestPath: response.manifestPath,
        outputDir: typeof response.outputDir === 'string' ? response.outputDir : '',
        generationId: typeof response.generationId === 'string' ? response.generationId : '',
        chapterCount: typeof response.chapterCount === 'number' ? response.chapterCount : 0,
      };
    }
    return {
      ok: false,
      cancelled: response?.cancelled === true,
      error:
        typeof response?.error === 'string' && response.error.trim() !== ''
          ? response.error
          : 'Audiobook export failed.',
      generationId: typeof response?.generationId === 'string' ? response.generationId : undefined,
      failedSegmentIndex:
        typeof response?.failedSegmentIndex === 'number' ? response.failedSegmentIndex : undefined,
    };
  }

  /**
   * Requests cancellation of an in-flight audiobook job (matched by `generationId`).
   */
  static async audiobookExportCancel(generationId: string): Promise<void> {
    await this.invokeAllowed('audiobook-export-cancel', { generationId });
  }

  /**
   * Subscribes to progress updates from {@link IPCService.audiobookExport}.
   */
  static subscribeAudiobookExportProgress(
    callback: (payload: AudiobookExportProgressPayload) => void,
  ): () => void {
    const api = this.ensureAPI();
    const subscribe = api.onAudiobookExportProgress;
    if (typeof subscribe !== 'function') {
      return () => {};
    }
    return subscribe(callback);
  }

  /**
   * Map Electron IPC errors to user-friendly messages
   */
  private static mapError(error: any, defaultMessage: string): IPCError {
    const message = error?.message || error?.toString() || defaultMessage;
    const code = error?.code || 'UNKNOWN_ERROR';

    const errorMap: Record<string, string> = {
      FILE_NOT_FOUND: 'File not found',
      PERMISSION_DENIED: 'Permission denied. Check file permissions.',
      INVALID_PATH: 'Invalid file path',
      IO_ERROR: 'File system error occurred',
      INVALID_UTF8: 'File contains invalid UTF-8 characters',
      BINARY_FILE: 'File appears to be binary and cannot be edited as text',
      TARGET_EXISTS: 'Target already exists',
      INVALID_MOVE: 'Invalid move operation',
      NO_OP: 'No file operation was needed',
      FILE_IN_USE: 'File is currently in use by another process',
      OTHER_ERROR: 'An error occurred',
      UNKNOWN_ERROR: defaultMessage,
    };

    return {
      code,
      message: `${errorMap[code] || defaultMessage}: ${message}`,
    };
  }
}

import type { FileMetadata } from '../../shared/utils/ipc';

/**
 * Injectable file API for tests (race / slow read scenarios).
 */
export type SelectedFileLoadApi = {
  readFile: (path: string) => Promise<string>;
  getMetadata: (path: string) => Promise<FileMetadata>;
};

export type SelectedFileLoadSuccess = {
  path: string;
  content: string;
  metadata: FileMetadata;
  language: string;
};

/**
 * Loads a single file selection with stale-load guards:
 * - Ignores success/error if `getCurrentSelection()` !== pathForThisLoad.
 * - Clears the reading overlay in `finally` only when selection is still this path, or null (cleared).
 */
export async function performSelectedFileLoad(
  pathForThisLoad: string,
  api: SelectedFileLoadApi,
  getCurrentSelection: () => string | null,
  getLanguageFromPath: (path: string) => string,
  onSuccess: (result: SelectedFileLoadSuccess) => void,
  onError: (error: unknown) => void,
  onClearReadingOverlay: () => void
): Promise<void> {
  try {
    const [fileContent, metadata] = await Promise.all([
      api.readFile(pathForThisLoad),
      api.getMetadata(pathForThisLoad),
    ]);
    if (getCurrentSelection() !== pathForThisLoad) {
      return;
    }
    onSuccess({
      path: pathForThisLoad,
      content: fileContent,
      metadata,
      language: getLanguageFromPath(pathForThisLoad),
    });
  } catch (error) {
    if (getCurrentSelection() !== pathForThisLoad) {
      return;
    }
    onError(error);
  } finally {
    const current = getCurrentSelection();
    if (current === pathForThisLoad || current === null) {
      onClearReadingOverlay();
    }
  }
}

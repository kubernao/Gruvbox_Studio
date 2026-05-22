const path = require('node:path');

/**
 * Electron's showSaveDialog uses the folder path as defaultPath when renaming a directory. On
 * macOS the sheet often returns a target path that nests the new name inside the folder being
 * renamed (e.g. Documents/Essays/Papers) instead of beside it (Documents/Papers). The backend
 * correctly rejects that as moving a directory into a descendant. When the chosen path is a
 * strict child of the source directory, rewrite it to a sibling path under the same parent
 * using the final path segment the user entered.
 *
 * @param {string} sourceDirResolved - Absolute path from path.resolve() for the directory being renamed.
 * @param {string} pickedResolved - Absolute path from path.resolve() for the save-dialog result.
 * @returns {string} Absolute path to pass to renamePath.
 */
function normalizeDirectoryRenameSavePick(sourceDirResolved, pickedResolved) {
  const norm = (absPath) =>
    absPath
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase();
  const src = norm(sourceDirResolved);
  const dst = norm(pickedResolved);
  if (!src || !dst || dst === src) {
    return pickedResolved;
  }
  const prefix = `${src}/`;
  if (!dst.startsWith(prefix)) {
    return pickedResolved;
  }
  return path.join(path.dirname(sourceDirResolved), path.basename(pickedResolved));
}

module.exports = { normalizeDirectoryRenameSavePick };

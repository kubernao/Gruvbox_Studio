/**
 * Error message utilities for user-friendly error feedback
 * Maps technical errors to user-friendly messages
 */

export interface ErrorContext {
  code?: string;
  message?: string;
  context?: string;
  originalError?: unknown;
}

/**
 * Get user-friendly error message for file operations
 */
export function getFileErrorMessage(error: ErrorContext): string {
  const message = (error.message || '').toLowerCase();
  const code = error.code || '';

  // File not found errors
  if (message.includes('not found') || code === 'ENOENT') {
    return 'File not found or deleted. It may have been moved or removed.';
  }

  // Permission errors
  if (
    message.includes('permission') ||
    message.includes('denied') ||
    code === 'EACCES' ||
    code === 'EPERM'
  ) {
    return 'Permission denied. Check that you have access to this file and folder.';
  }

  // Encoding errors
  if (message.includes('utf') || message.includes('encoding')) {
    return 'Could not read file. It may not be UTF-8 encoded or may be binary.';
  }

  // Too many files
  if (message.includes('too many') || message.includes('limit')) {
    return 'Folder contains too many files. Consider filtering or opening a smaller folder.';
  }

  // Invalid path
  if (message.includes('invalid') || message.includes('path')) {
    return 'Invalid folder path or the path no longer exists.';
  }

  // Disk full
  if (message.includes('disk') || message.includes('space') || code === 'ENOSPC') {
    return 'Not enough disk space to complete this operation.';
  }

  // File in use
  if (message.includes('use') || code === 'EBUSY') {
    return 'File is in use by another process. Try closing it in other applications.';
  }

  // Generic file error
  return 'File operation failed. Please check the file permissions and try again.';
}

/**
 * Get user-friendly error message for folder operations
 */
export function getFolderErrorMessage(error: ErrorContext): string {
  const message = (error.message || '').toLowerCase();
  const code = error.code || '';

  // Folder not found
  if (message.includes('not found') || code === 'ENOENT') {
    return 'Folder not found. It may have been moved or deleted.';
  }

  // Permission denied
  if (
    message.includes('permission') ||
    message.includes('denied') ||
    code === 'EACCES' ||
    code === 'EPERM'
  ) {
    return 'Permission denied. Check that you have access to this folder.';
  }

  // Too many files
  if (message.includes('too many') || message.includes('limit')) {
    return 'Folder contains too many files. Consider filtering or opening a smaller folder.';
  }

  // Invalid path
  if (message.includes('invalid') || message.includes('path')) {
    return 'Invalid folder path or the path is not a directory.';
  }

  // Generic folder error
  return 'Failed to open folder. Please check the path and try again.';
}

/**
 * Get user-friendly error message for save operations
 */
export function getSaveErrorMessage(error: ErrorContext): string {
  const message = (error.message || '').toLowerCase();
  const code = error.code || '';

  // Disk full
  if (message.includes('disk') || message.includes('space') || code === 'ENOSPC') {
    return 'Not enough disk space to save file. Free up space and try again.';
  }

  // Permission denied
  if (
    message.includes('permission') ||
    message.includes('denied') ||
    code === 'EACCES' ||
    code === 'EPERM'
  ) {
    return 'Cannot save file. Check file permissions.';
  }

  // File in use
  if (message.includes('use') || code === 'EBUSY') {
    return 'File is in use by another process. Try closing it and save again.';
  }

  // Read-only filesystem
  if (message.includes('read-only') || message.includes('readonly')) {
    return 'File system is read-only. Cannot save changes.';
  }

  // Generic save error
  return 'Failed to save file. Please check permissions and disk space and try again.';
}

/**
 * Get user-friendly error message for general operations
 */
export function getGeneralErrorMessage(error: ErrorContext): string {
  const message = (error.message || '').toLowerCase();

  // Timeout
  if (message.includes('timeout')) {
    return 'Operation timed out. The file system may be slow or unresponsive.';
  }

  // Network/IPC errors
  if (message.includes('network') || message.includes('ipc')) {
    return 'Communication error. Please try again.';
  }

  // Generic error
  return 'An error occurred. Please try again or restart the application.';
}

/**
 * Maps failures from file-explorer actions (create, rename, delete, drag-move) to copy that does not
 * imply the editor failed to save. Reuses the main errno and substring signals used elsewhere, and adds
 * wording for invalid rename/move paths and destination collisions so users are not told to “save the
 * file” when the problem is a folder operation or IPC rename rejection.
 *
 * @param error - Normalized error context from {@link extractErrorInfo}.
 * @returns Short toast-ready message.
 */
export function getExplorerErrorMessage(error: ErrorContext): string {
  const message = (error.message || '').toLowerCase();
  const code = error.code || '';

  if (message.includes('disk') || message.includes('space') || code === 'ENOSPC') {
    return 'Not enough disk space to complete this operation.';
  }

  if (
    message.includes('permission') ||
    message.includes('denied') ||
    code === 'EACCES' ||
    code === 'EPERM'
  ) {
    return 'Permission denied. Check that you can modify this file or folder.';
  }

  if (message.includes('read-only') || message.includes('readonly')) {
    return 'This location is read-only.';
  }

  if (message.includes('use') || code === 'EBUSY' || code === 'FILE_IN_USE') {
    return 'Something is using this file or folder. Close other apps or terminals and try again.';
  }

  if (message.includes('not found') || code === 'ENOENT' || code === 'FILE_NOT_FOUND') {
    return 'The file or folder no longer exists or was moved.';
  }

  if (
    message.includes('descendant') ||
    message.includes('into itself') ||
    code === 'INVALID_MOVE'
  ) {
    return 'Cannot use that location for this move or rename.';
  }

  if (
    message.includes('already exists') ||
    message.includes('target exists') ||
    code === 'EEXIST' ||
    code === 'TARGET_EXISTS'
  ) {
    return 'Something already exists at that path.';
  }

  if (message.includes('timeout')) {
    return 'Operation timed out. Try again.';
  }

  if (message.includes('network') || message.includes('ipc')) {
    return 'Communication error. Please try again.';
  }

  return 'Could not complete this action. Check permissions, disk space, and whether another program is using this item.';
}

/**
 * Extract error code and message from various error types
 */
export function extractErrorInfo(error: unknown): ErrorContext {
  if (error instanceof Error) {
    return {
      code: (error as any).code,
      message: error.message,
      originalError: error,
    };
  }

  if (typeof error === 'string') {
    return {
      message: error,
      originalError: error,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const obj = error as any;
    return {
      code: obj.code,
      message: obj.message || String(error),
      originalError: error,
    };
  }

  return {
    message: 'An unknown error occurred',
    originalError: error,
  };
}

/**
 * Get friendly error message based on operation type
 */
export function getFriendlyErrorMessage(
  error: unknown,
  operationType: 'read' | 'write' | 'folder' | 'explorer' | 'general' = 'general'
): string {
  const errorInfo = extractErrorInfo(error);

  switch (operationType) {
    case 'read':
      return getFileErrorMessage(errorInfo);
    case 'write':
      return getSaveErrorMessage(errorInfo);
    case 'folder':
      return getFolderErrorMessage(errorInfo);
    case 'explorer':
      return getExplorerErrorMessage(errorInfo);
    default:
      return getGeneralErrorMessage(errorInfo);
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getFileErrorMessage,
  getFolderErrorMessage,
  getSaveErrorMessage,
  getExplorerErrorMessage,
  getGeneralErrorMessage,
  extractErrorInfo,
  getFriendlyErrorMessage,
  ErrorContext,
} from '@/frontend/shared/utils/errorMessages';

describe('errorMessages', () => {
  describe('getFileErrorMessage', () => {
    it('should handle file not found errors', () => {
      const error: ErrorContext = { message: 'not found' };
      expect(getFileErrorMessage(error)).toContain('File not found');
    });

    it('should handle ENOENT error code', () => {
      const error: ErrorContext = { code: 'ENOENT' };
      expect(getFileErrorMessage(error)).toContain('File not found');
    });

    it('should handle permission denied errors', () => {
      const error: ErrorContext = { message: 'permission denied' };
      expect(getFileErrorMessage(error)).toContain('Permission denied');
    });

    it('should handle EACCES error code', () => {
      const error: ErrorContext = { code: 'EACCES' };
      expect(getFileErrorMessage(error)).toContain('Permission denied');
    });

    it('should handle UTF-8 encoding errors', () => {
      const error: ErrorContext = { message: 'invalid utf-8' };
      expect(getFileErrorMessage(error)).toContain('Could not read file');
    });

    it('should handle disk full errors', () => {
      const error: ErrorContext = { message: 'no disk space' };
      expect(getFileErrorMessage(error)).toContain('disk space');
    });

    it('should handle ENOSPC error code', () => {
      const error: ErrorContext = { code: 'ENOSPC' };
      expect(getFileErrorMessage(error)).toContain('disk space');
    });

    it('should handle file in use errors', () => {
      const error: ErrorContext = { message: 'file in use' };
      expect(getFileErrorMessage(error)).toContain('in use');
    });

    it('should return generic message for unknown errors', () => {
      const error: ErrorContext = { message: 'some weird error' };
      expect(getFileErrorMessage(error)).toContain('File operation failed');
    });
  });

  describe('getFolderErrorMessage', () => {
    it('should handle folder not found errors', () => {
      const error: ErrorContext = { message: 'not found' };
      expect(getFolderErrorMessage(error)).toContain('Folder not found');
    });

    it('should handle permission denied for folders', () => {
      const error: ErrorContext = { message: 'permission denied' };
      expect(getFolderErrorMessage(error)).toContain('Permission denied');
    });

    it('should handle too many files error', () => {
      const error: ErrorContext = { message: 'too many files' };
      expect(getFolderErrorMessage(error)).toContain('too many files');
    });

    it('should handle invalid path errors', () => {
      const error: ErrorContext = { message: 'invalid path' };
      expect(getFolderErrorMessage(error)).toContain('Invalid folder path');
    });
  });

  describe('getSaveErrorMessage', () => {
    it('should handle disk full errors for save', () => {
      const error: ErrorContext = { message: 'no disk space' };
      expect(getSaveErrorMessage(error)).toContain('disk space');
    });

    it('should handle permission denied for save', () => {
      const error: ErrorContext = { message: 'permission denied' };
      expect(getSaveErrorMessage(error)).toContain('Cannot save');
    });

    it('should handle read-only filesystem', () => {
      const error: ErrorContext = { message: 'read-only filesystem' };
      expect(getSaveErrorMessage(error)).toContain('read-only');
    });

    it('should handle file in use during save', () => {
      const error: ErrorContext = { message: 'file in use' };
      expect(getSaveErrorMessage(error)).toContain('in use');
    });
  });

  describe('getExplorerErrorMessage', () => {
    it('should surface disk space failures without save wording', () => {
      const error: ErrorContext = { message: 'no disk space' };
      expect(getExplorerErrorMessage(error)).toContain('disk space');
      expect(getExplorerErrorMessage(error)).not.toContain('save');
    });

    it('should describe invalid directory moves', () => {
      const error: ErrorContext = {
        message: 'directory into itself or one of its descendants',
      };
      expect(getExplorerErrorMessage(error)).toContain('location');
    });

    it('should map TARGET_EXISTS without implying save', () => {
      const error: ErrorContext = { code: 'TARGET_EXISTS', message: 'exists' };
      expect(getExplorerErrorMessage(error)).toContain('already exists');
      expect(getExplorerErrorMessage(error)).not.toContain('save');
    });

    it('should use a neutral fallback for unknown errors', () => {
      const error: ErrorContext = { message: 'weird failure' };
      expect(getExplorerErrorMessage(error)).toContain('Could not complete');
    });
  });

  describe('getGeneralErrorMessage', () => {
    it('should handle timeout errors', () => {
      const error: ErrorContext = { message: 'timeout' };
      expect(getGeneralErrorMessage(error)).toContain('timed out');
    });

    it('should handle IPC errors', () => {
      const error: ErrorContext = { message: 'ipc error' };
      expect(getGeneralErrorMessage(error)).toContain('Communication error');
    });

    it('should handle generic unknown errors', () => {
      const error: ErrorContext = { message: 'unknown' };
      expect(getGeneralErrorMessage(error)).toContain('An error occurred');
    });
  });

  describe('extractErrorInfo', () => {
    it('should extract from Error objects', () => {
      const err = new Error('Test error');
      (err as any).code = 'TEST_CODE';
      const result = extractErrorInfo(err);
      expect(result.message).toBe('Test error');
      expect(result.code).toBe('TEST_CODE');
    });

    it('should extract from strings', () => {
      const result = extractErrorInfo('String error');
      expect(result.message).toBe('String error');
    });

    it('should extract from objects', () => {
      const result = extractErrorInfo({ code: 'OBJ_CODE', message: 'Object error' });
      expect(result.message).toBe('Object error');
      expect(result.code).toBe('OBJ_CODE');
    });

    it('should handle unknown error types', () => {
      const result = extractErrorInfo(null);
      expect(result.message).toBe('An unknown error occurred');
    });
  });

  describe('getFriendlyErrorMessage', () => {
    it('should handle read operation errors', () => {
      const result = getFriendlyErrorMessage(
        new Error('File not found'),
        'read'
      );
      expect(result).toContain('File not found');
    });

    it('should handle write operation errors', () => {
      const result = getFriendlyErrorMessage(
        new Error('No disk space'),
        'write'
      );
      expect(result).toContain('disk space');
    });

    it('should handle folder operation errors', () => {
      const result = getFriendlyErrorMessage(
        new Error('Folder not found'),
        'folder'
      );
      expect(result).toContain('Folder not found');
    });

    it('should handle explorer operation errors without save wording', () => {
      const result = getFriendlyErrorMessage(
        new Error('permission denied'),
        'explorer'
      );
      expect(result).toContain('Permission denied');
      expect(result).not.toContain('save');
    });

    it('should default to general operation type', () => {
      const result = getFriendlyErrorMessage(new Error('Generic error'));
      expect(result).toBeDefined();
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  shortPath,
  shortGitHash,
  statusClass,
  versionDistanceLabel,
  branchSwitchErrorForDisplay,
  gitDocumentRowId,
} from '@/frontend/features/git/utils/gitHelpers';

describe('gitHelpers', () => {
  describe('shortPath', () => {
    it('should return filename from absolute path', () => {
      expect(shortPath('/home/user/documents/file.txt')).toBe('file.txt');
    });

    it('should handle Windows paths', () => {
      expect(shortPath('C:\\Users\\user\\documents\\file.txt')).toBe('file.txt');
    });

    it('should handle relative paths', () => {
      expect(shortPath('src/components/Button.tsx')).toBe('Button.tsx');
    });

    it('should handle root paths', () => {
      expect(shortPath('/home')).toBe('home');
    });

    it('should handle empty string', () => {
      expect(shortPath('')).toBe('');
    });

    it('should handle single filename', () => {
      expect(shortPath('file.txt')).toBe('file.txt');
    });
  });

  describe('shortGitHash', () => {
    it('should truncate hash to 7 characters', () => {
      const hash = 'abc123def456ghi';
      expect(shortGitHash(hash)).toBe('abc123d');
    });

    it('should handle exact 7 character hash', () => {
      const hash = '1234567';
      expect(shortGitHash(hash)).toBe('1234567');
    });

    it('should not truncate shorter hashes', () => {
      const hash = '12345';
      expect(shortGitHash(hash)).toBe('12345');
    });

    it('should handle empty string', () => {
      expect(shortGitHash('')).toBe('');
    });
  });

  describe('statusClass', () => {
    it('should return added class for A status', () => {
      expect(statusClass('A')).toBe('status-added');
    });

    it('should return added class for ?? status', () => {
      expect(statusClass('??')).toBe('status-added');
    });

    it('should return modified class for M status', () => {
      expect(statusClass('M')).toBe('status-modified');
    });

    it('should return modified class for R status', () => {
      expect(statusClass('R')).toBe('status-modified');
    });

    it('should return deleted class for D status', () => {
      expect(statusClass('D')).toBe('status-deleted');
    });

    it('should return other class for unknown status', () => {
      expect(statusClass('C')).toBe('status-other');
    });

    it('should handle multi-character status codes', () => {
      expect(statusClass('AM')).toBe('status-added');
      expect(statusClass('MD')).toBe('status-modified');
    });
  });

  describe('versionDistanceLabel', () => {
    it('should return "Current version" for index 0', () => {
      expect(versionDistanceLabel(0)).toBe('Current version');
    });

    it('should return "Current version" for negative index', () => {
      expect(versionDistanceLabel(-1)).toBe('Current version');
    });

    it('should return correct label for positive index', () => {
      expect(versionDistanceLabel(1)).toBe('1 back');
      expect(versionDistanceLabel(5)).toBe('5 back');
      expect(versionDistanceLabel(100)).toBe('100 back');
    });
  });

  describe('branchSwitchErrorForDisplay', () => {
    it('should return empty string for empty input', () => {
      expect(branchSwitchErrorForDisplay('')).toBe('');
    });

    it('should handle worktree error', () => {
      const message = 'already used by worktree at /path/to/worktree';
      const result = branchSwitchErrorForDisplay(message);
      expect(result).toContain('already checked out in another Git worktree');
      expect(result).toContain('git worktree list');
    });

    it('should handle case-insensitive worktree error', () => {
      const message = 'Already Used By Worktree';
      const result = branchSwitchErrorForDisplay(message);
      expect(result).toContain('Git worktree');
    });

    it('should return original message for unknown errors', () => {
      const message = 'unknown error message';
      expect(branchSwitchErrorForDisplay(message)).toBe(message);
    });

    it('should trim whitespace', () => {
      const message = '  some error  ';
      expect(branchSwitchErrorForDisplay(message)).toBe('some error');
    });
  });

  describe('gitDocumentRowId', () => {
    it('should generate id for row index', () => {
      expect(gitDocumentRowId(0)).toBe('git-document-row-0');
      expect(gitDocumentRowId(42)).toBe('git-document-row-42');
    });

    it('should handle negative indices', () => {
      expect(gitDocumentRowId(-1)).toBe('git-document-row--1');
    });
  });
});

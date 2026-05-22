import { describe, it, expect, vi } from 'vitest';
import { performSelectedFileLoad } from '../../src/frontend/features/editor/loadSelectedFile';
import type { FileMetadata } from '../../src/frontend/shared/utils/ipc';

function sampleMeta(path: string, readonly = false): FileMetadata {
  return {
    path,
    is_directory: false,
    size: 1,
    is_file: true,
    is_symlink: false,
    modified_at: 0,
    created_at: 0,
    permissions_readonly: readonly,
  };
}

describe('performSelectedFileLoad', () => {
  it('calls onSuccess and clears overlay on happy path', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onClear = vi.fn();
    const api = {
      readFile: vi.fn().mockResolvedValue('hello'),
      getMetadata: vi.fn().mockResolvedValue(sampleMeta('/a.txt')),
    };

    await performSelectedFileLoad(
      '/a.txt',
      api,
      () => '/a.txt',
      () => 'plaintext',
      onSuccess,
      onError,
      onClear
    );

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0]).toMatchObject({
      path: '/a.txt',
      content: 'hello',
      language: 'plaintext',
    });
    expect(onError).not.toHaveBeenCalled();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('does not apply stale success when selection switched before read completes', async () => {
    let selection: string | null = '/a.txt';
    const getSel = () => selection;

    let resolveRead!: (v: string) => void;
    const readPromise = new Promise<string>((r) => {
      resolveRead = r;
    });

    const api = {
      readFile: vi.fn().mockReturnValue(readPromise),
      getMetadata: vi.fn().mockResolvedValue(sampleMeta('/a.txt')),
    };

    const onSuccess = vi.fn();
    const onClear = vi.fn();

    const p = performSelectedFileLoad(
      '/a.txt',
      api,
      getSel,
      () => 'plaintext',
      onSuccess,
      () => {},
      onClear
    );

    selection = '/b.txt';
    resolveRead!('stale-a');

    await p;

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('clears overlay when selection cleared (null) after in-flight load', async () => {
    let selection: string | null = '/a.txt';
    const getSel = () => selection;

    let resolveRead!: (v: string) => void;
    const readPromise = new Promise<string>((r) => {
      resolveRead = r;
    });

    const api = {
      readFile: vi.fn().mockReturnValue(readPromise),
      getMetadata: vi.fn().mockResolvedValue(sampleMeta('/a.txt')),
    };

    const onSuccess = vi.fn();
    const onClear = vi.fn();

    const p = performSelectedFileLoad(
      '/a.txt',
      api,
      getSel,
      () => 'plaintext',
      onSuccess,
      () => {},
      onClear
    );

    selection = null;
    resolveRead!('x');

    await p;

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('invokes onError and clears overlay when read rejects', async () => {
    const api = {
      readFile: vi.fn().mockRejectedValue(new Error('boom')),
      getMetadata: vi.fn().mockResolvedValue(sampleMeta('/a.txt')),
    };

    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onClear = vi.fn();

    await performSelectedFileLoad(
      '/a.txt',
      api,
      () => '/a.txt',
      () => 'plaintext',
      onSuccess,
      onError,
      onClear
    );

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onError for stale rejection when selection moved', async () => {
    let selection: string | null = '/a.txt';
    const getSel = () => selection;

    let rejectRead!: (e: Error) => void;
    const readPromise = new Promise<string>((_, rej) => {
      rejectRead = rej;
    });

    const api = {
      readFile: vi.fn().mockReturnValue(readPromise),
      getMetadata: vi.fn().mockResolvedValue(sampleMeta('/a.txt')),
    };

    const onError = vi.fn();
    const onClear = vi.fn();

    const p = performSelectedFileLoad(
      '/a.txt',
      api,
      getSel,
      () => 'plaintext',
      () => {},
      onError,
      onClear
    );

    selection = '/b.txt';
    rejectRead!(new Error('stale'));

    await p;

    expect(onError).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });
});

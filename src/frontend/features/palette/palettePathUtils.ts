import { isWin32 } from './platform';

export function toRepoRelativePath(absolutePath: string, rootPath: string): string | null {
  if (rootPath.trim() === '') {
    return null;
  }
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedPath = absolutePath.replace(/\\/g, '/');
  const rootKey = isWin32() ? normalizedRoot.toLowerCase() : normalizedRoot;
  const pathKey = isWin32() ? normalizedPath.toLowerCase() : normalizedPath;
  if (pathKey === rootKey) {
    return '';
  }
  if (!pathKey.startsWith(`${rootKey}/`)) {
    return null;
  }
  return normalizedPath.slice(normalizedRoot.length + 1);
}

export function selectedFileRepoRelative(selectedFile: string | null, rootPath: string): string | null {
  if (selectedFile == null) {
    return null;
  }
  return toRepoRelativePath(selectedFile, rootPath);
}

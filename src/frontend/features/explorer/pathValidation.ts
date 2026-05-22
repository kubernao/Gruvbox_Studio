export function normalizePathForCompare(inputPath: string): string {
  return inputPath.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

export function hasPathSeparator(name: string): boolean {
  return /[\\/]/.test(name);
}

export function validateRenameName(nextName: string, currentName: string): string {
  const trimmed = nextName.trim();
  if (!trimmed) {
    throw new Error('Name cannot be empty.');
  }
  if (hasPathSeparator(trimmed)) {
    throw new Error('Name cannot include path separators.');
  }
  if (trimmed === currentName) {
    throw new Error('New name must be different from current name.');
  }
  return trimmed;
}

export function isSamePath(pathA: string, pathB: string): boolean {
  return normalizePathForCompare(pathA) === normalizePathForCompare(pathB);
}

export function isSelfOrDescendantPath(sourcePath: string, targetPath: string): boolean {
  const source = normalizePathForCompare(sourcePath);
  const target = normalizePathForCompare(targetPath);
  if (source === '' || target === '') {
    return false;
  }
  if (source === target) {
    return true;
  }
  return target.startsWith(`${source}\\`) || target.startsWith(`${source}/`);
}

export function getParentPath(inputPath: string): string {
  const normalized = inputPath.trim();
  if (!normalized) {
    return '';
  }
  const trimmed = normalized.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  if (parts.length <= 1) {
    return '';
  }
  parts.pop();
  return parts.join('/');
}

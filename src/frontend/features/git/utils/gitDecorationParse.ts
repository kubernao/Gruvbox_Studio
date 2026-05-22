/**
 * `%D` decorations → ref names for `commit-graph` import rows (matches archive `parseGitDecorationRefs`).
 */

export function parseGitDecorationRefs(raw: string): string[] {
  if (raw.trim() === '') {
    return [];
  }
  return raw
    .split(',')
    .map((part) => {
      let t = part.trim();
      if (t.startsWith('HEAD -> ')) {
        t = t.slice('HEAD -> '.length).trim();
      }
      return t;
    })
    .filter((t) => t !== '');
}

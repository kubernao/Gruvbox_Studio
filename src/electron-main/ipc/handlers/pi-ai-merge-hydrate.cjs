const { isPlausibleMergePath, partitionMergePaths } = require('../../utils/mergePathPolicy.cjs');

/**
 * pi-ai-merge-hydrate — Git-backed discovery of changed repo-relative paths for AI merge / diff UI.
 *
 * This module is imported only from the Electron main process (`pi-gui.js`). It keeps all merge-open
 * Git plumbing in one testable place: union touched paths, branch comparisons, worktree porcelain,
 * and pick a primary file using the same scoring rules the UI expects (DiffViewer requires a
 * concrete repo-relative path to load blobs).
 *
 * @typedef {(cwd: string, args: string[]) => Promise<{ stdout: string }>} RunGitFn
 */

/**
 * Normalize a raw path segment from git status or diff output into a safe repo-relative POSIX path.
 *
 * @param {unknown} rawPath
 * @returns {string}
 */
function normalizeRelativeCandidatePath(rawPath) {
  if (typeof rawPath !== 'string') {
    return '';
  }
  const trimmed = rawPath.trim().replaceAll('\\', '/');
  if (trimmed === '') {
    return '';
  }
  let withoutDot = trimmed.replace(/^\.\//, '');
  if (withoutDot.startsWith('@')) {
    withoutDot = withoutDot.slice(1).trim();
  }
  if (withoutDot === '' || withoutDot.startsWith('../') || withoutDot === '..') {
    return '';
  }
  return withoutDot;
}

/**
 * Parse `git status --porcelain -z` output into `{ status, path }` records.
 *
 * @param {string} raw
 * @returns {Array<{ status: string, path: string }>}
 */
function parsePorcelainZ(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return [];
  }
  const tokens = raw.split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.length < 4) {
      continue;
    }
    const status = token.slice(0, 2);
    const relPath = normalizeRelativeCandidatePath(token.slice(3));
    if (relPath) {
      entries.push({ status, path: relPath });
    }
    if (status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C') {
      index += 1;
    }
  }
  return entries;
}

/**
 * Pick the best file to open in the diff view (markdown-friendly, downrank artifacts).
 *
 * @param {string[]} gitDerivedTouchedFiles
 * @param {string[]} toolTouchedFiles
 * @param {string[]} bridgedRelativePaths
 * @returns {string}
 */
function selectPrimaryTouchedFile(gitDerivedTouchedFiles, toolTouchedFiles, bridgedRelativePaths) {
  const prioritizedToolPaths = (toolTouchedFiles || [])
    .map((f) => String(f || '').trim())
    .filter(Boolean);
  if (prioritizedToolPaths.length > 0) {
    return prioritizedToolPaths[0];
  }
  const all = [...(gitDerivedTouchedFiles || []), ...(toolTouchedFiles || [])]
    .map((f) => String(f || '').trim())
    .filter(Boolean);
  if (all.length === 0) {
    return '';
  }
  const unique = [...new Set(all)];
  const bridgedSet = new Set(
    (bridgedRelativePaths || [])
      .map((f) => String(f || '').trim())
      .filter(Boolean),
  );
  const toolTouchedSet = new Set(
    (toolTouchedFiles || [])
      .map((f) => String(f || '').trim())
      .filter(Boolean),
  );

  const extension = (file) => {
    const lower = file.toLowerCase();
    const idx = lower.lastIndexOf('.');
    return idx >= 0 ? lower.slice(idx) : '';
  };
  const isMarkdown = (file) => {
    const ext = extension(file);
    return ext === '.md' || ext === '.mdx';
  };
  const isReadableText = (file) => {
    const ext = extension(file);
    return ext === '.md' || ext === '.mdx' || ext === '.txt' || ext === '.rst' || ext === '.adoc';
  };
  const isJsonOrArtifact = (file) => {
    const lower = file.toLowerCase();
    const ext = extension(lower);
    return (
      ext === '.json' ||
      lower.startsWith('.cursor/') ||
      lower.endsWith('package-lock.json') ||
      lower.endsWith('pnpm-lock.yaml') ||
      lower.endsWith('yarn.lock')
    );
  };

  const score = (file) => {
    let total = 0;
    if (toolTouchedSet.has(file)) total += 1000;
    if (bridgedSet.has(file)) total += 500;
    if (isMarkdown(file)) total += 300;
    else if (isReadableText(file)) total += 180;
    if (isJsonOrArtifact(file)) total -= 400;
    return total;
  };

  unique.sort((a, b) => score(b) - score(a));
  return unique[0] ?? '';
}

/**
 * @param {RunGitFn} runGit
 * @param {string} repoPath
 * @param {string} targetBranch
 * @param {string} sourceBranch
 * @returns {Promise<string[]>}
 */
async function listChangedRelativeFilesForBranches(runGit, repoPath, targetBranch, sourceBranch) {
  const target = String(targetBranch ?? '').trim();
  const source = String(sourceBranch ?? '').trim();
  if (target === '' || source === '' || target === source) {
    return [];
  }
  const raw = (await runGit(repoPath, ['diff', '--name-only', `${target}...${source}`])).stdout;
  const lines = raw
    .split(/\r?\n/)
    .map((line) => normalizeRelativeCandidatePath(line))
    .filter(Boolean);
  return [...new Set(lines)].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {RunGitFn} runGit
 * @param {string} worktreePath
 * @param {string[]} bridgedRelativePaths
 * @returns {Promise<string[]>}
 */
async function listWorktreePorcelainRelativePathsMinusBridged(runGit, worktreePath, bridgedRelativePaths = []) {
  const wt = String(worktreePath ?? '').trim();
  if (wt === '') {
    return [];
  }
  const bridgedSet = new Set(Array.isArray(bridgedRelativePaths) ? bridgedRelativePaths.map((x) => String(x)) : []);
  const status = (await runGit(wt, ['status', '--porcelain', '-z'])).stdout;
  const entries = parsePorcelainZ(status);
  const paths = entries.map((entry) => entry.path).filter((rel) => rel !== '' && !bridgedSet.has(rel));
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {RunGitFn} runGit
 * @param {string} worktreePath
 * @returns {Promise<string[]>}
 */
async function listPathsChangedInWorktreeHeadCommit(runGit, worktreePath) {
  const wt = String(worktreePath ?? '').trim();
  if (wt === '') {
    return [];
  }
  try {
    const raw = (await runGit(wt, ['show', '--name-only', '--pretty=format:', 'HEAD'])).stdout;
    const lines = raw
      .split(/\r?\n/)
      .map((line) => normalizeRelativeCandidatePath(line))
      .filter(Boolean);
    return [...new Set(lines)].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * @param {RunGitFn} runGit
 * @param {string} repoPath
 * @param {string} baseRef
 * @param {string} tipBranch
 * @returns {Promise<string[]>}
 */
async function listChangedRelativeFilesBetweenRefs(runGit, repoPath, baseRef, tipBranch) {
  const repo = String(repoPath ?? '').trim();
  const base = String(baseRef ?? '').trim();
  const tip = String(tipBranch ?? '').trim();
  if (repo === '' || base === '' || tip === '' || base === tip) {
    return [];
  }
  try {
    const raw = (await runGit(repo, ['diff', '--name-only', `${base}..${tip}`])).stdout;
    const lines = raw
      .split(/\r?\n/)
      .map((line) => normalizeRelativeCandidatePath(line))
      .filter(Boolean);
    return [...new Set(lines)].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * @param {RunGitFn} runGit
 * @param {string} repoPath
 * @param {string} leftRef
 * @param {string} rightRef
 * @returns {Promise<string[]>}
 */
async function listDirectTreeDiffRelativePaths(runGit, repoPath, leftRef, rightRef) {
  const repo = String(repoPath ?? '').trim();
  const left = String(leftRef ?? '').trim();
  const right = String(rightRef ?? '').trim();
  if (repo === '' || left === '' || right === '' || left === right) {
    return [];
  }
  try {
    const raw = (await runGit(repo, ['diff', '--name-only', left, right])).stdout;
    const lines = raw
      .split(/\r?\n/)
      .map((line) => normalizeRelativeCandidatePath(line))
      .filter(Boolean);
    return [...new Set(lines)].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Last-resort path discovery when union lists disagree or tool bookkeeping missed files.
 *
 * @param {RunGitFn} runGit
 * @param {string} repoPath
 * @param {string} targetBranch
 * @param {string} aiBranch
 * @param {string} [worktreePath]
 * @param {string[]} [bridgedRelativePaths]
 * @returns {Promise<string>}
 */
async function resolveAiMergePreviewRelativePath(
  runGit,
  repoPath,
  targetBranch,
  aiBranch,
  worktreePath = '',
  bridgedRelativePaths = [],
) {
  const repo = String(repoPath ?? '').trim();
  const target = String(targetBranch ?? '').trim();
  const ai = String(aiBranch ?? '').trim();
  const wt = String(worktreePath ?? '').trim();
  if (!repo || !target || !ai || target === ai) {
    return '';
  }
  const union = new Set();
  /** @type {string[][]} */
  const batches = [];
  batches.push(await listChangedRelativeFilesForBranches(runGit, repo, target, ai));
  batches.push(await listChangedRelativeFilesBetweenRefs(runGit, repo, target, ai));
  batches.push(await listDirectTreeDiffRelativePaths(runGit, repo, target, ai));
  if (wt) {
    batches.push(await listPathsChangedInWorktreeHeadCommit(runGit, wt));
    batches.push(await listWorktreePorcelainRelativePathsMinusBridged(runGit, wt, bridgedRelativePaths ?? []));
  }
  for (const arr of batches) {
    for (const entry of arr) {
      const n = normalizeRelativeCandidatePath(entry);
      if (n) union.add(n);
    }
  }
  if (union.size === 0) {
    return '';
  }
  const ranked = [...union].sort((a, b) => a.localeCompare(b));
  return selectPrimaryTouchedFile(ranked, [], bridgedRelativePaths ?? []);
}

/**
 * Produce a non-empty primary path whenever Git shows any branch/worktree delta, and the sorted union
 * for optional multi-file UI later.
 *
 * @param {RunGitFn} runGit
 * @param {{
 *   gitDerivedTouchedFiles: string[],
 *   toolTouchedFiles: string[],
 *   bridgedRelativePaths: string[],
 *   repoPath: string,
 *   targetBranch: string,
 *   aiBranch: string,
 *   worktreePath: string,
 * }} ctx
 * @returns {Promise<{ primaryRelativePath: string, changedRelativePaths: string[] }>}
 */
async function hydrateAiMergeOpenPaths(runGit, ctx) {
  const bridged = ctx.bridgedRelativePaths ?? [];
  const derived = (ctx.gitDerivedTouchedFiles || [])
    .map((x) => normalizeRelativeCandidatePath(String(x)))
    .filter(Boolean);
  const { plausible: changedRelativePaths } = partitionMergePaths(derived);

  const toolPaths = (ctx.toolTouchedFiles || [])
    .map((x) => normalizeRelativeCandidatePath(String(x)))
    .filter((x) => x && isPlausibleMergePath(x));
  let primaryRelativePath = selectPrimaryTouchedFile(changedRelativePaths, toolPaths, bridged);

  if (!String(primaryRelativePath ?? '').trim()) {
    primaryRelativePath = await resolveAiMergePreviewRelativePath(
      runGit,
      ctx.repoPath,
      ctx.targetBranch,
      ctx.aiBranch,
      ctx.worktreePath,
      bridged,
    );
  }

  const primary = String(primaryRelativePath ?? '').trim();
  const mergedSet = new Set(changedRelativePaths);
  if (primary) {
    mergedSet.add(primary);
  }
  const mergedSorted = [...mergedSet].sort((a, b) => a.localeCompare(b));

  return {
    primaryRelativePath: primary,
    changedRelativePaths: mergedSorted,
  };
}

module.exports = {
  normalizeRelativeCandidatePath,
  parsePorcelainZ,
  selectPrimaryTouchedFile,
  listChangedRelativeFilesForBranches,
  listWorktreePorcelainRelativePathsMinusBridged,
  listPathsChangedInWorktreeHeadCommit,
  listChangedRelativeFilesBetweenRefs,
  listDirectTreeDiffRelativePaths,
  resolveAiMergePreviewRelativePath,
  hydrateAiMergeOpenPaths,
};

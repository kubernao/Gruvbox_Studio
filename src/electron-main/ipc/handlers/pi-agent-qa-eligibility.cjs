'use strict';

const fs = require('fs');
const path = require('path');

/**
 * This module answers a single product question: should the Pi assistant attempt to
 * run the repository-local `run-agent-qa` orchestration at the end of a turn. Many
 * user workspaces are plain note vaults or non-Node trees that will never contain
 * that script; treating a missing runner as an infrastructure failure produces a
 * noisy error after every response. The eligibility predicate is therefore strict
 * and filesystem-based so behavior stays deterministic without importing Electron.
 */

/**
 * Return true when `repoPath` appears to be a Gruvbox-style Node workspace that
 * actually ships the agent QA entrypoint alongside a `package.json`, so spawned
 * npm steps inside `run-agent-qa.cjs` have a meaningful target. When either file is
 * absent we skip verification entirely rather than failing the turn with a bogus
 * `infra_failure` that only reflects a missing script in the opened folder.
 *
 * @param {string} repoPath Repository root directory.
 * @returns {boolean} Whether agent QA should be invoked for this tree.
 */
function repoHasAgentQaRunner(repoPath) {
  const root = String(repoPath || '').trim();
  if (!root) {
    return false;
  }
  const scriptPath = path.resolve(root, 'scripts/run-agent-qa.cjs');
  const pkgPath = path.resolve(root, 'package.json');
  return fs.existsSync(scriptPath) && fs.existsSync(pkgPath);
}

module.exports = { repoHasAgentQaRunner };

const path = require('node:path');

const gitMutationQueues = new Map();

/**
 * Serialize git mutation commands for a given repository path.
 * A failed mutation must not block the queue forever.
 * @param {string} repoPath
 * @param {string} command
 * @param {() => Promise<unknown>} work
 * @returns {Promise<unknown>}
 */
function enqueueGitMutation(repoPath, command, work) {
  const key = path.resolve(repoPath);
  const tail = gitMutationQueues.get(key) ?? Promise.resolve();
  const startedAt = Date.now();
  const next = tail
    .catch(() => undefined)
    .then(async () => {
      try {
        const result = await work();
        console.log('[git-provider][mutation]', {
          command,
          repoPath: key,
          durationMs: Date.now() - startedAt,
          ok: result?.ok === true || !result?.error,
          errorCode: result?.code ?? null,
        });
        return result;
      } catch (error) {
        console.warn('[git-provider][mutation-error]', {
          command,
          repoPath: key,
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  gitMutationQueues.set(
    key,
    next.finally(() => {
      if (gitMutationQueues.get(key) === next) {
        gitMutationQueues.delete(key);
      }
    }),
  );
  return next;
}

module.exports = {
  enqueueGitMutation,
};

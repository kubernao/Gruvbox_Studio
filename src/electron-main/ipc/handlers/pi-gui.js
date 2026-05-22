/**
 * pi-gui — IPC handler for the AI assistant ("Pi") feature.
 *
 * Responsibilities:
 *   - Lifecycle: spawn, reuse, and kill long-lived Pi RPC child processes
 *     (one per renderer `webContents.id`).
 *   - Stream state machine: track per-renderer status
 *     (`idle | streaming | aborting | completed | failed`).
 *   - Reliability layer: normalize tool-call arguments, validate against
 *     contracts, classify errors, and apply retry policy.
 *   - Reliability KPIs: count first-attempt validity rates per tool.
 *   - Git worktree helpers: create/reuse AI diff branches, checkpoint the
 *     user workspace before mutations.
 *   - IPC registration: wire all `pi-gui` and `pi-settings` channels via
 *     {@link registerPiGui}.
 *
 * Main-process only. Never import from renderer code.
 */

const fs = require('fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { shell, BrowserWindow, dialog } = require('electron');
const { IPC_EVENT_CHANNELS } = require('../../../shared/ipc/channels');
const {
  normalizeToolArgs,
  validateToolArgs,
  requiredFields,
  exampleArgs,
  buildToolSchemaSteer,
} = require('./pi-tool-reliability/toolContracts');
const { resolveFuzzyPath } = require('./pi-tool-reliability/pathResolver');
const { resolveFuzzyText } = require('./pi-tool-reliability/textResolver');
const { classifyError, shouldRetry, isDeterministicErrorType, backoffMs } = require('./pi-tool-reliability/retryPolicy');
const { normalizeGitBranchListLine } = require('../../utils/gitBranchListLine');
const { isPlausibleMergePath } = require('../../utils/mergePathPolicy.cjs');
const {
  assertValidCwd,
  isMutatingGitArgs,
  listTopLevelEntries,
  runWithRepoGitMutex,
} = require('./pi-tool-reliability/workspaceIntegrity');
const {
  getStreamState: getStreamStateFromLifecycle,
  setStreamState: setStreamStateFromLifecycle,
  clearStreamState: clearStreamStateFromLifecycle,
  getTurnFinalizer,
  setTurnFinalizer,
  deleteTurnFinalizer,
  canStartPiTurn,
  getPiTurnLifecycle,
} = require('./pi-turn-lifecycle');
const { repoHasAgentQaRunner } = require('./pi-agent-qa-eligibility.cjs');
const { resolveTurnQaPolicy } = require('./pi-turn-qa-policy.cjs');
const { buildConversationPrompt } = require('./pi-tool-reliability/conversationParity');
const {
  isLikelyJsonToolArgsText,
  computeTurnFailureBucket,
  computeConsecutiveToolFailureState,
} = require('./pi-tool-reliability/turnReliability');
const {
  readGlobalMemory,
  retrieveProjectMemory,
  composeMemoryPreamble,
  getProjectStats,
  consumeOrientPending,
} = require('../../memory/memory-service');
const {
  fetchOpenRouterModels,
  stripOpenRouterPrefix,
  PROVIDER_PREFIX,
} = require('../../credentials/openrouter-models');
const {
  hydrateAiMergeOpenPaths,
  listChangedRelativeFilesForBranches,
  listWorktreePorcelainRelativePathsMinusBridged,
  listPathsChangedInWorktreeHeadCommit,
  listChangedRelativeFilesBetweenRefs,
} = require('./pi-ai-merge-hydrate.cjs');
const {
  resolveModelStreamIdleTimeoutMs,
  resolveWatchdogTimeoutMsForPhase,
  resolvePiChildStreamChunkIdleTimeoutMs,
  formatStreamIdleTimeoutMessage,
} = require('./pi-stream-idle-timeouts');

const CHANNEL_CHUNK = IPC_EVENT_CHANNELS.piChatChunk;
const CHANNEL_ACTIVITY = IPC_EVENT_CHANNELS.piChatActivity;
const CHANNEL_STREAM_END = IPC_EVENT_CHANNELS.piChatStreamEnd;
const CHANNEL_DONE = IPC_EVENT_CHANNELS.piChatDone;
const CHANNEL_ERROR = IPC_EVENT_CHANNELS.piChatError;
const CHANNEL_TOOL = IPC_EVENT_CHANNELS.piChatTool;
const CHANNEL_TOOLCALL_DELTA = IPC_EVENT_CHANNELS.piChatToolcallDelta;
const CHANNEL_TOOL_UPDATE = IPC_EVENT_CHANNELS.piChatToolUpdate;
const CHANNEL_TOOL_END = IPC_EVENT_CHANNELS.piChatToolEnd;
const CHANNEL_EXTENSION_UI = IPC_EVENT_CHANNELS.piExtensionUi;

const PROVIDER_NAME = PROVIDER_PREFIX;
const PROVIDER_DEGRADE_PLACEHOLDER_MODEL_ID = '__openrouter_dynamic_model__';
const LIST_MODELS_TIMEOUT_MS = 30_000;

/** Pi RPC stdout event types handled explicitly in the send-message JSONL switch. */
const HANDLED_PI_STDOUT_EVENT_TYPES = new Set([
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'extension_ui_request',
  'extension_error',
  'agent_start',
  'turn_start',
  'turn_end',
  'queue_update',
  'agent_end',
  'response',
  'compaction_start',
  'compaction_end',
  'auto_retry_start',
  'auto_retry_end',
]);
// Opt-out flags: each feature is ENABLED by default. Set the env var to '0'
// to disable. Using `!== '0'` (rather than `=== '1'`) means new environments
// get the feature without any explicit configuration.
const FEATURE_FLAGS = {
  streamStateMachine: process.env.PI_STREAM_STATE_MACHINE_V1 !== '0',
  toolErrorProtocol: process.env.PI_TOOL_ERROR_PROTOCOL_V1 !== '0',
  retryPolicy: process.env.PI_RETRY_POLICY_V1 !== '0',
  fuzzyGated: process.env.PI_FUZZY_GATED_V1 !== '0',
  adaptiveTolerance: process.env.PI_ADAPTIVE_TOLERANCE_V1 !== '0',
  providerReliabilityGuard: process.env.PI_PROVIDER_RELIABILITY_GUARD_V1 !== '0',
  toolCallSanitizer: process.env.PI_TOOL_CALL_SANITIZER_V1 !== '0',
  contextBudgetManager: process.env.PI_CONTEXT_BUDGET_MANAGER_V1 !== '0',
  memoryToolHardening:
    typeof process.env.PI_MEMORY_TOOL_HARDENING_V1 === 'string'
      ? process.env.PI_MEMORY_TOOL_HARDENING_V1 !== '0'
      : process.env.NODE_ENV !== 'production',
};

/**
 * migrateLegacyModelId rewrites saved gruvbox-api/* ids to openrouter/* after the OSS migration.
 */
function migrateLegacyModelId(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.startsWith('gruvbox-api/')) {
    return `openrouter/${value.slice('gruvbox-api/'.length)}`;
  }
  return value;
}

function isPiDebugEnabled() {
  return process.env.GRUVBOX_PI_DEBUG === '1' || process.env.NODE_ENV === 'development';
}

/**
 * piDebug logs Pi integration messages when debug mode is enabled (development or GRUVBOX_PI_DEBUG=1).
 */
function piDebug(...args) {
  if (!isPiDebugEnabled()) {
    return;
  }
  console.log('[gruvbox-pi]', ...args);
}

/**
 * Per-renderer Pi RPC session: one long-lived child per `webContents.id` so multi-turn
 * tool + conversation state survives between user messages (see plan: persistent Pi).
 * @typedef {{
 *   child: import('node:child_process').ChildProcessWithoutNullStreams,
 *   cwd: string,
 *   model: string,
 *   requestId: string,
 *   openRouterApiKey: string,
 *   detachStdout: (() => void) | null,
 *   stderrBuf: string,
 *   stderrAttached: boolean,
 *   lifecycleAttached: boolean,
 *   lastTouchedAtMs?: number,
 *   stderrLogCount?: number,
 * }} PiRpcSession 
 * */

/** @type {Map<number, PiRpcSession>} */
const piSessions = new Map();
const PI_SESSION_IDLE_TTL_MS = 10 * 60 * 1000;
const PI_SESSION_SWEEP_INTERVAL_MS = 60 * 1000;

/** Grace period after sending an `abort` RPC before we kill the Pi child. */
const PI_ABORT_GRACE_MS = 750;
/**
 * AiWorktreeSession. lastAgentEndWorktreeHead is updated every agent_end after commits so QA can
 * detect a new commit this turn without treating a stale branch diff as “mutation every turn”.
 *
 * The optional `userCheckpointCommit` and `userCheckpointChangedRelativePaths`
 * fields record the durable user-workspace checkpoint commit (if any) that
 * `prepareAiWorktreeSession` created right before branching the AI worktree.
 * They exist so later logging, status reporting, and finalize logic can
 * explain why the user repo gained an extra commit.
 *
 * @typedef {{
 *   repoPath: string,
 *   targetBranch: string,
 *   aiBranch: string,
 *   worktreePath: string,
 *   aiBranchB?: string,
 *   worktreePathB?: string,
 *   mode: 'reuse' | 'abandon-next',
 *   baseCommit: string,
 *   lastAgentEndWorktreeHead?: string,
 *   mergePrimaryRelativePath?: string,
 *   mergeChangedRelativePaths?: string[],
 *   toolTouchedFiles?: string[],
 *   lastMergeReadyEventId?: string,
 *   lastMergeReadyRequestId?: string,
 *   chatInstanceId?: string,
 *   bridgedRelativePaths?: string[],
 *   userCheckpointCommit?: string,
 *   userCheckpointChangedRelativePaths?: string[],
 * }} AiWorktreeSession
 */
/** @type {Map<string, AiWorktreeSession & { webContentsId?: number }>} */
const aiWorktreeSessions = new Map();
let aiWorktreeSessionStoreApp = null;
/** @type {Map<string, {
 *   chatInstanceId: string,
 *   webContentsId: number,
 *   createdAtMs: number,
 *   updatedAtMs: number,
 *   previewText: string,
 *   messages: Array<{ role: 'user' | 'assistant', content: string, thinkingContent?: string }>,
 * }>} */
const aiChatHistorySessions = new Map();

function aiWorktreeSessionKey(chatInstanceId, webContentsId) {
  const chatKey = String(chatInstanceId ?? '').trim();
  if (chatKey !== '') {
    return `chat:${chatKey}`;
  }
  return `wc:${Number(webContentsId)}`;
}

function aiWorktreeSessionStorePath() {
  if (!aiWorktreeSessionStoreApp) {
    return '';
  }
  return path.join(aiWorktreeSessionStoreApp.getPath('userData'), 'ai-worktree-sessions.json');
}

function aiChatHistoryStorePath() {
  if (!aiWorktreeSessionStoreApp) {
    return '';
  }
  return path.join(aiWorktreeSessionStoreApp.getPath('userData'), 'ai-chat-history-sessions.json');
}

async function writeFileAtomic(targetPath, content) {
  const tmpPath = `${targetPath}.tmp`;
  await fs.promises.writeFile(tmpPath, content, 'utf8');
  await fs.promises.rename(tmpPath, targetPath);
}

async function persistAiWorktreeSessions() {
  const filePath = aiWorktreeSessionStorePath();
  if (!filePath) {
    return;
  }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const payload = Object.fromEntries([...aiWorktreeSessions.entries()]);
  await writeFileAtomic(filePath, JSON.stringify(payload, null, 2));
}

async function loadPersistedAiWorktreeSessions() {
  const filePath = aiWorktreeSessionStorePath();
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      aiWorktreeSessions.set(key, value);
    }
  } catch {
    // best effort; keep empty state
  }
}

/**
 * This function serializes the in-memory chat history map into the user-data
 * file so chat sessions are recoverable across app restarts. It mirrors the
 * existing worktree-session persistence behavior to keep file IO semantics
 * consistent within the pi-gui handler module.
 */
async function persistAiChatHistorySessions() {
  const filePath = aiChatHistoryStorePath();
  if (!filePath) {
    return;
  }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const payload = Object.fromEntries([...aiChatHistorySessions.entries()]);
  await writeFileAtomic(filePath, JSON.stringify(payload, null, 2));
}

/**
 * This function loads previously persisted chat history snapshots during app
 * startup and hydrates the in-memory map used by IPC handlers. Parse failures
 * are intentionally swallowed because history recovery is best-effort and must
 * never block the assistant from starting.
 */
async function loadPersistedAiChatHistorySessions() {
  const filePath = aiChatHistoryStorePath();
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      aiChatHistorySessions.set(key, value);
    }
  } catch {
    // best effort; keep empty state
  }
}

/**
 * This helper normalizes renderer-provided chat transcript rows into a strict
 * user/assistant list with non-empty text so persisted history is predictable
 * and resilient to partial rows like in-flight empty assistant placeholders.
 */
function normalizeHistoryTranscriptMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .map((entry) => {
      const role = entry?.role === 'assistant' ? 'assistant' : entry?.role === 'user' ? 'user' : '';
      const content = typeof entry?.content === 'string' ? entry.content : '';
      const thinkingRaw = entry?.thinkingContent ?? entry?.thinking_content;
      const thinkingContent = typeof thinkingRaw === 'string' ? thinkingRaw : '';
      let mergedContent = content;
      if (thinkingContent.trim() !== '' && !mergedContent.includes('[[GVX_THINK:')) {
        mergedContent = `\n\n[[GVX_THINK:${encodeURIComponent(thinkingContent)}]]\n\n${mergedContent}`;
      }
      return { role, content: mergedContent };
    })
    .filter((entry) => {
      if (entry.role !== 'assistant' && entry.role !== 'user') {
        return false;
      }
      if (entry.content.trim() !== '') {
        return true;
      }
      return false;
    });
}

/**
 * This helper builds a compact human-friendly label for a session list row by
 * preferring the first user prompt and falling back to any available content.
 * It keeps titles short enough for the sidebar modal while still preserving
 * enough context to distinguish adjacent sessions.
 */
function buildHistoryPreviewText(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'Untitled chat';
  }
  const firstUser = messages.find((entry) => entry.role === 'user' && typeof entry.content === 'string');
  const source = firstUser?.content ?? messages[0]?.content ?? '';
  const compact = String(source).replace(/\s+/g, ' ').trim();
  if (compact === '') {
    return 'Untitled chat';
  }
  return compact.length <= 90 ? compact : `${compact.slice(0, 89)}...`;
}

/**
 * This helper upserts a per-window chat history snapshot and immediately
 * persists it to disk so session recovery survives app restarts. The function
 * intentionally ignores empty session ids and empty transcripts to avoid
 * polluting history with invalid entries.
 */
async function upsertAiChatHistorySession({ chatInstanceId, webContentsId, messages }) {
  const chatId = String(chatInstanceId ?? '').trim();
  if (chatId === '') {
    return;
  }
  const normalizedMessages = normalizeHistoryTranscriptMessages(messages);
  if (normalizedMessages.length === 0) {
    return;
  }
  const nowMs = Date.now();
  const key = aiWorktreeSessionKey(chatId, webContentsId);
  const existing = aiChatHistorySessions.get(key);
  aiChatHistorySessions.set(key, {
    chatInstanceId: chatId,
    webContentsId: Number(webContentsId),
    createdAtMs: Number(existing?.createdAtMs) > 0 ? Number(existing.createdAtMs) : nowMs,
    updatedAtMs: nowMs,
    previewText: buildHistoryPreviewText(normalizedMessages),
    messages: normalizedMessages,
  });
  await persistAiChatHistorySessions();
}

function findAiWorktreeSessionByWebContentsId(webContentsId) {
  for (const [key, session] of aiWorktreeSessions.entries()) {
    if (Number(session?.webContentsId) === Number(webContentsId)) {
      return { key, session };
    }
  }
  return null;
}

async function setAiWorktreeSession(chatInstanceId, webContentsId, session) {
  const key = aiWorktreeSessionKey(chatInstanceId, webContentsId);
  aiWorktreeSessions.set(key, { ...session, webContentsId });
  await persistAiWorktreeSessions();
  return key;
}

async function deleteAiWorktreeSessionByKey(key) {
  if (!key || !aiWorktreeSessions.has(key)) {
    return;
  }
  aiWorktreeSessions.delete(key);
  await persistAiWorktreeSessions();
}

const reliabilityKpis = {
  malformedWritePathOnly: 0,
  malformedWriteRecovered: 0,
  hostFallbackTurns: 0,
  successfulMutations: 0,
  adaptedSuccesses: 0,
  adaptedFailures: 0,
  adaptationBlocked: 0,
  firstAttemptByTool: {},
  firstAttemptOverall: { total: 0, valid: 0 },
};

/**
 * Record whether the first tool-call attempt for `toolName` had valid arguments.
 * Mutates the module-level {@link reliabilityKpis} counters; call once per
 * `tool_execution_end` event where `attempt.attempts === 1`.
 * @param {string} toolName
 * @param {boolean} isValid
 */
function recordFirstAttemptKpi(toolName, isValid) {
  const name = String(toolName || 'unknown').trim() || 'unknown';
  const current = reliabilityKpis.firstAttemptByTool[name] ?? { total: 0, valid: 0 };
  current.total += 1;
  if (isValid) current.valid += 1;
  reliabilityKpis.firstAttemptByTool[name] = current;
  reliabilityKpis.firstAttemptOverall.total += 1;
  if (isValid) reliabilityKpis.firstAttemptOverall.valid += 1;
}

/**
 * Return a deep-copied snapshot of `kpis` with rate fields added to every
 * per-tool bucket and the overall bucket. Rates are rounded to 4 decimal
 * places — sufficient precision for a percentage point without floating-point
 * noise in logs.
 * @param {typeof reliabilityKpis} kpis
 * @returns {object}
 */
function withFirstAttemptRatesSnapshot(kpis) {
  const byTool = {};
  for (const [tool, stats] of Object.entries(kpis.firstAttemptByTool ?? {})) {
    const total = Number(stats?.total ?? 0);
    const valid = Number(stats?.valid ?? 0);
    byTool[tool] = {
      total,
      valid,
      rate: total > 0 ? Number((valid / total).toFixed(4)) : 0,
    };
  }
  const overallTotal = Number(kpis.firstAttemptOverall?.total ?? 0);
  const overallValid = Number(kpis.firstAttemptOverall?.valid ?? 0);
  return {
    ...kpis,
    firstAttemptByTool: byTool,
    firstAttemptOverall: {
      total: overallTotal,
      valid: overallValid,
      rate: overallTotal > 0 ? Number((overallValid / overallTotal).toFixed(4)) : 0,
    },
  };
}

/**
 * Return the current stream-state record for a renderer (by `webContents.id`).
 * Returns a safe idle default when the state machine feature flag is off or
 * when no state has been set yet.
 * @param {number} wcId
 */
function getStreamState(wcId) {
  return getStreamStateFromLifecycle(wcId, FEATURE_FLAGS);
}

/**
 * Overwrite the stream-state record for renderer `wcId`. No-op when the
 * state machine feature flag is off.
 * @param {number} wcId
 * @param {{ status: string, activeRequestId: string, aborting: boolean }} next
 */
function setStreamState(wcId, next) {
  setStreamStateFromLifecycle(wcId, next, FEATURE_FLAGS);
}

/**
 * Remove the stream-state record for renderer `wcId` (called on session end).
 * No-op when the state machine feature flag is off.
 * @param {number} wcId
 */
function clearStreamState(wcId) {
  clearStreamStateFromLifecycle(wcId, FEATURE_FLAGS);
}

function sweepIdlePiSessions() {
  const now = Date.now();
  for (const [wcId, session] of piSessions.entries()) {
    const streamState = getStreamState(wcId);
    if (streamState.status === 'streaming') {
      continue;
    }
    const lastTouchedAtMs = Number(session.lastTouchedAtMs ?? 0);
    if (lastTouchedAtMs <= 0 || now - lastTouchedAtMs < PI_SESSION_IDLE_TTL_MS) {
      continue;
    }
    killPiSession(wcId);
    clearStreamState(wcId);
  }
}

const piSessionSweepTimer = setInterval(sweepIdlePiSessions, PI_SESSION_SWEEP_INTERVAL_MS);
if (typeof piSessionSweepTimer.unref === 'function') {
  piSessionSweepTimer.unref();
}

/**
 * Return `true` if `child` has not yet exited (exit code and signal are both
 * null). Used to guard against sending commands to a dead process.
 * @param {import('node:child_process').ChildProcess | null | undefined} child
 * @returns {boolean}
 */
function isChildAlive(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

/**
 * Kill the Pi RPC child process for renderer `webContentsId` and remove it
 * from the session map. Swallows errors so callers do not need to guard
 * against a process that already exited.
 * @param {number} webContentsId
 */
function killPiSession(webContentsId) {
  const s = piSessions.get(webContentsId);
  if (!s) {
    return;
  }
  try {
    s.detachStdout?.();
  } catch {
    // ignore
  }
  try {
    s.child.kill();
  } catch {
    // ignore
  }
  piSessions.delete(webContentsId);
}

async function resetAiWorktreeSession(webContentsId) {
  const match = findAiWorktreeSessionByWebContentsId(webContentsId);
  if (!match) {
    return;
  }
  await deleteAiWorktreeSessionByKey(match.key);
}

/**
 * Sanitize an arbitrary string into a valid git branch name token.
 * Strips characters outside `[a-zA-Z0-9._/-]`, collapses repeated dashes,
 * and trims leading/trailing dashes and slashes. Truncates to 80 chars so
 * the composed branch name stays within git's 255-byte limit.
 * @param {string | null | undefined} input
 * @returns {string}
 */
function safeBranchToken(input) {
  return String(input ?? '')
    .replace(/[^a-zA-Z0-9._/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
    .slice(0, 80);
}

/**
 * Run a git command in `repoPath` and collect stdout/stderr.
 * Rejects with an error carrying `.stderr` on non-zero exit so callers can
 * surface the git message directly.
 * @param {string} repoPath - absolute path to the git repository
 * @param {string[]} args - git subcommand and flags
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runGit(repoPath, args, options = {}) {
  const execute = async () =>
    await new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: repoPath,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (err) => {
        finishReject(err);
      });
      const timeoutMs = 15000;
      const timeoutId = setTimeout(() => {
        child.kill('SIGKILL');
        finishReject(new Error(`git ${args.join(' ')} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          finishResolve({ stdout, stdoutTrimmed: stdout.trim(), stderr: stderr.trim() });
          return;
        }
        finishReject(new Error((stderr || stdout || `git ${args.join(' ')} failed`).trim()));
      });
    });
  if (isMutatingGitArgs(args) && options.skipMutex !== true) {
    return await runWithRepoGitMutex(repoPath, execute);
  }
  return await execute();
}

/**
 * Serialize explicit repo-level git mutations so AI session orchestration steps
 * cannot interleave with concurrent git operations from other UI surfaces.
 */
async function enqueueGitMutation(repoPath, work) {
  return await runWithRepoGitMutex(repoPath, work);
}

/**
 * Parse `git status --porcelain -z` output into `{ status, path }` records.
 * The `-z` format is NUL-delimited and preserves leading spaces in status
 * columns, which avoids off-by-one path slicing bugs.
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
 * Resolve git top-level for any path inside a repository.
 * Returns null when the path is not inside a git work tree.
 * @param {string} absPath
 * @returns {Promise<string|null>}
 */
async function resolveGitTopLevel(absPath) {
  const cwd = path.resolve(String(absPath || '').trim() || '.');
  try {
    const { stdout } = await runGit(cwd, ['rev-parse', '--show-toplevel']);
    const top = String(stdout || '').trim();
    return top === '' ? null : top;
  } catch {
    return null;
  }
}

/**
 * Enforces an upper bound for async preparation steps so renderer turns fail
 * with actionable errors instead of appearing to hang indefinitely.
 *
 * @template T
 * @param {Promise<T>} work
 * @param {number} timeoutMs
 * @param {string} label
 * @returns {Promise<T>}
 */
async function withTimeout(work, timeoutMs, label) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Choose QA verification tier from touched files.
 * @param {string[]} touchedRelativeFiles
 * @returns {'fast'|'smoke'|'full'}
 */
function selectQaTierForTouchedFiles(touchedRelativeFiles) {
  if (!Array.isArray(touchedRelativeFiles) || touchedRelativeFiles.length === 0) {
    return 'fast';
  }
  const files = touchedRelativeFiles.map((file) => String(file || '').toLowerCase());
  const hasCrossCuttingChange = files.some(
    (file) =>
      file.startsWith('src/electron-main/') ||
      file.startsWith('submodules/') ||
      file.includes('package.json') ||
      file.includes('playwright.config'),
  );
  if (hasCrossCuttingChange) {
    return 'full';
  }
  const docsOnly = files.every(
    (file) =>
      file.endsWith('.md') ||
      file.endsWith('.txt') ||
      file.endsWith('.css') ||
      file.endsWith('.json') ||
      file.startsWith('.cursor/'),
  );
  const markdownEditorOnly = files.every(
    (file) =>
      file.endsWith('.md') ||
      file.endsWith('.mdx') ||
      file.includes('monaco') ||
      file.includes('markdown') ||
      file.startsWith('src/frontend/features/assistant/') ||
      file.startsWith('src/frontend/components/editor/') ||
      file.startsWith('src/frontend/components/monaco/'),
  );
  if (docsOnly || markdownEditorOnly) {
    return 'fast';
  }
  return 'smoke';
}

/**
 * Run agent QA orchestration script and parse machine-readable result.
 *
 * Spawning uses {@link process.execPath} (the Electron binary in production). Without
 * `ELECTRON_RUN_AS_NODE`, Electron does not execute a `.cjs` file as a Node script, so the
 * child exits without writing the JSON report and this function surfaces `qa_report_unreadable`
 * / `infra_failure`. That mismatch is why Pi RPC uses the same env flag in {@link startPiRpc}.
 *
 * @param {string} repoPath
 * @param {'fast'|'smoke'|'full'} tier
 * @param {string} requestId
 * @returns {Promise<{ passed: boolean, tier: string, failureType: string, stopReason: string, reportPath: string, steps: Array<{name:string,status:string,exitCode:number,durationMs:number,failureType:string}> }>}
 */
async function runAgentQaTier(repoPath, tier, requestId) {
  const scriptPath = path.resolve(repoPath, 'scripts/run-agent-qa.cjs');
  const reportPath = path.resolve(repoPath, '.cursor/reports', `qa-session-report-${requestId}.json`);
  if (!fs.existsSync(scriptPath)) {
    return {
      passed: false,
      tier,
      failureType: 'infra_failure',
      stopReason: 'qa_script_missing',
      reportPath,
      steps: [],
    };
  }
  const qaChildEnv = {
    ...process.env,
    /** Same as Pi RPC: required when execPath is Electron so the child runs the script with Node semantics. */
    ELECTRON_RUN_AS_NODE: '1',
  };
  const childResult = await new Promise((resolve) => {
    let stderrBuf = '';
    const child = spawn(
      process.execPath,
      [scriptPath, `--tier=${tier}`, '--cwd', repoPath, '--out', reportPath],
      { cwd: repoPath, env: qaChildEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stderr?.on('data', (chunk) => {
      stderrBuf += String(chunk);
      if (stderrBuf.length > 8000) {
        stderrBuf = stderrBuf.slice(-8000);
      }
    });
    child.once('close', (code) => resolve({ exitCode: code, stderrTail: stderrBuf }));
    child.once('error', (err) =>
      resolve({
        exitCode: null,
        stderrTail: `${stderrBuf}\n${err instanceof Error ? err.message : 'spawn error'}`.trim(),
      }),
    );
  });
  try {
    const raw = fs.readFileSync(reportPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      passed: Boolean(parsed?.passed),
      tier: String(parsed?.tier || tier),
      failureType: String(parsed?.failureType || 'none'),
      stopReason: String(parsed?.stopReason || ''),
      reportPath,
      steps: Array.isArray(parsed?.steps) ? parsed.steps : [],
    };
  } catch (readErr) {
    piDebug('runAgentQaTier: unreadable report', {
      reportPath,
      exitCode: childResult.exitCode,
      stderrTail: String(childResult.stderrTail || '').slice(-1200),
      cause: readErr instanceof Error ? readErr.message : String(readErr),
    });
    return {
      passed: false,
      tier,
      failureType: 'infra_failure',
      stopReason: 'qa_report_unreadable',
      reportPath,
      steps: [],
      qaChildExitCode: childResult.exitCode,
      qaChildStderrTail: String(childResult.stderrTail || '').slice(-1200),
    };
  }
}

/**
 * Second AI worktree/branch from the same base commit (variant B) for dual-AI merge UI.
 * @param {import('electron').App} app
 * @param {number} webContentsId
 * @returns {Promise<void>}
 */
async function ensureSecondaryAiWorktreeSession(app, webContentsId) {
  const match = findAiWorktreeSessionByWebContentsId(webContentsId);
  const sess = match?.session;
  if (!sess || sess.worktreePathB) {
    return;
  }
  const repoPath = sess.repoPath;
  const baseCommit = sess.baseCommit;
  const currentBranch = sess.targetBranch;
  const ts = Date.now();
  const branchNameB = `ai/pi/w${webContentsId}/${safeBranchToken(currentBranch)}/b/${ts}`;
  const worktreeRoot = path.join(app.getPath('userData'), 'ai-worktrees');
  const worktreePathB = path.join(worktreeRoot, `w${webContentsId}-${ts}-b`);
  await fs.promises.mkdir(worktreeRoot, { recursive: true });
  await runGit(repoPath, ['worktree', 'add', '-B', branchNameB, worktreePathB, baseCommit]);
  sess.aiBranchB = branchNameB;
  sess.worktreePathB = worktreePathB;
  await setAiWorktreeSession(sess.chatInstanceId, webContentsId, sess);
}

async function isHealthyWorktreePath(worktreePath) {
  if (typeof worktreePath !== 'string' || !fs.existsSync(worktreePath)) {
    return false;
  }
  try {
    const inside = (await runGit(worktreePath, ['rev-parse', '--is-inside-work-tree'])).stdout.trim();
    if (inside !== 'true') {
      return false;
    }
    await runGit(worktreePath, ['status', '--porcelain']);
    return true;
  } catch {
    return false;
  }
}

async function listRepoBridgePaths(repoPath) {
  try {
    const out = (await runGit(repoPath, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout;
    if (typeof out !== 'string' || out.length === 0) {
      return [];
    }
    return out.split('\0').map((p) => normalizeRelativeCandidatePath(p)).filter(Boolean);
  } catch {
    return [];
  }
}

async function bridgeRepoPathsIntoWorktree(repoPath, worktreePath, relativePaths) {
  const bridged = [];
  for (const rel of relativePaths) {
    const from = path.join(repoPath, rel);
    const to = path.join(worktreePath, rel);
    if (!fs.existsSync(from) || fs.existsSync(to)) {
      continue;
    }
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await fs.promises.cp(from, to, { recursive: true, force: false });
    bridged.push(rel);
  }
  return bridged;
}

/**
 * Best-effort cleanup for stale AI worktrees that are no longer tracked by the
 * current in-memory session map. This keeps `git worktree list` bounded and
 * reduces branch/worktree lifecycle failures over long-running app sessions.
 * @param {string} repoPath
 * @param {string} aiWorktreeRoot
 * @param {number} maxAgeMs
 * @returns {Promise<void>}
 */
async function cleanupStaleAiWorktrees(repoPath, aiWorktreeRoot, maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const activePaths = new Set(
      [...aiWorktreeSessions.values()]
        .flatMap((session) => [session?.worktreePath, session?.worktreePathB])
        .filter((candidate) => typeof candidate === 'string' && candidate.trim() !== '')
        .map((candidate) => path.resolve(candidate)),
    );
    const now = Date.now();
    const listRaw = (await runGit(repoPath, ['worktree', 'list', '--porcelain'])).stdout;
    const lines = listRaw.split(/\r?\n/);
    /** @type {string[]} */
    const worktreePaths = [];
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        worktreePaths.push(path.resolve(line.slice('worktree '.length).trim()));
      }
    }
    const removedBranchCandidates = new Set();
    for (const worktreePath of worktreePaths) {
      if (!worktreePath.startsWith(path.resolve(aiWorktreeRoot))) {
        continue;
      }
      if (activePaths.has(worktreePath)) {
        continue;
      }
      const basename = path.basename(worktreePath);
      const tsMatch = basename.match(/-(\d{10,})/);
      const guessedTs = tsMatch ? Number(tsMatch[1]) : Number.NaN;
      const ageMs = Number.isFinite(guessedTs) ? now - guessedTs : maxAgeMs + 1;
      if (ageMs < maxAgeMs) {
        continue;
      }
      try {
        const branchRaw = (await runGit(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
        await runGit(repoPath, ['worktree', 'remove', '--force', worktreePath]);
        if (branchRaw.startsWith('ai/pi/w')) {
          removedBranchCandidates.add(branchRaw);
        }
      } catch {
        // best effort
      }
    }
    for (const branchName of removedBranchCandidates) {
      try {
        await runGit(repoPath, ['branch', '-D', branchName]);
      } catch {
        // best effort
      }
    }
    // Keep abandoned ai/pi branches (worktree removed) visible in git history;
    // only stale worktree directories are removed above.
    try {
      await runGit(repoPath, ['worktree', 'prune']);
    } catch {
      // best effort
    }
  } catch {
    // best effort
  }
}

async function prepareAiWorktreeSession(app, webContentsId, requestedRepoPath, chatInstanceId) {
  const repoPath = path.resolve(String(requestedRepoPath ?? '').trim() || app.getPath('home'));
  const worktreeRoot = path.join(app.getPath('userData'), 'ai-worktrees');
  await cleanupStaleAiWorktrees(repoPath, worktreeRoot);
  const chatId = String(chatInstanceId ?? '').trim();
  const prior = aiWorktreeSessions.get(aiWorktreeSessionKey(chatId, webContentsId))
    ?? findAiWorktreeSessionByWebContentsId(webContentsId)?.session;
  const priorSecondaryOk =
    !prior?.worktreePathB || (await isHealthyWorktreePath(prior.worktreePathB));
  if (prior && prior.mode === 'abandon-next') {
    await detachAiWorktreeKeepBranch(prior);
    const priorKey = aiWorktreeSessionKey(prior.chatInstanceId ?? chatId, webContentsId);
    await deleteAiWorktreeSessionByKey(priorKey);
  }
  if (
    prior &&
    prior.mode === 'reuse' &&
    path.resolve(prior.repoPath) === repoPath &&
    prior.chatInstanceId === chatId &&
    (await isHealthyWorktreePath(prior.worktreePath)) &&
    priorSecondaryOk
  ) {
    await ensureSecondaryAiWorktreeSession(app, webContentsId);
    return aiWorktreeSessions.get(aiWorktreeSessionKey(chatId, webContentsId)) ?? prior;
  }

  const branchRaw = (await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout;
  const currentBranch = branchRaw.trim();
  if (!currentBranch || currentBranch === 'HEAD') {
    throw new Error('Detached HEAD is not supported for AI worktree flow.');
  }
  // Capture any uncommitted user changes as a real checkpoint commit so the AI
  // worktree branches off a saved version of the user's work. Without this,
  // dirty trees later cause the DiffViewer's branch-merge save step to refuse.
  const checkpoint = await checkpointUserRepoIfDirty(repoPath);
  const baseCommit = (await runGit(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
  const ts = Date.now();
  const branchName = `ai/pi/w${webContentsId}/${safeBranchToken(currentBranch)}/${ts}`;
  const worktreePath = path.join(worktreeRoot, `w${webContentsId}-${ts}`);
  await fs.promises.mkdir(worktreeRoot, { recursive: true });
  try {
    await runGit(repoPath, ['worktree', 'add', '-B', branchName, worktreePath, baseCommit]);
    const inside = (await runGit(worktreePath, ['rev-parse', '--is-inside-work-tree'])).stdout.trim();
    if (!fs.existsSync(worktreePath) || inside !== 'true') {
      throw new Error('Worktree verification failed.');
    }
    const bridgeCandidates = await listRepoBridgePaths(repoPath);
    const bridgeLimit = 500;
    if (bridgeCandidates.length > bridgeLimit) {
      const tooLarge = new Error(
        `Too many untracked files to bridge (${bridgeCandidates.length}); falling back to in-place mode.`,
      );
      tooLarge.code = 'worktree_bridge_too_large';
      throw tooLarge;
    }
    const shouldBridge = bridgeCandidates.length <= bridgeLimit;
    const bridgedRelativePaths = shouldBridge
      ? await bridgeRepoPathsIntoWorktree(repoPath, worktreePath, bridgeCandidates)
      : [];
    const next = {
      repoPath,
      targetBranch: currentBranch,
      aiBranch: branchName,
      worktreePath,
      mode: 'reuse',
      baseCommit,
      lastAgentEndWorktreeHead: baseCommit,
      chatInstanceId: chatId,
      bridgedRelativePaths,
      userCheckpointCommit: checkpoint.committed === true ? String(checkpoint.head ?? '') : '',
      userCheckpointChangedRelativePaths:
        checkpoint.committed === true && Array.isArray(checkpoint.changedRelativePaths)
          ? [...checkpoint.changedRelativePaths]
          : [],
    };
    await setAiWorktreeSession(chatId, webContentsId, next);
    await ensureSecondaryAiWorktreeSession(app, webContentsId);
    return aiWorktreeSessions.get(aiWorktreeSessionKey(chatId, webContentsId)) ?? next;
  } catch (error) {
    if (fs.existsSync(worktreePath)) {
      try {
        await runGit(repoPath, ['worktree', 'remove', '--force', worktreePath]);
      } catch {
        // best effort cleanup
      }
    }
    try {
      await runGit(repoPath, ['worktree', 'prune']);
    } catch {
      // best effort cleanup
    }
    throw error;
  }
}

/**
 * Removes AI worktree directories but keeps proposal branch refs for git history.
 *
 * @param {AiWorktreeSession} sess
 * @returns {Promise<void>}
 */
async function detachAiWorktreeKeepBranch(sess) {
  const removeWorktree = async (worktreePath) => {
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      return;
    }
    try {
      await runGit(sess.repoPath, ['worktree', 'remove', '--force', worktreePath]);
    } catch {
      // best effort
    }
  };
  await removeWorktree(sess.worktreePath);
  await removeWorktree(sess.worktreePathB);
  try {
    await runGit(sess.repoPath, ['worktree', 'prune']);
  } catch {
    // best effort
  }
}

async function discardAiWorktreeSession(webContentsId, chatInstanceId = '', options = {}) {
  const keepBranch = options?.keepBranch === true;
  const key = aiWorktreeSessionKey(chatInstanceId, webContentsId);
  const matched = aiWorktreeSessions.get(key) ? { key, session: aiWorktreeSessions.get(key) } : findAiWorktreeSessionByWebContentsId(webContentsId);
  if (!matched?.session) {
    return false;
  }
  const sess = matched.session;
  await detachAiWorktreeKeepBranch(sess);
  if (!keepBranch) {
    try {
      await runGit(sess.repoPath, ['branch', '-D', sess.aiBranch]);
    } catch {
      // best effort
    }
    if (sess.aiBranchB) {
      try {
        await runGit(sess.repoPath, ['branch', '-D', sess.aiBranchB]);
      } catch {
        // best effort
      }
    }
  }
  await deleteAiWorktreeSessionByKey(matched.key);
  return true;
}

function normalizeRelativeCandidatePath(rawPath) {
  if (typeof rawPath !== 'string') {
    return '';
  }
  const trimmed = rawPath.trim().replaceAll('\\', '/');
  if (trimmed === '') {
    return '';
  }
  let withoutDot = trimmed.replace(/^\.\//, '');
  // Pi agent paths may use a leading `@` (cwd-relative alias). Repo-relative paths must not
  // retain it — git and disk resolution treat `@file` as a literal segment.
  if (withoutDot.startsWith('@')) {
    withoutDot = withoutDot.slice(1).trim();
  }
  if (withoutDot === '' || withoutDot.startsWith('../') || withoutDot === '..') {
    return '';
  }
  return withoutDot;
}

function toRepoRelativePath(rawPath, effectiveCwd, repoPath) {
  const normalized = normalizeRelativeCandidatePath(rawPath);
  if (normalized === '') {
    return '';
  }
  if (!path.isAbsolute(normalized)) {
    return normalized;
  }
  try {
    const fromWorktree = path.relative(effectiveCwd, normalized).replaceAll('\\', '/');
    if (fromWorktree && !fromWorktree.startsWith('..')) {
      return normalizeRelativeCandidatePath(fromWorktree);
    }
  } catch {
    // ignore
  }
  try {
    const fromRepo = path.relative(repoPath, normalized).replaceAll('\\', '/');
    if (fromRepo && !fromRepo.startsWith('..')) {
      return normalizeRelativeCandidatePath(fromRepo);
    }
  } catch {
    // ignore
  }
  return '';
}

function isLikelyMutatingBashCommand(command) {
  const text = String(command ?? '').trim().toLowerCase();
  if (text === '') {
    return false;
  }
  if (/(^|\s)(touch|mv|cp|rm|rmdir|mkdir|truncate|sed\s+-i|perl\s+-i|tee)\b/.test(text)) {
    return true;
  }
  if (/(^|\s)(git\s+apply|git\s+am|git\s+cherry-pick|git\s+revert|git\s+commit)\b/.test(text)) {
    return true;
  }
  if (/(^|\s)(npm|pnpm|yarn)\s+version\b/.test(text)) {
    return true;
  }
  if (/[>|]{1,2}\s*["']?[^|&;\n]+/.test(text)) {
    return true;
  }
  return false;
}

function inferTouchedPathFromBashCommand(command) {
  const text = String(command ?? '').trim();
  if (text === '') {
    return '';
  }
  const redirection = text.match(/[>|]{1,2}\s*["']([^"']+)["']/) || text.match(/[>|]{1,2}\s*([^\s|&;]+)/);
  const opPath = text.match(/(?:^|\s)(?:touch|rm|rmdir|mkdir)\s+["']([^"']+)["']/)
    || text.match(/(?:^|\s)(?:touch|rm|rmdir|mkdir)\s+([^\s|&;]+)/);
  const mvCp = text.match(/(?:^|\s)(?:mv|cp)\s+(?:["'][^"']+["']|[^\s|&;]+)\s+["']([^"']+)["']/)
    || text.match(/(?:^|\s)(?:mv|cp)\s+(?:["'][^"']+["']|[^\s|&;]+)\s+([^\s|&;]+)/);
  const raw =
    (redirection && redirection[1]) ||
    (opPath && opPath[1]) ||
    (mvCp && mvCp[1]) ||
    '';
  if (!raw || !isPlausibleMergePath(raw)) {
    return '';
  }
  return raw;
}

function areFileContentsEqual(leftPath, rightPath) {
  try {
    const left = fs.readFileSync(leftPath);
    const right = fs.readFileSync(rightPath);
    return left.equals(right);
  } catch {
    return false;
  }
}

/**
 * Commit the user's working tree as a durable checkpoint before an AI worktree
 * branch is created from the same repository.
 *
 * The AI edit flow branches off the user repository's current `HEAD`, so any
 * uncommitted edits the user has at that moment would later cause the
 * DiffViewer's branch-merge save step to refuse with
 * `Working tree must be clean before merging branches.`. Creating a real
 * checkpoint commit here means the AI branch always starts from a saved
 * version of the user's work, the post-AI merge always sees a clean tree,
 * and nothing the user typed before pressing send is ever silently dropped.
 *
 * The function inspects `git status --porcelain -z` for the user repository
 * and returns `{ committed: false }` immediately when the tree is already
 * clean. When changes are present it stages everything (`git add -A`) and
 * records a single commit under the repo git mutex so concurrent worktree
 * mutations cannot interleave. The new commit hash and the list of changed
 * relative paths are returned so callers can record metadata about the
 * checkpoint they created.
 *
 * @param {string} repoPath
 * @returns {Promise<{ committed: boolean, head?: string, changedRelativePaths?: string[] }>}
 */
async function checkpointUserRepoIfDirty(repoPath) {
  const statusRaw = (await runGit(repoPath, ['status', '--porcelain', '-z'])).stdout;
  const statusEntries = parsePorcelainZ(statusRaw);
  if (statusEntries.length === 0) {
    return { committed: false };
  }
  const changedRelativePaths = [
    ...new Set(
      statusEntries
        .map((entry) => entry.path)
        .filter((entry) => typeof entry === 'string' && entry.trim() !== ''),
    ),
  ].sort((a, b) => a.localeCompare(b));
  return await enqueueGitMutation(repoPath, async () => {
    await runGit(repoPath, ['add', '-A'], { skipMutex: true });
    await runGit(
      repoPath,
      [
        'commit',
        '-m',
        `chore(ai): checkpoint user workspace before AI edit (${new Date().toISOString()})`,
      ],
      { skipMutex: true },
    );
    const head = (await runGit(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
    return { committed: true, head, changedRelativePaths };
  });
}

async function commitWorktreeChangesIfAny(worktreePath, repoPath, bridgedRelativePaths = []) {
  const status = (await runGit(worktreePath, ['status', '--porcelain', '-z'])).stdout;
  const statusEntries = parsePorcelainZ(status);
  if (statusEntries.length === 0) {
    return { committed: false };
  }
  const bridgedSet = new Set(Array.isArray(bridgedRelativePaths) ? bridgedRelativePaths : []);
  const pathsToAdd = [];
  for (const entry of statusEntries) {
    const rel = entry.path;
    if (!rel) {
      continue;
    }
    if (!bridgedSet.has(rel)) {
      pathsToAdd.push(rel);
      continue;
    }
    const repoAbs = path.join(repoPath, rel);
    const worktreeAbs = path.join(worktreePath, rel);
    if (!areFileContentsEqual(repoAbs, worktreeAbs)) {
      pathsToAdd.push(rel);
    }
  }
  if (pathsToAdd.length === 0) {
    return { committed: false };
  }
  const sortedStagedPaths = [...new Set(pathsToAdd)].sort((a, b) => a.localeCompare(b));
  return await enqueueGitMutation(worktreePath, async () => {
    await runGit(worktreePath, ['add', '-A'], { skipMutex: true });
    await runGit(worktreePath, ['commit', '-m', `chore(ai): apply assistant edits (${new Date().toISOString()})`], {
      skipMutex: true,
    });
    const head = (await runGit(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
    return { committed: true, head, changedRelativePaths: sortedStagedPaths };
  });
}

async function abortAndKillPiSession(webContentsId) {
  const s = piSessions.get(webContentsId);
  if (!s) {
    return;
  }
  try {
    await sendRpcCommand(s.child, { type: 'abort' });
  } catch {
    // ignore
  }
  killPiSession(webContentsId);
}

function settingsPath(app) {
  return path.join(app.getPath('userData'), 'pi-settings.json');
}

async function readSettings(app) {
  try {
    const raw = await fs.promises.readFile(settingsPath(app), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function sendTo(sender, channel, payload) {
  if (!sender.isDestroyed()) {
    sender.send(channel, payload);
  }
}

/**
 * This function returns concrete candidate roots for the pi-mono repository in
 * both development and packaged layouts. Development keeps pi-mono under
 * `submodules/pi-mono`, while packaged builds may copy it directly to
 * `Resources/pi-mono`, so both forms are included to keep runtime resolution
 * consistent across environments.
 * @param {import('electron').App} app
 * @returns {string[]}
 */
function resolvePiMonoRoots(app) {
  const roots = [];
  const envRoot = typeof process.env.GRUVBOX_PI_ROOT === 'string' ? process.env.GRUVBOX_PI_ROOT.trim() : '';
  if (envRoot) {
    roots.push(path.resolve(envRoot));
  }

  const appRoot = String(app.getAppPath() || '').trim();
  if (appRoot) {
    roots.push(path.join(appRoot, 'submodules', 'pi-mono'));
  }

  const cwdRoot = String(process.cwd() || '').trim();
  if (cwdRoot) {
    roots.push(path.join(cwdRoot, 'submodules', 'pi-mono'));
  }

  const resourcesRoot = String(process.resourcesPath || '').trim();
  if (resourcesRoot) {
    roots.push(path.join(resourcesRoot, 'submodules', 'pi-mono'));
    roots.push(path.join(resourcesRoot, 'pi-mono'));
  }

  return Array.from(new Set(roots.filter((value) => typeof value === 'string' && value.trim() !== '')));
}

function resolvePiSearchRoots(app) {
  const piMonoRoots = resolvePiMonoRoots(app);
  const roots = [];
  const envRoot = typeof process.env.GRUVBOX_PI_ROOT === 'string' ? process.env.GRUVBOX_PI_ROOT.trim() : '';
  if (envRoot) {
    roots.push(path.resolve(envRoot));
  }
  if (process.resourcesPath) {
    roots.push(process.resourcesPath);
  }
  roots.push(process.cwd());
  for (const piMonoRoot of piMonoRoots) {
    roots.push(path.dirname(path.dirname(piMonoRoot)));
  }
  return Array.from(new Set(roots.filter((value) => typeof value === 'string' && value.trim() !== '')));
}

function resolvePiCliPath(app) {
  const candidates = [];
  const fromEnv = typeof process.env.GRUVBOX_PI_CLI === 'string' ? process.env.GRUVBOX_PI_CLI.trim() : '';
  if (fromEnv) {
    candidates.push(path.resolve(fromEnv));
  }
  const piMonoRoots = resolvePiMonoRoots(app);
  for (const piMonoRoot of piMonoRoots) {
    candidates.push(path.join(piMonoRoot, 'packages', 'coding-agent', 'dist', 'cli.js'));
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveGruvboxEditorBridgeExtensionPath(app) {
  const piMonoRoots = resolvePiMonoRoots(app);
  const candidates = [];
  for (const piMonoRoot of piMonoRoots) {
    candidates.push(path.join(piMonoRoot, '.pi', 'extensions', 'gruvbox-editor-bridge.ts'));
    candidates.push(path.join(piMonoRoot, '.pi', 'extensions', 'gruvbox-editor-bridge.js'));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveToolReliabilityGuardExtensionPath(app) {
  const appRoot = app.getAppPath();
  const candidates = [
    path.join(appRoot, 'submodules', 'pi-mono', '.pi', 'extensions', 'tool-reliability-guard.ts'),
    path.join(appRoot, 'submodules', 'pi-mono', '.pi', 'extensions', 'tool-reliability-guard.js'),
    path.join(process.cwd(), 'submodules', 'pi-mono', '.pi', 'extensions', 'tool-reliability-guard.ts'),
    path.join(process.cwd(), 'submodules', 'pi-mono', '.pi', 'extensions', 'tool-reliability-guard.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveGruvboxMemoryToolExtensionPath(app) {
  const appRoot = app.getAppPath();
  const candidates = [
    path.join(appRoot, 'submodules', 'pi-mono', '.pi', 'extensions', 'gruvbox-memory-tool.ts'),
    path.join(appRoot, 'submodules', 'pi-mono', '.pi', 'extensions', 'gruvbox-memory-tool.js'),
    path.join(process.cwd(), 'submodules', 'pi-mono', '.pi', 'extensions', 'gruvbox-memory-tool.ts'),
    path.join(process.cwd(), 'submodules', 'pi-mono', '.pi', 'extensions', 'gruvbox-memory-tool.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveGruvboxDocToolsExtensionPath(app) {
  const appRoot = app.getAppPath();
  const candidates = [
    path.join(appRoot, 'submodules', 'pi-mono', '.pi', 'extensions', 'gruvbox-doc-tools.ts'),
    path.join(appRoot, 'submodules', 'pi-mono', '.pi', 'extensions', 'gruvbox-doc-tools.js'),
    path.join(process.cwd(), 'submodules', 'pi-mono', '.pi', 'extensions', 'gruvbox-doc-tools.ts'),
    path.join(process.cwd(), 'submodules', 'pi-mono', '.pi', 'extensions', 'gruvbox-doc-tools.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolves a project-local reliability extension by base filename.
 * The resolver checks app-relative and cwd-relative candidate paths so
 * development and packaged environments share the same startup behavior.
 * @param {import('electron').App} app
 * @param {string} baseName
 * @returns {string | null}
 */
function resolveReliabilityExtensionPath(app, baseName) {
  const piMonoRoots = resolvePiMonoRoots(app);
  const candidates = [];
  for (const piMonoRoot of piMonoRoots) {
    candidates.push(path.join(piMonoRoot, '.pi', 'extensions', `${baseName}.ts`));
    candidates.push(path.join(piMonoRoot, '.pi', 'extensions', `${baseName}.js`));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function stringifyResultContent(result) {
  if (!result || typeof result !== 'object') {
    return '';
  }
  const content = Array.isArray(result.content) ? result.content : [];
  const parts = [];
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

function attachJsonlReader(stream, onLine) {
  let buffer = '';
  const emitLine = (raw) => {
    let line = raw;
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }
    if (line.trim() !== '') {
      onLine(line);
    }
  };
  const onData = (chunk) => {
    buffer += typeof chunk === 'string' ? chunk : String(chunk);
    for (;;) {
      const idx = buffer.indexOf('\n');
      if (idx === -1) {
        break;
      }
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      emitLine(line);
    }
  };
  const onEnd = () => {
    if (buffer.trim() !== '') {
      emitLine(buffer);
      buffer = '';
    }
  };
  const onError = (err) => {
    piDebug('attachJsonlReader: stdout stream error', err instanceof Error ? err.message : String(err));
  };
  stream.on('data', onData);
  stream.on('end', onEnd);
  stream.on('error', onError);
  return () => {
    stream.off('data', onData);
    stream.off('end', onEnd);
    stream.off('error', onError);
  };
}

function sendRpcCommand(child, command) {
  return new Promise((resolve, reject) => {
    const id = `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = JSON.stringify({ ...command, id }) + '\n';
    child.stdin.write(payload, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(id);
      }
    });
  });
}

const TOOL_SCHEMA_STEER = buildToolSchemaSteer();

function buildTurnToolSteer(promptText) {
  const prompt = String(promptText ?? '').toLowerCase();
  const likelyRead = /\b(read|show|open|view|summarize|inspect)\b/.test(prompt);
  const likelyAppendEnd =
    /\b(append(\s+to)?|add\s+to\s+the\s+end|to\s+the\s+end\s+of|at\s+the\s+end(\s+of)?|bottom\s+of(\s+the)?(\s+(file|document))?)\b/.test(
      prompt,
    );
  const likelyPrepend =
    /\b(prepend|add\s+to\s+the\s+(beginning|start)|at\s+the\s+(start|beginning)|top\s+of(\s+the)?(\s+(file|document))?)\b/.test(
      prompt,
    );
  const likelyInsertMarker =
    /\b(insert\s+(after|before)|after\s+the\s+(passage|paragraph|line)|before\s+the\s+(passage|paragraph))\b/.test(
      prompt,
    );
  const likelyEdit =
    /\b(edit|modify|change|update|rewrite|patch|fix|refactor|replace|rename|remove)\b/.test(prompt) ||
    (/\badd\b/.test(prompt) &&
      !likelyAppendEnd &&
      !likelyPrepend &&
      !/\b(end|bottom|beginning|start|top)\b/.test(prompt));
  const likelyWrite = /\b(write|overwrite|replace entire|full file|save this)\b/.test(prompt);
  const likelyBash = /\b(bash|shell|terminal|command|run|git|npm|pnpm|yarn|ls|dir|cat|type)\b/.test(prompt);
  const targeted = [];
  if (likelyRead) targeted.push('read');
  if (likelyPrepend) targeted.push('prepend_to_file');
  else if (likelyAppendEnd) targeted.push('append_to_file');
  else if (likelyInsertMarker) targeted.push('insert_at');
  if (likelyEdit) targeted.push('edit');
  if (likelyWrite) targeted.push('write');
  if (likelyBash) targeted.push('bash');
  if (targeted.length === 0) {
    return '';
  }
  const lines = [
    'Turn-level first-attempt policy:',
    ...targeted.map((tool) => `- If using ${tool}, invoke the ${tool} tool now with valid arguments.`),
    'Never output raw JSON text in place of a tool call.',
  ];
  lines.push(`Use this as a shape reference only (do not paste as assistant text): ${exampleArgs(targeted[0])}`);
  const mutatesDoc = targeted.some((t) =>
    ['edit', 'write', 'append_to_file', 'prepend_to_file', 'insert_at'].includes(t),
  );
  if (mutatesDoc) {
    lines.push(
      'For additive changes at the end of an existing document, use append_to_file(path, content) — never pass only the new fragment as write.content.',
    );
    lines.push(
      'For inserts at a specific line or unique marker, use insert_at with anchor; use read(offset/limit) when you need surrounding context.',
    );
    lines.push('For full rewrites or brand-new files, use write with complete file content, or read then edit.');
    lines.push('Do not call write with path-only.');
  }
  return lines.join('\n');
}

function buildToolRepairMessage({ toolName, missing, normalizedArgs, fuzzyPath, fuzzyText }) {
  const required = requiredFields(toolName);
  const fields = Array.isArray(normalizedArgs) || !normalizedArgs ? [] : Object.keys(normalizedArgs);
  const lines = [
    `Tool call validation failed for "${toolName}".`,
    required.length > 0 ? `Required fields: ${required.join(', ')}` : 'No required field contract.',
    missing.length > 0 ? `Missing/invalid fields: ${missing.join(', ')}` : 'Missing/invalid fields: unknown',
    fields.length > 0 ? `Received fields: ${fields.join(', ')}` : 'Received fields: none',
    'Emit an actual tool call event next; do not print JSON in assistant text.',
  ];
  if (toolName === 'write') {
    lines.push('Reference shape: {"path":"src/file.ts","content":"<full file text>"}');
    lines.push('Next action: invoke write with BOTH path and full content, or call read first if content is unknown.');
  } else if (toolName === 'edit') {
    lines.push('Reference shape: {"path":"src/file.ts","edits":[{"oldText":"<exact text>","newText":"<replacement>"}]}');
    lines.push('Next action: invoke edit with one precise edit entry; avoid assistant-text explanations.');
  } else if (toolName === 'read') {
    lines.push('Reference shape: {"path":"src/file.ts"}');
    lines.push('Next action: invoke read with a single concrete path.');
  } else if (toolName === 'bash') {
    lines.push('Next action: invoke bash with one concrete command string.');
  } else if (toolName === 'append_to_file') {
    lines.push(
      'Reference shape: {"path":"notes/doc.md","content":"<fragment only>","ensure_trailing_newline":true}',
    );
    lines.push('Next action: invoke append_to_file when appending to an existing file without rewriting it.');
  } else if (toolName === 'prepend_to_file') {
    lines.push('Reference shape: {"path":"notes/doc.md","content":"<header block>"}');
    lines.push('Next action: invoke prepend_to_file to insert at the top without rewriting the whole file.');
  } else if (toolName === 'insert_at') {
    lines.push(
      'Reference shape: {"path":"notes/doc.md","content":"<inserted text>","anchor":{"line":12}} or anchor.afterText / anchor.beforeText (unique).',
    );
    lines.push('Next action: invoke insert_at with exactly one anchor field set.');
  }
  if (fuzzyPath?.resolved) {
    lines.push(`Suggested path (highest score ${fuzzyPath.confidence.toFixed(2)}): ${fuzzyPath.resolved}`);
  } else if (Array.isArray(fuzzyPath?.candidates) && fuzzyPath.candidates.length > 0) {
    const top = fuzzyPath.candidates
      .slice(0, 3)
      .map((c) => `${c.relPath} (${c.score.toFixed(2)})`)
      .join('; ');
    lines.push(`Path candidates: ${top}`);
  }
  if (fuzzyText?.ok && fuzzyText.bestSnippet) {
    lines.push(`Suggested oldText snippet (highest score ${fuzzyText.bestScore.toFixed(2)}): ${fuzzyText.bestSnippet}`);
  }
  return lines.join('\n');
}

function adaptArgsForRetry({ toolName, normalizedArgs, errorType, fuzzyPath, fuzzyText }) {
  const args = normalizedArgs && typeof normalizedArgs === 'object' && !Array.isArray(normalizedArgs)
    ? JSON.parse(JSON.stringify(normalizedArgs))
    : normalizedArgs;
  const none = {
    args,
    adaptationApplied: false,
    adaptationType: null,
    adaptationConfidence: null,
    adaptationBlockedReason: null,
  };
  if (!FEATURE_FLAGS.adaptiveTolerance || !args || typeof args !== 'object' || Array.isArray(args)) {
    return none;
  }

  if (
    (toolName === 'read' ||
      toolName === 'edit' ||
      toolName === 'write' ||
      toolName === 'append_to_file' ||
      toolName === 'prepend_to_file' ||
      toolName === 'insert_at') &&
    fuzzyPath?.resolved
  ) {
    const conf = Number(fuzzyPath.confidence ?? 0);
    const currentPath = typeof args.path === 'string' ? args.path : '';
    if (conf >= 0.92 && fuzzyPath.resolved !== currentPath) {
      args.path = fuzzyPath.resolved;
      return {
        args,
        adaptationApplied: true,
        adaptationType: 'path',
        adaptationConfidence: conf,
        adaptationBlockedReason: null,
      };
    }
    if (conf > 0 && conf < 0.92 && (errorType === 'not_found' || errorType === 'targeting_error')) {
      return { ...none, adaptationBlockedReason: 'low_confidence_path' };
    }
  }

  if (toolName === 'edit' && Array.isArray(args.edits) && args.edits.length > 0 && fuzzyText) {
    const first = args.edits[0];
    if (first && typeof first === 'object' && typeof first.oldText === 'string') {
      const conf = Number(fuzzyText.bestScore ?? 0);
      if (fuzzyText.ok && typeof fuzzyText.bestSnippet === 'string' && fuzzyText.bestSnippet !== first.oldText && conf >= 0.90) {
        first.oldText = fuzzyText.bestSnippet;
        return {
          args,
          adaptationApplied: true,
          adaptationType: 'text',
          adaptationConfidence: conf,
          adaptationBlockedReason: null,
        };
      }
      if (errorType === 'targeting_error') {
        return { ...none, adaptationBlockedReason: 'low_confidence_oldtext' };
      }
    }
  }

  return none;
}

function isWritePathOnlyValidationFailure(toolName, validation, normalizedArgs) {
  if (toolName !== 'write') return false;
  if (!validation || validation.ok !== false) return false;
  const missing = Array.isArray(validation.missing) ? validation.missing : [];
  const hasContentMissing = missing.includes('content');
  const hasPath = typeof normalizedArgs?.path === 'string' && normalizedArgs.path.trim() !== '';
  const hasContent = typeof normalizedArgs?.content === 'string' && normalizedArgs.content.trim() !== '';
  return hasContentMissing && hasPath && !hasContent;
}

function buildWritePathOnlyFallbackMessage(normalizedArgs, fuzzyPath) {
  const suggestedPath = fuzzyPath?.resolved ?? normalizedArgs?.path ?? '<file>';
  return [
    'Invalid write call: "write" requires BOTH path and full file content.',
    'Do not call write with only path.',
    `Next step now: call read({"path":"${suggestedPath}"})`,
    'Then call edit with exact oldText/newText or call write with full content.',
    'If you only meant to add text at the end of an existing file, use append_to_file({"path":"...","content":"..."}) instead of write.',
    'Emit the corrected call as a real tool invocation, not assistant text JSON.',
  ].join('\n');
}

function buildIdempotencyKey(requestId, messagesPayload) {
  const stableRequestId = String(requestId ?? '').trim();
  const payloadHash = createHash('sha256')
    .update(JSON.stringify({ messages: messagesPayload, requestId }))
    .digest('hex')
    .slice(0, 20);
  const base = stableRequestId !== '' ? stableRequestId : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const hash = createHash('sha256').update(`${base}:${requestId}:${payloadHash}`).digest('hex').slice(0, 32);
  return `gvx-${hash}`;
}

function stableArgsFingerprint(toolName, normalizedArgs, errorType) {
  let json = '';
  try {
    json = JSON.stringify(normalizedArgs ?? {});
  } catch {
    json = '';
  }
  const digest = createHash('sha256')
    .update(`${String(toolName ?? '')}:${String(errorType ?? '')}:${json}`)
    .digest('hex')
    .slice(0, 16);
  return `${String(toolName ?? 'unknown')}:${String(errorType ?? 'unknown')}:${digest}`;
}

/**
 * @param {unknown} msg
 * @returns {string} Non-empty if this assistant turn represents a failure the UI should show.
 */
function textFromFailedAssistantMessage(msg) {
  if (!msg || typeof msg !== 'object' || msg.role !== 'assistant') {
    return '';
  }
  const em = typeof msg.errorMessage === 'string' ? msg.errorMessage.trim() : '';
  const sr = msg.stopReason;
  if (em) {
    return em;
  }
  if (sr === 'error') {
    return 'Assistant run failed.';
  }
  return '';
}

/**
 * @param {unknown} messages
 * @returns {string}
 */
function extractLastAssistantErrorFromMessages(messages) {
  if (!Array.isArray(messages)) {
    return '';
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const t = textFromFailedAssistantMessage(messages[i]);
    if (t) {
      return t;
    }
  }
  return '';
}

async function getCredentialsContext(credentialsStore) {
  if (!credentialsStore || typeof credentialsStore.getStatus !== 'function') {
    return { openRouterConfigured: false, openAiConfigured: false, openRouterKey: null };
  }
  const [status, openRouterKey] = await Promise.all([
    credentialsStore.getStatus(),
    credentialsStore.getOpenRouterKey(),
  ]);
  return {
    openRouterConfigured: Boolean(status?.openRouter?.configured),
    openAiConfigured: Boolean(status?.openAi?.configured),
    openRouterKey: typeof openRouterKey === 'string' ? openRouterKey : null,
  };
}

function normalizeApiErrorMessage(raw) {
  return String(raw ?? '').trim();
}

/**
 * Diagnostics should not hard-stop Gruvie for expired or missing session tokens.
 * The assistant can still start, and the user can re-authenticate when they
 * actually need protected endpoints. This helper keeps those auth-token errors
 * as non-fatal diagnostics signals instead of setup blockers.
 *
 * @param {unknown} raw
 * @returns {boolean}
 */






async function startPiRpc(app, options, extraExtensionPaths = []) {
  const piCliPath = resolvePiCliPath(app);
  if (!piCliPath) {
    throw new Error(
      'Pi CLI not found. Build it from submodules/pi-mono (npm --prefix "submodules/pi-mono" install && npm --prefix "submodules/pi-mono" run build).',
    );
  }

  const openRouterApiKey =
    typeof options?.openRouterApiKey === 'string'
      ? options.openRouterApiKey
      : typeof options?.token === 'string'
        ? options.token
        : '';
  const model = typeof options?.model === 'string' ? options.model : '';
  const cwd = typeof options?.cwd === 'string' && options.cwd.trim() !== '' ? options.cwd : app.getPath('home');
  const memoryRoot =
    typeof options?.memoryRoot === 'string' && options.memoryRoot.trim() !== ''
      ? path.resolve(options.memoryRoot.trim())
      : '';
  const resolvedSpawnCwd = await assertValidCwd(cwd);
  const args = [piCliPath, '--mode', 'rpc', '--no-session', '--no-extensions'];
  for (const ext of extraExtensionPaths) {
    if (typeof ext === 'string' && ext.trim() !== '') {
      args.push('--extension', ext.trim());
    }
  }
  const modelId = String(model ?? '').trim();
  if (modelId) {
    args.push('--model', modelId.includes('/') ? modelId : `${PROVIDER_NAME}/${modelId}`);
  }
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    OPENROUTER_API_KEY: String(openRouterApiKey ?? '').trim(),
    // Pi defaults to 120s between SSE chunks; long chapter writes and reasoning exceed that.
    PI_OPENAI_STREAM_CHUNK_IDLE_MS: String(resolvePiChildStreamChunkIdleTimeoutMs()),
  };
  if (memoryRoot) {
    env.GRUVBOX_MEMORY_ROOT = memoryRoot;
  }
  piDebug('spawn Pi RPC', {
    piCliPath,
    cwd: resolvedSpawnCwd,
    model: modelId || '(none)',
    hasOpenRouterKey: Boolean(env.OPENROUTER_API_KEY),
    extraExtensionCount: Array.isArray(extraExtensionPaths) ? extraExtensionPaths.length : 0,
  });
  const child = spawn(process.execPath, args, {
    cwd: resolvedSpawnCwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderrPreview = '';
  const appendStderr = (chunk) => {
    stderrPreview += String(chunk);
    if (stderrPreview.length > 8000) {
      stderrPreview = stderrPreview.slice(-8000);
    }
  };
  child.stderr.on('data', appendStderr);
  child.on('exit', (code, signal) => {
    piDebug('Pi RPC exit', { code, signal, stderrTail: stderrPreview.slice(-1200) });
  });
  return child;
}


async function resolveValidOpenRouterModelForSend(credentialsStore, selectedModel) {
  const bareId = stripOpenRouterPrefix(selectedModel);
  if (!bareId || bareId === PROVIDER_DEGRADE_PLACEHOLDER_MODEL_ID) {
    return { ok: false, error: 'Select a model before sending messages.' };
  }
  const key = await credentialsStore.getOpenRouterKey();
  if (!key) {
    return { ok: false, error: 'OpenRouter API key is not configured. Add it in Gruvie settings.' };
  }
  try {
    const models = await fetchOpenRouterModels(key);
    const availableIds = new Set(
      models.map((entry) => stripOpenRouterPrefix(entry.id)).filter((id) => id.length > 0),
    );
    if (!availableIds.has(bareId)) {
      return {
        ok: false,
        error: `Model "${PROVIDER_NAME}/${bareId}" is unavailable. Refresh models and pick a listed model.`,
      };
    }
    return { ok: true, modelId: `${PROVIDER_NAME}/${bareId}` };
  } catch (error) {
    return {
      ok: false,
      error: normalizeApiErrorMessage(
        error instanceof Error ? error.message : 'Failed to validate selected model.',
      ),
    };
  }
}

async function listModelsFromOpenRouter(credentialsStore) {
  if (process.env.GRUVBOX_E2E === '1') {
    return {
      ok: true,
      models: [{ id: `${PROVIDER_NAME}/e2e-stub`, name: 'E2E stub model' }],
    };
  }
  const key = await credentialsStore.getOpenRouterKey();
  if (!key) {
    return {
      ok: false,
      error: 'OpenRouter API key is not configured. Add it in Gruvie settings.',
      models: [],
    };
  }
  try {
    const models = await fetchOpenRouterModels(key);
    if (models.length === 0) {
      return {
        ok: false,
        error: 'OpenRouter returned no models. Check your API key at https://openrouter.ai/keys',
        models: [],
      };
    }
    return { ok: true, models };
  } catch (err) {
    piDebug('list-models: OpenRouter fetch failed', err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: normalizeApiErrorMessage(err instanceof Error ? err.message : String(err)),
      models: [],
    };
  }
}

function registerPiGui(ipcMain, app, credentialsStore) {
  aiWorktreeSessionStoreApp = app;
  void loadPersistedAiChatHistorySessions();
  void loadPersistedAiWorktreeSessions().then(async () => {
    const seenRepoPaths = new Set(
      [...aiWorktreeSessions.values()]
        .map((session) => String(session?.repoPath ?? '').trim())
        .filter(Boolean),
    );
    for (const repoPath of seenRepoPaths) {
      try {
        const mergeHeadPath = (await runGit(repoPath, ['rev-parse', '--git-path', 'MERGE_HEAD'])).stdout.trim();
        if (!mergeHeadPath || !fs.existsSync(mergeHeadPath)) {
          continue;
        }
        const response = await dialog.showMessageBox(BrowserWindow.getAllWindows()[0] ?? null, {
          type: 'warning',
          buttons: ['Abort merge', 'Keep merge state'],
          defaultId: 0,
          cancelId: 1,
          title: 'Interrupted AI merge detected',
          message: `A previous AI merge in ${repoPath} appears to be interrupted.`,
          detail: 'Do you want to run "git merge --abort" now?',
        });
        if (response.response === 0) {
          await runGit(repoPath, ['merge', '--abort']);
        }
      } catch {
        // best effort startup recovery
      }
    }
  });

  ipcMain.handle('pi-settings', async (_event, request) => {
    const op = request && typeof request === 'object' && typeof request.op === 'string' ? request.op : 'get';
    if (op === 'get') {
      const settings = await readSettings(app);
      const autopilot = settings.autopilot === true;
      return {
        model: migrateLegacyModelId(typeof settings.model === 'string' ? settings.model : ''),
        requestId: settings.requestId === 'org' ? 'org' : 'user',
        autopilot,
      };
    }
    if (op === 'set') {
      const current = await readSettings(app);
      const next = {
        ...current,
        ...(typeof request.model === 'string' ? { model: migrateLegacyModelId(request.model) } : {}),
        ...(request.requestId === 'org' || request.requestId === 'user'
          ? { requestId: request.requestId }
          : {}),
        ...(typeof request.autopilot === 'boolean' ? { autopilot: request.autopilot } : {}),
      };
      await fs.promises.mkdir(path.dirname(settingsPath(app)), { recursive: true });
      await fs.promises.writeFile(settingsPath(app), JSON.stringify(next, null, 2), 'utf8');
      return { ok: true };
    }
    return { ok: false, error: 'Unknown pi-settings op' };
  });

  ipcMain.handle('pi-gui', async (event, payload) => {
    const command = payload && typeof payload === 'object' ? payload.command : '';
    const pl = payload && typeof payload === 'object' && payload.payload && typeof payload.payload === 'object'
      ? payload.payload
      : {};
    const sender = event.sender;
    const credContext = await getCredentialsContext(credentialsStore);

    if (command === 'diagnostics') {
      const cliPath = resolvePiCliPath(app);
      const errors = [];
      if (!cliPath) {
        errors.push(
          'Pi CLI not found. From Gruvbox Studio run: npm run build:pi (or npm --prefix submodules/pi-mono install && npm --prefix submodules/pi-mono run build).',
        );
      }
      return {
        ok: errors.length === 0,
        cliPath: cliPath ?? '',
        openRouterConfigured: credContext.openRouterConfigured,
        openAiConfigured: credContext.openAiConfigured,
        errors,
      };
    }

    if (command === 'abort' || command === 'abort-session') {
      const wcId = sender.id;
      const current = getStreamState(wcId);
      setStreamState(wcId, { ...current, status: 'aborting', aborting: true });

      // Politely ask Pi to abort the in-flight turn so any in-progress tool
      // call can settle before we tear the child process down. We then wait
      // a short grace window so partial text or a pending tool result can
      // flush onto stdout where the JSONL reader can record it.
      const session = piSessions.get(wcId);
      if (session?.child && isChildAlive(session.child)) {
        try {
          await sendRpcCommand(session.child, { type: 'abort' });
        } catch {
          // ignore — child may already be exiting
        }
      }
      await new Promise((resolve) => setTimeout(resolve, PI_ABORT_GRACE_MS));
      const sessionAfterGrace = piSessions.get(wcId);
      if (sessionAfterGrace?.child && isChildAlive(sessionAfterGrace.child)) {
        try {
          sessionAfterGrace.child.kill();
        } catch {
          // ignore
        }
      }

      // Drive the same finalize sequence we use on natural completion so a
      // user-initiated Stop still commits any partial worktree edits, emits
      // and emits pi-chat-done
      // (so the renderer clears its streaming state). QA is skipped on
      // abort because the model was interrupted mid-turn.
      const finalizer = getTurnFinalizer(wcId);
      if (finalizer) {
        try {
          await finalizer({ reason: 'aborted' });
        } catch {
          // finalizer is responsible for its own error reporting; never
          // throw out of the abort handler
        }
      } else {
        // No active turn was registered (e.g. user pressed Stop after the
        // turn already finished). Still emit a clean stream-end + done pair
        // so the renderer's streaming state is fully reset.
        sendTo(sender, CHANNEL_STREAM_END, { reason: 'aborted' });
        sendTo(sender, CHANNEL_DONE, {
          code: 0,
          failureBucket: 'aborted_by_user',
          aborted: true,
        });
      }

      killPiSession(wcId);
      clearStreamState(wcId);
      return { ok: true };
    }

    if (command === 'reset-pi-session') {
      const current = getStreamState(sender.id);
      setStreamState(sender.id, { ...current, status: 'aborting', aborting: true });
      await abortAndKillPiSession(sender.id);
      clearStreamState(sender.id);
      return { ok: true };
    }

    if (command === 'list-chat-sessions') {
      const sessions = [...aiChatHistorySessions.values()]
        .filter((entry) => Number(entry?.webContentsId) === Number(sender.id))
        .map((entry) => ({
          chatInstanceId: String(entry.chatInstanceId ?? ''),
          previewText: String(entry.previewText ?? ''),
          updatedAtMs: Number(entry.updatedAtMs ?? 0),
          createdAtMs: Number(entry.createdAtMs ?? 0),
        }))
        .filter((entry) => entry.chatInstanceId !== '')
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      return { ok: true, sessions };
    }

    if (command === 'get-chat-session') {
      const historyChatInstanceId = typeof pl.chatInstanceId === 'string' ? pl.chatInstanceId.trim() : '';
      if (historyChatInstanceId === '') {
        return { ok: false, error: 'chatInstanceId is required.' };
      }
      const key = aiWorktreeSessionKey(historyChatInstanceId, sender.id);
      const entry = aiChatHistorySessions.get(key);
      if (!entry) {
        return { ok: false, error: 'Session not found.' };
      }
      return {
        ok: true,
        session: {
          chatInstanceId: String(entry.chatInstanceId ?? ''),
          previewText: String(entry.previewText ?? ''),
          updatedAtMs: Number(entry.updatedAtMs ?? 0),
          createdAtMs: Number(entry.createdAtMs ?? 0),
          messages: normalizeHistoryTranscriptMessages(entry.messages),
        },
      };
    }

    /**
     * Persists the current transcript for this window under the given
     * chatInstanceId so "New conversation" can reset Pi state while History
     * still lists the closed session. Empty transcripts are a no-op.
     */
    if (command === 'save-chat-session') {
      const saveChatId = typeof pl.chatInstanceId === 'string' ? pl.chatInstanceId.trim() : '';
      const saveMessages = Array.isArray(pl.messages) ? pl.messages : [];
      if (saveChatId === '') {
        return { ok: false, error: 'chatInstanceId is required.' };
      }
      const normalized = normalizeHistoryTranscriptMessages(saveMessages);
      if (normalized.length === 0) {
        return { ok: true, saved: false };
      }
      await upsertAiChatHistorySession({
        chatInstanceId: saveChatId,
        webContentsId: sender.id,
        messages: normalized,
      });
      return { ok: true, saved: true };
    }

    if (command === 'ai-worktree-keep') {
      const sess = findAiWorktreeSessionByWebContentsId(sender.id)?.session;
      if (sess) {
        sess.mode = 'reuse';
        await setAiWorktreeSession(sess.chatInstanceId, sender.id, sess);
      }
      return { ok: true };
    }

    if (command === 'ai-worktree-abandon-next') {
      const sess = findAiWorktreeSessionByWebContentsId(sender.id)?.session;
      if (sess) {
        sess.mode = 'abandon-next';
        await setAiWorktreeSession(sess.chatInstanceId, sender.id, sess);
      }
      return { ok: true };
    }

    if (command === 'ai-worktree-status') {
      const statusChatInstanceId = typeof pl.chatInstanceId === 'string' ? pl.chatInstanceId.trim() : '';
      const byChatKey =
        statusChatInstanceId !== ''
          ? aiWorktreeSessions.get(aiWorktreeSessionKey(statusChatInstanceId, sender.id))
          : null;
      const sess = byChatKey ?? findAiWorktreeSessionByWebContentsId(sender.id)?.session;
      if (!sess) {
        return { ok: true, active: false };
      }
      let primaryRelativePath = typeof sess.mergePrimaryRelativePath === 'string' ? sess.mergePrimaryRelativePath : '';
      let changedRelativePaths = Array.isArray(sess.mergeChangedRelativePaths) ? sess.mergeChangedRelativePaths : [];
      const toolTouchedFiles = Array.isArray(sess.toolTouchedFiles) ? sess.toolTouchedFiles : [];
      const canHydrate =
        typeof sess.repoPath === 'string' &&
        sess.repoPath.trim() !== '' &&
        typeof sess.targetBranch === 'string' &&
        sess.targetBranch.trim() !== '' &&
        typeof sess.aiBranch === 'string' &&
        sess.aiBranch.trim() !== '' &&
        typeof sess.worktreePath === 'string' &&
        sess.worktreePath.trim() !== '';
      if ((primaryRelativePath.trim() === '' || changedRelativePaths.length === 0) && canHydrate) {
        try {
          const hydrated = await hydrateAiMergeOpenPaths(runGit, {
            gitDerivedTouchedFiles: changedRelativePaths,
            toolTouchedFiles,
            bridgedRelativePaths: sess.bridgedRelativePaths ?? [],
            repoPath: sess.repoPath,
            targetBranch: sess.targetBranch,
            aiBranch: sess.aiBranch,
            worktreePath: sess.worktreePath,
          });
          primaryRelativePath = String(hydrated.primaryRelativePath ?? '').trim();
          changedRelativePaths = Array.isArray(hydrated.changedRelativePaths) ? hydrated.changedRelativePaths : [];
          sess.mergePrimaryRelativePath = primaryRelativePath;
          sess.mergeChangedRelativePaths = changedRelativePaths;
          await setAiWorktreeSession(sess.chatInstanceId ?? '', sender.id, sess);
          const hydratedPrimarySource = toolTouchedFiles.includes(primaryRelativePath)
            ? 'tool'
            : (sess.bridgedRelativePaths ?? []).includes(primaryRelativePath)
              ? 'bridged'
              : primaryRelativePath !== ''
                ? 'heuristic'
                : 'none';
          piDebug('ai-worktree-status hydrate primary selection', {
            wcId: sender.id,
            primaryRelativePath,
            hydratedPrimarySource,
            toolTouchedLen: toolTouchedFiles.length,
            changedRelativeLen: changedRelativePaths.length,
          });
        } catch {
          // best-effort hydration only
        }
      }
      return {
        ok: true,
        active: true,
        mode: sess.mode,
        repoPath: sess.repoPath,
        sourceBranch: sess.aiBranch,
        targetBranch: sess.targetBranch,
        worktreePath: sess.worktreePath,
        primaryRelativePath,
        changedRelativePaths,
        mergeEventId: typeof sess.lastMergeReadyEventId === 'string' ? sess.lastMergeReadyEventId : '',
        mergeRequestId: typeof sess.lastMergeReadyRequestId === 'string' ? sess.lastMergeReadyRequestId : '',
        toolTouchedFiles,
        ...(sess.aiBranchB && sess.worktreePathB
          ? { sourceBranchB: sess.aiBranchB, worktreePathB: sess.worktreePathB }
          : {}),
      };
    }

    if (command === 'pi-discard-ai-worktree') {
      const chatInstanceId = typeof pl.chatInstanceId === 'string' ? pl.chatInstanceId.trim() : '';
      const discarded = await discardAiWorktreeSession(sender.id, chatInstanceId);
      return { ok: true, discarded };
    }

    if (command === 'reliability-kpis') {
      return { ok: true, ...withFirstAttemptRatesSnapshot(reliabilityKpis) };
    }

    if (command === 'extension-ui-response') {
      const body =
        pl && typeof pl === 'object' && pl.type === 'extension_ui_response'
          ? pl
          : pl?.response && typeof pl.response === 'object' && pl.response.type === 'extension_ui_response'
            ? pl.response
            : null;
      if (!body) {
        return { ok: false, error: 'Invalid extension_ui_response payload.' };
      }
      const sess = piSessions.get(sender.id);
      if (!sess || !isChildAlive(sess.child) || !sess.child.stdin?.writable) {
        return { ok: false, error: 'No active Pi session for this window.' };
      }
      try {
        const line = `${JSON.stringify(body)}\n`;
        await new Promise((resolve, reject) => {
          sess.child.stdin.write(line, (err) => {
            if (err) reject(err);
            else resolve(undefined);
          });
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    const e2ePiStubEnabled = process.env.GRUVBOX_E2E === '1' && process.env.E2E_PI_STUB === '1';
    if (e2ePiStubEnabled && (command === 'send-message' || command === 'send-messages')) {
      const wcId = sender.id;
      const messages = Array.isArray(pl.messages) ? pl.messages : [];
      const chatInstanceId = typeof pl.chatInstanceId === 'string' ? pl.chatInstanceId.trim() : '';
      const historyBaseMessages = normalizeHistoryTranscriptMessages(messages);
      const latestUser = [...messages].reverse().find((m) => m && m.role === 'user' && typeof m.content === 'string');
      const userText = String(latestUser?.content ?? '');
      const requestIdRaw = typeof pl.requestId === 'string' ? pl.requestId.trim() : '';
      const requestId = requestIdRaw || `rq-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const repoPath = typeof pl.cwd === 'string' && pl.cwd.trim() !== '' ? pl.cwd : app.getPath('home');
      const caseName = userText.includes('[E2E_CASE:GIT_FINALIZE_FAIL]')
        ? 'git_finalize_fail'
        : userText.includes('[E2E_CASE:VALIDATION_FAIL]')
          ? 'validation_fail'
          : userText.includes('[E2E_CASE:STREAM_ERROR]')
            ? 'stream_error'
            : userText.includes('[E2E_CASE:ABORT_AFTER_EDIT]')
              ? 'abort_after_edit'
              : 'success';

      const emitToolStart = (tool, inputPreview) => {
        sendTo(sender, CHANNEL_TOOL, { tool, inputPreview });
      };
      const emitToolEnd = (payload) => {
        sendTo(sender, CHANNEL_TOOL_END, payload);
      };
      const persistStubHistory = async (assistantText) => {
        if (chatInstanceId === '') {
          return;
        }
        const finalMessages = String(assistantText ?? '').trim() === ''
          ? [...historyBaseMessages]
          : [...historyBaseMessages, { role: 'assistant', content: String(assistantText) }];
        await upsertAiChatHistorySession({
          chatInstanceId,
          webContentsId: wcId,
          messages: finalMessages,
        });
      };

      if (caseName === 'validation_fail') {
        emitToolStart('write', JSON.stringify({ path: 'story.md' }));
        emitToolEnd({
          tool: 'write',
          result: 'Validation failed for tool "write": - content: must have required properties content',
          isError: true,
          reliabilityHint: 'Detected write(path-only); forcing read/edit recovery path for this turn.',
          toolEnvelope: {
            toolName: 'write',
            ok: false,
            errorType: 'validation_error',
            message: 'Validation failed for write',
            suggestedAction: 'stop_turn',
            missingFields: ['content'],
            exampleValidCall: ['path', 'content'],
            retriable: false,
          },
        });
        sendTo(sender, CHANNEL_ERROR, normalizeApiErrorMessage('Validation failed for tool "write": content is required'));
        sendTo(sender, CHANNEL_DONE, {
          code: -1,
          failureBucket: 'tool_event_then_validation_failure',
          toolStartCount: 1,
          toolValidationFailureCount: 1,
          toolRuntimeFailureCount: 0,
          worktreePrepareFailed: false,
          checkpointFailed: false,
          finalizeFailed: false,
        });
        await persistStubHistory('Validation failed while running write tool.');
        return { ok: true, sessionId: 'pi-e2e-stub', idempotencyKey: `e2e-${requestId}` };
      }

      if (caseName === 'stream_error') {
        emitToolStart('write', JSON.stringify({ path: 'story.md', content: '# E2E content\n' }));
        emitToolEnd({
          tool: 'write',
          result: 'Successfully wrote 24 bytes to story.md',
          isError: false,
        });
        sendTo(sender, CHANNEL_ERROR, normalizeApiErrorMessage('E2E simulated stream timeout'));
        sendTo(sender, CHANNEL_DONE, {
          code: -1,
          failureBucket: 'stream_error',
          toolStartCount: 1,
          toolValidationFailureCount: 0,
          toolRuntimeFailureCount: 0,
          worktreePrepareFailed: false,
          checkpointFailed: false,
          finalizeFailed: false,
        });
        await persistStubHistory('E2E simulated stream timeout.');
        return { ok: true, sessionId: 'pi-e2e-stub', idempotencyKey: `e2e-${requestId}` };
      }

      emitToolStart('write', JSON.stringify({ path: 'story.md', content: '# E2E content\n' }));
      emitToolEnd({
        tool: 'write',
        result: 'Successfully wrote 24 bytes to story.md',
        isError: false,
      });

      if (caseName === 'abort_after_edit') {
        // Simulate the production "Pi wrote a partial edit, then user pressed
        // Stop" flow. We register a finalizer keyed by webContents id, exactly
        // as the real send-message path does, then hold this IPC handler open
        // until the abort handler invokes the finalizer (or a safety timer
        // fires). The finalizer emits the same stream-end +
        // done sequence that the real `finalizeTurn({ reason: 'aborted' })`
        // emits, so the renderer's diff view opens for the partial edit.
        await new Promise((resolveTurn) => {
          let safety;
          const stubFinalizer = async ({ reason } = {}) => {
            try {
              sendTo(sender, CHANNEL_STREAM_END, { requestId, reason });
              sendTo(sender, CHANNEL_DONE, {
                code: 0,
                failureBucket: reason === 'aborted' ? 'aborted_by_user' : 'none',
                aborted: reason === 'aborted',
                toolStartCount: 1,
                toolValidationFailureCount: 0,
                toolRuntimeFailureCount: 0,
                worktreePrepareFailed: false,
                checkpointFailed: false,
                finalizeFailed: false,
              });
            } finally {
              if (safety) clearTimeout(safety);
              if (getTurnFinalizer(wcId) === stubFinalizer) {
                deleteTurnFinalizer(wcId);
              }
              resolveTurn();
            }
          };
          // Safety net: if no abort arrives within 30s, complete the turn
          // cleanly so a stuck test fails on a missing assertion rather than
          // hanging forever.
          safety = setTimeout(() => {
            void stubFinalizer({ reason: 'completed' });
          }, 30_000);
          setTurnFinalizer(wcId, stubFinalizer);
        });
        await persistStubHistory('Turn aborted after partial edit.');
        return { ok: true, sessionId: 'pi-e2e-stub', idempotencyKey: `e2e-${requestId}` };
      }

      if (caseName === 'git_finalize_fail') {
        sendTo(sender, CHANNEL_ERROR, normalizeApiErrorMessage('Failed to finalize AI worktree changes before merge diff: e2e forced'));
        sendTo(sender, CHANNEL_DONE, {
          code: 0,
          failureBucket: 'git_finalize_failure',
          toolStartCount: 1,
          toolValidationFailureCount: 0,
          toolRuntimeFailureCount: 0,
          worktreePrepareFailed: false,
          checkpointFailed: false,
          finalizeFailed: true,
        });
        await persistStubHistory('Failed to finalize AI worktree changes.');
        return { ok: true, sessionId: 'pi-e2e-stub', idempotencyKey: `e2e-${requestId}` };
      }

      sendTo(sender, CHANNEL_DONE, {
        code: 0,
        failureBucket: 'none',
        toolStartCount: 1,
        toolValidationFailureCount: 0,
        toolRuntimeFailureCount: 0,
        worktreePrepareFailed: false,
        checkpointFailed: false,
        finalizeFailed: false,
      });
      await persistStubHistory('E2E assistant response completed successfully.');
      return { ok: true, sessionId: 'pi-e2e-stub', idempotencyKey: `e2e-${requestId}` };
    }

    if (command === 'list-models') {
      return listModelsFromOpenRouter(credentialsStore);
    }

    if (command !== 'send-message' && command !== 'send-messages') {
      return { ok: false, error: `Unknown pi-gui command: ${command}` };
    }
    // Reject overlapping turns. A new user message must not start while the previous
    // turn is still streaming. Overlap would let two assistant turns race on the same
    // AI worktree, corrupt tool-attempt state, and produce interleaved output streams.
    {
      const wcIdEarly = sender.id;
      const startCheck = canStartPiTurn(wcIdEarly, {
        featureFlags: FEATURE_FLAGS,
        idleTimeoutMs: resolveModelStreamIdleTimeoutMs(),
        getPiSession: (id) => piSessions.get(id),
        isChildAlive,
      });
      if (!startCheck.ok) {
        return { ok: false, error: startCheck.reason };
      }
      if (startCheck.recoveredStale) {
        const sess = piSessions.get(wcIdEarly);
        if (sess) {
          killPiSession(wcIdEarly);
        }
        deleteTurnFinalizer(wcIdEarly);
        clearStreamState(wcIdEarly);
      }
    }

    const wcId = sender.id;
    getPiTurnLifecycle(wcId).resetForNewTurn();
        const messages = Array.isArray(pl.messages) ? pl.messages : [];
    const latestUser = [...messages].reverse().find((m) => m && m.role === 'user' && typeof m.content === 'string');
    const prompt = buildConversationPrompt(messages);
    const rootPathForMemory = typeof pl.cwd === 'string' && pl.cwd.trim() !== '' ? path.resolve(pl.cwd) : '';
    const globalMemory = await readGlobalMemory(app);
    const projectRetrieval = rootPathForMemory
      ? await retrieveProjectMemory(rootPathForMemory, latestUser?.content ?? '', { k: 8, maxTokens: 2200, minScore: 0.15 })
      : { hits: [], totalTokens: 0 };
    let projectMemoryEmpty = false;
    let orientationPending = false;
    if (rootPathForMemory) {
      try {
        const stats = await getProjectStats(rootPathForMemory);
        projectMemoryEmpty = stats.count === 0;
        orientationPending = await consumeOrientPending(rootPathForMemory);
      } catch {
        // best-effort; treat as no orientation requested
      }
    }
    const memoryPreamble = composeMemoryPreamble(globalMemory, projectRetrieval, {
      hasProjectScope: Boolean(rootPathForMemory),
      projectEmpty: projectMemoryEmpty,
      orientationMode: orientationPending ? 'rescan' : 'auto',
    });
    if (!prompt) {
      return { ok: false, error: 'Message prompt is empty.' };
    }

    const settings = await readSettings(app);
    const modelFromPayload = typeof pl.model === 'string' ? pl.model.trim() : '';
    const modelFromSettings = typeof settings.model === 'string' ? settings.model.trim() : '';
    const selectedModel = modelFromPayload || modelFromSettings;
    if (!selectedModel) {
      return { ok: false, error: 'Select a model before sending messages.' };
    }
    const modelValidation = await resolveValidOpenRouterModelForSend(credentialsStore, selectedModel);
    if (!modelValidation.ok) {
      return { ok: false, error: modelValidation.error };
    }
    const resolvedModel = modelValidation.modelId;

    const hasExplicitCwd = typeof pl.cwd === 'string' && pl.cwd.trim() !== '';
    const cwdRaw = hasExplicitCwd ? pl.cwd : app.getPath('home');
    const resolvedCwd = path.resolve(cwdRaw);
    const gitRepoPath = hasExplicitCwd ? await resolveGitTopLevel(resolvedCwd) : null;
    const useWorktree = pl.useWorktree === true || Boolean(gitRepoPath);
    const chatInstanceId = typeof pl.chatInstanceId === 'string' ? pl.chatInstanceId.trim() : '';
    const historyBaseMessages = normalizeHistoryTranscriptMessages(messages);
    let checkpointFailed = false;
    const checkpointInfo = { committed: false };
    let finalizeFailed = false;
    let worktreeSession = null;
    let worktreePrepareFailed = false;
    if (useWorktree) {
      if (!gitRepoPath) {
        piDebug('AI worktree required but cwd is not a git repository', {
          wcId,
          cwdRaw: resolvedCwd,
        });
        sendTo(
          sender,
          CHANNEL_ERROR,
          normalizeApiErrorMessage(
            'AI edits require a git repository workspace so changes can be routed through diff review.',
          ),
        );
        sendTo(sender, CHANNEL_DONE, {
          code: -1,
          failureBucket: 'worktree_prepare_failure',
          guardrailReason: 'worktree_requires_git_repository',
          jsonLikeTextDeltaCount: 0,
          toolStartCount: 0,
          toolValidationFailureCount: 0,
          toolRuntimeFailureCount: 0,
          worktreePrepareFailed: true,
          checkpointFailed: false,
          finalizeFailed: false,
        });
        return {
          ok: false,
          error:
            'AI edits require a git repository workspace so changes can be routed through diff review.',
        };
      }
      try {
        worktreeSession = await withTimeout(
          prepareAiWorktreeSession(app, wcId, gitRepoPath, chatInstanceId),
          20000,
          'prepare AI worktree session',
        );
        const checkpointHead = String(worktreeSession?.userCheckpointCommit ?? '').trim();
        if (checkpointHead !== '') {
          checkpointInfo.committed = true;
          checkpointInfo.head = checkpointHead;
          checkpointInfo.changedRelativePaths = Array.isArray(
            worktreeSession?.userCheckpointChangedRelativePaths,
          )
            ? [...worktreeSession.userCheckpointChangedRelativePaths]
            : [];
        }
      } catch (error) {
        worktreePrepareFailed = true;
        const msg = error instanceof Error ? error.message : String(error);
        piDebug('AI worktree preparation failed; aborting turn to prevent bypassing diff review', {
          wcId,
          cwdRaw,
          error: msg,
        });
        sendTo(
          sender,
          CHANNEL_ERROR,
          normalizeApiErrorMessage(
            `Failed to prepare AI worktree session; edits were blocked to enforce diff review: ${msg}`,
          ),
        );
        sendTo(sender, CHANNEL_DONE, {
          code: -1,
          failureBucket: 'worktree_prepare_failure',
          guardrailReason: 'worktree_prepare_failed',
          jsonLikeTextDeltaCount: 0,
          toolStartCount: 0,
          toolValidationFailureCount: 0,
          toolRuntimeFailureCount: 0,
          worktreePrepareFailed: true,
          checkpointFailed: false,
          finalizeFailed: false,
        });
        return {
          ok: false,
          error:
            'Failed to prepare AI worktree session; edits were blocked to enforce diff review.',
        };
      }
    }
    const effectiveCwd = worktreeSession?.worktreePath ?? cwdRaw;
    const requestIdRaw = typeof pl.requestId === 'string' ? pl.requestId.trim() : '';
    const requestId = requestIdRaw || `rq-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const idempotencyKey = buildIdempotencyKey(requestId, messages);
    piDebug('send-message: idempotency base key (Pi child env)', {
      wcId,
      requestId,
      keyPrefix: idempotencyKey.length > 20 ? `${idempotencyKey.slice(0, 20)}…` : idempotencyKey,
    });

    let session = piSessions.get(wcId);
    if (session?.detachStdout) {
      try {
        await sendRpcCommand(session.child, { type: 'abort' });
      } catch {
        // ignore
      }
      try {
        session.detachStdout();
      } catch {
        // ignore
      }
      killPiSession(wcId);
      session = undefined;
      clearStreamState(wcId);
    }

    const editorBridge = resolveGruvboxEditorBridgeExtensionPath(app);
    const reliabilityGuard = resolveToolReliabilityGuardExtensionPath(app);
    const providerReliabilityGuard = FEATURE_FLAGS.providerReliabilityGuard
      ? resolveReliabilityExtensionPath(app, 'provider-reliability-guard')
      : null;
    const toolCallSanitizer = FEATURE_FLAGS.toolCallSanitizer
      ? resolveReliabilityExtensionPath(app, 'tool-call-sanitizer')
      : null;
    const contextBudgetManager = FEATURE_FLAGS.contextBudgetManager
      ? resolveReliabilityExtensionPath(app, 'context-budget-manager')
      : null;
    const memoryTool = resolveGruvboxMemoryToolExtensionPath(app);
    const docTools = resolveGruvboxDocToolsExtensionPath(app);
    const extraExtensions = [
      editorBridge,
      reliabilityGuard,
      providerReliabilityGuard,
      toolCallSanitizer,
      contextBudgetManager,
      memoryTool,
      docTools,
    ].filter(Boolean);

    // Always rotate the Pi child per send-message: GRUVBOX_PI_IDEMPOTENCY_KEY is set in child env at spawn.
    // Reusing a session would pin a stale base key; combined with API in-flight idempotency this caused 503s.
    const reusedSession = false;
    if (session) {
      killPiSession(wcId);
      session = undefined;
    }
    piDebug('pi session: spawn new child (per-send rotation)', { wcId, cwd: cwdRaw, model: resolvedModel });
    let child = null;
    let finalEffectiveCwd = effectiveCwd;
    try {
      child = await startPiRpc(
        app,
        {
          openRouterApiKey: credContext.openRouterKey,
          model: resolvedModel,
          cwd: finalEffectiveCwd,
          memoryRoot: rootPathForMemory || undefined,
        },
        extraExtensions,
      );
    } catch (error) {
      if (error?.code === 'cwd_missing' && worktreeSession && finalEffectiveCwd !== cwdRaw) {
        await resetAiWorktreeSession(wcId);
        try {
          await runGit(worktreeSession.repoPath, ['worktree', 'prune']);
        } catch {
          // best effort prune
        }
        worktreeSession = await prepareAiWorktreeSession(app, wcId, cwdRaw, chatInstanceId);
        finalEffectiveCwd = worktreeSession?.worktreePath ?? cwdRaw;
        child = await startPiRpc(
          app,
          {
            openRouterApiKey: credContext.openRouterKey,
            model: resolvedModel,
            cwd: finalEffectiveCwd,
            memoryRoot: rootPathForMemory || undefined,
          },
          extraExtensions,
        );
      } else if (error?.code === 'cwd_missing') {
        sendTo(sender, CHANNEL_ERROR, 'workspace_missing: The selected workspace path does not exist.');
        sendTo(sender, CHANNEL_DONE, {
          code: -1,
          failureBucket: 'workspace_missing',
          guardrailReason: 'workspace_missing',
        });
        return { ok: false, error: 'Workspace path missing on disk.' };
      } else {
        throw error;
      }
    }
    session = {
      child,
      cwd: finalEffectiveCwd,
      model: resolvedModel,
      requestId,
      openRouterApiKey: credContext.openRouterKey ?? '',
      detachStdout: null,
      stderrBuf: '',
      stderrAttached: false,
      lifecycleAttached: false,
      lastTouchedAtMs: Date.now(),
      stderrLogCount: 0,
    };
    piSessions.set(wcId, session);
    if (!session.stderrAttached) {
      session.stderrAttached = true;
      child.stderr.on('data', (chunk) => {
        const text = String(chunk);
        session.stderrBuf += text;
        if (session.stderrBuf.length > 8000) {
          session.stderrBuf = session.stderrBuf.slice(-8000);
        }
        if ((session.stderrLogCount ?? 0) < 3) {
          session.stderrLogCount = (session.stderrLogCount ?? 0) + 1;
        }
      });
    }

    if (!session.lifecycleAttached) {
      session.lifecycleAttached = true;
      child.on('error', (error) => {
        const s = piSessions.get(wcId);
        if (!s || s.child !== child) {
          return;
        }
        sendTo(sender, CHANNEL_ERROR, normalizeApiErrorMessage(error.message));
        sendTo(sender, CHANNEL_DONE, { code: -1 });
        setStreamState(wcId, { status: 'failed', activeRequestId: requestId, aborting: false });
        killPiSession(wcId);
        clearStreamState(wcId);
      });
      child.on('close', (code) => {
        const s = piSessions.get(wcId);
        if (!s || s.child !== child) {
          return;
        }
        const stillStreaming = Boolean(s.detachStdout);
        const state = getStreamState(wcId);
        const abortedThis = state.aborting === true || state.status === 'aborting';
        if (stillStreaming && !abortedThis) {
          piDebug('send-message: Pi closed before stream end', {
            code,
            stderrTail: s.stderrBuf.trim().slice(-800),
          });
          sendTo(
            sender,
            CHANNEL_ERROR,
            normalizeApiErrorMessage(s.stderrBuf.trim() || `Pi process exited with code ${code}`),
          );
          const closeFin = getTurnFinalizer(wcId);
          if (closeFin) {
            void closeFin({ reason: 'failed' }).catch(() => {});
          } else {
            sendTo(sender, CHANNEL_DONE, { code: typeof code === 'number' ? code : -1 });
          }
        }
        clearStreamState(wcId);
        try {
          s.detachStdout?.();
        } catch {
          // ignore
        }
        s.detachStdout = null;
        piSessions.delete(wcId);
      });
    }

    setStreamState(wcId, { status: 'streaming', activeRequestId: requestId, aborting: false });

    let streamEnded = false;
    let assistantDisplayText = '';
    let streamNonJsonLines = 0;
    let sentPiChatError = false;
    let stoppedByReliabilityGuard = false;
    let toolcallDeltaSeenCount = 0;
    let toolcallDeltaForwardedCount = 0;
    let textDeltaForwardedCount = 0;
    let thinkingDeltaForwardedCount = 0;
    let jsonLikeTextDeltaCount = 0;
    let toolStartCount = 0;
    let toolEndCount = 0;
    let toolValidationFailureCount = 0;
    let toolRuntimeFailureCount = 0;
    let consecutiveFailedToolName = '';
    let consecutiveFailedToolCount = 0;
    let repairSteerCount = 0;
    let jsonNoToolCorrectiveSteerSent = false;
    let jsonNoToolGuardrailTriggered = false;
    let guardrailReason = '';
    /** @type {{ ran: boolean, passed: boolean, tier: 'fast'|'smoke'|'full', failureType: string, stopReason: string, reportPath: string, steps: Array<{name:string,status:string,exitCode:number,durationMs:number,failureType:string}> } | null} */
    let qaSummary = null;
    let streamWatchdog = null;
    /** @type {null | 'model' | 'tool' | 'waiting' | 'compaction' | 'finalize'} */
    let watchdogPhase = null;
    let activeToolName = '';
    let lastStdoutEventType = '';
    let lastStdoutEventAtMs = 0;
    const seenUnhandledPiEventTypes = new Set();
    const noteStdoutEvent = (eventType) => {
      if (typeof eventType === 'string' && eventType.trim() !== '') {
        lastStdoutEventType = eventType.trim();
        lastStdoutEventAtMs = Date.now();
      }
    };
    const buildStreamIdleDiagnostics = () => ({
      lastEventType: lastStdoutEventType,
      lastEventAgeSec:
        lastStdoutEventAtMs > 0 ? Math.round((Date.now() - lastStdoutEventAtMs) / 1000) : null,
      piChildAlive: isChildAlive(child),
      stderrTail: String(session.stderrBuf ?? '').trim().slice(-400),
    });
    const clearStreamWatchdog = () => {
      if (streamWatchdog) {
        clearTimeout(streamWatchdog);
        streamWatchdog = null;
      }
    };
    /**
     * Arm or refresh the Pi stdout idle watchdog for the current phase.
     * No timer runs until {@link setWatchdogPhase} sets a non-null phase (after prompt).
     *
     * @param {null | 'model' | 'tool' | 'waiting' | 'compaction' | 'finalize'} [phaseOverride]
     */
    const bumpStreamWatchdog = (phaseOverride) => {
      const phase = phaseOverride ?? watchdogPhase;
      if (!phase) {
        return;
      }
      const timeoutMs = resolveWatchdogTimeoutMsForPhase(phase);
      clearStreamWatchdog();
      streamWatchdog = setTimeout(() => {
        if (streamEnded) {
          return;
        }
        const idleDiagnostics = buildStreamIdleDiagnostics();
        piDebug('send-message: stream idle watchdog fired', {
          wcId,
          phase,
          timeoutMs,
          ...idleDiagnostics,
        });
        sendTo(
          sender,
          CHANNEL_ERROR,
          normalizeApiErrorMessage(
            formatStreamIdleTimeoutMessage(phase, activeToolName, timeoutMs, idleDiagnostics),
          ),
        );
        const timeoutFin = getTurnFinalizer(wcId);
        if (timeoutFin) {
          void timeoutFin({ reason: 'failed' }).catch(() => {});
        } else {
          sendTo(sender, CHANNEL_DONE, { code: -1 });
          setStreamState(wcId, { status: 'failed', activeRequestId: requestId, aborting: false });
          tearDownSession();
        }
      }, timeoutMs);
    };
    /**
     * Transition the idle watchdog phase and restart the timer when armed.
     *
     * @param {null | 'model' | 'tool' | 'waiting' | 'compaction' | 'finalize'} phase
     * @param {string} [toolName]
     */
    const setWatchdogPhase = (phase, toolName = '') => {
      const prevPhase = watchdogPhase;
      watchdogPhase = phase;
      if (phase === 'tool') {
        activeToolName = typeof toolName === 'string' ? toolName : '';
      } else {
        activeToolName = '';
      }
      if (prevPhase !== phase) {
        piDebug('send-message: stream idle watchdog phase', {
          wcId,
          phase,
          activeToolName: phase === 'tool' ? activeToolName : undefined,
          timeoutMs: phase ? resolveWatchdogTimeoutMsForPhase(phase) : undefined,
        });
      }
      if (phase) {
        bumpStreamWatchdog(phase);
      } else {
        clearStreamWatchdog();
      }
    };
    /** @type {string[]} */
    const touchedRelativeFiles = [];
    /** @type {Map<string, {schemaFailures: number, repairedOnce: boolean, lastArgs: Record<string, unknown> | null, lastFailureFingerprint?: string, lastAdaptation?: { adaptationApplied: boolean, adaptationType?: string | null, adaptationConfidence?: number | null, adaptationBlockedReason?: string | null } }>} */
    const toolAttemptState = new Map();

    const endStreamKeepChild = (status = 'completed') => {
      clearStreamWatchdog();
      try {
        if (session.detachStdout) {
          session.detachStdout();
        }
      } catch {
        // ignore
      }
      session.detachStdout = null;
      setStreamState(wcId, { status, activeRequestId: requestId, aborting: false });
    };

    const tearDownSession = () => {
      endStreamKeepChild();
      killPiSession(wcId);
      clearStreamState(wcId);
    };

    /**
     * Run the post-turn finalize sequence for the in-flight chat turn.
     *
     * This is the single place where we (a) emit `pi-chat-stream-end` so the
     * renderer can clear its streaming spinner the moment the model has
     * stopped producing tokens, (b) commit any pending AI worktree edits and
     * continue to the diff workflow, (c) optionally run the
     * agent QA tier, and (d) emit the terminal `pi-chat-done` event. It is
     * called from two places: the `agent_end` event handler (natural
     * completion) and the `command === 'abort'` handler (user pressed Stop).
     * For aborted turns we skip QA but still commit + diff + done so partial
     * edits surface in the merge view rather than disappearing silently.
     *
     * The closure is idempotent — repeated invocations after the first do
     * nothing — and during its asynchronous body it bumps the stream idle
     * watchdog periodically so long-running QA/Git work never trips the
     * "AI request timed out" guard.
     *
     * @param {{ reason: 'completed' | 'aborted' }} args
     */
    let finalizeRan = false;
    const finalizeTurn = async ({ reason }) => {
      if (finalizeRan) {
        return;
      }
      finalizeRan = true;
      streamEnded = true;

      sendTo(sender, CHANNEL_STREAM_END, { requestId, reason });

      setWatchdogPhase('finalize');
      const finalizeWatchdogTicker = setInterval(() => {
        bumpStreamWatchdog('finalize');
      }, 30_000);
      if (typeof finalizeWatchdogTicker.unref === 'function') {
        finalizeWatchdogTicker.unref();
      }
      bumpStreamWatchdog();

      let piChatDoneEmitted = false;
      const emitPiChatDone = (payload) => {
        if (piChatDoneEmitted) {
          return;
        }
        piChatDoneEmitted = true;
        sendTo(sender, CHANNEL_DONE, payload);
      };

      try {
        /** @type {string[]} */
        let gitDerivedTouchedFiles = [];
        /** @type {string} */
        let postCommitWorktreeHead = '';
        /** True only when the AI worktree advanced to a new HEAD this turn — used so the renderer does not pop the merge editor after pure chat/thinking turns while a session stays open. */
        let mergeAutoOpenThisTurn = false;
        if (worktreeSession) {
          let primaryCommitOutcome = { committed: false };
          try {
            primaryCommitOutcome = await commitWorktreeChangesIfAny(
              worktreeSession.worktreePath,
              worktreeSession.repoPath,
              worktreeSession.bridgedRelativePaths ?? [],
            );
          } catch (err) {
            finalizeFailed = true;
            sendTo(
              sender,
              CHANNEL_ERROR,
              normalizeApiErrorMessage(
                `Failed to finalize AI worktree changes before merge diff: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              ),
            );
          }
          /** @type {string[]} */
          let secondaryCommitPaths = [];
          if (worktreeSession.worktreePathB) {
            try {
              const secondaryOutcome = await commitWorktreeChangesIfAny(worktreeSession.worktreePathB);
              if (secondaryOutcome.committed && Array.isArray(secondaryOutcome.changedRelativePaths)) {
                secondaryCommitPaths = [...secondaryOutcome.changedRelativePaths];
              }
            } catch {
              // non-fatal; secondary may have no local edits
            }
          }
          /** @type {string[]} */
          let branchTripleDotPaths = [];
          try {
            branchTripleDotPaths = await listChangedRelativeFilesForBranches(
              runGit,
              worktreeSession.repoPath,
              worktreeSession.targetBranch,
              worktreeSession.aiBranch,
            );
          } catch {
            branchTripleDotPaths = [];
          }
          /** @type {string[]} */
          let headCommitPaths = [];
          try {
            headCommitPaths = await listPathsChangedInWorktreeHeadCommit(runGit, worktreeSession.worktreePath);
          } catch {
            headCommitPaths = [];
          }
          /** @type {string[]} */
          let porcelainPaths = [];
          try {
            porcelainPaths = await listWorktreePorcelainRelativePathsMinusBridged(
              runGit,
              worktreeSession.worktreePath,
              worktreeSession.bridgedRelativePaths ?? [],
            );
          } catch {
            porcelainPaths = [];
          }
          /** @type {string[]} */
          let baseToTipPaths = [];
          try {
            baseToTipPaths = await listChangedRelativeFilesBetweenRefs(
              runGit,
              worktreeSession.repoPath,
              worktreeSession.baseCommit ?? '',
              worktreeSession.aiBranch,
            );
          } catch {
            baseToTipPaths = [];
          }
          const commitStagingPaths =
            primaryCommitOutcome.committed && Array.isArray(primaryCommitOutcome.changedRelativePaths)
              ? primaryCommitOutcome.changedRelativePaths
              : [];
          const normalizedToolTouchedFiles = (touchedRelativeFiles || [])
            .map((entry) => normalizeRelativeCandidatePath(String(entry ?? '')))
            .filter(Boolean);
          const turnLocalPreferredPaths = [...new Set([
            ...normalizedToolTouchedFiles,
            ...commitStagingPaths.map((entry) => normalizeRelativeCandidatePath(String(entry ?? ''))).filter(Boolean),
            ...headCommitPaths.map((entry) => normalizeRelativeCandidatePath(String(entry ?? ''))).filter(Boolean),
            ...secondaryCommitPaths.map((entry) => normalizeRelativeCandidatePath(String(entry ?? ''))).filter(Boolean),
          ])];
          const unionSet = new Set([
            ...(touchedRelativeFiles || []).map(String).map((x) => x.trim()).filter(Boolean),
            ...branchTripleDotPaths,
            ...headCommitPaths,
            ...porcelainPaths,
            ...baseToTipPaths,
            ...commitStagingPaths,
            ...secondaryCommitPaths.map((x) => String(x || '').trim()).filter(Boolean),
          ]);
          gitDerivedTouchedFiles = [...unionSet].sort((a, b) => a.localeCompare(b));
          const mergeOpenPaths = await hydrateAiMergeOpenPaths(runGit, {
            gitDerivedTouchedFiles,
            toolTouchedFiles: turnLocalPreferredPaths,
            bridgedRelativePaths: worktreeSession.bridgedRelativePaths ?? [],
            repoPath: worktreeSession.repoPath,
            targetBranch: worktreeSession.targetBranch,
            aiBranch: worktreeSession.aiBranch,
            worktreePath: worktreeSession.worktreePath,
          });
          const mergePrimaryRelativePath = String(mergeOpenPaths.primaryRelativePath ?? '').trim();
          const mergeChangedRelativePaths = Array.isArray(mergeOpenPaths.changedRelativePaths)
            ? mergeOpenPaths.changedRelativePaths
            : [];
          const uniqueToolTouchedFiles = turnLocalPreferredPaths;
          if (mergePrimaryRelativePath !== '') {
            gitDerivedTouchedFiles = [...new Set([...gitDerivedTouchedFiles, mergePrimaryRelativePath])].sort((a, b) =>
              a.localeCompare(b),
            );
          }
          worktreeSession.mergePrimaryRelativePath = mergePrimaryRelativePath;
          worktreeSession.mergeChangedRelativePaths = mergeChangedRelativePaths;
          worktreeSession.toolTouchedFiles = uniqueToolTouchedFiles;
          const primarySource = uniqueToolTouchedFiles.includes(mergePrimaryRelativePath)
            ? 'tool'
            : (worktreeSession.bridgedRelativePaths ?? []).includes(mergePrimaryRelativePath)
              ? 'bridged'
              : mergePrimaryRelativePath !== ''
                ? 'heuristic'
                : 'none';
          piDebug('finalizeTurn merge primary selection', {
            wcId,
            requestId,
            primaryRelativePath: mergePrimaryRelativePath,
            primarySource,
            toolTouchedLen: uniqueToolTouchedFiles.length,
            turnLocalPreferredLen: turnLocalPreferredPaths.length,
            gitDerivedLen: gitDerivedTouchedFiles.length,
            changedRelativeLen: mergeChangedRelativePaths.length,
          });
          try {
            postCommitWorktreeHead = (await runGit(worktreeSession.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
          } catch {
            postCommitWorktreeHead = '';
          }
          const prevTipForMergeAutoOpen = String(
            worktreeSession.lastAgentEndWorktreeHead ?? worktreeSession.baseCommit ?? '',
          ).trim();
          mergeAutoOpenThisTurn =
            postCommitWorktreeHead !== '' &&
            prevTipForMergeAutoOpen !== '' &&
            postCommitWorktreeHead !== prevTipForMergeAutoOpen &&
            reason !== 'failed';
          worktreeSession.lastMergeReadyEventId = `${requestId}:${postCommitWorktreeHead || 'nohead'}`;
          worktreeSession.lastMergeReadyRequestId = requestId;
          const hasDetectedChanges = gitDerivedTouchedFiles.length > 0;
          const emitMergeDespiteNoPaths =
            !hasDetectedChanges && reason !== 'failed' && getPiTurnLifecycle(wcId).anyMutatingToolStarted;

          piDebug('finalizeTurn merge gate', {
            wcId,
            requestId,
            reason,
            hasDetectedChanges,
            emitMergeDespiteNoPaths,
            toolTouchedLen: touchedRelativeFiles.length,
            branchTripleDotLen: branchTripleDotPaths.length,
            headCommitLen: headCommitPaths.length,
            porcelainLen: porcelainPaths.length,
            baseToTipLen: baseToTipPaths.length,
            commitStagingLen: commitStagingPaths.length,
            secondaryCommitLen: secondaryCommitPaths.length,
            unionLen: gitDerivedTouchedFiles.length,
          });

          if (!hasDetectedChanges && !emitMergeDespiteNoPaths) {
            await discardAiWorktreeSession(wcId, worktreeSession.chatInstanceId ?? chatInstanceId);
            // The user-workspace checkpoint commit (if any) is intentionally
            // preserved here. It represents a real saved version of the
            // user's work captured before AI editing began, so we never
            // soft-reset it even when the AI turn produced no merge changes.
          }
        }
        const prevWorktreeSnapshot = worktreeSession
          ? String(worktreeSession.lastAgentEndWorktreeHead ?? worktreeSession.baseCommit ?? '').trim()
          : '';
        const headChangedThisTurn =
          Boolean(worktreeSession) &&
          postCommitWorktreeHead !== '' &&
          prevWorktreeSnapshot !== '' &&
          postCommitWorktreeHead !== prevWorktreeSnapshot;
        const qaTouchedFiles = gitDerivedTouchedFiles.length > 0 ? gitDerivedTouchedFiles : touchedRelativeFiles;
        const qaPolicy = resolveTurnQaPolicy({
          touchedRelativeFiles,
          gitDerivedTouchedFiles,
          toolStartCount,
          useWorktreeHeadGate: Boolean(worktreeSession),
          headChangedThisTurn,
        });
        const qaRepoPath = worktreeSession?.repoPath ?? path.resolve(cwdRaw);
        const qaDisabledByEnv =
          process.env.PI_DISABLE_AGENT_QA === '1' || process.env.PI_DISABLE_AGENT_QA === 'true';
        const qaRunnerPresent = repoHasAgentQaRunner(qaRepoPath);
        if (reason === 'aborted' || reason === 'failed') {
          // User-initiated aborts and hard turn failures skip QA: interrupted / errored
          // turns are not meaningfully verified by the repo QA tier, but we still
          // commit above when applicable.
          qaSummary = {
            ran: false,
            passed: true,
            tier: 'fast',
            failureType: 'none',
            stopReason: reason === 'aborted' ? 'qa_skipped_aborted_by_user' : 'qa_skipped_turn_failed',
            reportPath: '',
            steps: [],
          };
        } else if (qaPolicy.runQa && qaDisabledByEnv) {
          qaSummary = {
            ran: false,
            passed: true,
            tier: 'fast',
            failureType: 'none',
            stopReason: 'qa_skipped_env_pi_disable_agent_qa',
            reportPath: '',
            steps: [],
          };
        } else if (qaPolicy.runQa && !qaRunnerPresent) {
          qaSummary = {
            ran: false,
            passed: true,
            tier: 'fast',
            failureType: 'none',
            stopReason: 'qa_skipped_no_repo_runner',
            reportPath: '',
            steps: [],
          };
        } else if (qaPolicy.runQa) {
          const qaTier = selectQaTierForTouchedFiles(qaTouchedFiles);
          const qaResult = await runAgentQaTier(qaRepoPath, qaTier, requestId);
          qaSummary = {
            ran: true,
            ...qaResult,
          };
        } else {
          qaSummary = {
            ran: false,
            passed: true,
            tier: 'fast',
            failureType: 'none',
            stopReason: qaPolicy.skipReason,
            reportPath: '',
            steps: [],
          };
        }
        if (worktreeSession && postCommitWorktreeHead) {
          worktreeSession.lastAgentEndWorktreeHead = postCommitWorktreeHead;
          await setAiWorktreeSession(worktreeSession.chatInstanceId, wcId, worktreeSession);
        }
        const failureBucket =
          reason === 'aborted'
            ? 'aborted_by_user'
            : reason === 'failed'
            ? 'stream_error'
            : computeTurnFailureBucket({
                jsonNoToolGuardrailTriggered,
                jsonLikeTextDeltaCount,
                toolStartCount,
                sentPiChatError,
                toolValidationFailureCount,
                toolRuntimeFailureCount,
                worktreePrepareFailed,
                checkpointFailed,
                finalizeFailed,
                qaFailed: qaSummary.ran && !qaSummary.passed,
                qaFailureType: qaSummary.failureType,
              });
        if (qaSummary.ran && !qaSummary.passed && !sentPiChatError) {
          sentPiChatError = true;
          sendTo(
            sender,
            CHANNEL_ERROR,
            normalizeApiErrorMessage(
              `QA verification failed (${qaSummary.tier}/${qaSummary.failureType}). See ${qaSummary.reportPath}`,
            ),
          );
        }
        const historyMessages = assistantDisplayText.trim() === ''
          ? [...historyBaseMessages]
          : [...historyBaseMessages, { role: 'assistant', content: assistantDisplayText }];
        if (chatInstanceId !== '' && historyMessages.length > 0) {
          try {
            await upsertAiChatHistorySession({
              chatInstanceId,
              webContentsId: wcId,
              messages: historyMessages,
            });
          } catch {
            // best effort history persistence
          }
        }
        const doneCode =
          reason === 'aborted'
            ? 0
            : reason === 'failed'
            ? -1
            : qaSummary.ran && !qaSummary.passed
            ? -1
            : 0;
        emitPiChatDone({
          code: doneCode,
          requestId,
          mergeAutoOpen: mergeAutoOpenThisTurn,
          ...(worktreeSession?.lastMergeReadyEventId
            ? { mergeEventId: worktreeSession.lastMergeReadyEventId }
            : {}),
          failureBucket,
          ...(reason === 'aborted' ? { aborted: true } : {}),
          ...(guardrailReason || (qaSummary.ran && !qaSummary.passed)
            ? { guardrailReason: guardrailReason || qaSummary.stopReason || 'qa_required_check_failed' }
            : {}),
          jsonLikeTextDeltaCount,
          toolStartCount,
          toolValidationFailureCount,
          toolRuntimeFailureCount,
          worktreePrepareFailed,
          checkpointFailed,
          finalizeFailed,
          qaSummary,
        });
        const streamStatus =
          reason === 'aborted' ? 'aborted' : doneCode === 0 ? 'completed' : 'failed';
        setStreamState(wcId, { status: streamStatus, activeRequestId: requestId, aborting: false });
        endStreamKeepChild(streamStatus);
      } catch (finalizeBodyErr) {
        finalizeFailed = true;
        sendTo(
          sender,
          CHANNEL_ERROR,
          normalizeApiErrorMessage(
            finalizeBodyErr instanceof Error ? finalizeBodyErr.message : String(finalizeBodyErr),
          ),
        );
        emitPiChatDone({
          code: -1,
          failureBucket: 'finalize_exception',
          jsonLikeTextDeltaCount,
          toolStartCount,
          toolValidationFailureCount,
          toolRuntimeFailureCount,
          worktreePrepareFailed,
          checkpointFailed,
          finalizeFailed: true,
        });
        setStreamState(wcId, { status: 'failed', activeRequestId: requestId, aborting: false });
        endStreamKeepChild('failed');
      } finally {
        if (!piChatDoneEmitted) {
          finalizeFailed = true;
          emitPiChatDone({
            code: -1,
            failureBucket: 'finalize_incomplete',
            jsonLikeTextDeltaCount,
            toolStartCount,
            toolValidationFailureCount,
            toolRuntimeFailureCount,
            worktreePrepareFailed,
            checkpointFailed,
            finalizeFailed: true,
          });
          setStreamState(wcId, { status: 'failed', activeRequestId: requestId, aborting: false });
          endStreamKeepChild('failed');
        }
        clearInterval(finalizeWatchdogTicker);
        // Remove ourselves so a follow-up `abort` after natural completion (or
        // a duplicate agent_end) does not re-enter the finalize sequence.
        if (getTurnFinalizer(wcId) === finalizeTurn) {
          deleteTurnFinalizer(wcId);
        }
      }
    };
    setTurnFinalizer(wcId, finalizeTurn);

    const detachStdout = attachJsonlReader(child.stdout, async (line) => {
      session.lastTouchedAtMs = Date.now();
      if (watchdogPhase) {
        bumpStreamWatchdog();
      }
      const streamState = getStreamState(wcId);
      if (streamState.activeRequestId && streamState.activeRequestId !== requestId) {
        return;
      }
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        if (streamNonJsonLines < 3 && line.trim() !== '') {
          streamNonJsonLines += 1;
          piDebug('send-message: non-json stdout line', line.slice(0, 240));
        }
        return;
      }
      const evType = typeof ev?.type === 'string' ? ev.type : '';
      noteStdoutEvent(evType);
      if (ev?.type === 'message_update') {
        const delta = ev?.assistantMessageEvent;
        // Keep `waiting` (long timeout) during toolcall_delta-only assembly — large write/edit
        // payloads can go minutes without text/thinking deltas and must not use the model limit.
        if (delta?.type === 'text_delta' || delta?.type === 'thinking_delta') {
          setWatchdogPhase('model');
        }
        if (delta?.type === 'toolcall_delta') {
          toolcallDeltaSeenCount += 1;
          if (typeof delta.delta === 'string' && delta.delta !== '') {
            toolcallDeltaForwardedCount += 1;
            sendTo(sender, CHANNEL_TOOLCALL_DELTA, { delta: delta.delta });
          }
        }
        const isForwardableDisplayDelta = delta?.type === 'text_delta' || delta?.type === 'thinking_delta';
        if (delta && isForwardableDisplayDelta && typeof delta.delta === 'string' && delta.delta !== '') {
          assistantDisplayText += delta.delta;
          if (delta.type === 'text_delta') {
            textDeltaForwardedCount += 1;
            if (isLikelyJsonToolArgsText(delta.delta)) {
              jsonLikeTextDeltaCount += 1;
              if (toolStartCount === 0) {
                if (!jsonNoToolCorrectiveSteerSent) {
                  jsonNoToolCorrectiveSteerSent = true;
                  void sendRpcCommand(child, {
                    type: 'steer',
                    message: 'You emitted JSON in assistant text. Stop text output and invoke the intended tool call event now.',
                  }).catch(() => {});
                } else if (!jsonNoToolGuardrailTriggered) {
                  jsonNoToolGuardrailTriggered = true;
                  guardrailReason = 'json_text_without_tool_event';
                  try {
                    await sendRpcCommand(child, { type: 'abort' });
                  } catch {
                    // ignore
                  }
                  sendTo(
                    sender,
                    CHANNEL_ERROR,
                    normalizeApiErrorMessage(
                      'JSON_TEXT_WITHOUT_TOOL_EVENT: Assistant emitted JSON-like text without invoking a tool call.',
                    ),
                  );
                  sendTo(sender, CHANNEL_DONE, {
                    code: -1,
                    failureBucket: 'json_text_without_tool_event',
                    guardrailReason: guardrailReason || 'json_text_without_tool_event',
                    jsonLikeTextDeltaCount,
                    toolStartCount,
                  });
                  setStreamState(wcId, { status: 'failed', activeRequestId: requestId, aborting: false });
                  endStreamKeepChild();
                  return;
                }
              }
            }
          } else if (delta.type === 'thinking_delta') {
            thinkingDeltaForwardedCount += 1;
          }
          sendTo(sender, CHANNEL_CHUNK, {
            kind: delta.type === 'thinking_delta' ? 'thinking' : 'text',
            delta: delta.delta,
          });
        } else if (delta?.type === 'error') {
          const fromNested =
            delta.error && typeof delta.error === 'object' && typeof delta.error.errorMessage === 'string'
              ? delta.error.errorMessage
              : '';
          const detailed = normalizeApiErrorMessage(
            typeof ev?.message?.errorMessage === 'string'
              ? ev.message.errorMessage
              : fromNested || (typeof delta.reason === 'string' ? delta.reason : '') || '',
          );
          sentPiChatError = true;
          sendTo(sender, CHANNEL_ERROR, detailed || 'Pi message stream error');
          const errFinalizer = getTurnFinalizer(wcId);
          if (errFinalizer) {
            try {
              await errFinalizer({ reason: 'failed' });
            } catch {
              // finalizeTurn emits terminal IPC; swallow residual errors
            }
          } else {
            tearDownSession();
          }
        }
      } else if (ev?.type === 'message_end') {
        const errText = textFromFailedAssistantMessage(ev?.message);
        if (errText && !sentPiChatError) {
          sentPiChatError = true;
          const normalizedErr = normalizeApiErrorMessage(errText);
          sendTo(sender, CHANNEL_ERROR, normalizedErr);
          const endErrFinalizer = getTurnFinalizer(wcId);
          if (endErrFinalizer) {
            try {
              await endErrFinalizer({ reason: 'failed' });
            } catch {
              // finalizeTurn emits terminal IPC; swallow residual errors
            }
          } else {
            tearDownSession();
          }
        }
      } else if (ev?.type === 'tool_execution_start') {
        toolStartCount += 1;
        const toolName = typeof ev.toolName === 'string' ? ev.toolName : '';
        setWatchdogPhase('tool', toolName);
        const { normalized: normalizedArgs, normalizationNotes } = normalizeToolArgs(toolName, ev.args);
        const prevState = toolAttemptState.get(toolName) ?? { schemaFailures: 0, repairedOnce: false, lastArgs: null };
        // Store args before any awaits in this branch so tool_end cannot race with empty attempt state.
        prevState.lastArgs = normalizedArgs;
        prevState.normalizationNotes = normalizationNotes;
        prevState.attempts = Number.isFinite(prevState.attempts) ? prevState.attempts : 0;
        prevState.repairCount = Number.isFinite(prevState.repairCount) ? prevState.repairCount : 0;
        prevState.repairCountByType = prevState.repairCountByType && typeof prevState.repairCountByType === 'object'
          ? prevState.repairCountByType
          : {};
        toolAttemptState.set(toolName, prevState);
        if (toolName === 'write') {
        }
        const isStructuredMutatingTool =
          toolName === 'write'
          || toolName === 'edit'
          || toolName === 'append_to_file'
          || toolName === 'prepend_to_file'
          || toolName === 'insert_at';
        const isMutatingTool =
          isStructuredMutatingTool
          || (toolName === 'bash' && isLikelyMutatingBashCommand(normalizedArgs?.command));
        if (isMutatingTool) {
          getPiTurnLifecycle(wcId).markMutatingToolStarted();
        }
        if (worktreeSession && isMutatingTool) {
          let inferredPath = '';
          if (isStructuredMutatingTool) {
            inferredPath = toRepoRelativePath(normalizedArgs?.path, effectiveCwd, worktreeSession.repoPath);
          } else if (toolName === 'bash') {
            inferredPath = toRepoRelativePath(
              inferTouchedPathFromBashCommand(normalizedArgs?.command),
              effectiveCwd,
              worktreeSession.repoPath,
            );
          }
          if (inferredPath && !touchedRelativeFiles.includes(inferredPath)) {
            touchedRelativeFiles.push(inferredPath);
          }
        }
        if (toolName === 'write') {
        }
        const argsPreview = (() => {
          try {
            return JSON.stringify(normalizedArgs ?? {});
          } catch {
            return '';
          }
        })();
        sendTo(sender, CHANNEL_TOOL, {
          tool: toolName,
          inputPreview: argsPreview,
        });
      } else if (ev?.type === 'tool_execution_update') {
        const toolName = typeof ev.toolName === 'string' ? ev.toolName : '';
        const partialOutput = stringifyResultContent(ev.partialResult);
        if (partialOutput !== '') {
          sendTo(sender, CHANNEL_TOOL_UPDATE, {
            tool: toolName,
            output: partialOutput,
          });
        }
      } else if (ev?.type === 'agent_start') {
        sendTo(sender, CHANNEL_ACTIVITY, { kind: 'agent_start' });
      } else if (ev?.type === 'turn_start') {
        sendTo(sender, CHANNEL_ACTIVITY, { kind: 'turn_start' });
      } else if (ev?.type === 'turn_end') {
        sendTo(sender, CHANNEL_ACTIVITY, { kind: 'turn_end' });
      } else if (ev?.type === 'compaction_start') {
        setWatchdogPhase('compaction');
        const compactionReason = typeof ev.reason === 'string' ? ev.reason : '';
        sendTo(sender, CHANNEL_ACTIVITY, {
          kind: 'compaction_start',
          ...(compactionReason !== '' ? { detail: compactionReason } : {}),
        });
      } else if (ev?.type === 'compaction_end') {
        setWatchdogPhase('waiting');
        sendTo(sender, CHANNEL_ACTIVITY, { kind: 'compaction_end' });
      } else if (ev?.type === 'auto_retry_start') {
        setWatchdogPhase('waiting');
        const attempt = Number(ev.attempt);
        const maxAttempts = Number(ev.maxAttempts);
        const errSnippet =
          typeof ev.errorMessage === 'string' ? ev.errorMessage.trim().slice(0, 120) : '';
        const attemptLabel =
          Number.isFinite(attempt) && Number.isFinite(maxAttempts)
            ? `${attempt}/${maxAttempts}`
            : '';
        sendTo(sender, CHANNEL_ACTIVITY, {
          kind: 'auto_retry_start',
          detail: [attemptLabel, errSnippet].filter(Boolean).join(' — ') || undefined,
        });
      } else if (ev?.type === 'auto_retry_end') {
        const retryOk = ev.success === true;
        sendTo(sender, CHANNEL_ACTIVITY, {
          kind: 'auto_retry_end',
          detail: retryOk ? 'success' : 'failed',
        });
      } else if (ev?.type === 'queue_update') {
        sendTo(sender, CHANNEL_ACTIVITY, { kind: 'queue_update' });
      } else if (ev?.type === 'tool_execution_end') {
        setWatchdogPhase('waiting');
        toolEndCount += 1;
        const toolResultText = stringifyResultContent(ev.result);
        const toolName = typeof ev.toolName === 'string' ? ev.toolName : '';
        const isToolError = Boolean(ev.isError);
        const literalBackslashNCount = (toolResultText.match(/\\n/g) || []).length;
        const realNewlineCount = (toolResultText.match(/\n/g) || []).length;
        const attempt = toolAttemptState.get(toolName) ?? {
          schemaFailures: 0,
          repairedOnce: false,
          lastArgs: null,
          attempts: 0,
          normalizationNotes: [],
          lastAdaptation: { adaptationApplied: false, adaptationType: null, adaptationConfidence: null, adaptationBlockedReason: null },
        };
        attempt.attempts += 1;
        let reliabilityHint = '';
        if (toolName === 'write') {
        }
        const { normalized: normalizedArgs } = normalizeToolArgs(toolName, attempt.lastArgs ?? {});
        const validation = validateToolArgs(toolName, normalizedArgs);
        if (attempt.attempts === 1) {
          recordFirstAttemptKpi(toolName, validation.ok);
        }
        const classification = classifyError({
          validation,
          resultText: toolResultText,
          isToolError,
          effectiveCwd: finalEffectiveCwd,
        });
        const errorType = classification.errorType;
        const memoryFailuresAreWarningOnly = FEATURE_FLAGS.memoryToolHardening && toolName === 'memory_remember';
        const countsAsConsecutiveFailure =
          isToolError
          && !memoryFailuresAreWarningOnly
          && errorType !== 'binary_file'
          && errorType !== 'workspace_drift';
        const failureStreak = computeConsecutiveToolFailureState({
          toolName,
          isToolError: countsAsConsecutiveFailure,
          lastFailedToolName: consecutiveFailedToolName,
          lastFailedToolCount: consecutiveFailedToolCount,
        });
        consecutiveFailedToolName = failureStreak.failedToolName;
        consecutiveFailedToolCount = failureStreak.failedToolCount;
        if (isToolError) {
          if (errorType === 'validation_error') {
            toolValidationFailureCount += 1;
          } else if (errorType === 'binary_file') {
            // Binary reads are expected in mixed repos and should not poison turn diagnostics.
          } else {
            toolRuntimeFailureCount += 1;
          }
        }
        let fuzzyPath = null;
        if (typeof normalizedArgs.path === 'string' && normalizedArgs.path.trim() !== '') {
          fuzzyPath = resolveFuzzyPath({
            queryPath: normalizedArgs.path,
            cwd: effectiveCwd,
            recentPaths: [cwdRaw],
            highConfidenceThreshold: FEATURE_FLAGS.fuzzyGated ? 0.82 : 0.75,
            confidenceMargin: FEATURE_FLAGS.fuzzyGated ? 0.06 : 0,
          });
        }
        let fuzzyText = null;
        const firstEdit =
          Array.isArray(normalizedArgs.edits) && normalizedArgs.edits[0] && typeof normalizedArgs.edits[0] === 'object'
            ? normalizedArgs.edits[0]
            : null;
        if (toolName === 'edit' && firstEdit && typeof firstEdit.oldText === 'string') {
          try {
            const filePath = fuzzyPath?.resolved ?? (path.isAbsolute(normalizedArgs.path) ? normalizedArgs.path : path.join(effectiveCwd, normalizedArgs.path));
            if (fs.existsSync(filePath)) {
              const fileText = await fs.promises.readFile(filePath, 'utf8');
              fuzzyText = resolveFuzzyText({
                oldText: firstEdit.oldText,
                fileText,
                highThreshold: 0.86,
                minGap: 0.08,
              });
            }
          } catch {
            // ignore
          }
        }
        const retryAttemptsForType = Number(attempt.repairCountByType?.[errorType] ?? 0);
        const adaptation = adaptArgsForRetry({
          toolName,
          normalizedArgs,
          errorType,
          fuzzyPath,
          fuzzyText,
        });
        attempt.lastAdaptation = adaptation;
        const writePathOnlyFailure = isWritePathOnlyValidationFailure(toolName, validation, normalizedArgs);
        if (writePathOnlyFailure) {
          reliabilityKpis.malformedWritePathOnly += 1;
        }
        const retriable = FEATURE_FLAGS.retryPolicy
          ? shouldRetry({ errorType, attempts: retryAttemptsForType })
          : attempt.repairCount < 1;
        const failureFingerprint = stableArgsFingerprint(toolName, normalizedArgs, errorType);
        const strategyShiftDetected = !attempt.lastFailureFingerprint || attempt.lastFailureFingerprint !== failureFingerprint;
        const deterministicError = isDeterministicErrorType(errorType);
        const consecutiveSameToolFailureLimit =
          errorType === 'not_found' || errorType === 'workspace_drift' ? 3 : 5;
        const hitConsecutiveSameToolFailureLimit = isToolError
          && !memoryFailuresAreWarningOnly
          && consecutiveFailedToolCount >= consecutiveSameToolFailureLimit;
        const retryDecisionReason = memoryFailuresAreWarningOnly
          ? 'memory_failure_warning_only'
          : hitConsecutiveSameToolFailureLimit
          ? 'same_tool_consecutive_fail_limit_reached'
          : retriable
            ? 'retry_policy_allow'
            : 'retry_policy_deny';
        const allowRetry = isToolError
          ? retriable && !hitConsecutiveSameToolFailureLimit
          : false;
        if (toolName === 'write') {
        }
        const reliabilityMeta = {
          schemaFailures: attempt.schemaFailures,
          repairedOnce: attempt.repairedOnce,
          repairCount: attempt.repairCount,
          repairCountByType: attempt.repairCountByType ?? {},
          errorType,
          retriable: allowRetry,
          retryDecisionReason,
          failureFingerprint,
          strategyShiftDetected,
          adaptationApplied: Boolean(adaptation.adaptationApplied),
          adaptationType: adaptation.adaptationType ?? null,
          adaptationConfidence: adaptation.adaptationConfidence ?? null,
          adaptationBlockedReason: adaptation.adaptationBlockedReason ?? null,
          normalizedArgs,
          normalizationNotes: attempt.normalizationNotes ?? [],
          validationErrors: validation.errors ?? [],
        };
        const envelope = {
          toolName,
          ok: !isToolError,
          errorType,
          message: toolResultText,
          suggestedAction: errorType === 'binary_file'
            ? 'skip_binary_file'
            : writePathOnlyFailure
            ? 'read_then_edit_or_write'
            : allowRetry
              ? 'retry_with_structured_arguments'
              : hitConsecutiveSameToolFailureLimit
                ? 'stop_turn'
                : 'continue_turn',
          missingFields: validation.missing ?? [],
          exampleValidCall: requiredFields(toolName),
          retriable: allowRetry,
          retryDecisionReason,
          failureFingerprint,
          strategyShiftDetected,
          adaptationApplied: Boolean(adaptation.adaptationApplied),
          adaptationType: adaptation.adaptationType ?? null,
          adaptationConfidence: adaptation.adaptationConfidence ?? null,
          adaptationBlockedReason: adaptation.adaptationBlockedReason ?? null,
        };
        if (isToolError) {
          attempt.lastFailureFingerprint = failureFingerprint;
        }
        if (isToolError && allowRetry) {
          attempt.repairedOnce = true;
          attempt.repairCount += 1;
          attempt.repairCountByType = attempt.repairCountByType ?? {};
          attempt.repairCountByType[errorType] = retryAttemptsForType + 1;
          if (errorType === 'validation_error') {
            attempt.schemaFailures += 1;
          }
          toolAttemptState.set(toolName, attempt);
          const repairMessage = buildToolRepairMessage({
            toolName,
            missing: validation.missing ?? [],
            normalizedArgs: adaptation.adaptationApplied ? adaptation.args : normalizedArgs,
            fuzzyPath,
            fuzzyText,
          });
          const fallbackMessage = writePathOnlyFailure
            ? buildWritePathOnlyFallbackMessage(normalizedArgs, fuzzyPath)
            : '';
          try {
          const waitMs = FEATURE_FLAGS.retryPolicy ? backoffMs(errorType, attempt.attempts) : 0;
            if (waitMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
            if (toolName === 'write') {
            }
            await sendRpcCommand(child, {
              type: 'steer',
              message: writePathOnlyFailure ? `${repairMessage}\n\n${fallbackMessage}` : repairMessage,
            });
            repairSteerCount += 1;
            if (errorType === 'not_found' || errorType === 'targeting_error') {
              reliabilityHint =
                fuzzyPath?.resolved
                  ? `Resolved file path to ${fuzzyPath.resolved} (score ${fuzzyPath.confidence.toFixed(2)}).`
                  : 'Auto-corrected tool target guidance sent.';
            } else {
              reliabilityHint = writePathOnlyFailure
                ? 'Detected write(path-only); forcing read/edit recovery path for this turn.'
                : errorType === 'validation_error'
                ? 'Auto-corrected tool schema guidance sent; retrying with required fields.'
                : 'Auto-corrected tool call guidance sent.';
            }
            if (adaptation.adaptationApplied) {
              reliabilityHint = `${reliabilityHint} Adaptive correction applied (${adaptation.adaptationType}, confidence ${Number(adaptation.adaptationConfidence ?? 0).toFixed(2)}).`;
            } else if (adaptation.adaptationBlockedReason) {
              reliabilityHint = `${reliabilityHint} Adaptive correction blocked (${adaptation.adaptationBlockedReason}).`;
              reliabilityKpis.adaptationBlocked += 1;
            }
            if (writePathOnlyFailure) {
              reliabilityKpis.hostFallbackTurns += 1;
            }
            if (adaptation.adaptationApplied) {
              reliabilityKpis.adaptedFailures += 1;
            }
          } catch {
            // ignore
          }
        } else if (isToolError && errorType === 'binary_file') {
          reliabilityHint = 'Skipped binary/non-text file and continued the turn.';
        } else if (isToolError && memoryFailuresAreWarningOnly) {
          reliabilityHint = 'Memory save failed; continuing turn with warning-only memory reliability policy.';
        } else if (isToolError && hitConsecutiveSameToolFailureLimit && !stoppedByReliabilityGuard) {
          stoppedByReliabilityGuard = true;
          reliabilityHint = `Detected ${consecutiveFailedToolCount} consecutive failures on "${toolName}"; stopping this turn.`;
          try {
            await sendRpcCommand(child, { type: 'abort' });
          } catch {
            // ignore
          }
          const stopMessage = `Tool "${toolName}" failed ${consecutiveFailedToolCount} times in a row. Stopping this turn.`;
          sendTo(sender, CHANNEL_ERROR, normalizeApiErrorMessage(stopMessage));
          sendTo(sender, CHANNEL_DONE, {
            code: -1,
            failureBucket: 'reliability_guard_stop',
            guardrailReason: retryDecisionReason || 'retry_exhausted',
            jsonLikeTextDeltaCount,
            toolStartCount,
            toolValidationFailureCount,
            toolRuntimeFailureCount,
          });
          setStreamState(wcId, { status: 'failed', activeRequestId: requestId, aborting: false });
          endStreamKeepChild();
        } else if (isToolError && !allowRetry) {
          reliabilityHint = `Tool "${toolName}" failed and retry policy denied retry for this error type; continuing unless consecutive failure guard is hit.`;
        } else if (
          !isToolError
          && (
            toolName === 'write'
            || toolName === 'edit'
            || toolName === 'append_to_file'
            || toolName === 'prepend_to_file'
            || toolName === 'insert_at'
          )
        ) {
          reliabilityKpis.successfulMutations += 1;
          if (attempt.repairCountByType?.validation_error) {
            reliabilityKpis.malformedWriteRecovered += 1;
          }
          if (attempt.lastAdaptation?.adaptationApplied || (attempt.normalizationNotes ?? []).length > 0) {
            reliabilityKpis.adaptedSuccesses += 1;
          }
        }
        sendTo(sender, CHANNEL_TOOL_END, {
          tool: toolName,
          result: toolResultText,
          isError: isToolError,
          reliabilityHint,
          reliabilityMeta,
          ...(FEATURE_FLAGS.toolErrorProtocol ? { toolEnvelope: envelope } : {}),
        });
      } else if (ev?.type === 'extension_ui_request') {
        sendTo(sender, CHANNEL_EXTENSION_UI, ev);
      } else if (ev?.type === 'extension_error') {
        const extPath = typeof ev.extensionPath === 'string' ? ev.extensionPath : 'unknown';
        const extEvent = typeof ev.event === 'string' ? ev.event : '';
        const extErr =
          ev.error && typeof ev.error === 'object' && typeof ev.error.message === 'string'
            ? ev.error.message
            : typeof ev.error === 'string'
              ? ev.error
              : 'Extension error';
        piDebug('send-message: extension_error from Pi', { extensionPath: extPath, event: extEvent, error: extErr });
        if (!sentPiChatError) {
          sentPiChatError = true;
          sendTo(
            sender,
            CHANNEL_ERROR,
            normalizeApiErrorMessage(`Extension error (${extPath}${extEvent ? `, ${extEvent}` : ''}): ${extErr}`),
          );
        }
      } else if (ev?.type === 'agent_end') {
        if (!sentPiChatError) {
          const tailErr = extractLastAssistantErrorFromMessages(ev?.messages);
          if (tailErr) {
            sentPiChatError = true;
            sendTo(sender, CHANNEL_ERROR, normalizeApiErrorMessage(tailErr));
          }
        }
        piDebug('send-message: agent_end (persistent session)', { wcId });
        await finalizeTurn({ reason: 'completed' });
      } else if (ev?.type === 'response' && ev?.command === 'prompt' && ev.success === false) {
        piDebug('send-message: prompt RPC error', ev.error);
        const msg = normalizeApiErrorMessage(ev.error ?? 'Failed to send prompt to Pi');
        sendTo(sender, CHANNEL_ERROR, msg);
        const promptFin = getTurnFinalizer(wcId);
        if (promptFin) {
          await promptFin({ reason: 'failed' });
        } else {
          sendTo(sender, CHANNEL_DONE, { code: -1 });
          setStreamState(wcId, { status: 'failed', activeRequestId: requestId, aborting: false });
          tearDownSession();
        }
      } else if (evType !== '') {
        if (!HANDLED_PI_STDOUT_EVENT_TYPES.has(evType) && !seenUnhandledPiEventTypes.has(evType)) {
          seenUnhandledPiEventTypes.add(evType);
          piDebug('send-message: Pi event (watchdog bump only)', { type: evType });
        }
      }
    });

    session.detachStdout = detachStdout;
    setWatchdogPhase('waiting');

    try {
      try {
        await sendRpcCommand(child, { type: 'steer', message: TOOL_SCHEMA_STEER });
        try {
          const modeLabel = worktreeSession ? 'worktree' : 'in-place';
          const branchLabel = worktreeSession?.aiBranch
            ? `${worktreeSession.aiBranch} (base: ${worktreeSession.targetBranch})`
            : 'n/a';
          const topLevelEntries = await listTopLevelEntries(finalEffectiveCwd, 50);
          const orientationCard = [
            `Workspace: ${finalEffectiveCwd}`,
            `Mode: ${modeLabel}`,
            `Git branch: ${branchLabel}`,
            'Top-level entries (depth 1, max 50):',
            ...topLevelEntries.map((entry) => `- ${entry}`),
          ].join('\n').slice(0, 2000);
          await sendRpcCommand(child, { type: 'steer', message: orientationCard });
        } catch {
          // best effort orientation card
        }
        if (memoryPreamble) {
          await sendRpcCommand(child, { type: 'steer', message: memoryPreamble });
        }
        const turnSteer = buildTurnToolSteer(prompt);
        if (turnSteer) {
          await sendRpcCommand(child, { type: 'steer', message: turnSteer });
        }
      } catch {
        // best-effort; continue to prompt
      }
      await sendRpcCommand(child, { type: 'prompt', message: prompt });
    } catch (error) {
      clearStreamWatchdog();
      sendTo(sender, CHANNEL_ERROR, normalizeApiErrorMessage(error instanceof Error ? error.message : String(error)));
      sendTo(sender, CHANNEL_DONE, { code: -1 });
      setStreamState(wcId, { status: 'failed', activeRequestId: requestId, aborting: false });
      tearDownSession();
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    return { ok: true, sessionId: 'pi-local', idempotencyKey };
  });
}

module.exports = {
  registerPiGui,
  CHANNEL_CHUNK,
  CHANNEL_DONE,
  CHANNEL_ERROR,
  CHANNEL_TOOL,
  CHANNEL_TOOLCALL_DELTA,
  CHANNEL_TOOL_UPDATE,
  CHANNEL_TOOL_END,
  CHANNEL_EXTENSION_UI,
  parsePorcelainZ,
  checkpointUserRepoIfDirty,
  prepareAiWorktreeSession,
};

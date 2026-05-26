import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { History, Plane, Plus, Send, Settings, Square } from 'lucide-react';
import { FileExplorerContext } from '../explorer/FileExplorerContext';
import type { FileTreeNode } from '../explorer/types';
import {
  assistantHasAnswerContent,
  assistantStreamPlainCharCount,
  renderAssistantContent,
} from '../../shared/ai/aiChatRender';
import AiStreamingLoader from './AiStreamingLoader';
import { useDiffViewer } from '../../shared/contexts/DiffViewerContext';
import { useAiInlineReview } from '../../shared/contexts/AiInlineReviewContext';
import {
  PALETTE_ACTION_EVENT,
  type PaletteActionEventDetail,
} from '../palette/paletteActionEvents';
import { formatPiUserMessage } from '../../shared/assistant-protocol/piFriendlyErrors';
import { usePiSession, type AssistantMessage as AIMessage } from './hooks/usePiSession';
import { useStickyScrollBottom } from './hooks/useStickyScrollBottom';
import type { PiExtensionUiRequest } from '../../shared/assistant-protocol/piEventTypes';
import { useAssistantCredentialsState } from './hooks/useAssistantCredentialsState';
import { chooseMergeOpenPath, isRepoRelativePath } from './utils/mergeOpenPath';
import { buildMergeQueuePaths } from './utils/mergePathPolicy';
import type { PiChatHistorySessionDetail, PiChatHistorySessionSummary } from '../../shared/utils/ipc';
import './AIAssistantTab.css';

interface AIModelOption {
  id: string;
  name: string;
}

interface MentionCandidate {
  absolutePath: string;
  relativePath: string;
}

interface MentionContextRange {
  start: number;
  end: number;
}

interface MentionContext {
  range: MentionContextRange;
  query: string;
}

const MAX_MENTION_RESULTS = 10;

/**
 * Canonical upstream OpenAI model id for the default assistant selection when the gateway exposes
 * this id and the user has not already persisted a different valid model in Pi preferences.
 */
const DEFAULT_CHAT_MODEL_ID = 'gpt-5.4';

/**
 * Chooses which model id should appear in the composer when models finish loading: keep the
 * current selection when it still exists in the catalog; otherwise prefer {@link DEFAULT_CHAT_MODEL_ID}
 * when listed, then fall back to the first catalog entry.
 */
function resolveAssistantModelAfterCatalogLoad(models: AIModelOption[], currentInput: string): string {
  const trimmed = currentInput.trim();
  if (models.length === 0) {
    return '';
  }
  if (models.some((m) => m.id === trimmed)) {
    return currentInput;
  }
  const preferred = models.find((m) => {
    const slash = m.id.lastIndexOf('/');
    const modelOnly = slash >= 0 ? m.id.slice(slash + 1) : m.id;
    return modelOnly === DEFAULT_CHAT_MODEL_ID;
  });
  return preferred?.id ?? models[0].id;
}

function resolveWorkspacePathForPi(rootPath: string, raw: string): string {
  const t = raw.trim();
  if (t === '') {
    return '';
  }
  if (/^[a-zA-Z]:[\\/]/.test(t) || t.startsWith('/') || t.startsWith('\\\\')) {
    return t;
  }
  const base = rootPath.replace(/[/\\]+$/, '');
  if (base === '') {
    return t;
  }
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base}${sep}${t.replace(/^[/\\]+/, '')}`;
}

function newChatInstanceId(): string {
  return `chat-${Date.now()}-${crypto.randomUUID()}`;
}

/**
 * This formatter keeps history metadata readable in the compact sidebar modal
 * by converting timestamps into short relative labels for recent sessions, and
 * falling back to a local date string for older entries where relative values
 * become less informative.
 */
/**
 * This function converts the in-memory assistant transcript plus any unsent
 * composer draft into the minimal `{ role, content }[]` shape expected by the
 * main-process history store. It drops system notices so history stays
 * aligned with user-visible turns, and it appends trimmed draft text as an
 * extra user message when the user starts a new chat without sending that
 * prompt yet, so nothing is lost when rotating `chatInstanceId`.
 */
function buildHistoryMessagesForSave(
  messages: AIMessage[],
  draftText: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const lines = messages
    .filter((m) => {
      if (m.role !== 'user' && m.role !== 'assistant') {
        return false;
      }
      return m.content.trim() !== '';
    })
    .map((m) => {
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });
  const draft = draftText.trim();
  if (draft !== '') {
    lines.push({ role: 'user', content: draft });
  }
  return lines;
}

function formatRelativeTimestamp(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return 'Unknown time';
  }
  const deltaMs = Date.now() - timestampMs;
  const deltaMinutes = Math.max(0, Math.floor(deltaMs / 60_000));
  if (deltaMinutes < 1) {
    return 'Just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 30) {
    return `${deltaDays}d ago`;
  }
  return new Date(timestampMs).toLocaleDateString();
}

/**
 * This hook persists the active chat instance identifier in localStorage so
 * the AI worktree session key remains stable across sidebar unmounts, tab
 * toggles, and renderer reloads. The identifier rotates only when callers
 * explicitly request a new value, which keeps backend session reuse accurate
 * until the user intentionally clears the conversation.
 */
function usePersistedChatInstanceId() {
  const storageKey = 'gvx.chatInstanceId';
  const [chatInstanceId, setChatInstanceId] = useState<string>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored && stored.trim() !== '' ? stored : newChatInstanceId();
    } catch {
      return newChatInstanceId();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, chatInstanceId);
    } catch {
      // best-effort persistence
    }
  }, [chatInstanceId]);

  return [chatInstanceId, setChatInstanceId] as const;
}

/**
 * The mention parser and scorer operate on slash-normalized paths so matching behavior
 * stays predictable across Windows and POSIX file systems, while insertion remains
 * workspace-relative and readable in the composer text.
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function toRelativePath(rootPath: string, absolutePath: string): string {
  const normalizedRoot = normalizePath(rootPath).replace(/\/+$/, '');
  const normalizedAbsolute = normalizePath(absolutePath);
  if (normalizedRoot === '') {
    return normalizedAbsolute;
  }
  if (normalizedAbsolute === normalizedRoot) {
    return '';
  }
  const prefix = `${normalizedRoot}/`;
  if (normalizedAbsolute.startsWith(prefix)) {
    return normalizedAbsolute.slice(prefix.length);
  }
  return normalizedAbsolute;
}

function collectFileMentionCandidates(tree: FileTreeNode | null, rootPath: string): MentionCandidate[] {
  if (!tree) {
    return [];
  }

  const result: MentionCandidate[] = [];
  const stack: FileTreeNode[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.isDirectory) {
      const children = node.children ?? [];
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push(children[i]);
      }
      continue;
    }
    const relativePath = toRelativePath(rootPath, node.path);
    if (relativePath !== '') {
      result.push({
        absolutePath: node.path,
        relativePath,
      });
    }
  }
  return result;
}

function parseMentionContext(text: string, caretIndex: number): MentionContext | null {
  if (caretIndex < 0 || caretIndex > text.length) {
    return null;
  }
  const beforeCaret = text.slice(0, caretIndex);
  const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(beforeCaret);
  if (!mentionMatch) {
    return null;
  }

  const token = mentionMatch[1] ?? '';
  const atIndex = beforeCaret.length - token.length - 1;
  if (atIndex < 0 || beforeCaret.charAt(atIndex) !== '@') {
    return null;
  }

  return {
    range: {
      start: atIndex,
      end: caretIndex,
    },
    query: token,
  };
}

/**
 * This scorer prioritizes intuitive path matches: contiguous character runs, segment
 * starts, and prefix alignment rank higher, while still allowing sparse subsequence
 * matches for short fuzzy queries.
 */
function scoreMentionCandidate(candidateRelativePath: string, query: string): number {
  const normalizedCandidate = normalizePath(candidateRelativePath).toLowerCase();
  const normalizedQuery = normalizePath(query).toLowerCase().trim();
  if (normalizedQuery === '') {
    return 1;
  }

  let score = 0;
  let queryIndex = 0;
  let lastMatchIndex = -1;
  let contiguousRun = 0;

  for (let candidateIndex = 0; candidateIndex < normalizedCandidate.length; candidateIndex += 1) {
    if (queryIndex >= normalizedQuery.length) {
      break;
    }
    if (normalizedCandidate[candidateIndex] !== normalizedQuery[queryIndex]) {
      contiguousRun = 0;
      continue;
    }

    score += 5;
    if (candidateIndex === 0) {
      score += 10;
    }
    if (candidateIndex > 0 && normalizedCandidate[candidateIndex - 1] === '/') {
      score += 8;
    }

    if (lastMatchIndex >= 0) {
      const distance = candidateIndex - lastMatchIndex;
      score += Math.max(0, 5 - distance);
    }

    contiguousRun += 1;
    if (contiguousRun > 1) {
      score += 2;
    }

    lastMatchIndex = candidateIndex;
    queryIndex += 1;
  }

  if (queryIndex !== normalizedQuery.length) {
    return Number.NEGATIVE_INFINITY;
  }

  if (normalizedCandidate.startsWith(normalizedQuery)) {
    score += 20;
  } else if (normalizedCandidate.includes(`/${normalizedQuery}`)) {
    score += 10;
  }

  return score;
}

const AIAssistantTab: React.FC = () => {
  const fileExplorer = useContext(FileExplorerContext);
  const rootPath = fileExplorer?.rootPath ?? '';
  const { openDiff } = useDiffViewer();
  const { clearSession: clearInlineReviewSession } = useAiInlineReview();

  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [modelInput, setModelInput] = useState('');
  const [autopilot, setAutopilot] = useState(false);
  const [modelOptions, setModelOptions] = useState<AIModelOption[]>([]);
  const [isModelsLoading, setIsModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [editSettings, setEditSettings] = useState(false);
  const [openRouterKeyDraft, setOpenRouterKeyDraft] = useState('');
  const [openAiKeyDraft, setOpenAiKeyDraft] = useState('');
  const [credentialsError, setCredentialsError] = useState('');
  const {
    credentialsStatus,
    saveOpenRouterKey,
    saveOpenAiKey,
    clearOpenRouterKey,
    clearOpenAiKey,
  } = useAssistantCredentialsState();
  const [chatInstanceId, setChatInstanceId] = usePersistedChatInstanceId();
  const lastHandledMergeEventIdRef = useRef<string>('');

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const streamTextStableLengthRef = useRef<Map<string, number>>(new Map());
  const hasConversation = messages.length > 0;
  const { pinToBottom } = useStickyScrollBottom(transcriptScrollRef, [messages], hasConversation);

  const liveAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant') {
        return messages[i].id;
      }
    }
    return null;
  }, [messages]);

  useLayoutEffect(() => {
    const nextStable = new Map<string, number>();
    for (const m of messages) {
      const isLiveAssistant =
        m.role === 'assistant' &&
        (Boolean(m.isStreaming) || (isStreaming && m.id === liveAssistantMessageId));
      if (!isLiveAssistant) {
        continue;
      }
      nextStable.set(m.id, assistantStreamPlainCharCount(m.content));
    }
    streamTextStableLengthRef.current = nextStable;
  }, [isStreaming, liveAssistantMessageId, messages]);
  const assistantRootRef = useRef<HTMLDivElement>(null);
  const splashComposerRef = useRef<HTMLDivElement>(null);
  const splashBarRef = useRef<HTMLDivElement>(null);
  const [mentionContext, setMentionContext] = useState<MentionContext | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<PiChatHistorySessionSummary[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isHistoryRestoring, setIsHistoryRestoring] = useState(false);

  const invoke = window.electronAPI?.invoke;
  const subscribe = window.electronAPI?.subscribePiChat;
  const hasOpenRouterKey = credentialsStatus.openRouter.configured;
  const trimmedModelInput = modelInput.trim();
  const hasValidModelSelection =
    trimmedModelInput !== '' && modelOptions.some((model) => model.id === trimmedModelInput);
  const canSend = hasOpenRouterKey && hasValidModelSelection;

  const loadChatHistorySessions = useCallback(async (): Promise<void> => {
    if (!invoke) {
      return;
    }
    setIsHistoryLoading(true);
    setHistoryError('');
    try {
      const raw = (await invoke('pi-gui', { command: 'list-chat-sessions', payload: {} })) as {
        ok?: boolean;
        error?: string;
        sessions?: PiChatHistorySessionSummary[];
      };
      if (!raw?.ok) {
        setHistorySessions([]);
        setHistoryError(formatPiUserMessage(String(raw?.error ?? 'Failed to load chat history.')));
        return;
      }
      const sessions = Array.isArray(raw.sessions)
        ? raw.sessions.filter((entry) => typeof entry?.chatInstanceId === 'string' && entry.chatInstanceId.trim() !== '')
        : [];
      setHistorySessions(sessions);
    } catch (error) {
      setHistorySessions([]);
      setHistoryError(formatPiUserMessage(error instanceof Error ? error.message : String(error)));
    } finally {
      setIsHistoryLoading(false);
    }
  }, [invoke]);

  const openChatHistory = useCallback((): void => {
    if (isStreaming) {
      return;
    }
    setIsHistoryOpen(true);
    void loadChatHistorySessions();
  }, [isStreaming, loadChatHistorySessions]);

  const restoreChatSession = useCallback(
    async (targetChatInstanceId: string): Promise<void> => {
      if (!invoke || targetChatInstanceId.trim() === '' || isStreaming) {
        return;
      }
      setIsHistoryRestoring(true);
      setHistoryError('');
      try {
        const raw = (await invoke('pi-gui', {
          command: 'get-chat-session',
          payload: { chatInstanceId: targetChatInstanceId },
        })) as { ok?: boolean; error?: string; session?: PiChatHistorySessionDetail };
        if (!raw?.ok || !raw.session) {
          setHistoryError(formatPiUserMessage(String(raw?.error ?? 'Could not restore this session.')));
          return;
        }
        const restoredMessages: AIMessage[] = (Array.isArray(raw.session.messages) ? raw.session.messages : [])
          .filter((entry) => {
            if (entry.role !== 'user' && entry.role !== 'assistant') {
              return false;
            }
            return entry.content.trim() !== '';
          })
          .map((entry, index) => ({
            id: `${entry.role}-${raw.session?.chatInstanceId ?? 'history'}-${index}-${Date.now()}`,
            role: entry.role,
            content: entry.content,
          }));
        setMessages(restoredMessages);
        setInputText('');
        setMentionContext(null);
        setChatInstanceId(raw.session.chatInstanceId);
        setIsHistoryOpen(false);
        pinToBottom();
      } catch (error) {
        setHistoryError(formatPiUserMessage(error instanceof Error ? error.message : String(error)));
      } finally {
        setIsHistoryRestoring(false);
      }
    },
    [invoke, isStreaming, pinToBottom, setChatInstanceId],
  );

  useEffect(() => {
    if (!invoke) {
      return;
    }
    void invoke('pi-settings', { op: 'get' }).then((raw) => {
      const s = raw as { model?: string; autopilot?: boolean };
      if (typeof s.model === 'string') {
        setModelInput(s.model);
      }
      setAutopilot(s.autopilot === true);
    });
  }, [invoke]);

  useEffect(() => {
    const e2eBridge = window.electronAPI?.e2eGetFixtureRoot;
    if (typeof e2eBridge !== 'function') {
      return;
    }
    void e2eBridge().then((root) => {
      if (!root || String(root).trim() === '') {
        return;
      }
      setModelInput((current) => (current.trim() === '' ? 'openrouter/e2e-stub' : current));
      setEditSettings(false);
    }).catch(() => {});
  }, []);

  const showSettingsBanner = !hasOpenRouterKey || editSettings;

  const handlePiExtensionUi = useCallback(
    async (ev: PiExtensionUiRequest) => {
      if (!invoke || ev.type !== 'extension_ui_request') {
        return;
      }
      const id = typeof ev.id === 'string' ? ev.id : '';
      const send = async (response: Record<string, unknown>) => {
        await invoke('pi-gui', { command: 'extension-ui-response', payload: response });
      };
      const m = ev.method;
      if (m === 'confirm') {
        const title = typeof ev.title === 'string' ? ev.title : 'Confirm';
        const message = typeof ev.message === 'string' ? ev.message : '';
        const ok = window.confirm(`${title}\n\n${message}`);
        await send({ type: 'extension_ui_response', id, confirmed: ok });
        return;
      }
      if (m === 'select') {
        const title = typeof ev.title === 'string' ? ev.title : 'Choose';
        const opts = Array.isArray(ev.options) ? ev.options.map((o) => String(o)) : [];
        if (opts.length === 0) {
          await send({ type: 'extension_ui_response', id, cancelled: true });
          return;
        }
        const lines = opts.map((o, i) => `${i}: ${o}`).join('\n');
        const raw = window.prompt(`${title}\n${lines}\n\nEnter index (0-${opts.length - 1}):`, '0');
        if (raw === null) {
          await send({ type: 'extension_ui_response', id, cancelled: true });
          return;
        }
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 0 || n >= opts.length) {
          await send({ type: 'extension_ui_response', id, cancelled: true });
          return;
        }
        await send({ type: 'extension_ui_response', id, value: opts[n] });
        return;
      }
      if (m === 'input') {
        const title = typeof ev.title === 'string' ? ev.title : 'Input';
        const placeholder = typeof ev.placeholder === 'string' ? ev.placeholder : '';
        const raw = window.prompt(title, placeholder);
        if (raw === null) {
          await send({ type: 'extension_ui_response', id, cancelled: true });
          return;
        }
        await send({ type: 'extension_ui_response', id, value: raw });
        return;
      }
      if (m === 'editor') {
        const title = typeof ev.title === 'string' ? ev.title : 'Edit';
        const prefill = typeof ev.prefill === 'string' ? ev.prefill : '';
        const raw = window.prompt(title, prefill);
        if (raw === null) {
          await send({ type: 'extension_ui_response', id, cancelled: true });
          return;
        }
        await send({ type: 'extension_ui_response', id, value: raw });
        return;
      }
      if (m === 'setWidget' && ev.widgetKey === 'gruvbox_open_file') {
        const lines = Array.isArray(ev.widgetLines) ? ev.widgetLines.map((x) => String(x)) : [];
        const raw = lines[0]?.trim() ?? '';
        if (raw && fileExplorer?.selectFile) {
          const resolved = resolveWorkspacePathForPi(fileExplorer.rootPath ?? rootPath, raw);
          fileExplorer.selectFile(resolved);
        }
        return;
      }
    },
    [fileExplorer, invoke, rootPath],
  );

  const toggleAutopilot = useCallback((): void => {
    const next = !autopilot;
    setAutopilot(next);
    void invoke?.('pi-settings', { op: 'set', autopilot: next });
  }, [autopilot, invoke]);

  /**
   * Opens merge review only when main reports `mergeAutoOpen` (worktree HEAD
   * advanced this turn — a new AI-side commit). An active worktree session alone
   * is insufficient: branch-wide diffs stay non-empty after the first edit, so the
   * status IPC would otherwise justify reopening merge after every reply.
   */
  const handlePiTurnDone = useCallback(
    async (payload: { code: number; aborted?: boolean; mergeEventId?: string; mergeAutoOpen?: boolean }) => {
      if (!invoke) {
        return;
      }
      // Main sets this only when the worktree HEAD advanced (new commit). Without it, an open
      // worktree session + stale merge paths would reopen the merge viewer after every reply.
      if (payload.mergeAutoOpen !== true) {
        return;
      }
      const payloadMergeEventId = typeof payload.mergeEventId === 'string' ? payload.mergeEventId.trim() : '';
      if (payloadMergeEventId !== '' && payloadMergeEventId === lastHandledMergeEventIdRef.current) {
        return;
      }
      const statusRaw = (await invoke('pi-gui', {
        command: 'ai-worktree-status',
        payload: { chatInstanceId },
      })) as {
        ok?: boolean;
        active?: boolean;
        repoPath?: string;
        sourceBranch?: string;
        sourceBranchB?: string;
        targetBranch?: string;
        worktreePath?: string;
        worktreePathB?: string;
        primaryRelativePath?: string;
        changedRelativePaths?: string[];
        toolTouchedFiles?: string[];
        mergeEventId?: string;
      };
      if (!statusRaw?.ok || statusRaw.active !== true) {
        return;
      }
      const statusMergeEventId = typeof statusRaw.mergeEventId === 'string' ? statusRaw.mergeEventId.trim() : '';
      const effectiveMergeEventId = payloadMergeEventId || statusMergeEventId;
      if (effectiveMergeEventId !== '' && effectiveMergeEventId === lastHandledMergeEventIdRef.current) {
        return;
      }
      const repoPath = typeof statusRaw.repoPath === 'string' ? statusRaw.repoPath.trim() : '';
      const sourceBranch = typeof statusRaw.sourceBranch === 'string' ? statusRaw.sourceBranch.trim() : '';
      const targetBranch = typeof statusRaw.targetBranch === 'string' ? statusRaw.targetBranch.trim() : '';
      const primaryRelativePath =
        typeof statusRaw.primaryRelativePath === 'string' ? statusRaw.primaryRelativePath.trim() : '';
      const { queue: mergeQueue, rejected: rejectedMergePaths } = buildMergeQueuePaths(
        statusRaw.changedRelativePaths,
      );
      const mergeFilePath = chooseMergeOpenPath(
        primaryRelativePath,
        mergeQueue,
        statusRaw.toolTouchedFiles,
      );
      if (
        repoPath === '' ||
        sourceBranch === '' ||
        targetBranch === '' ||
        !isRepoRelativePath(mergeFilePath)
      ) {
        return;
      }
      const sourceBranchB = typeof statusRaw.sourceBranchB === 'string' ? statusRaw.sourceBranchB.trim() : '';
      const dualAiMerge = sourceBranchB !== '';
      openDiff({
        repoPath,
        filePath: mergeFilePath,
        hash1: targetBranch,
        hash2: sourceBranch,
        ...(dualAiMerge ? { hashBase: targetBranch } : {}),
        aiProposedEdits: true,
        branchMerge: { sourceBranch, targetBranch },
        aiWorktreePath: typeof statusRaw.worktreePath === 'string' ? statusRaw.worktreePath : undefined,
        aiWorktreePathB: typeof statusRaw.worktreePathB === 'string' ? statusRaw.worktreePathB : undefined,
        dualAiMerge,
        mergePendingPaths: mergeQueue.length > 0 ? mergeQueue : undefined,
      });
      if (rejectedMergePaths.length > 0) {
        const rejectId = effectiveMergeEventId !== '' ? `merge-rejected-${effectiveMergeEventId}` : `merge-rejected-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: rejectId,
            role: 'assistant',
            content: `Ignored suspicious paths (not opened for merge): ${rejectedMergePaths.join(', ')}. Delete them in the explorer if they were created by mistake.`,
          },
        ]);
      }
      if (effectiveMergeEventId !== '') {
        lastHandledMergeEventIdRef.current = effectiveMergeEventId;
      }
    },
    [chatInstanceId, invoke, openDiff],
  );

  const { sendMessage, abortMessage, tearDownStreamIpc, streamActivityLabel } = usePiSession({
    invoke,
    subscribe,
    rootPath,
    modelInput,
    hasOpenRouterKey,
    messages,
    setMessages,
    setInputText,
    setIsStreaming,
    chatInstanceId,
    onExtensionUi: handlePiExtensionUi,
    onTurnDone: handlePiTurnDone,
  });

  useEffect(() => {
    return () => {
      tearDownStreamIpc();
      void invoke?.('pi-gui', { command: 'abort' });
    };
  }, [invoke, tearDownStreamIpc]);

  const selectedModelName =
    modelOptions.find((m) => m.id === modelInput.trim())?.name ?? modelInput.trim();
  const currentModelLabel = selectedModelName !== '' ? selectedModelName : 'model (Preferences)';
  const mentionCandidates = useMemo(
    () => collectFileMentionCandidates(fileExplorer?.fileTree ?? null, rootPath),
    [fileExplorer?.fileTree, rootPath],
  );

  const mentionSuggestions = useMemo(() => {
    if (!mentionContext) {
      return [];
    }
    const scored = mentionCandidates
      .map((candidate) => ({
        candidate,
        score: scoreMentionCandidate(candidate.relativePath, mentionContext.query),
      }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.candidate.relativePath.localeCompare(b.candidate.relativePath);
      })
      .slice(0, MAX_MENTION_RESULTS)
      .map((item) => item.candidate);
    return scored;
  }, [mentionCandidates, mentionContext]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionContext?.query, mentionContext?.range.start, mentionContext?.range.end]);

  useEffect(() => {
    if (mentionSuggestions.length === 0) {
      setActiveMentionIndex(0);
      return;
    }
    setActiveMentionIndex((prev) => Math.min(prev, mentionSuggestions.length - 1));
  }, [mentionSuggestions.length]);

  const submitComposerMessage = useCallback((): void => {
    pinToBottom();
    void sendMessage(inputText);
  }, [inputText, pinToBottom, sendMessage]);

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) {
      return;
    }

    if (!hasConversation) {
      textarea.style.height = '';
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [hasConversation, inputText]);

  const updateMentionContext = useCallback((nextText: string, caretIndex: number | null): void => {
    if (caretIndex === null) {
      setMentionContext(null);
      return;
    }
    setMentionContext(parseMentionContext(nextText, caretIndex));
  }, []);

  const insertMention = useCallback(
    (selected: MentionCandidate): void => {
      if (!mentionContext) {
        return;
      }
      const replacement = `@${selected.relativePath} `;
      const nextText =
        inputText.slice(0, mentionContext.range.start) +
        replacement +
        inputText.slice(mentionContext.range.end);
      const nextCaret = mentionContext.range.start + replacement.length;
      setInputText(nextText);
      setMentionContext(null);
      setActiveMentionIndex(0);
      window.requestAnimationFrame(() => {
        const textarea = inputRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [inputText, mentionContext],
  );

  const handleInputKeydown = (ev: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (ev.key === 'Escape' && mentionContext) {
      ev.preventDefault();
      setMentionContext(null);
      return;
    }

    if (mentionContext && mentionSuggestions.length > 0) {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        setActiveMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        setActiveMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (ev.key === 'Enter' || ev.key === 'Tab') {
        ev.preventDefault();
        insertMention(mentionSuggestions[activeMentionIndex] ?? mentionSuggestions[0]);
        return;
      }
    }

    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      submitComposerMessage();
    }
  };

  const savePiSettings = async (): Promise<void> => {
    if (!invoke) {
      return;
    }
    await invoke('pi-settings', {
      op: 'set',
      model: modelInput,
      autopilot,
    });
    setEditSettings(false);
  };

  const loadModels = useCallback(async (): Promise<void> => {
    if (!invoke || !hasOpenRouterKey) {
      return;
    }
    setIsModelsLoading(true);
    setModelsError('');
    try {
      const res = (await invoke('pi-gui', {
        command: 'list-models',
        payload: {},
      })) as {
        ok: boolean;
        error?: string;
        models?: Array<{ id?: string; name?: string }>;
      };
      if (!res.ok) {
        setModelsError(formatPiUserMessage(res.error ?? 'Failed to load models'));
        setModelOptions([]);
        setModelInput('');
        return;
      }
      const models = Array.isArray(res.models)
        ? res.models
            .filter((m) => typeof m?.id === 'string' && m.id.trim() !== '')
            .map((m) => ({
              id: String(m.id).trim(),
              name:
                typeof m.name === 'string' && m.name.trim() !== ''
                  ? m.name.trim()
                  : String(m.id).trim(),
            }))
        : [];
      setModelOptions(models);
      if (models.length > 0) {
        setModelInput((current) => resolveAssistantModelAfterCatalogLoad(models, current));
      } else {
        setModelInput('');
      }
    } catch (err) {
      setModelsError(formatPiUserMessage(err instanceof Error ? err.message : String(err)));
      setModelOptions([]);
      setModelInput('');
    } finally {
      setIsModelsLoading(false);
    }
  }, [hasOpenRouterKey, invoke]);

  const saveCredentials = async (): Promise<void> => {
    setCredentialsError('');
    if (openRouterKeyDraft.trim() !== '') {
      const result = await saveOpenRouterKey(openRouterKeyDraft.trim());
      if (!result.ok) {
        setCredentialsError(result.error ?? 'Could not save OpenRouter key.');
        return;
      }
      setOpenRouterKeyDraft('');
    }
    if (openAiKeyDraft.trim() !== '') {
      const result = await saveOpenAiKey(openAiKeyDraft.trim());
      if (!result.ok) {
        setCredentialsError(result.error ?? 'Could not save OpenAI key.');
        return;
      }
      setOpenAiKeyDraft('');
    }
    void loadModels();
  };

  useEffect(() => {
    if (!hasOpenRouterKey) {
      return;
    }
    void loadModels();
  }, [hasOpenRouterKey, loadModels]);

  const openPreferences = (): void => {
    void invoke?.('application', { command: 'open-preferences' }).catch(() => {});
  };

  /**
   * Saves the current transcript to backend session history for this window,
   * then resets the Pi child and starts a fresh chat instance. This is the
   * product "new conversation" flow: nothing is discarded without a history
   * snapshot when there is anything to store.
   */
  const startNewConversation = useCallback(async (): Promise<void> => {
    if (!invoke || isStreaming) {
      return;
    }
    const historyPayload = buildHistoryMessagesForSave(messages, inputText);
    if (historyPayload.length > 0) {
      try {
        await invoke('pi-gui', {
          command: 'save-chat-session',
          payload: { chatInstanceId, messages: historyPayload },
        });
      } catch {
        // best-effort persistence; still reset below so the UI never dead-ends
      }
    }
    clearInlineReviewSession();
    try {
      await invoke('pi-gui', { command: 'reset-pi-session', payload: {} });
    } catch {
      // still clear local UI
    }
    setMessages([]);
    setInputText('');
    setChatInstanceId(newChatInstanceId());
  }, [chatInstanceId, clearInlineReviewSession, inputText, invoke, isStreaming, messages]);

  useEffect(() => {
    const onPalette = (ev: Event): void => {
      const ce = ev as CustomEvent<PaletteActionEventDetail>;
      const kind = ce.detail?.action.kind;
      if (kind === 'ai.clearChat') {
        void startNewConversation();
      } else if (kind === 'ai.abort') {
        abortMessage();
      } else if (kind === 'ai.reloadModels') {
        void loadModels();
      } else if (kind === 'ai.openSettings') {
        setEditSettings(true);
      }
    };
    window.addEventListener(PALETTE_ACTION_EVENT, onPalette as EventListener);
    return () => window.removeEventListener(PALETTE_ACTION_EVENT, onPalette as EventListener);
  }, [abortMessage, loadModels, startNewConversation]);

  return (
    <div id="ai-assistant-tab" className="ai-assistant-tab" data-testid="ai-assistant-root" ref={assistantRootRef}>
      {showSettingsBanner && (
        <div className="ai-chat-banner ai-chat-banner-api-key" role="status">
          <p className="ai-chat-banner-text">
            Add your OpenRouter API key for chat. OpenAI key is optional and used only for cloud TTS (audiobook).
          </p>
          <div className="ai-chat-banner-fields">
            <label className="ai-chat-banner-label">
              OpenRouter API key {credentialsStatus.openRouter.configured ? '(configured)' : '(required)'}
              <input
                type="password"
                className="ai-chat-banner-input"
                placeholder={credentialsStatus.openRouter.configured ? 'Enter new key to replace' : 'sk-or-...'}
                value={openRouterKeyDraft}
                onChange={(e) => setOpenRouterKeyDraft(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="ai-chat-banner-label">
              OpenAI API key (TTS only) {credentialsStatus.openAi.configured ? '(configured)' : '(optional)'}
              <input
                type="password"
                className="ai-chat-banner-input"
                placeholder={credentialsStatus.openAi.configured ? 'Enter new key to replace' : 'sk-...'}
                value={openAiKeyDraft}
                onChange={(e) => setOpenAiKeyDraft(e.target.value)}
                autoComplete="off"
              />
            </label>
            {hasOpenRouterKey && (
              <label className="ai-chat-banner-label">
                Model
                <select
                  className="ai-chat-banner-input"
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  disabled={isModelsLoading}
                >
                  {isModelsLoading && <option value="">Loading models...</option>}
                  {!isModelsLoading && modelOptions.length === 0 && (
                    <option value="">No models available</option>
                  )}
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {modelsError !== '' && <p className="ai-chat-banner-error">{modelsError}</p>}
          {credentialsError !== '' && <p className="ai-chat-banner-error">{credentialsError}</p>}
          <div className="ai-chat-banner-actions">
            {credentialsStatus.openRouter.configured && (
              <button
                type="button"
                className="ai-chat-btn ai-chat-btn-ghost"
                onClick={() => void clearOpenRouterKey()}
              >
                Clear OpenRouter key
              </button>
            )}
            {credentialsStatus.openAi.configured && (
              <button type="button" className="ai-chat-btn ai-chat-btn-ghost" onClick={() => void clearOpenAiKey()}>
                Clear OpenAI key
              </button>
            )}
            {hasOpenRouterKey && (
              <button
                type="button"
                className="ai-chat-btn ai-chat-btn-ghost"
                onClick={() => void loadModels()}
                disabled={isModelsLoading}
              >
                Refresh models
              </button>
            )}
            <button type="button" className="ai-chat-btn ai-chat-btn-primary" onClick={() => void saveCredentials()}>
              Save keys
            </button>
            {hasOpenRouterKey && (
              <button type="button" className="ai-chat-btn ai-chat-btn-primary" onClick={() => void savePiSettings()}>
                Save model
              </button>
            )}
            {canSend && (
              <button type="button" className="ai-chat-btn ai-chat-btn-ghost" onClick={() => setEditSettings(false)}>
                Close
              </button>
            )}
            <button type="button" className="ai-chat-btn ai-chat-btn-ghost" onClick={openPreferences}>
              Open Preferences
            </button>
          </div>
        </div>
      )}
      <div
        className={`ai-chat-body ${hasConversation ? 'ai-chat-body--chat' : 'ai-chat-body--splash'}`}
        data-testid="ai-chat-body"
      >
        {hasConversation && (
          <div ref={transcriptScrollRef} className="ai-chat-scroll" data-testid="ai-chat-transcript">
            {messages.map((m) => {
              if (m.role === 'system') {
                return (
                  <div key={m.id} className="ai-chat-turn">
                    <div className="ai-chat-system">{m.content}</div>
                  </div>
                );
              }
              if (m.role === 'user') {
                return (
                  <div key={m.id} className="ai-chat-turn is-user">
                    <div className="ai-chat-turn-body">
                      <div className="ai-chat-bubble" style={{ whiteSpace: 'pre-wrap' }}>
                        {m.content}
                      </div>
                    </div>
                  </div>
                );
              }
              const isLiveAssistantStream =
                Boolean(m.isStreaming) ||
                (isStreaming && m.id === liveAssistantMessageId);
              const showThinkingLoader =
                isLiveAssistantStream && !assistantHasAnswerContent(m.content);
              const streamStableCharCount = isLiveAssistantStream
                ? (streamTextStableLengthRef.current.get(m.id) ?? 0)
                : undefined;
              return (
                <div key={m.id} className="ai-chat-turn">
                  <div className="ai-chat-turn-body">
                    {showThinkingLoader && <AiStreamingLoader />}
                    <div
                      className={`ai-chat-bubble ai-chat-md${isLiveAssistantStream ? ' is-streaming' : ''}${showThinkingLoader ? ' ai-chat-bubble--pending' : ''}`}
                      dangerouslySetInnerHTML={{
                        __html: renderAssistantContent(m.content, isLiveAssistantStream, {
                          streamStableCharCount,
                        }),
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div
          className={`ai-chat-composer ${hasConversation ? 'ai-chat-composer--chat' : 'ai-chat-composer--splash'}`}
          data-testid="ai-composer"
          ref={hasConversation ? null : splashComposerRef}
        >
          <div className="ai-chat-textarea-wrap">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                updateMentionContext(e.target.value, e.target.selectionStart);
              }}
              onSelect={(e) => {
                updateMentionContext(e.currentTarget.value, e.currentTarget.selectionStart);
              }}
              onBlur={(e) => {
                const nextFocused = e.relatedTarget as Node | null;
                if (nextFocused && mentionListRef.current?.contains(nextFocused)) {
                  return;
                }
                setMentionContext(null);
              }}
              className={`ai-chat-textarea ${hasConversation ? 'ai-chat-textarea--chat' : 'ai-chat-textarea--splash'}`}
              placeholder={hasOpenRouterKey ? 'Ask Gruvie...' : 'Add OpenRouter API key in settings...'}
              disabled={isStreaming || !hasOpenRouterKey}
              onKeyDown={handleInputKeydown}
            />
            {mentionContext && mentionSuggestions.length > 0 && (
              <div className="ai-chat-mentions-dropdown" ref={mentionListRef} role="listbox" aria-label="File mentions">
                {mentionSuggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.absolutePath}
                    type="button"
                    className={`ai-chat-mention-item${index === activeMentionIndex ? ' is-active' : ''}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertMention(suggestion);
                    }}
                    onMouseEnter={() => setActiveMentionIndex(index)}
                    role="option"
                    aria-selected={index === activeMentionIndex}
                  >
                    @{suggestion.relativePath}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div
            className={`ai-chat-composer-bar ${hasConversation ? 'ai-chat-composer-bar--inline' : 'ai-chat-composer-bar--splash'}`}
            ref={hasConversation ? null : splashBarRef}
          >
            <button
              type="button"
              className="ai-chat-btn ai-chat-btn-ghost ai-chat-btn-icon"
              title={`Model: ${currentModelLabel}`}
              onClick={() => setEditSettings(true)}
            >
              <Settings size={14} />
            </button>
            <button
              type="button"
              className={`ai-chat-btn ai-chat-btn-ghost ai-chat-btn-icon${autopilot ? ' ai-chat-btn-autopilot-on' : ''}`}
              data-testid="ai-autopilot-toggle"
              aria-pressed={autopilot}
              title={
                autopilot
                  ? 'Autopilot: AI edits land directly in the editor (click to open diff/merge view instead)'
                  : 'Autopilot off: AI edits open in diff/merge view (click to apply edits in the editor)'
              }
              onClick={toggleAutopilot}
            >
              <Plane size={14} />
            </button>
            <button
              type="button"
              className="ai-chat-btn ai-chat-btn-ghost ai-chat-btn-icon"
              title="Open chat history"
              data-testid="ai-chat-history-button"
              onClick={openChatHistory}
              disabled={isStreaming || !hasOpenRouterKey}
            >
              <History size={14} />
            </button>
            <button
              type="button"
              className="ai-chat-btn ai-chat-btn-ghost ai-chat-btn-icon"
              data-testid="ai-new-conversation-button"
              disabled={(messages.length === 0 && inputText.trim() === '') || isStreaming}
              title="New conversation — current chat is saved to History"
              onClick={() => void startNewConversation()}
            >
              <Plus size={14} />
            </button>
            {isStreaming && streamActivityLabel !== '' && (
              <span className="ai-chat-stream-activity" data-testid="ai-stream-activity">
                {streamActivityLabel}
              </span>
            )}
            {isStreaming && (
              <button
                type="button"
                className="ai-chat-btn ai-chat-btn-danger ai-chat-btn-icon"
                title="Stop"
                onClick={abortMessage}
              >
                <Square size={14} fill="currentColor" />
              </button>
            )}
            {!isStreaming && (
              <button
                type="button"
                className="ai-chat-btn ai-chat-btn-primary ai-chat-btn-icon"
                disabled={!inputText.trim() || !canSend}
                title={canSend ? 'Send' : 'Add OpenRouter key and select a valid model first'}
                onClick={submitComposerMessage}
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
      {isHistoryOpen && (
        <div className="ai-chat-history-modal-backdrop" role="dialog" aria-modal="true" aria-label="Chat history">
          <div className="ai-chat-history-modal">
            <div className="ai-chat-history-modal-header">
              <h3 className="ai-chat-history-modal-title">Chat History</h3>
              <button
                type="button"
                className="ai-chat-btn ai-chat-btn-ghost"
                onClick={() => setIsHistoryOpen(false)}
                disabled={isHistoryRestoring}
              >
                Close
              </button>
            </div>
            {historyError !== '' && <p className="ai-chat-history-error">{historyError}</p>}
            {isHistoryLoading ? (
              <p className="ai-chat-history-empty">Loading sessions...</p>
            ) : historySessions.length === 0 ? (
              <p className="ai-chat-history-empty">No saved chat sessions yet.</p>
            ) : (
              <div className="ai-chat-history-list" data-testid="ai-chat-history-list">
                {historySessions.map((entry) => (
                  <button
                    key={entry.chatInstanceId}
                    type="button"
                    className="ai-chat-history-item"
                    onClick={() => void restoreChatSession(entry.chatInstanceId)}
                    disabled={isHistoryRestoring}
                  >
                    <span className="ai-chat-history-item-preview">{entry.previewText || 'Untitled chat'}</span>
                    <span className="ai-chat-history-item-meta">{formatRelativeTimestamp(entry.updatedAtMs)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AIAssistantTab;

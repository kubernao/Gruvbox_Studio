import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import type {
  PiChatActivityPayload,
  PiChatChunkPayload,
  PiChatDonePayload,
  PiChatHandlers,
  PiChatStreamEndPayload,
  PiExtensionUiRequest,
  PiToolcallDeltaPayload,
  PiToolUpdatePayload,
} from '../../../shared/assistant-protocol/piEventTypes';
import { formatPiUserMessage } from '../../../shared/assistant-protocol/piFriendlyErrors';
import { replaceOrAppendToolCard, appendToToolCard } from '../utils/toolCardStream';
import { appendToThinkingCard } from '../utils/thinkingCardStream';

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** @deprecated Legacy sessions only; live turns embed thinking in `content`. */
  thinkingContent?: string;
  isStreaming?: boolean;
}

interface UsePiSessionArgs {
  invoke: ((channel: string, ...args: unknown[]) => Promise<unknown>) | undefined;
  subscribe: ((handlers: PiChatHandlers) => () => void) | undefined;
  rootPath: string;
  modelInput: string;
  hasOpenRouterKey: boolean;
  messages: AssistantMessage[];
  setMessages: Dispatch<SetStateAction<AssistantMessage[]>>;
  setInputText: Dispatch<SetStateAction<string>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  chatInstanceId: string;
  onExtensionUi?: (ev: PiExtensionUiRequest) => void | Promise<void>;
  onTurnDone?: (payload: PiChatDonePayload) => void | Promise<void>;
}

interface UsePiSessionResult {
  sendMessage: (inputText: string) => Promise<void>;
  abortMessage: () => void;
  tearDownStreamIpc: () => void;
  /** Human-readable Pi lifecycle hint while streaming (waiting, compaction, retry). */
  streamActivityLabel: string;
}

/**
 * Map Pi lifecycle IPC payloads to a short status string for the composer area.
 */
function activityToLabel(payload: PiChatActivityPayload): string {
  switch (payload.kind) {
    case 'agent_start':
    case 'turn_start':
    case 'compaction_end':
      return 'Waiting on model…';
    case 'compaction_start':
      return payload.detail ? `Compacting context (${payload.detail})…` : 'Compacting context…';
    case 'auto_retry_start':
      return payload.detail ? `Retrying (${payload.detail})…` : 'Retrying…';
    case 'auto_retry_end':
      return payload.detail === 'failed' ? 'Retry failed, waiting…' : 'Waiting on model…';
    case 'queue_update':
      return 'Queued follow-up…';
    case 'turn_end':
      return '';
    default:
      return '';
  }
}

/** Append to the assistant row with this id (avoids races where IPC chunks arrive before React commits the new row). */
function appendTextToAssistantById(
  setter: Dispatch<SetStateAction<AssistantMessage[]>>,
  assistantId: string,
  chunk: string,
  onMiss?: () => void,
): void {
  setter((prev) => {
    const idx = prev.findIndex((m) => m.id === assistantId && m.role === 'assistant');
    if (idx === -1) {
      onMiss?.();
      return prev;
    }
    const next = [...prev];
    const cur = next[idx];
    next[idx] = { ...cur, content: cur.content + chunk };
    return next;
  });
}

/** Append streamed reasoning tokens into the assistant content timeline. */
function appendThinkingToAssistantById(
  setter: Dispatch<SetStateAction<AssistantMessage[]>>,
  assistantId: string,
  chunk: string,
  onMiss?: () => void,
): void {
  setter((prev) => {
    const idx = prev.findIndex((m) => m.id === assistantId && m.role === 'assistant');
    if (idx === -1) {
      onMiss?.();
      return prev;
    }
    const next = [...prev];
    const cur = next[idx];
    next[idx] = { ...cur, content: appendToThinkingCard(cur.content, chunk) };
    return next;
  });
}

/**
 * Normalizes main-process chunk payloads: structured `{ kind, delta }` from current
 * Electron builds, or legacy plain strings for compatibility.
 */
function parsePiChatChunk(chunk: PiChatChunkPayload): { kind: 'text' | 'thinking'; delta: string } {
  if (typeof chunk === 'string') {
    return { kind: 'text', delta: chunk };
  }
  if (chunk !== null && typeof chunk === 'object' && typeof chunk.delta === 'string') {
    return {
      kind: chunk.kind === 'thinking' ? 'thinking' : 'text',
      delta: chunk.delta,
    };
  }
  return { kind: 'text', delta: '' };
}

function stripDisplayOnlyArtifacts(content: string): string {
  return content
    .replace(/\[\[GVX_TOOL:[^\]]+\]\]/g, '')
    .replace(/\[\[GVX_THINK:[^\]]+\]\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Mention tokens are a chat-only affordance for file pickers, so this normalizer
 * removes the leading "@" from mention-like segments before user content is sent
 * to the backend model payload. The UI transcript keeps the original text, but the
 * model receives plain file paths to avoid leaking mention syntax into prompts.
 */
function stripMentionPrefixes(content: string): string {
  return content.replace(/(^|\s)@([^\s@]+)/g, '$1$2');
}

function transcriptLinesForSend(list: AssistantMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of list) {
    if (m.role === 'user' || m.role === 'assistant') {
      out.push({
        role: m.role,
        content: stripMentionPrefixes(stripDisplayOnlyArtifacts(m.content)),
      });
    }
  }
  return out;
}

function truncateText(input: string, max = 180): string {
  const compact = input.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 1)}…`;
}

function summarizeToolInput(toolName: string, inputPreview: string): string {
  const raw = inputPreview.trim();
  if (raw === '') {
    return 'No arguments.';
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (toolName === 'read') {
      return typeof parsed.path === 'string' ? `Path: ${truncateText(parsed.path, 100)}` : 'Read arguments received.';
    }
    if (toolName === 'edit') {
      const path = typeof parsed.path === 'string' ? parsed.path : '(unknown path)';
      const edits = Array.isArray(parsed.edits) ? parsed.edits.length : 0;
      return `Path: ${truncateText(path, 90)} | edits: ${edits}`;
    }
    if (toolName === 'bash') {
      return typeof parsed.command === 'string'
        ? `Command: ${truncateText(parsed.command, 120)}`
        : 'Command arguments received.';
    }
    const keys = Object.keys(parsed).slice(0, 6);
    return keys.length > 0 ? `Arguments: ${keys.join(', ')}` : 'Structured arguments received.';
  } catch {
    return truncateText(raw, 140);
  }
}

function summarizeToolResult(raw: string): string {
  const text = raw.trim();
  if (text === '') {
    return 'No output.';
  }
  const withoutArgsDump = text.replace(/\n*Received arguments:\s*[\s\S]*$/i, '').trim();
  const candidate = withoutArgsDump === '' ? text : withoutArgsDump;
  const t = candidate.trim();
  if (
    (t.startsWith('{') && t.endsWith('}')) ||
    (t.startsWith('[') && t.endsWith(']')) ||
    t.startsWith('```json')
  ) {
    return 'Structured output hidden.';
  }
  return truncateText(candidate, 220);
}

function sanitizeAssistantChunk(chunk: string): string {
  // Keep as a light fallback cleaner; protocol-level filtering in main process
  // should prevent tool-call argument JSON from reaching this path.
  return chunk
    .replace(/Received arguments:\s*\{[\s\S]*?\}\s*/gi, '')
    .replace(/\n{3,}/g, '\n\n');
}

function buildToolCard(toolName: string, title: string, body: string, state: 'run' | 'ok' | 'err' | 'building' | 'update'): string {
  void toolName;
  const encodedTitle = encodeURIComponent(title);
  const encodedBody = encodeURIComponent(body);
  return `\n\n[[GVX_TOOL:${state}:${encodedTitle}:${encodedBody}]]\n\n`;
}

/**
 * Heuristically classify whether the current message likely requests file/code
 * mutations. We keep this intentionally permissive for edit-like verbs and
 * explicit file/code references so worktree mode is enabled when the user
 * expects AI changes, but avoided for normal Q&A turns to keep latency low.
 */
function isLikelyEditIntent(inputText: string): boolean {
  const text = inputText.trim().toLowerCase();
  if (text === '') {
    return false;
  }
  if (/```/.test(text)) {
    return true;
  }
  if (/\b[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|java|kt|swift|json|md|css|html)\b/.test(text)) {
    return true;
  }
  if (/\b(src|tests?|package\.json|readme|dockerfile|tsconfig|vite\.config)\b/.test(text)) {
    return true;
  }
  return /\b(edit|patch|change|update|modify|refactor|rewrite|fix|implement|add|remove|rename|move|create)\b/.test(
    text,
  );
}

export function usePiSession(args: UsePiSessionArgs): UsePiSessionResult {
  const {
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
    onExtensionUi,
    onTurnDone,
  } = args;

  const streamDisposersRef = useRef<Array<() => void>>([]);
  const streamCompletedViaIpcRef = useRef(false);
  const [streamActivityLabel, setStreamActivityLabel] = useState('');

  const tearDownStreamIpc = useCallback((): void => {
    for (const d of streamDisposersRef.current) {
      try {
        d();
      } catch {
        // ignore
      }
    }
    streamDisposersRef.current = [];
  }, []);

  const abortMessage = useCallback((): void => {
    // Ask main to abort the in-flight Pi turn. We deliberately do NOT tear
    // down the IPC subscription here: main runs a streamlined finalize on
    // abort that still emits `pi-chat-stream-end`
    // (so the diff view appears for any partial edits), and a final
    // `pi-chat-done`. The subscription is torn down in the `onDone` handler
    // exactly as it is on natural completion.
    void invoke?.('pi-gui', { command: 'abort' });
    // Clear the per-message "streaming" indicator immediately so the thinking
    // loader in the chat row stops the moment the user clicks Stop. The
    // top-level `isStreaming` state stays true until
    // `pi-chat-stream-end` arrives, which keeps the Stop button responsive
    // and the input disabled while main commits the partial worktree.
    setMessages((prev) =>
      prev.map((m) => (m.role === 'assistant' && m.isStreaming ? { ...m, isStreaming: false } : m)),
    );
  }, [invoke, setMessages]);

  const sendMessage = useCallback(
    async (inputText: string): Promise<void> => {
      const text = inputText.trim();
      if (text === '' || !invoke || !subscribe) {
        return;
      }
      if (!hasOpenRouterKey) {
        setMessages((prev) => [
          ...prev,
          {
            id: `s-${Date.now()}`,
            role: 'system',
            content: 'Add your OpenRouter API key in Gruvie settings before sending messages.',
          },
        ]);
        return;
      }

      setInputText('');
      const withUser: AssistantMessage[] = [
        ...messages,
        { id: `u-${Date.now()}`, role: 'user', content: text },
        {
          id: `a-${Date.now() + 1}`,
          role: 'assistant',
          content: '',
          isStreaming: true,
        },
      ];
      flushSync(() => {
        setMessages(withUser);
        setIsStreaming(true);
      });
      const messagesPayload = transcriptLinesForSend(withUser);
      const streamingId = withUser[withUser.length - 1].id;
      // Main process enforces git-backed worktree mode for explicit repo workspaces.
      // Keep edit-intent heuristics as an additional hint for compatibility.
      const shouldUseWorktree = rootPath.trim() !== '' || isLikelyEditIntent(text);

      tearDownStreamIpc();
      streamCompletedViaIpcRef.current = false;
      setStreamActivityLabel('Starting…');
      const dispose = subscribe({
        onChunk: (chunk) => {
          setStreamActivityLabel('');
          const parsed = parsePiChatChunk(chunk);
          if (parsed.delta === '') {
            return;
          }
          if (parsed.kind === 'thinking') {
            appendThinkingToAssistantById(setMessages, streamingId, sanitizeAssistantChunk(parsed.delta));
          } else {
            appendTextToAssistantById(setMessages, streamingId, sanitizeAssistantChunk(parsed.delta));
          }
        },
        onActivity: (payload) => {
          const label = activityToLabel(payload);
          if (label !== '') {
            setStreamActivityLabel(label);
          }
        },
        onStreamEnd: (payload: PiChatStreamEndPayload) => {
          // Stop the streaming spinner the moment the model has produced its
          // final token. Post-turn work (worktree commit, QA) continues in
          // main and is reported via subsequent `onDone` and `onError` events
          // on the still-active
          // subscription. Without this signal, the spinner would visually
          // hang for the full duration of the QA/Git pipeline.
          void payload;
          setStreamActivityLabel('');
          setIsStreaming(false);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingId && m.role === 'assistant' ? { ...m, isStreaming: false } : m,
            ),
          );
        },
        ...(onExtensionUi ? { onExtensionUi } : {}),
        onTool: (toolEvent) => {
          const toolName = (toolEvent.tool ?? '').trim() !== '' ? toolEvent.tool : 'unknown';
          const preview = summarizeToolInput(toolName, toolEvent.inputPreview ?? '');
          appendTextToAssistantById(
            setMessages,
            streamingId,
            buildToolCard(toolName, `Tool running: ${toolName}`, preview, 'run'),
          );
        },
        onToolcallDelta: (payload: PiToolcallDeltaPayload) => {
          const delta = payload.delta;
          if (delta === '') {
            return;
          }
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === streamingId && m.role === 'assistant');
            if (idx === -1) {
              return prev;
            }
            const next = [...prev];
            const cur = next[idx];
            next[idx] = {
              ...cur,
              content: appendToToolCard(
                cur.content,
                'toolcall',
                'building',
                'Building tool call',
                delta,
              ),
            };
            return next;
          });
        },
        onToolUpdate: (payload: PiToolUpdatePayload) => {
          const toolName = payload.tool.trim() !== '' ? payload.tool : 'unknown';
          const compact = payload.output.trim().slice(0, 280);
          if (compact === '') {
            return;
          }
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === streamingId && m.role === 'assistant');
            if (idx === -1) {
              return prev;
            }
            const next = [...prev];
            const cur = next[idx];
            next[idx] = {
              ...cur,
              content: replaceOrAppendToolCard(
                cur.content,
                toolName,
                'update',
                `Tool updating: ${toolName}`,
                compact,
              ),
            };
            return next;
          });
        },
        onToolEnd: (toolEvent) => {
          const toolName = (toolEvent.tool ?? '').trim() !== '' ? toolEvent.tool : 'unknown';
          const output = summarizeToolResult(toolEvent.result ?? '');
          const reliabilityHint =
            typeof toolEvent.reliabilityHint === 'string' && toolEvent.reliabilityHint.trim() !== ''
              ? `\n${truncateText(toolEvent.reliabilityHint, 180)}`
              : '';
          const reliabilityStatus = (() => {
            const env = toolEvent.toolEnvelope;
            if (!env || env.ok) return '';
            if (env.adaptationApplied) {
              const conf = typeof env.adaptationConfidence === 'number' ? env.adaptationConfidence.toFixed(2) : 'n/a';
              return `\nStatus: adaptive correction applied (${env.adaptationType ?? 'unknown'}, confidence ${conf}).`;
            }
            if (env.retryDecisionReason === 'duplicate_failure_fingerprint') {
              return '\nStatus: repeated identical failure stopped to prevent a retry loop.';
            }
            if (env.suggestedAction === 'retry_with_structured_arguments') {
              return '\nStatus: retrying with structured fix.';
            }
            if (env.suggestedAction === 'stop_turn') {
              return '\nStatus: retry exhausted for this turn.';
            }
            return '';
          })();
          const title = toolEvent.isError ? `Tool failed: ${toolName}` : `Tool done: ${toolName}`;
          appendTextToAssistantById(
            setMessages,
            streamingId,
            buildToolCard(
              toolName,
              title,
              `${output}${reliabilityHint}${reliabilityStatus}`,
              toolEvent.isError ? 'err' : 'ok',
            ),
          );
          if (toolEvent.isError) {
          }
        },
        onError: (err) => {
          setStreamActivityLabel('');
          appendTextToAssistantById(
            setMessages,
            streamingId,
            `\n\n**Error:** ${formatPiUserMessage(err)}`,
          );
          setIsStreaming(false);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingId && m.role === 'assistant' ? { ...m, isStreaming: false } : m,
            ),
          );
          tearDownStreamIpc();
        },
        onDone: async (payload: PiChatDonePayload | unknown) => {
          streamCompletedViaIpcRef.current = true;
          const p = payload as PiChatDonePayload;
          const bucket = typeof p?.failureBucket === 'string' ? p.failureBucket : '';
          // Match shouldAppendTurnDiagnosticsLine in main/pi-tool-reliability/turnReliability.js (renderer cannot import it).
          const skipDupJsonGuard =
            p?.code === -1 && bucket === 'json_text_without_tool_event';
          if (bucket && bucket !== 'none' && !skipDupJsonGuard) {
            const human = bucket.replace(/_/g, ' ');
            const reason =
              typeof p.guardrailReason === 'string' && p.guardrailReason.trim() !== ''
                ? ` (${p.guardrailReason})`
                : '';
            appendTextToAssistantById(
              setMessages,
              streamingId,
              `\n\nTurn diagnostics: ${human}${reason}`,
            );
          }
          const qaSummary = p?.qaSummary;
          if (qaSummary && typeof qaSummary === 'object') {
            const qaRan = qaSummary.ran !== false;
            const tier = typeof qaSummary.tier === 'string' ? qaSummary.tier : 'unknown';
            const passed = qaSummary.passed === true;
            const failureType =
              typeof qaSummary.failureType === 'string' && qaSummary.failureType.trim() !== ''
                ? qaSummary.failureType
                : 'none';
            const steps = qaRan && Array.isArray(qaSummary.steps) ? qaSummary.steps : [];
            const failedStep = qaRan
              ? (steps.find(
                  (step) => step && typeof step === 'object' && (step as { status?: string }).status === 'failed',
                ) as { name?: string } | undefined)
              : undefined;
            const summary = !qaRan
              ? ''
              : passed
                ? `\n\nQA verification: passed (${tier}).`
                : `\n\nQA verification: failed (${tier}, ${failureType}${failedStep?.name ? `, step ${failedStep.name}` : ''}).`;
            appendTextToAssistantById(setMessages, streamingId, summary);
          }
          setStreamActivityLabel('');
          setIsStreaming(false);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingId && m.role === 'assistant' ? { ...m, isStreaming: false } : m,
            ),
          );
          if (p && typeof p === 'object') {
            await onTurnDone?.(p);
          }
          tearDownStreamIpc();
        },
      });
      streamDisposersRef.current.push(dispose);

      try {
        const res = (await invoke('pi-gui', {
          command: 'send-message',
          payload: {
            messages: messagesPayload,
            ...(rootPath.trim() !== '' ? { cwd: rootPath } : {}),
            model: modelInput.trim(),
            chatInstanceId,
            useWorktree: shouldUseWorktree,
            requestId: `rq-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          },
        })) as { ok: boolean; error?: string; sessionId?: string; idempotencyKey?: string };
        if (!res.ok && !streamCompletedViaIpcRef.current) {
          setStreamActivityLabel('');
          setIsStreaming(false);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingId && m.role === 'assistant' ? { ...m, isStreaming: false } : m,
            ),
          );
          tearDownStreamIpc();
          appendTextToAssistantById(
            setMessages,
            streamingId,
            `\n\n**Error:** ${formatPiUserMessage(res.error ?? 'Pi failed')}`,
          );
        }
      } catch (error) {
        setStreamActivityLabel('');
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingId && m.role === 'assistant' ? { ...m, isStreaming: false } : m,
          ),
        );
        tearDownStreamIpc();
        appendTextToAssistantById(
          setMessages,
          streamingId,
          `\n\n**Error:** ${formatPiUserMessage(error instanceof Error ? error.message : String(error))}`,
        );
      }
    },
    [
      hasOpenRouterKey,
      invoke,
      messages,
      modelInput,
      rootPath,
      setInputText,
      setIsStreaming,
      chatInstanceId,
      setMessages,
      subscribe,
      tearDownStreamIpc,
      onExtensionUi,
      onTurnDone,
    ],
  );

  return {
    sendMessage,
    abortMessage,
    tearDownStreamIpc,
    streamActivityLabel,
  };
}

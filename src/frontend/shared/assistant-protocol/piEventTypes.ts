export interface PiToolStartEvent {
  tool: string;
  inputPreview: string;
}

/** Payload on `pi-chat-toolcall-delta` — model is assembling tool call arguments. */
export interface PiToolcallDeltaPayload {
  delta: string;
}

/** Payload on `pi-chat-tool-update` — intermediate output during tool execution. */
export interface PiToolUpdatePayload {
  tool: string;
  output: string;
}

export interface PiToolEndEvent {
  tool: string;
  result: string;
  isError: boolean;
  reliabilityHint?: string;
  reliabilityMeta?: {
    schemaFailures?: number;
    repairedOnce?: boolean;
    repairCount?: number;
    repairCountByType?: Record<string, number>;
    errorType?: string | null;
    retriable?: boolean;
    retryDecisionReason?: string;
    failureFingerprint?: string;
    strategyShiftDetected?: boolean;
    adaptationApplied?: boolean;
    adaptationType?: string | null;
    adaptationConfidence?: number | null;
    adaptationBlockedReason?: string | null;
    normalizedArgs?: Record<string, unknown>;
    normalizationNotes?: string[];
    validationErrors?: Array<{ field: string; code: string; message: string }>;
  };
  toolEnvelope?: {
    toolName: string;
    ok: boolean;
    errorType: string | null;
    message: string;
    suggestedAction: string;
    missingFields: string[];
    exampleValidCall: string[];
    retriable: boolean;
    retryDecisionReason?: string;
    failureFingerprint?: string;
    strategyShiftDetected?: boolean;
    adaptationApplied?: boolean;
    adaptationType?: string | null;
    adaptationConfidence?: number | null;
    adaptationBlockedReason?: string | null;
  };
}

/** Pi RPC `extension_ui_request` forwarded from main (see coding-agent rpc-types). */
export type PiExtensionUiRequest = Record<string, unknown> & {
  type: 'extension_ui_request';
  id: string;
  method: string;
};

/** Payload on `pi-chat-done` after a Pi stream turn (success or failure). */
export interface PiChatDonePayload {
  code: number;
  requestId?: string;
  /** When true, the AI worktree created a new commit this turn — safe to auto-open merge review. */
  mergeAutoOpen?: boolean;
  mergeEventId?: string;
  failureBucket?: string;
  guardrailReason?: string;
  /** True when the turn ended because the user pressed Stop. */
  aborted?: boolean;
  jsonLikeTextDeltaCount?: number;
  toolStartCount?: number;
  toolValidationFailureCount?: number;
  toolRuntimeFailureCount?: number;
  worktreePrepareFailed?: boolean;
  checkpointFailed?: boolean;
  finalizeFailed?: boolean;
  qaSummary?: {
    ran: boolean;
    passed: boolean;
    tier: 'fast' | 'smoke' | 'full';
    failureType: string;
    stopReason: string;
    reportPath: string;
    steps: Array<{
      name: string;
      status: 'passed' | 'failed';
      exitCode: number;
      durationMs: number;
      failureType: string;
    }>;
  };
}

/**
 * Payload on `pi-chat-stream-end` — emitted as soon as the Pi child reports
 * `agent_end` (or the user aborts), before any post-turn work like worktree
 * commits or QA. The renderer uses this to clear its streaming spinner the
 * moment the model stops producing tokens, instead of waiting for the
 * terminal `pi-chat-done` payload.
 */
export interface PiChatStreamEndPayload {
  reason: 'completed' | 'aborted';
  requestId?: string;
}

/**
 * Main sends structured stream parts so the UI can interleave model "thinking"
 * with answer text and tool cards on the assistant content timeline. Legacy string chunks are treated as
 * answer text.
 */
export type PiChatChunkPayload = string | { kind: 'text' | 'thinking'; delta: string };

/** Lifecycle signals from Pi (waiting on model, compaction, retries) — not token content. */
export type PiChatActivityPayload = {
  kind:
    | 'agent_start'
    | 'turn_start'
    | 'turn_end'
    | 'compaction_start'
    | 'compaction_end'
    | 'auto_retry_start'
    | 'auto_retry_end'
    | 'queue_update';
  detail?: string;
};

export interface PiChatHandlers {
  onChunk?: (chunk: PiChatChunkPayload) => void;
  /** Non-token lifecycle updates while a turn is in flight. */
  onActivity?: (payload: PiChatActivityPayload) => void;
  /** Fires the moment the model stops producing tokens, before post-turn work. */
  onStreamEnd?: (payload: PiChatStreamEndPayload) => void;
  onDone?: (payload: PiChatDonePayload | unknown) => void;
  onError?: (err: string) => void;
  onTool?: (ev: PiToolStartEvent) => void;
  /** Model is assembling tool call arguments (streaming). */
  onToolcallDelta?: (payload: PiToolcallDeltaPayload) => void;
  /** Intermediate output during tool execution (bash stdout chunks, etc.). */
  onToolUpdate?: (payload: PiToolUpdatePayload) => void;
  onToolEnd?: (ev: PiToolEndEvent) => void;
  /** Pi needs `extension_ui_response` on stdin for confirm/select/input/editor. */
  onExtensionUi?: (ev: PiExtensionUiRequest) => void;
}

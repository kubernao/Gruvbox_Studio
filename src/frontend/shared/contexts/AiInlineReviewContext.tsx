import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { type AiChangedSection } from '../ai/extractAiChangedLinesFromUnifiedDiff';

/** Dispatched when user undoes inline AI review so dependent UI can reset state. */
export const AI_INLINE_REVIEW_CLEARED_EVENT = 'gruvbox-ai-inline-review-cleared';

export type AiInlineReviewSession = {
  sessionKey: string;
  absolutePath: string;
  repoPath: string;
  relativeFilePath: string;
  sourceBranch: string;
  targetBranch: string;
  baselineText: string;
  aiText: string;
  /** 1-based line numbers in the AI document to highlight */
  highlightedLines: readonly number[];
  /** Range metadata for each highlighted AI-change block. */
  highlightedSections: readonly AiChangedSection[];
  /** When true, EditorPane should open this path from aiText instead of disk */
  pendingApply: boolean;
};

type AiInlineReviewContextValue = {
  session: AiInlineReviewSession | null;
  /** After editor applied AI buffer */
  markApplied: () => void;
  updateSession: (updater: (prev: AiInlineReviewSession) => AiInlineReviewSession | null) => void;
  clearSession: () => void;
};

const AiInlineReviewContext = createContext<AiInlineReviewContextValue | undefined>(undefined);

export function AiInlineReviewProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AiInlineReviewSession | null>(null);

  const markApplied = useCallback(() => {
    setSession((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, pendingApply: false };
    });
  }, []);

  const updateSession = useCallback(
    (updater: (prev: AiInlineReviewSession) => AiInlineReviewSession | null) => {
      setSession((prev) => {
        if (!prev) {
          return prev;
        }
        return updater(prev);
      });
    },
    [],
  );

  const clearSession = useCallback(() => {
    setSession(null);
  }, []);

  const value = useMemo<AiInlineReviewContextValue>(
    () => ({
      session,
      markApplied,
      updateSession,
      clearSession,
    }),
    [session, markApplied, updateSession, clearSession],
  );

  return <AiInlineReviewContext.Provider value={value}>{children}</AiInlineReviewContext.Provider>;
}

export function useAiInlineReview(): AiInlineReviewContextValue {
  const ctx = useContext(AiInlineReviewContext);
  if (!ctx) {
    throw new Error('useAiInlineReview must be used within AiInlineReviewProvider');
  }
  return ctx;
}

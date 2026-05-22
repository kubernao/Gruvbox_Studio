/**
 * React hook that wires document metadata and editor callbacks into {@link createWebSpeechQueue}, exposes
 * playback controls for document listening modals, refreshes available voices when the browser fires
 * `voiceschanged`, and stops synthesis whenever the active file path changes so background narration never
 * tracks stale tabs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  chunkTextForSpeechUtterances,
  extractSpeakableText,
  isMarkdownLikeLanguage,
  markdownToSpeakablePlainText,
} from './extractSpeakableText';
import { extractPlainTextFromPdfPath } from './pdfExtractPlainText';
import { createWebSpeechQueue } from './webSpeechQueue';
import { IPCService } from '../../shared/utils/ipc';

export type DocumentSpeechPlayback = 'idle' | 'playing' | 'paused';

export type UseDocumentSpeechParams = {
  activeDocumentPath: string | null;
  language: string;
  fileType: 'text' | 'pdf';
  textContent: string;
  readSelectedEditorText: () => string | null;
};

export type DocumentSpeechUiState = {
  playback: DocumentSpeechPlayback;
  rate: number;
  voiceUri: string;
  voices: SpeechSynthesisVoice[];
  chunkIndex: number;
  chunkTotal: number;
  lastError: string | null;
};

const CLOUD_TTS_CHAR_LIMIT = 4096;

/**
 * Controls Web Speech playback for the middle editor, optional PDF extraction, and cloud MP3 export wiring.
 *
 * @param params - Active document identity plus snippets used to derive speakable prose.
 */
export function useDocumentSpeech(params: UseDocumentSpeechParams) {
  const queueRef = useRef(createWebSpeechQueue());
  const [playback, setPlayback] = useState<DocumentSpeechPlayback>('idle');
  const [rate, setRate] = useState(1);
  const [voiceUri, setVoiceUri] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [chunkTotal, setChunkTotal] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const refreshVoices = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return;
    }
    const next = window.speechSynthesis.getVoices();
    setVoices(next);
  }, []);

  useEffect(() => {
    refreshVoices();
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return;
    }
    window.speechSynthesis.onvoiceschanged = refreshVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [refreshVoices]);

  useEffect(() => {
    queueRef.current.stop();
    setPlayback('idle');
    setChunkIndex(0);
    setChunkTotal(0);
  }, [params.activeDocumentPath]);

  const selectedVoice = useMemo(() => {
    if (!voiceUri) {
      return null;
    }
    return voices.find((v) => v.voiceURI === voiceUri) ?? null;
  }, [voiceUri, voices]);

  const resolveSpeakableDocumentText = useCallback(async (): Promise<string> => {
    if (params.fileType === 'pdf' && params.activeDocumentPath) {
      return extractPlainTextFromPdfPath(params.activeDocumentPath);
    }
    return extractSpeakableText({
      content: params.textContent,
      language: params.language,
    });
  }, [params.activeDocumentPath, params.fileType, params.language, params.textContent]);

  const resolveSpeakableSelectionText = useCallback((): string => {
    const selected = params.readSelectedEditorText();
    if (!selected || selected.trim() === '') {
      return '';
    }
    const lang = params.language;
    if (isMarkdownLikeLanguage(lang)) {
      return markdownToSpeakablePlainText(selected);
    }
    return selected.replace(/\s+/g, ' ').trim();
  }, [params]);

  const beginChunks = useCallback(
    (plain: string): boolean => {
      if (plain.trim() === '') {
        setLastError('Nothing to read aloud.');
        return false;
      }
      setLastError(null);
      const chunks = chunkTextForSpeechUtterances(plain);
      if (chunks.length === 0) {
        setLastError('Nothing to read aloud.');
        return false;
      }
      setChunkTotal(chunks.length);
      setChunkIndex(0);
      setPlayback('playing');
      queueRef.current.speakChunks(
        chunks,
        { rate: Math.min(2, Math.max(0.5, rate)), voice: selectedVoice },
        {
          onChunkStart: (idx, total) => {
            setChunkIndex(idx + 1);
            setChunkTotal(total);
          },
          onEnd: () => {
            setPlayback('idle');
            setChunkIndex(0);
            setChunkTotal(0);
          },
        },
      );
      return true;
    },
    [rate, selectedVoice],
  );

  const listenDocument = useCallback(async (): Promise<boolean> => {
    try {
      const plain = await resolveSpeakableDocumentText();
      return beginChunks(plain);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
      return false;
    }
  }, [beginChunks, resolveSpeakableDocumentText]);

  const listenSelection = useCallback((): boolean => {
    const plain = resolveSpeakableSelectionText();
    return beginChunks(plain);
  }, [beginChunks, resolveSpeakableSelectionText]);

  const stopPlayback = useCallback(() => {
    queueRef.current.stop();
    setPlayback('idle');
    setChunkIndex(0);
    setChunkTotal(0);
  }, []);

  const togglePause = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!synth) {
      return;
    }
    if (playback === 'paused') {
      queueRef.current.resume();
      setPlayback('playing');
      return;
    }
    if (playback === 'playing') {
      queueRef.current.pause();
      setPlayback('paused');
    }
  }, [playback]);

  const exportCloudMp3 = useCallback(async (): Promise<{
    ok: boolean;
    outputPath?: string;
    canceled?: boolean;
    error?: string;
  }> => {
    setLastError(null);
    let plain: string;
    try {
      plain = await resolveSpeakableDocumentText();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
      return { ok: false, error: message };
    }
    const clipped = plain.slice(0, CLOUD_TTS_CHAR_LIMIT);
    const result = await IPCService.speechTtsProxy({
      text: clipped,
      voice: undefined,
      model: 'tts-1-hd',
      speed: 1,
    });
    if (!result.ok) {
      setLastError(result.error);
      return { ok: false, error: result.error };
    }
    if (!params.activeDocumentPath) {
      const message = 'Save requires an active file path.';
      setLastError(message);
      return { ok: false, error: message };
    }
    const save = await IPCService.editorExportFileCopy({
      sourcePath: params.activeDocumentPath,
      contentBase64: result.audioBase64,
    });
    if (save.canceled) {
      return { ok: false, canceled: true };
    }
    if (!save.outputPath) {
      const message = 'Could not save audio file.';
      setLastError(message);
      return { ok: false, error: message };
    }
    return { ok: true, outputPath: save.outputPath };
  }, [params.activeDocumentPath, resolveSpeakableDocumentText]);

  const ui: DocumentSpeechUiState = {
    playback,
    rate,
    voiceUri,
    voices,
    chunkIndex,
    chunkTotal,
    lastError,
  };

  return {
    ui,
    setRate,
    setVoiceUri,
    refreshVoices,
    listenDocument,
    listenSelection,
    stopPlayback,
    togglePause,
    exportCloudMp3,
  };
}

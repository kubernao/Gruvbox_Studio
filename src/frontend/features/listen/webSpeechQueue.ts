/**
 * Manages a FIFO queue of `SpeechSynthesisUtterance` instances so long documents play as sequential
 * paragraphs without blocking the UI thread. Handles pause, resume, and hard cancellation when the user
 * switches documents or stops playback, including clearing any pending utterances Chrome queues internally.
 */

export type WebSpeechQueueHandlers = {
  onChunkStart?: (index: number, total: number) => void;
  onChunkEnd?: (index: number, total: number) => void;
  onEnd?: () => void;
};

export type WebSpeechQueueController = {
  speakChunks: (
    chunks: string[],
    options: { rate: number; voice: SpeechSynthesisVoice | null },
    handlers?: WebSpeechQueueHandlers,
  ) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  getPaused: () => boolean;
};

/**
 * Builds a controller that forwards plain-text chunks to `window.speechSynthesis` using one utterance per chunk.
 */
export function createWebSpeechQueue(): WebSpeechQueueController {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  let chunksList: string[] = [];
  let chunkIndex = 0;
  let handlersRef: WebSpeechQueueHandlers | undefined;

  const speakNext = (options: { rate: number; voice: SpeechSynthesisVoice | null }): void => {
    if (!synth) {
      return;
    }
    if (chunkIndex >= chunksList.length) {
      handlersRef?.onEnd?.();
      handlersRef = undefined;
      chunksList = [];
      return;
    }
    const text = chunksList[chunkIndex];
    handlersRef?.onChunkStart?.(chunkIndex, chunksList.length);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = options.rate;
    if (options.voice) {
      u.voice = options.voice;
    }
    u.onend = () => {
      const endedIndex = chunkIndex;
      handlersRef?.onChunkEnd?.(endedIndex, chunksList.length);
      chunkIndex += 1;
      speakNext(options);
    };
    u.onerror = () => {
      chunkIndex = chunksList.length;
      handlersRef?.onEnd?.();
      handlersRef = undefined;
      chunksList = [];
    };
    synth.speak(u);
  };

  return {
    speakChunks(chunks, options, handlers) {
      if (!synth) {
        return;
      }
      synth.cancel();
      chunksList = chunks.filter((c) => c.trim() !== '');
      chunkIndex = 0;
      handlersRef = handlers;
      if (chunksList.length === 0) {
        handlers?.onEnd?.();
        return;
      }
      speakNext(options);
    },
    stop() {
      if (!synth) {
        return;
      }
      synth.cancel();
      chunksList = [];
      chunkIndex = 0;
      handlersRef = undefined;
    },
    pause() {
      synth?.pause();
    },
    resume() {
      synth?.resume();
    },
    getPaused() {
      return synth?.paused ?? false;
    },
  };
}

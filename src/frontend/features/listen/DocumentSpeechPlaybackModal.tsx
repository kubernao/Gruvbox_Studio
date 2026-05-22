/**
 * Small floating panel shown while document speech is active: draggable header, chunk progress, pause,
 * and stop. Hidden whenever playback returns to idle so the editor stays uncluttered after narration ends.
 */

import { Pause, Play, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DocumentSpeechPlayback, DocumentSpeechUiState } from './useDocumentSpeech';
import './DocumentSpeechPlaybackModal.css';

export type DocumentSpeechPlaybackModalProps = {
  playback: DocumentSpeechPlayback;
  ui: DocumentSpeechUiState;
  onPauseResume: () => void;
  onStop: () => void;
};

/**
 * Renders the movable mini-modal with pause/stop while speech is playing or paused.
 *
 * @param props - Playback phase, shared UI state, and transport handlers from {@link useDocumentSpeech}.
 */
export default function DocumentSpeechPlaybackModal(props: DocumentSpeechPlaybackModalProps) {
  const { playback, ui, onPauseResume, onStop } = props;
  const labelId = useId();
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const prevPlaybackRef = useRef<DocumentSpeechPlayback>('idle');

  useEffect(() => {
    if (playback !== 'idle' && prevPlaybackRef.current === 'idle') {
      setOffset({ x: 0, y: 0 });
    }
    prevPlaybackRef.current = playback;
  }, [playback]);

  const onPointerDownHandle = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  }, [offset.x, offset.y]);

  const onPointerMoveHandle = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d || event.pointerId !== d.pointerId) {
        return;
      }
      setOffset({
        x: d.originX + event.clientX - d.startX,
        y: d.originY + event.clientY - d.startY,
      });
    },
    [],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || event.pointerId !== d.pointerId) {
      return;
    }
    try {
      (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    } catch {
      // ignore if already released
    }
    dragRef.current = null;
  }, []);

  if (playback === 'idle') {
    return null;
  }

  const showProgress = ui.chunkTotal > 0;

  return (
    <div
      className="document-speech-playback-modal"
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelId}
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px)`,
      }}
    >
      <div
        id={labelId}
        className="document-speech-playback-modal-drag-handle"
        onPointerDown={onPointerDownHandle}
        onPointerMove={onPointerMoveHandle}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <Volume2 size={16} strokeWidth={2} aria-hidden="true" />
        Listening
      </div>
      <div className="document-speech-playback-modal-body">
        {showProgress ? (
          <p className="document-speech-playback-modal-progress" aria-live="polite">
            Part {ui.chunkIndex} / {ui.chunkTotal}
          </p>
        ) : null}
        <div className="document-speech-playback-modal-transport">
          <button
            type="button"
            onClick={onPauseResume}
            aria-label={playback === 'paused' ? 'Resume speech' : 'Pause speech'}
            title={playback === 'paused' ? 'Resume' : 'Pause'}
          >
            {playback === 'paused' ? <Play size={16} /> : <Pause size={16} />}
            <span>{playback === 'paused' ? 'Resume' : 'Pause'}</span>
          </button>
          <button type="button" onClick={onStop} aria-label="Stop speech" title="Stop">
            <Square size={16} />
            <span>Stop</span>
          </button>
        </div>
      </div>
    </div>
  );
}

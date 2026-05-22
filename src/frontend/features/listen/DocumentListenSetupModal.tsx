/**
 * Centered modal shown before Web Speech playback starts: choose voice and rate, then confirm or cancel.
 * Matches Gruvbox modal styling used elsewhere so listening stays consistent with audiobook generation.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import type { DocumentSpeechUiState } from './useDocumentSpeech';
import './DocumentListenSetupModal.css';

export type DocumentListenSetupModalProps = {
  isOpen: boolean;
  mode: 'document' | 'selection';
  ui: DocumentSpeechUiState;
  onRateChange: (rate: number) => void;
  onVoiceChange: (voiceUri: string) => void;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

/**
 * Presents voice and speed controls plus primary/cancel actions before narration begins.
 *
 * @param props - Visibility, listen scope (whole document vs selection), UI state from {@link useDocumentSpeech}, and callbacks.
 */
export default function DocumentListenSetupModal(props: DocumentListenSetupModalProps) {
  const { isOpen, mode, ui, onRateChange, onVoiceChange, onConfirm, onCancel } = props;
  const titleId = useId();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setBusy(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onCancel]);

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }, [onConfirm]);

  if (!isOpen) {
    return null;
  }

  const heading = mode === 'document' ? 'Listen to document' : 'Listen to selection';
  const description =
    mode === 'document'
      ? 'Pick a voice and speed, then start. Playback controls appear in a small floating panel while audio runs.'
      : 'Reads the current editor selection with your chosen voice and speed.';

  return (
    <div
      className="document-listen-setup-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="document-listen-setup-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="document-listen-setup-modal-title">
          {heading}
        </h2>
        <p className="document-listen-setup-modal-desc">{description}</p>

        <label className="document-listen-setup-modal-field">
          Voice
          <select
            value={ui.voiceUri}
            onChange={(event) => {
              onVoiceChange(event.target.value);
            }}
            aria-label="Speech voice"
          >
            <option value="">Default</option>
            {ui.voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name}
                {voice.lang ? ` (${voice.lang})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="document-listen-setup-modal-field">
          Speed
          <div className="document-listen-setup-modal-rate-row">
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={ui.rate}
              onChange={(event) => {
                onRateChange(Number(event.target.value));
              }}
              aria-label="Speech rate"
            />
            <span className="document-listen-setup-modal-rate-value">{ui.rate.toFixed(1)}×</span>
          </div>
        </label>

        {ui.lastError ? (
          <p className="document-listen-setup-modal-error" role="alert">
            {ui.lastError}
          </p>
        ) : null}

        <div className="document-listen-setup-modal-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="document-listen-setup-modal-primary"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={busy}
          >
            {busy ? 'Starting…' : 'Start listening'}
          </button>
        </div>
      </div>
    </div>
  );
}

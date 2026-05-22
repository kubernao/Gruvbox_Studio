/**
 * Modal workflow for cloud audiobook generation: choose neural model, speed, voice, and chapter split
 * strategy; pick an output folder; then stream progress from the main-process synthesizer until MP3
 * chapters and a manifest are written.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { AudiobookSplitMode } from './audiobookSegments';
import { buildAudiobookSegments } from './audiobookSegments';
import { extractPlainTextFromPdfPath } from './pdfExtractPlainText';
import { isMarkdownLikeLanguage } from './extractSpeakableText';
import { IPCService, type AudiobookExportProgressPayload } from '../../shared/utils/ipc';
import './AudiobookGenerationModal.css';

export type AudiobookGenerationModalProps = {
  isOpen: boolean;
  onClose: () => void;
  activeDocumentPath: string | null;
  language: string;
  fileType: 'text' | 'pdf';
  textContent: string;
  onExportSuccess?: (detail: { manifestPath: string; outputDir: string; chapterCount: number }) => void;
};

const MODEL_OPTIONS = [
  { value: 'tts-1', label: 'Standard (tts-1)' },
  { value: 'tts-1-hd', label: 'High definition (tts-1-hd)' },
];

const OPENAI_VOICE_OPTIONS = [
  { value: 'alloy', label: 'alloy' },
  { value: 'echo', label: 'echo' },
  { value: 'fable', label: 'fable' },
  { value: 'onyx', label: 'onyx' },
  { value: 'nova', label: 'nova' },
  { value: 'shimmer', label: 'shimmer' },
];

/**
 * Renders the audiobook export dialog and wires IPC progress plus folder selection.
 *
 * @param props - Document context, visibility, and optional completion callback for playlist hand-off.
 */
export default function AudiobookGenerationModal(props: AudiobookGenerationModalProps) {
  const {
    isOpen,
    onClose,
    activeDocumentPath,
    language,
    fileType,
    textContent,
    onExportSuccess,
  } = props;
  const titleId = useId();
  const descId = useId();

  const [splitMode, setSplitMode] = useState<AudiobookSplitMode>('chapters');
  const [openAiVoice, setOpenAiVoice] = useState('alloy');
  const [model, setModel] = useState('tts-1-hd');
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AudiobookExportProgressPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const generationIdRef = useRef<string | null>(null);

  const effectiveSplitMode: AudiobookSplitMode =
    fileType === 'pdf' || !isMarkdownLikeLanguage(language) ? 'flat' : splitMode;

  useEffect(() => {
    if (!isOpen) {
      setProgress(null);
      setError(null);
      setBusy(false);
      setGenerationId(null);
    }
  }, [isOpen]);

  const resolveSegments = useCallback(async () => {
    if (fileType === 'pdf') {
      if (!activeDocumentPath) {
        throw new Error('PDF path is missing.');
      }
      const plain = await extractPlainTextFromPdfPath(activeDocumentPath);
      return buildAudiobookSegments({
        rawContent: plain,
        language: 'plaintext',
        splitMode: 'flat',
      });
    }
    return buildAudiobookSegments({
      rawContent: textContent,
      language,
      splitMode: effectiveSplitMode,
    });
  }, [activeDocumentPath, effectiveSplitMode, fileType, language, textContent]);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setProgress(null);
    setBusy(true);
    let genId = '';
    let unsubscribe: (() => void) | null = null;
    try {
      const segments = await resolveSegments();
      if (segments.length === 0) {
        throw new Error('No speakable text after processing. Add content or adjust split mode.');
      }
      const folder = await IPCService.showOpenDialog();
      if (folder.canceled || !folder.filePaths?.[0]) {
        return;
      }
      const outputDir = folder.filePaths[0];
      genId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `ab-${Date.now()}`;
      setGenerationId(genId);
      generationIdRef.current = genId;

      unsubscribe = IPCService.subscribeAudiobookExportProgress((payload) => {
        if (payload.generationId === genId) {
          setProgress(payload);
        }
      });

      const result = await IPCService.audiobookExport({
        generationId: genId,
        outputDir,
        sourceDocumentPath: activeDocumentPath ?? '',
        segments,
        voice: openAiVoice,
        model,
        speed,
      });

      if (!result.ok) {
        if (result.cancelled) {
          setError('Export cancelled.');
        } else {
          setError(result.error ?? 'Export failed.');
        }
        return;
      }

      onExportSuccess?.({
        manifestPath: result.manifestPath,
        outputDir: result.outputDir,
        chapterCount: result.chapterCount,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      unsubscribe?.();
      setBusy(false);
      setGenerationId(null);
      generationIdRef.current = null;
    }
  }, [
    activeDocumentPath,
    model,
    onClose,
    onExportSuccess,
    resolveSegments,
    openAiVoice,
    speed,
  ]);

  const handleCancelExport = useCallback(async () => {
    const id = generationIdRef.current ?? generationId;
    if (id) {
      await IPCService.audiobookExportCancel(id);
    }
  }, [generationId]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="audiobook-modal-backdrop" role="presentation">
      <div
        className="audiobook-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h2 id={titleId} className="audiobook-modal-title">
          Generate audiobook (cloud)
        </h2>
        <p id={descId} className="audiobook-modal-desc">
          Neural MP3 chapters via OpenAI (add an OpenAI API key in Gruvie settings). PDFs use extracted text only—may not
          match visual layout.
        </p>

        <div className="audiobook-modal-grid">
          <label className="audiobook-modal-field">
            <span>Model</span>
            <select
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
              }}
              disabled={busy}
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="audiobook-modal-field">
            <span>Speed ({speed.toFixed(2)}×)</span>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.05}
              value={speed}
              onChange={(e) => {
                setSpeed(Number(e.target.value));
              }}
              disabled={busy}
            />
          </label>

          <label className="audiobook-modal-field audiobook-modal-field-span2">
            <span>OpenAI voice</span>
            <select
              value={openAiVoice}
              onChange={(e) => {
                setOpenAiVoice(e.target.value);
              }}
              disabled={busy}
            >
              {OPENAI_VOICE_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="audiobook-modal-field-span2 audiobook-modal-fieldset" disabled={busy}>
            <legend>Split</legend>
            <label className="audiobook-modal-radio">
              <input
                type="radio"
                name="ab-split"
                checked={effectiveSplitMode === 'chapters'}
                onChange={() => {
                  setSplitMode('chapters');
                }}
                disabled={fileType === 'pdf' || !isMarkdownLikeLanguage(language)}
              />
              Chapters (markdown headings)
            </label>
            <label className="audiobook-modal-radio">
              <input
                type="radio"
                name="ab-split"
                checked={effectiveSplitMode === 'flat'}
                onChange={() => {
                  setSplitMode('flat');
                }}
              />
              Flat (continuous prose parts)
            </label>
          </fieldset>
        </div>

        {progress ? (
          <p className="audiobook-modal-progress" aria-live="polite">
            {progress.phase === 'synthesizing'
              ? `Synthesizing ${progress.index}/${progress.total}${progress.segmentTitle ? `: ${progress.segmentTitle}` : ''}`
              : progress.phase === 'done'
                ? 'Done.'
                : `${progress.phase} ${progress.index}/${progress.total}`}
          </p>
        ) : null}

        {error ? (
          <p className="audiobook-modal-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="audiobook-modal-actions">
          <button type="button" className="audiobook-modal-btn secondary" onClick={onClose} disabled={busy}>
            Close
          </button>
          {busy ? (
            <button type="button" className="audiobook-modal-btn secondary" onClick={handleCancelExport}>
              Cancel export
            </button>
          ) : null}
          <button type="button" className="audiobook-modal-btn primary" onClick={handleGenerate} disabled={busy}>
            {busy ? 'Working…' : 'Choose folder & generate'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Lightweight player for the last exported audiobook manifest: reads JSON via IPC, resolves each
 * chapter file path, and plays through `HTMLAudioElement` with optional pause/resume on the active clip.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { filePathToFileUrlForMedia } from '../../shared/utils/fileUrlFromPath';
import { IPCService } from '../../shared/utils/ipc';
import { Pause, Play, SkipForward, Square } from 'lucide-react';
import './AudiobookPlaylistDock.css';

export type AudiobookPlaylistDockProps = {
  manifestPath: string | null;
  onClear?: () => void;
};

type ManifestV1 = {
  version: number;
  chapters?: Array<{ index: number; title?: string | null; file: string }>;
};

function dirnameFs(filePath: string): string {
  const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (i <= 0) {
    return '';
  }
  return filePath.slice(0, i);
}

function joinFs(dir: string, rel: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[/\\]+$/, '')}${sep}${rel.replace(/^[/\\]+/, '')}`;
}

/**
 * Renders compact controls when an export produced `audiobook-manifest.json`.
 *
 * @param props - Absolute manifest path or null to hide; optional dismiss handler.
 */
export default function AudiobookPlaylistDock(props: AudiobookPlaylistDockProps) {
  const { manifestPath, onClear } = props;
  const [manifest, setManifest] = useState<ManifestV1 | null>(null);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setManifest(null);
    setChapterIdx(0);
    setPlaying(false);
    audioRef.current?.pause();
    audioRef.current = null;
    if (!manifestPath) {
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const raw = await IPCService.readFile(manifestPath);
        const parsed = JSON.parse(raw) as ManifestV1;
        if (!cancelled && parsed?.version === 1 && Array.isArray(parsed.chapters)) {
          setManifest(parsed);
        }
      } catch {
        if (!cancelled) {
          setManifest(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manifestPath]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const chapters = manifest?.chapters ?? [];
  const dir = manifestPath ? dirnameFs(manifestPath) : '';

  const playChapterAt = useCallback(
    (idx: number) => {
      if (!dir || chapters.length === 0 || idx < 0 || idx >= chapters.length) {
        return;
      }
      const rel = chapters[idx]?.file;
      if (!rel) {
        return;
      }
      const abs = joinFs(dir, rel);
      const href = filePathToFileUrlForMedia(abs);
      audioRef.current?.pause();
      const audio = new Audio(href);
      audioRef.current = audio;
      audio.onended = () => {
        setPlaying(false);
      };
      void audio.play().then(() => {
        setPlaying(true);
      });
      setChapterIdx(idx);
    },
    [chapters, dir],
  );

  const togglePause = useCallback(() => {
    const a = audioRef.current;
    if (!a) {
      playChapterAt(chapterIdx);
      return;
    }
    if (a.paused) {
      void a.play().then(() => setPlaying(true));
    } else {
      a.pause();
      setPlaying(false);
    }
  }, [chapterIdx, playChapterAt]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
  }, []);

  if (!manifestPath || chapters.length === 0) {
    return null;
  }

  const title = chapters[chapterIdx]?.title ?? `Chapter ${chapterIdx + 1}`;

  return (
    <div className="audiobook-playlist-dock" role="region" aria-label="Exported audiobook playback">
      <span className="audiobook-playlist-label">Last export</span>
      <span className="audiobook-playlist-title" title={title}>
        {title}
      </span>
      <span className="audiobook-playlist-meta">
        {chapterIdx + 1}/{chapters.length}
      </span>
      <div className="audiobook-playlist-actions">
        <button
          type="button"
          className="audiobook-playlist-btn"
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
          onClick={togglePause}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          type="button"
          className="audiobook-playlist-btn"
          aria-label="Next chapter"
          title="Next chapter"
          disabled={chapterIdx >= chapters.length - 1}
          onClick={() => {
            stop();
            playChapterAt(Math.min(chapters.length - 1, chapterIdx + 1));
          }}
        >
          <SkipForward size={16} />
        </button>
        <button type="button" className="audiobook-playlist-btn" aria-label="Stop" title="Stop" onClick={stop}>
          <Square size={16} />
        </button>
        {onClear ? (
          <button type="button" className="audiobook-playlist-dismiss" onClick={onClear}>
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

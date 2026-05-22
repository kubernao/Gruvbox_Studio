import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, ListOrdered, PenLine, RefreshCw, Trash2, X } from 'lucide-react';
import { useFileExplorer } from '../explorer/useFileExplorer';
import './MemoryTab.css';

type MemoryStats = { count: number; lastUpdated: number | null };

type ProjectMemoryEntry = {
  id: string;
  kind: string;
  title: string;
  body: string;
  source: string;
  sourceRef: string;
  updatedAt: number;
};

/**
 * Invokes a command on the Electron memory-provider IPC bridge. All Memory tab
 * reads and writes go through this helper so the renderer never touches disk directly.
 */
async function invokeMemory(command: string, payload: Record<string, unknown> = {}): Promise<any> {
  const api = (window as any).electronAPI;
  if (!api?.invoke) {
    throw new Error('Electron invoke bridge unavailable.');
  }
  return api.invoke('memory-provider', { command, payload });
}

/**
 * Formats a project-memory entry timestamp for display in the Memory tab list.
 */
function formatLastUpdated(ts: number | null): string {
  if (!ts) return 'never';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return 'unknown';
  }
}

/**
 * Truncates long memory bodies so the entry list stays scannable in the sidebar.
 */
function truncateBody(body: string, maxLen = 120): string {
  const trimmed = body.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen).trimEnd()}…`;
}

const MemoryTab: React.FC = () => {
  const { rootPath, selectFile } = useFileExplorer();
  const [stats, setStats] = useState<MemoryStats>({ count: 0, lastUpdated: null });
  const [entries, setEntries] = useState<ProjectMemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rescanStatus, setRescanStatus] = useState('');
  const loadGenerationRef = useRef(0);

  const loadProjectMemory = useCallback(async () => {
    if (!rootPath) {
      setStats({ count: 0, lastUpdated: null });
      setEntries([]);
      return;
    }
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setLoading(true);
    try {
      const [statsRes, readRes] = await Promise.all([
        invokeMemory('project-stats', { rootPath }) as Promise<{
          ok: boolean;
          stats?: MemoryStats;
          error?: string;
        }>,
        invokeMemory('project-read', { rootPath }) as Promise<{
          ok: boolean;
          project?: { entries?: ProjectMemoryEntry[] };
          error?: string;
        }>,
      ]);
      if (loadGenerationRef.current !== generation) {
        return;
      }
      if (!statsRes.ok) {
        setError(statsRes.error ?? 'Failed to load project memory stats.');
        return;
      }
      if (!readRes.ok) {
        setError(readRes.error ?? 'Failed to load project memories.');
        return;
      }
      setError('');
      setStats(statsRes.stats ?? { count: 0, lastUpdated: null });
      const raw = Array.isArray(readRes.project?.entries) ? readRes.project.entries : [];
      const sorted = [...raw].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setEntries(sorted);
    } finally {
      if (loadGenerationRef.current === generation) {
        setLoading(false);
      }
    }
  }, [rootPath]);

  useEffect(() => {
    void loadProjectMemory().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [loadProjectMemory]);

  const openGlobalMemoryFile = useCallback(
    async (kind: 'style' | 'rules') => {
      setError('');
      try {
        const res = (await invokeMemory('global-ensure-paths')) as {
          ok: boolean;
          stylePath?: string;
          rulesPath?: string;
          error?: string;
        };
        if (!res.ok) {
          setError(res.error ?? 'Failed to resolve global memory paths.');
          return;
        }
        const target = kind === 'rules' ? res.rulesPath : res.stylePath;
        if (typeof target !== 'string' || target.trim() === '') {
          setError('Global memory path missing.');
          return;
        }
        selectFile(target);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [selectFile],
  );

  const clearProject = useCallback(async () => {
    if (!rootPath) return;
    const confirmed = window.confirm('Clear all AI-managed memories for this project? This cannot be undone.');
    if (!confirmed) return;
    setError('');
    const res = (await invokeMemory('project-clear', { rootPath })) as { ok: boolean; error?: string };
    if (!res.ok) {
      setError(res.error ?? 'Failed to clear project memory.');
      return;
    }
    setRescanStatus('');
    await loadProjectMemory();
  }, [loadProjectMemory, rootPath]);

  const deleteEntry = useCallback(
    async (entry: ProjectMemoryEntry) => {
      if (!rootPath) return;
      const confirmed = window.confirm(`Remove "${entry.title}" from project memory?`);
      if (!confirmed) return;
      setError('');
      const res = (await invokeMemory('project-delete-entry', { rootPath, id: entry.id })) as {
        ok: boolean;
        deleted?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(res.error ?? 'Failed to delete memory.');
        return;
      }
      await loadProjectMemory();
    },
    [loadProjectMemory, rootPath],
  );

  const requestRescan = useCallback(async () => {
    if (!rootPath) return;
    setError('');
    const res = (await invokeMemory('project-request-rescan', { rootPath })) as { ok: boolean; error?: string };
    if (!res.ok) {
      setError(res.error ?? 'Failed to schedule re-scan.');
      return;
    }
    setRescanStatus('Gruvie will review your project files on your next message.');
  }, [rootPath]);

  return (
    <div className="memory-tab">
      {error ? (
        <div className="memory-banner memory-banner--error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="memory-panel" aria-labelledby="memory-global-heading">
        <header className="memory-panel__header">
          <h2 id="memory-global-heading" className="memory-panel__title">
            Global memory
          </h2>
          <p className="memory-panel__subtitle">Applies to every project. Stored as Markdown; edit in the main editor.</p>
        </header>
        <ul className="memory-editor-links" role="list">
          <li>
            <button
              type="button"
              className="memory-editor-link"
              data-e2e-memory-open-style
              onClick={() => void openGlobalMemoryFile('style')}
            >
              <span className="memory-editor-link__icon" aria-hidden>
                <PenLine size={18} strokeWidth={1.75} />
              </span>
              <span className="memory-editor-link__body">
                <span className="memory-editor-link__label">Writing style</span>
                <span className="memory-editor-link__meta">style.md</span>
              </span>
              <ChevronRight className="memory-editor-link__chevron" size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </li>
          <li>
            <button
              type="button"
              className="memory-editor-link"
              data-e2e-memory-open-rules
              onClick={() => void openGlobalMemoryFile('rules')}
            >
              <span className="memory-editor-link__icon" aria-hidden>
                <ListOrdered size={18} strokeWidth={1.75} />
              </span>
              <span className="memory-editor-link__body">
                <span className="memory-editor-link__label">Writing rules</span>
                <span className="memory-editor-link__meta">rules.md</span>
              </span>
              <ChevronRight className="memory-editor-link__chevron" size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </li>
        </ul>
      </section>

      <section className="memory-panel memory-panel--project" aria-labelledby="memory-project-heading">
        <header className="memory-panel__header memory-panel__header--row">
          <div>
            <h2 id="memory-project-heading" className="memory-panel__title">
              Project memory
            </h2>
            <p className="memory-panel__subtitle">
              Facts Gruvie saves with Remember during chat. Injected into future messages for this workspace.
            </p>
          </div>
          {rootPath ? (
            <button
              type="button"
              className="memory-refresh-btn"
              title="Refresh list"
              aria-label="Refresh project memories"
              disabled={loading}
              onClick={() => void loadProjectMemory()}
            >
              <RefreshCw size={15} strokeWidth={1.75} className={loading ? 'memory-refresh-btn__spin' : undefined} aria-hidden />
            </button>
          ) : null}
        </header>

        {!rootPath ? (
          <p className="memory-empty-hint">Open a folder in the sidebar to see status and controls for this workspace.</p>
        ) : (
          <>
            <div className="memory-stat-card" role="status">
              <span className="memory-stat-card__value">{stats.count}</span>
              <span className="memory-stat-card__label">{stats.count === 1 ? 'saved memory' : 'saved memories'}</span>
              <span className="memory-stat-card__meta">Last update · {formatLastUpdated(stats.lastUpdated)}</span>
            </div>

            {entries.length > 0 ? (
              <ul className="memory-entry-list" role="list" aria-label="Project memories">
                {entries.map((entry) => (
                  <li key={entry.id} className="memory-entry">
                    <div className="memory-entry__header">
                      <span className="memory-entry__kind">{entry.kind || 'note'}</span>
                      <button
                        type="button"
                        className="memory-entry__delete"
                        aria-label={`Delete ${entry.title}`}
                        title="Delete memory"
                        onClick={() => void deleteEntry(entry)}
                      >
                        <X size={14} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                    <p className="memory-entry__title">{entry.title}</p>
                    {entry.body ? <p className="memory-entry__body">{truncateBody(entry.body)}</p> : null}
                    {entry.sourceRef ? (
                      <p className="memory-entry__ref">{entry.sourceRef}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="memory-empty-hint memory-empty-hint--inline">
                No project memories yet. Ask Gruvie to remember characters, places, or plot details, or use Re-scan below.
              </p>
            )}

            <div className="memory-project-actions">
              <button
                type="button"
                className="memory-action memory-action--danger"
                onClick={() => void clearProject()}
                disabled={stats.count === 0}
              >
                <Trash2 size={15} strokeWidth={1.75} aria-hidden />
                <span>Clear project memory</span>
              </button>
              <button type="button" className="memory-action memory-action--secondary" onClick={() => void requestRescan()}>
                <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
                <span>Re-scan project</span>
              </button>
            </div>
            {rescanStatus ? <p className="memory-rescan-toast">{rescanStatus}</p> : null}
          </>
        )}
      </section>
    </div>
  );
};

export default MemoryTab;

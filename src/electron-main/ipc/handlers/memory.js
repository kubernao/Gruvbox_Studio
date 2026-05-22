const path = require('node:path');
const {
  readGlobalMemory,
  writeGlobalMemory,
  ensureGlobalMemoryFiles,
  bootstrapProjectMemory,
  readProjectMemory,
  retrieveProjectMemory,
  getProjectStats,
  clearProjectEntries,
  deleteProjectEntry,
  requestProjectRescan,
} = require('../../memory/memory-service');

function normalizeRootPath(input) {
  return typeof input === 'string' && input.trim() !== '' ? path.resolve(input.trim()) : '';
}

/**
 * Strips embedding vectors from project-memory entries before IPC. Large float
 * arrays are unnecessary for the Memory tab UI and can freeze the renderer when
 * cloned across the Electron bridge on every refresh.
 */
function projectEntriesForUi(project) {
  const entries = Array.isArray(project?.entries) ? project.entries : [];
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    source: entry.source,
    sourceRef: entry.sourceRef,
    updatedAt: entry.updatedAt,
  }));
}

function registerMemoryHandlers(ipcMain, app) {
  ipcMain.handle('memory-provider', async (_event, request) => {
    const command = typeof request?.command === 'string' ? request.command : '';
    const payload = request?.payload ?? {};

    if (command === 'global-read') {
      const memory = await readGlobalMemory(app);
      return { ok: true, memory };
    }

    if (command === 'global-write') {
      const kind = payload?.kind === 'rules' ? 'rules' : 'style';
      const content = typeof payload?.content === 'string' ? payload.content : '';
      await writeGlobalMemory(app, kind, content);
      return { ok: true };
    }

    if (command === 'global-ensure-paths') {
      const paths = await ensureGlobalMemoryFiles(app);
      return { ok: true, ...paths };
    }

    if (command === 'project-bootstrap') {
      const rootPath = normalizeRootPath(payload?.rootPath);
      if (!rootPath) return { ok: false, error: 'Missing rootPath' };
      const result = await bootstrapProjectMemory(rootPath);
      return { ok: true, ...result };
    }

    if (command === 'project-read') {
      const rootPath = normalizeRootPath(payload?.rootPath);
      if (!rootPath) return { ok: false, error: 'Missing rootPath' };
      try {
        const project = await readProjectMemory(rootPath);
        const slimEntries = projectEntriesForUi(project);
        return { ok: true, project: { ...project, entries: slimEntries } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message || 'Failed to read project memory.' };
      }
    }

    if (command === 'project-stats') {
      const rootPath = normalizeRootPath(payload?.rootPath);
      if (!rootPath) return { ok: false, error: 'Missing rootPath' };
      try {
        const stats = await getProjectStats(rootPath);
        return { ok: true, stats };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message || 'Failed to read project memory stats.' };
      }
    }

    if (command === 'project-clear') {
      const rootPath = normalizeRootPath(payload?.rootPath);
      if (!rootPath) return { ok: false, error: 'Missing rootPath' };
      const result = await clearProjectEntries(rootPath);
      return { ok: true, ...result };
    }

    if (command === 'project-delete-entry') {
      const rootPath = normalizeRootPath(payload?.rootPath);
      if (!rootPath) return { ok: false, error: 'Missing rootPath' };
      const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
      if (!id) return { ok: false, error: 'Missing id' };
      const result = await deleteProjectEntry(rootPath, id);
      return { ok: true, ...result };
    }

    if (command === 'project-request-rescan') {
      const rootPath = normalizeRootPath(payload?.rootPath);
      if (!rootPath) return { ok: false, error: 'Missing rootPath' };
      const result = await requestProjectRescan(rootPath);
      return { ok: true, ...result };
    }

    if (command === 'project-retrieve') {
      const rootPath = normalizeRootPath(payload?.rootPath);
      if (!rootPath) return { ok: false, error: 'Missing rootPath' };
      const query = typeof payload?.query === 'string' ? payload.query : '';
      const retrieval = await retrieveProjectMemory(rootPath, query, payload ?? {});
      return { ok: true, retrieval };
    }

    return { ok: false, error: `Unknown memory command: ${command}` };
  });
}

module.exports = {
  registerMemoryHandlers,
};

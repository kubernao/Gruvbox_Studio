/**
 * toolContracts — required-field definitions and validation for AI tool calls.
 *
 * {@link CONTRACTS} maps tool names to their required argument fields.
 * {@link validateToolArgs} checks an argument object against those contracts
 * and returns `{ ok, missing, errors }`. {@link classifyError} turns a
 * validation result + tool result text into a stable error-type string used
 * by `retryPolicy.js` and surfaced in reliability KPI telemetry.
 *
 * Stateless pure functions; no IPC or file I/O.
 */

const { isPlausibleMergePath } = require('../../../utils/mergePathPolicy.cjs');

const PATH_TOOLS = new Set([
  'read',
  'write',
  'edit',
  'append_to_file',
  'prepend_to_file',
  'insert_at',
]);

const CONTRACTS = {
  read: { required: ['path'] },
  write: { required: ['path', 'content'] },
  edit: { required: ['path', 'edits'] },
  bash: { required: ['command'] },
  memory_remember: { required: ['kind', 'title', 'body'] },
  append_to_file: { required: ['path', 'content'] },
  prepend_to_file: { required: ['path', 'content'] },
  insert_at: { required: ['path', 'content', 'anchor'] },
  web_search: { required: ['query'] },
};

const EXAMPLES = {
  read: '{"path":"src/file.ts"}',
  write: '{"path":"src/file.ts","content":"<full file text>"}',
  edit: '{"path":"src/file.ts","edits":[{"oldText":"<exact text>","newText":"<replacement>"}]}',
  bash: '{"command":"git status"}',
  memory_remember: '{"kind":"fact","title":"Project convention","body":"Use descriptive commit messages"}',
  append_to_file:
    '{"path":"notes/chapter.md","content":"\\n## New section\\nYour paragraph here.","ensure_trailing_newline":true}',
  prepend_to_file: '{"path":"notes/chapter.md","content":"---\\ntitle: Draft\\n---\\n"}',
  insert_at:
    '{"path":"notes/chapter.md","content":"Inserted paragraph.\\n","anchor":{"line":12}}',
  web_search: '{"query":"Elixir Phoenix liveview testing best practices"}',
};

const MEMORY_KIND_ALIASES = {
  person: 'character',
  people: 'character',
  character_note: 'character',
  place: 'location',
  places: 'location',
  repo: 'thread',
  project: 'thread',
  context: 'thread',
  memo: 'note',
  notes: 'note',
  detail: 'fact',
  details: 'fact',
};

const MEMORY_VALID_KINDS = new Set(['character', 'location', 'thread', 'note', 'fact']);

const ALIASES = {
  file: 'path',
  filepath: 'path',
  filePath: 'path',
  contents: 'content',
  text: 'content',
  body: 'content',
  value: 'content',
  changes: 'edits',
  cmd: 'command',
  script: 'command',
  q: 'query',
  search: 'query',
  search_query: 'query',
};

const EDIT_FIELD_ALIASES = {
  old_text: 'oldText',
  oldtext: 'oldText',
  old_value: 'oldText',
  new_text: 'newText',
  newtext: 'newText',
  new_value: 'newText',
  start_line: 'startLine',
  end_line: 'endLine',
};

function coerceObject(input) {
  if (!input) return {};
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function unwrapArgs(raw) {
  const base = coerceObject(raw);
  const argumentsObj = coerceObject(base.arguments);
  if (Object.keys(argumentsObj).length > 0) {
    return { ...argumentsObj };
  }
  const inputObj = coerceObject(base.input);
  if (Object.keys(inputObj).length > 0) {
    return { ...inputObj };
  }
  return { ...base };
}

function normalizeToolArgs(toolName, raw) {
  const normalized = unwrapArgs(raw);
  const normalizationNotes = [];
  for (const [from, to] of Object.entries(ALIASES)) {
    if (normalized[to] === undefined && normalized[from] !== undefined) {
      normalized[to] = normalized[from];
      normalizationNotes.push(`${from}->${to}`);
    }
  }
  if (typeof normalized.path === 'string') {
    const originalPath = normalized.path;
    const cleanedPath = normalized.path
      .trim()
      .replaceAll('\\', '/')
      .replace(/\/{2,}/g, '/')
      .replace(/^\.\//, '');
    normalized.path = cleanedPath;
    if (cleanedPath !== originalPath) {
      normalizationNotes.push('path:cleaned');
    }
  }
  if (toolName === 'edit') {
    if (typeof normalized.edits === 'string') {
      try {
        const parsed = JSON.parse(normalized.edits);
        if (Array.isArray(parsed)) {
          normalized.edits = parsed;
          normalizationNotes.push('edits:string->array');
        }
      } catch {
        // keep original for downstream diagnostics
      }
    }
    if (
      typeof normalized.oldText === 'string'
      && typeof normalized.newText === 'string'
    ) {
      const current = Array.isArray(normalized.edits) ? normalized.edits : [];
      normalized.edits = [...current, { oldText: normalized.oldText, newText: normalized.newText }];
      delete normalized.oldText;
      delete normalized.newText;
      normalizationNotes.push('legacy_oldText_newText->edits[]');
    }
    if (Array.isArray(normalized.edits)) {
      normalized.edits = normalized.edits.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return entry;
        }
        const item = { ...entry };
        for (const [from, to] of Object.entries(EDIT_FIELD_ALIASES)) {
          if (item[to] === undefined && item[from] !== undefined) {
            item[to] = item[from];
            normalizationNotes.push(`edit.${from}->${to}`);
          }
        }
        return item;
      });
    }
  }
  if (toolName === 'bash' && typeof normalized.command === 'string') {
    const cmd = normalized.command.trim();
    if (cmd !== normalized.command) {
      normalizationNotes.push('command:trim');
      normalized.command = cmd;
    }
  }
  if (toolName === 'memory_remember') {
    if (typeof normalized.content === 'string' && (normalized.body === undefined || normalized.body === null)) {
      normalized.body = normalized.content;
      normalizationNotes.push('content->body');
    }
    if (typeof normalized.kind === 'string') {
      const originalKind = normalized.kind;
      const canonicalKind = originalKind.trim().toLowerCase();
      if (canonicalKind !== originalKind) {
        normalized.kind = canonicalKind;
        normalizationNotes.push('kind:canonicalized');
      }
      const mappedKind = MEMORY_KIND_ALIASES[normalized.kind];
      if (mappedKind) {
        normalized.kind = mappedKind;
        normalizationNotes.push(`kind:${canonicalKind}->${mappedKind}`);
      }
    }
    if (typeof normalized.title === 'string') {
      const trimmedTitle = normalized.title.trim();
      if (trimmedTitle !== normalized.title) {
        normalized.title = trimmedTitle;
        normalizationNotes.push('title:trim');
      }
    }
    if (typeof normalized.body === 'string') {
      const trimmedBody = normalized.body.trim();
      if (trimmedBody !== normalized.body) {
        normalized.body = trimmedBody;
        normalizationNotes.push('body:trim');
      }
    }
  }
  return { normalized, normalizationNotes };
}

function addFieldError(errors, field, code, message) {
  errors.push({ field, code, message });
}

function validateInsertAtAnchor(anchor, errors) {
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) {
    addFieldError(errors, 'anchor', 'invalid_type', 'anchor must be an object');
    return;
  }
  const linePresent = anchor.line !== undefined && anchor.line !== null;
  const afterPresent = typeof anchor.afterText === 'string';
  const beforePresent = typeof anchor.beforeText === 'string';
  let count = 0;
  if (linePresent) count += 1;
  if (afterPresent) count += 1;
  if (beforePresent) count += 1;
  if (count !== 1) {
    addFieldError(errors, 'anchor', 'invalid_shape', 'set exactly one of: line, afterText, beforeText');
    return;
  }
  if (linePresent) {
    if (!Number.isFinite(anchor.line)) {
      addFieldError(errors, 'anchor.line', 'invalid_type', 'line must be a finite number');
    } else if (Math.trunc(anchor.line) < 1) {
      addFieldError(errors, 'anchor.line', 'invalid_range', 'line must be >= 1');
    }
  }
  if (afterPresent && anchor.afterText.trim() === '') {
    addFieldError(errors, 'anchor.afterText', 'empty', 'afterText must be non-empty');
  }
  if (beforePresent && anchor.beforeText.trim() === '') {
    addFieldError(errors, 'anchor.beforeText', 'empty', 'beforeText must be non-empty');
  }
}

function validateEditEdits(edits, errors) {
  if (!Array.isArray(edits) || edits.length === 0) {
    addFieldError(errors, 'edits', 'invalid_type', 'edits must be a non-empty array');
    return;
  }
  edits.forEach((edit, idx) => {
    const base = `edits[${idx}]`;
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) {
      addFieldError(errors, base, 'invalid_type', 'edit item must be an object');
      return;
    }
    const hasOldText = typeof edit.oldText === 'string' && edit.oldText.trim() !== '';
    const hasNewText = typeof edit.newText === 'string';
    const hasRange = Number.isInteger(edit.startLine) && Number.isInteger(edit.endLine);
    if (hasOldText && !hasNewText) {
      addFieldError(errors, `${base}.newText`, 'required', 'newText is required when oldText is provided');
    }
    if (!hasOldText && !hasRange) {
      addFieldError(
        errors,
        base,
        'invalid_shape',
        'each edit must provide oldText/newText pair or explicit startLine/endLine range',
      );
    }
    if (hasRange && typeof edit.newText !== 'string') {
      addFieldError(errors, `${base}.newText`, 'required', 'newText is required with range edits');
    }
  });
}

function validateToolArgs(toolName, args) {
  const contract = CONTRACTS[toolName];
  if (!contract) {
    return { ok: true, missing: [], errors: [] };
  }
  const missing = [];
  const errors = [];
  for (const field of contract.required) {
    const value = args[field];
    if (value === undefined || value === null) {
      missing.push(field);
      addFieldError(errors, field, 'required', `${field} is required`);
      continue;
    }
    if (typeof value === 'string' && value.trim() === '') {
      missing.push(field);
      addFieldError(errors, field, 'empty', `${field} must be a non-empty string`);
    }
    if (field === 'edits' && !Array.isArray(value)) {
      missing.push(field);
      addFieldError(errors, field, 'invalid_type', 'edits must be an array');
    }
  }
  if (toolName === 'write' && typeof args.content !== 'string') {
    addFieldError(errors, 'content', 'invalid_type', 'content must be a string');
  }
  if (toolName === 'read' && typeof args.path !== 'string') {
    addFieldError(errors, 'path', 'invalid_type', 'path must be a string');
  }
  if (toolName === 'edit') {
    validateEditEdits(args.edits, errors);
  }
  if (toolName === 'insert_at') {
    validateInsertAtAnchor(args.anchor, errors);
  }
  if (toolName === 'memory_remember') {
    if (typeof args.kind !== 'string') {
      addFieldError(errors, 'kind', 'invalid_type', 'kind must be a string');
    } else if (!MEMORY_VALID_KINDS.has(args.kind)) {
      addFieldError(
        errors,
        'kind',
        'invalid_enum',
        'kind must be one of: character, location, thread, note, fact',
      );
    }
    if (typeof args.title !== 'string') {
      addFieldError(errors, 'title', 'invalid_type', 'title must be a string');
    }
    if (typeof args.body !== 'string') {
      addFieldError(errors, 'body', 'invalid_type', 'body must be a string');
    }
  }
  if (PATH_TOOLS.has(toolName) && typeof args.path === 'string' && args.path.trim() !== '') {
    if (!isPlausibleMergePath(args.path)) {
      addFieldError(
        errors,
        'path',
        'implausible_path',
        'path looks like a bare word, not a file path (include a directory or extension)',
      );
    }
  }
  return { ok: missing.length === 0 && errors.length === 0, missing, errors };
}

function requiredFields(toolName) {
  return CONTRACTS[toolName]?.required ?? [];
}

function knownTools() {
  return Object.keys(CONTRACTS);
}

function exampleArgs(toolName) {
  return EXAMPLES[toolName] ?? '{}';
}

function buildToolSchemaSteer(tools = knownTools()) {
  const normalizedTools = Array.from(new Set((Array.isArray(tools) ? tools : []).filter((t) => CONTRACTS[t])));
  const list = normalizedTools.length > 0 ? normalizedTools : knownTools();
  const lines = ['Tool argument contract (must be exact):'];
  for (const tool of list) {
    lines.push(`- ${tool}: ${exampleArgs(tool)}`);
  }
  lines.push('Never emit a JSON object in assistant text when you intend a tool call; emit an actual tool call event.');
  lines.push('For each tool call, include all required fields exactly in the first attempt.');
  lines.push('If required fields are missing, fix the arguments and emit a corrected tool call immediately.');
  return lines.join('\n');
}

module.exports = {
  normalizeToolArgs,
  validateToolArgs,
  requiredFields,
  knownTools,
  exampleArgs,
  buildToolSchemaSteer,
};

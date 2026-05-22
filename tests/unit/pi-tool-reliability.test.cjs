const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeToolArgs,
  validateToolArgs,
  buildToolSchemaSteer,
} = require('../../src/electron-main/ipc/handlers/pi-tool-reliability/toolContracts');
const {
  classifyError,
  shouldRetry,
} = require('../../src/electron-main/ipc/handlers/pi-tool-reliability/retryPolicy');

test('normalizes aliases and unwraps nested arguments', () => {
  const { normalized, normalizationNotes } = normalizeToolArgs('write', {
    arguments: { file: 'foo.txt', contents: 'hello' },
  });
  assert.equal(normalized.path, 'foo.txt');
  assert.equal(normalized.content, 'hello');
  assert.deepEqual(normalizationNotes.sort(), ['contents->content', 'file->path'].sort());
});

test('normalizes additional wrapper aliases and path cleanup', () => {
  const { normalized, normalizationNotes } = normalizeToolArgs('write', {
    input: { filePath: '.\\src\\\\file.ts', value: 'hello' },
  });
  assert.equal(normalized.path, 'src/file.ts');
  assert.equal(normalized.content, 'hello');
  assert.equal(normalizationNotes.includes('filePath->path'), true);
  assert.equal(normalizationNotes.includes('path:cleaned'), true);
});

test('normalizes write content aliases from top-level input wrapper', () => {
  const { normalized, normalizationNotes } = normalizeToolArgs('write', {
    input: { filepath: 'story.md', body: 'Once upon a time' },
  });
  assert.equal(normalized.path, 'story.md');
  assert.equal(normalized.content, 'Once upon a time');
  assert.ok(normalizationNotes.includes('filepath->path'));
  assert.ok(normalizationNotes.includes('body->content'));
});

test('write validation fails clearly when content is missing', () => {
  const invalid = validateToolArgs('write', { path: 'story.md' });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.missing.includes('content'));
  assert.ok(invalid.errors.some((e) => e.field === 'content' && e.code === 'required'));
});

test('write validation fails when content is non-string', () => {
  const invalid = validateToolArgs('write', { path: 'story.md', content: { bad: true } });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((e) => e.field === 'content' && e.code === 'invalid_type'));
});

test('edit contract enforces nested edit structure', () => {
  const invalid = validateToolArgs('edit', { path: 'a.ts', edits: [{}] });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((e) => e.code === 'invalid_shape'));
});

test('retry policy classifies validation errors and caps retries', () => {
  const validation = validateToolArgs('write', { path: 'x.ts' });
  const cls = classifyError({ validation, resultText: 'Validation failed for tool write', isToolError: true });
  assert.equal(cls.errorType, 'validation_error');
  assert.equal(shouldRetry({ errorType: cls.errorType, attempts: 0 }), true);
  assert.equal(shouldRetry({ errorType: cls.errorType, attempts: 1 }), false);
});

test('retry policy classifies not found and does not retry', () => {
  const cls = classifyError({
    validation: { ok: true, missing: [], errors: [] },
    resultText: 'File not found: story.md',
    isToolError: true,
  });
  assert.equal(cls.errorType, 'not_found');
  assert.equal(shouldRetry({ errorType: cls.errorType, attempts: 0 }), false);
});

test('retry policy classifies transient errors', () => {
  const cls = classifyError({
    validation: { ok: true, missing: [], errors: [] },
    resultText: 'Service temporarily unavailable (timeout)',
    isToolError: true,
  });
  assert.equal(cls.errorType, 'transient_error');
  assert.equal(shouldRetry({ errorType: cls.errorType, attempts: 1 }), true);
  assert.equal(shouldRetry({ errorType: cls.errorType, attempts: 2 }), false);
});

test('retry policy classifies workspace drift for ENOENT under cwd', () => {
  const cls = classifyError({
    validation: { ok: true, missing: [], errors: [] },
    resultText: 'spawn ENOENT: no such file or directory, chdir /repo/worktree',
    isToolError: true,
    effectiveCwd: '/repo/worktree',
  });
  assert.equal(cls.errorType, 'workspace_drift');
  assert.equal(shouldRetry({ errorType: cls.errorType, attempts: 0 }), true);
  assert.equal(shouldRetry({ errorType: cls.errorType, attempts: 1 }), false);
});

test('retry policy keeps not_found for normal file ENOENT', () => {
  const cls = classifyError({
    validation: { ok: true, missing: [], errors: [] },
    resultText: 'ENOENT: no such file or directory, open /repo/worktree/missing.md',
    isToolError: true,
    effectiveCwd: '/repo/worktree',
  });
  assert.equal(cls.errorType, 'not_found');
});

test('retry policy classifies binary/non-text read errors and does not retry', () => {
  const cls = classifyError({
    validation: { ok: true, missing: [], errors: [] },
    resultText: 'File appears binary and is not text-decodable',
    isToolError: true,
  });
  assert.equal(cls.errorType, 'binary_file');
  assert.equal(shouldRetry({ errorType: cls.errorType, attempts: 0 }), false);
});

test('classifyError returns null for non-tool errors', () => {
  const cls = classifyError({
    validation: { ok: false, missing: ['content'], errors: [] },
    resultText: 'Validation failed',
    isToolError: false,
  });
  assert.equal(cls.errorType, null);
  assert.equal(cls.retriable, false);
});

test('forensics: repeated write calls with only path exhaust validation retries', () => {
  const attempts = [];
  for (let i = 0; i < 5; i += 1) {
    const { normalized } = normalizeToolArgs('write', { path: 'story.md' });
    const validation = validateToolArgs('write', normalized);
    const cls = classifyError({
      validation,
      resultText: 'Validation failed for tool "write": content required',
      isToolError: true,
    });
    attempts.push({
      validationOk: validation.ok,
      errorType: cls.errorType,
      retryAllowed: shouldRetry({ errorType: cls.errorType, attempts: i }),
    });
  }
  assert.deepEqual(attempts.map((a) => a.validationOk), [false, false, false, false, false]);
  assert.deepEqual(attempts.map((a) => a.errorType), [
    'validation_error',
    'validation_error',
    'validation_error',
    'validation_error',
    'validation_error',
  ]);
  assert.deepEqual(attempts.map((a) => a.retryAllowed), [true, false, false, false, false]);
});

test('edit normalization accepts legacy top-level oldText/newText', () => {
  const { normalized, normalizationNotes } = normalizeToolArgs('edit', {
    path: 'src/file.ts',
    oldText: 'before',
    newText: 'after',
  });
  assert.equal(Array.isArray(normalized.edits), true);
  assert.equal(normalized.edits.length, 1);
  assert.equal(normalized.edits[0].oldText, 'before');
  assert.equal(normalized.edits[0].newText, 'after');
  assert.equal(normalizationNotes.includes('legacy_oldText_newText->edits[]'), true);
});

test('edit normalization parses stringified edits array', () => {
  const { normalized, normalizationNotes } = normalizeToolArgs('edit', {
    path: 'src/file.ts',
    edits: '[{"oldText":"x","newText":"y"}]',
  });
  assert.equal(Array.isArray(normalized.edits), true);
  assert.equal(normalized.edits[0].oldText, 'x');
  assert.equal(normalizationNotes.includes('edits:string->array'), true);
});

test('edit normalization accepts snake_case edit field aliases', () => {
  const { normalized, normalizationNotes } = normalizeToolArgs('edit', {
    path: 'src/file.ts',
    edits: [
      {
        old_text: 'before',
        new_text: 'after',
      },
    ],
  });
  assert.equal(normalized.edits[0].oldText, 'before');
  assert.equal(normalized.edits[0].newText, 'after');
  assert.equal(normalizationNotes.includes('edit.old_text->oldText'), true);
  assert.equal(normalizationNotes.includes('edit.new_text->newText'), true);
});

test('forensics: content survives nested stringified argument payload', () => {
  const payload = JSON.stringify({
    arguments: {
      path: 'story.md',
      content: 'chapter one',
    },
  });
  const { normalized } = normalizeToolArgs('write', payload);
  const validation = validateToolArgs('write', normalized);
  assert.equal(normalized.path, 'story.md');
  assert.equal(normalized.content, 'chapter one');
  assert.equal(validation.ok, true);
});

test('forensics: invalid json argument payload drops content and fails validation', () => {
  const payload = '{"arguments":{"path":"story.md","content":"broken"';
  const { normalized } = normalizeToolArgs('write', payload);
  const validation = validateToolArgs('write', normalized);
  assert.deepEqual(normalized, {});
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes('content'));
  assert.ok(validation.missing.includes('path'));
});

test('buildToolSchemaSteer includes all tool contracts and first-attempt rules', () => {
  const steer = buildToolSchemaSteer();
  assert.equal(steer.includes('- read:'), true);
  assert.equal(steer.includes('- write:'), true);
  assert.equal(steer.includes('- edit:'), true);
  assert.equal(steer.includes('- bash:'), true);
  assert.equal(steer.includes('first attempt'), true);
});

test('memory_remember normalization canonicalizes kind aliases and trims fields', () => {
  const { normalized, normalizationNotes } = normalizeToolArgs('memory_remember', {
    kind: ' Person ',
    title: '  Team convention  ',
    body: '  Keep functions single-purpose.  ',
  });
  assert.equal(normalized.kind, 'character');
  assert.equal(normalized.title, 'Team convention');
  assert.equal(normalized.body, 'Keep functions single-purpose.');
  assert.equal(normalizationNotes.includes('kind:canonicalized'), true);
  assert.equal(normalizationNotes.includes('kind:person->character'), true);
});

test('memory_remember validation rejects invalid enum kind', () => {
  const invalid = validateToolArgs('memory_remember', {
    kind: 'project_note',
    title: 'Team convention',
    body: 'Keep functions single-purpose.',
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((e) => e.field === 'kind' && e.code === 'invalid_enum'));
});

test('memory_remember validation requires non-empty title/body', () => {
  const invalid = validateToolArgs('memory_remember', {
    kind: 'fact',
    title: ' ',
    body: '',
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((e) => e.field === 'title' && e.code === 'empty'));
  assert.ok(invalid.errors.some((e) => e.field === 'body' && e.code === 'empty'));
});

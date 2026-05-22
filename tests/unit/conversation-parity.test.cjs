const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeModelFacingContent,
  buildConversationPrompt,
} = require('../../src/electron-main/ipc/handlers/pi-tool-reliability/conversationParity');

test('sanitizeModelFacingContent strips display-only GVX tokens', () => {
  const raw = 'Model text\n\n[[GVX_TOOL:ok:Tool%20done:Output%20hidden]]\n\nMore text';
  const cleaned = sanitizeModelFacingContent(raw);
  assert.equal(cleaned.includes('GVX_TOOL'), false);
  assert.equal(cleaned, 'Model text\n\nMore text');
});

test('sanitizeModelFacingContent strips leaked assistant tool-arg json blobs', () => {
  const raw = 'I will do it now\n{"path":"src/file.ts","edits":[{"oldText":"a","newText":"b"}]}\nDone';
  const cleaned = sanitizeModelFacingContent(raw);
  assert.equal(cleaned.includes('"path"'), false);
  assert.equal(cleaned, 'I will do it now\n\nDone');
});

test('buildConversationPrompt keeps recent conversation semantics', () => {
  const prompt = buildConversationPrompt([
    { role: 'user', content: 'Read story.md' },
    { role: 'assistant', content: 'Working on it.\n\n[[GVX_TOOL:ok:x:y]]' },
    { role: 'user', content: 'Now summarize in 3 bullets' },
  ]);
  assert.equal(prompt.includes('GVX_TOOL'), false);
  assert.equal(prompt.includes('[user] Read story.md'), true);
  assert.equal(prompt.includes('[assistant] Working on it.'), true);
  assert.equal(prompt.includes('[user] Now summarize in 3 bullets'), true);
});


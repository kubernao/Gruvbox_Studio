const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

describe('Monaco diff viewer styling (source contracts)', () => {
  it('MonacoDiffEditor disables line numbers and enables word wrap', () => {
    const src = read('src/frontend/components/DiffViewer/MonacoDiffEditor.tsx');
    assert.match(src, /lineNumbers:\s*'off'/);
    assert.match(src, /wordWrap:\s*'on'/);
    assert.match(src, /diffWordWrap:\s*'on'/);
  });

  it('Monaco theme uses app bg-primary hex for editor surfaces', () => {
    const src = read('src/frontend/components/DiffViewer/utils/monacoGruvboxTheme.ts');
    assert.match(src, /const editorSurround = readRootCssVar\('--bg-editor-surround', '#181b1c'\)/);
    assert.match(src, /'editor\.background':\s*editorSurround/);
    assert.match(src, /'editorGutter\.background':\s*editorSurround/);
  });

  it('DiffViewer.css defines pane gap and bg-primary overrides under meld-diff-editor-slot', () => {
    const src = read('src/frontend/components/DiffViewer/DiffViewer.css');
    assert.match(src, /\.meld-diff-editor-slot \.monaco-diff-editor\.side-by-side \.editor\.modified/);
    assert.match(src, /left:\s*calc\(50%\s*\+\s*12\.5px\)\s*!important/);
    assert.match(src, /\.meld-diff-editor-slot \.monaco-editor-background/);
    assert.match(src, /background:\s*var\(--bg\)\s*!important/);
  });
});

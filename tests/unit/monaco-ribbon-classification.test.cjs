const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

describe('Monaco meld ribbon classification (source contracts)', () => {
  it('exports ribbonKindFromLineChange with planned branch order', () => {
    const src = read('src/frontend/components/DiffViewer/utils/monacoDiffMeldRibbon.ts');
    assert.match(src, /export function ribbonKindFromLineChange/);
    assert.match(src, /modifiedEndLineNumber === 0[\s\S]*?return ['"]del['"]/);
    assert.match(src, /originalEndLineNumber === 0[\s\S]*?return ['"]ins['"]/);
    assert.match(src, /return ['"]change['"]/);
  });

  it('paintMonacoDiffRibbons sets diff-ribbon classes (no inline stroke)', () => {
    const src = read('src/frontend/components/DiffViewer/utils/monacoDiffMeldRibbon.ts');
    assert.match(src, /path\.setAttribute\(['"]class['"],\s*cls\)/);
    assert.match(src, /diff-ribbon-\$\{kind\}/);
    assert.ok(!/path\.setAttribute\(['"]stroke['"]/.test(src));
    assert.ok(!/path\.setAttribute\(['"]opacity['"]/.test(src));
  });

  it('DiffViewer.css defines ribbon classes for diff and current highlights', () => {
    const src = read('src/frontend/components/DiffViewer/DiffViewer.css');
    assert.match(src, /\.diff-ribbon-del/);
    assert.match(src, /\.diff-ribbon-ins/);
    assert.match(src, /\.diff-ribbon-change/);
    assert.match(src, /\.diff-ribbon-current/);
  });
});

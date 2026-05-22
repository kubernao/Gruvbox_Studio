const test = require('node:test');
const assert = require('node:assert/strict');

const {
  chooseExportDimensionsFromSvgMarkup,
  computePaddingForBBoxSize,
  mergeRasterDimensions,
  replaceMermaidSvgsWithPngDataUri,
} = require('../../src/electron-main/ipc/mermaid-export-rasterizer');

/** Matches renderer export ids: 32 lowercase hex + index (see markdownPreviewHtml). */
const SAMPLE_NONCE = 'a1b2c3d4e5f678901234567890abcdef';
const mermaidSvgId = (index) => `gruvbox-docs-mermaid-${SAMPLE_NONCE}-${index}`;

test('chooseExportDimensionsFromSvgMarkup uses viewBox when width/height absent', () => {
  const dims = chooseExportDimensionsFromSvgMarkup(
    `<svg id="${mermaidSvgId(1)}" viewBox="0 0 640 480"><g></g></svg>`,
  );
  assert.equal(dims.width, 640);
  assert.equal(dims.height, 480);
});

test('chooseExportDimensionsFromSvgMarkup prefers viewBox when attrs conflict in aspect ratio', () => {
  const svg =
    `<svg id="${mermaidSvgId(0)}" width="300" height="150" viewBox="0 0 1200 800"><g></g></svg>`;
  const dims = chooseExportDimensionsFromSvgMarkup(svg);
  assert.equal(dims.width, 1200);
  assert.equal(dims.height, 800);
});

test('chooseExportDimensionsFromSvgMarkup uses attrs when aspect matches viewBox', () => {
  const svg =
    `<svg id="${mermaidSvgId(0)}" width="600" height="400" viewBox="0 0 1200 800"><g></g></svg>`;
  const dims = chooseExportDimensionsFromSvgMarkup(svg);
  assert.equal(dims.width, 600);
  assert.equal(dims.height, 400);
});

test('computePaddingForBBoxSize returns at least 8 and scales with diagram size', () => {
  assert.equal(computePaddingForBBoxSize(10, 10), 8);
  assert.equal(computePaddingForBBoxSize(200, 200), 10);
});

test('mergeRasterDimensions takes max of bbox padded, hints, and naturals', () => {
  const merged = mergeRasterDimensions({
    paddedFromBBoxW: 400,
    paddedFromBBoxH: 300,
    hintW: 100,
    hintH: 100,
    naturalW: 350,
    naturalH: 280,
  });
  assert.equal(merged.width, 400);
  assert.equal(merged.height, 300);
});

test('replaceMermaidSvgsWithPngDataUri converts mermaid svg to png img', async () => {
  const html = `<p>before</p><svg id="${mermaidSvgId(0)}" viewBox="0 0 300 150"><g></g></svg><p>after</p>`;
  const result = await replaceMermaidSvgsWithPngDataUri(html, {
    convertSvgToPngDataUri: async () => 'data:image/png;base64,ZmFrZQ==',
  });
  assert.equal(result.convertedCount, 1);
  assert.match(result.html, /<img[^>]*data-mermaid-rasterized="true"/);
  assert.match(result.html, /width="300"/);
  assert.match(result.html, /height="150"/);
  assert.doesNotMatch(result.html, /<svg id="gruvbox-docs-mermaid-/);
});

test('replaceMermaidSvgsWithPngDataUri uses dimensions from raster result object', async () => {
  const html = `<svg id="${mermaidSvgId(1)}" viewBox="0 0 10 10"><g></g></svg>`;
  const result = await replaceMermaidSvgsWithPngDataUri(html, {
    convertSvgToPngDataUri: async () => ({
      dataUri: 'data:image/png;base64,ZmFrZQ==',
      width: 900,
      height: 450,
    }),
  });
  assert.equal(result.convertedCount, 1);
  assert.match(result.html, /width="900"/);
  assert.match(result.html, /height="450"/);
});

test('replaceMermaidSvgsWithPngDataUri leaves non-mermaid svg untouched', async () => {
  const html = '<svg id="plain-svg" viewBox="0 0 40 40"><circle cx="10" cy="10" r="5" /></svg>';
  const result = await replaceMermaidSvgsWithPngDataUri(html, {
    convertSvgToPngDataUri: async () => 'data:image/png;base64,ZmFrZQ==',
  });
  assert.equal(result.convertedCount, 0);
  assert.equal(result.html, html);
});

test('replaceMermaidSvgsWithPngDataUri ignores legacy ids without 32-hex nonce', async () => {
  const html = '<p>before</p><svg id="gruvbox-docs-mermaid-0" viewBox="0 0 300 150"><g></g></svg><p>after</p>';
  const result = await replaceMermaidSvgsWithPngDataUri(html, {
    convertSvgToPngDataUri: async () => 'data:image/png;base64,ZmFrZQ==',
  });
  assert.equal(result.convertedCount, 0);
  assert.equal(result.html, html);
});

test('replaceMermaidSvgsWithPngDataUri falls back to original svg on rasterization error', async () => {
  const svg = `<svg id="${mermaidSvgId(2)}" viewBox="0 0 100 40"><g></g></svg>`;
  const result = await replaceMermaidSvgsWithPngDataUri(svg, {
    convertSvgToPngDataUri: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(result.convertedCount, 0);
  assert.ok(result.warnings.length >= 1);
  assert.equal(result.html, svg);
});

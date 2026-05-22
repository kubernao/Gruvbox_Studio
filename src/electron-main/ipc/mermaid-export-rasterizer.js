/**
 * Export only treats SVG roots whose id matches docs Mermaid output:
 * gruvbox-docs-mermaid-<32 lowercase hex><-<diagram index>. This avoids
 * rasterizing arbitrary user HTML that reused a looser prefix, and matches
 * the render id from markdownPreviewHtml (32-char hex nonce per export).
 *
 * Alternatives considered (see plan): Resvg/sharp give deterministic rasterization
 * but vary on foreignObject/CSS; Playwright screenshots are faithful but heavy for
 * every export. Hidden BrowserWindow + canvas stays the default until a concrete
 * gap (e.g. systematic filter loss) justifies swapping.
 */
const MERMAID_SVG_PATTERN =
  /<svg\b[^>]*\bid=(["'])gruvbox-docs-mermaid-[0-9a-f]{32}-\d+\1[^>]*>[\s\S]*?<\/svg>/gi;

/** Max relative aspect-ratio difference to treat width/height attrs as consistent with viewBox. */
const ASPECT_MATCH_EPSILON = 0.02;

function toFinitePositiveNumber(value) {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseViewBoxDimensions(svgMarkup) {
  const viewBoxAttr = svgMarkup.match(/\bviewBox=(["'])(.*?)\1/i)?.[2] ?? '';
  if (!viewBoxAttr.trim()) {
    return null;
  }
  const parts = viewBoxAttr.trim().split(/\s+/).map((value) => Number.parseFloat(value));
  if (parts.length !== 4 || !Number.isFinite(parts[2]) || !Number.isFinite(parts[3])) {
    return null;
  }
  const vbWidth = parts[2];
  const vbHeight = parts[3];
  if (!(vbWidth > 0 && vbHeight > 0)) {
    return null;
  }
  return { width: vbWidth, height: vbHeight };
}

function parseNumericSvgAttrs(svgMarkup) {
  const widthAttr = svgMarkup.match(/\bwidth=(["'])(.*?)\1/i)?.[2] ?? '';
  const heightAttr = svgMarkup.match(/\bheight=(["'])(.*?)\1/i)?.[2] ?? '';
  return {
    width: toFinitePositiveNumber(widthAttr),
    height: toFinitePositiveNumber(heightAttr),
  };
}

/**
 * Choose logical width/height for export display and as raster fallback when
 * naturalWidth/naturalHeight are unavailable. Prefer viewBox when it conflicts
 * with numeric width/height (common Mermaid output).
 */
function chooseExportDimensionsFromSvgMarkup(svgMarkup) {
  const vb = parseViewBoxDimensions(svgMarkup);
  const { width: attrW, height: attrH } = parseNumericSvgAttrs(svgMarkup);

  if (vb) {
    if (attrW && attrH) {
      const rAttr = attrW / attrH;
      const rVb = vb.width / vb.height;
      const relDiff = Math.abs(rAttr - rVb) / Math.max(rVb, 1e-9);
      if (relDiff <= ASPECT_MATCH_EPSILON) {
        return { width: attrW, height: attrH };
      }
    }
    return { width: vb.width, height: vb.height };
  }
  if (attrW && attrH) {
    return { width: attrW, height: attrH };
  }
  if (attrW) {
    return { width: attrW, height: 800 };
  }
  if (attrH) {
    return { width: 1200, height: attrH };
  }
  return { width: 1200, height: 800 };
}

/**
 * Padding around SVG geometry for raster export (strokes, markers, slight overflow).
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function computePaddingForBBoxSize(width, height) {
  if (!(width > 0) || !(height > 0)) {
    return 8;
  }
  return Math.max(8, 0.05 * Math.max(width, height));
}

/**
 * @param {{ paddedFromBBoxW: number; paddedFromBBoxH: number; hintW: number; hintH: number; naturalW: number; naturalH: number }} c
 * @returns {{ width: number; height: number }}
 */
function mergeRasterDimensions(c) {
  const nw = c.naturalW > 0 ? c.naturalW : 0;
  const nh = c.naturalH > 0 ? c.naturalH : 0;
  return {
    width: Math.max(c.paddedFromBBoxW || 0, c.hintW, nw, 1),
    height: Math.max(c.paddedFromBBoxH || 0, c.hintH, nh, 1),
  };
}

function buildPngImgTag(dataUri, dimensions) {
  const safeWidth = Math.max(1, Math.round(dimensions.width));
  const safeHeight = Math.max(1, Math.round(dimensions.height));
  return `<img src="${dataUri}" alt="Mermaid diagram" width="${safeWidth}" height="${safeHeight}" style="max-width:100%;height:auto;" data-mermaid-rasterized="true" />`;
}

async function replaceMermaidSvgsWithPngDataUri(html, options) {
  const source = typeof html === 'string' ? html : '';
  const convertSvgToPngDataUri =
    typeof options?.convertSvgToPngDataUri === 'function' ? options.convertSvgToPngDataUri : null;
  if (!convertSvgToPngDataUri) {
    throw new Error('convertSvgToPngDataUri is required.');
  }
  const matches = [...source.matchAll(MERMAID_SVG_PATTERN)];
  if (matches.length === 0) {
    return { html: source, convertedCount: 0, warnings: [] };
  }

  let output = '';
  let cursor = 0;
  let convertedCount = 0;
  const warnings = [];

  for (const match of matches) {
    const fullMatch = match[0];
    const index = match.index ?? 0;
    output += source.slice(cursor, index);
    try {
      const converted = await convertSvgToPngDataUri(fullMatch);
      let dataUri;
      let displayDims;
      if (typeof converted === 'string') {
        dataUri = converted;
        displayDims = chooseExportDimensionsFromSvgMarkup(fullMatch);
      } else if (converted && typeof converted === 'object' && typeof converted.dataUri === 'string') {
        dataUri = converted.dataUri;
        displayDims =
          typeof converted.width === 'number' &&
          typeof converted.height === 'number' &&
          converted.width > 0 &&
          converted.height > 0
            ? { width: converted.width, height: converted.height }
            : chooseExportDimensionsFromSvgMarkup(fullMatch);
      } else {
        throw new Error('Invalid rasterization result.');
      }
      output += buildPngImgTag(dataUri, displayDims);
      convertedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Mermaid rasterization failed: ${message}`);
      output += fullMatch;
    }
    cursor = index + fullMatch.length;
  }
  output += source.slice(cursor);

  return { html: output, convertedCount, warnings };
}

/**
 * Rasterize SVG to PNG. Canvas size follows decoded intrinsic size
 * (naturalWidth/naturalHeight) with chooseExportDimensionsFromSvgMarkup as fallback.
 * @returns {Promise<{ dataUri: string; width: number; height: number }>}
 */
async function rasterizeSvgToPngDataUri(BrowserWindow, svgMarkup, scale = 2) {
  const svgJson = JSON.stringify(svgMarkup);
  const hints = chooseExportDimensionsFromSvgMarkup(svgMarkup);
  const hintW = Math.max(1, Math.round(hints.width));
  const hintH = Math.max(1, Math.round(hints.height));
  const pixelScale = Math.max(1, Number(scale) || 2);
  const tempWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  });
  try {
    await tempWindow.loadURL('data:text/html;charset=utf-8,<html><body></body></html>');
    const result = await tempWindow.webContents.executeJavaScript(`
      (() => {
        return new Promise((resolve, reject) => {
          const svgText = ${svgJson};
          const hintW = ${hintW};
          const hintH = ${hintH};
          const scale = ${pixelScale};
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = svgText;
          const svg = tempDiv.querySelector('svg');
          if (!svg) {
            reject(new Error('No svg element in Mermaid markup'));
            return;
          }
          let bboxOk = false;
          let bx = 0;
          let by = 0;
          let bw = 0;
          let bh = 0;
          try {
            document.body.appendChild(svg);
            const b = svg.getBBox();
            bx = b.x;
            by = b.y;
            bw = b.width;
            bh = b.height;
            bboxOk = bw > 0 && bh > 0;
          } catch (_) {
            /* ignore */
          } finally {
            if (svg.parentNode) {
              svg.parentNode.removeChild(svg);
            }
          }
          let pad = 8;
          let paddedW = 0;
          let paddedH = 0;
          if (bboxOk) {
            pad = Math.max(8, 0.05 * Math.max(bw, bh));
            const vbW = bw + 2 * pad;
            const vbH = bh + 2 * pad;
            const vbX = bx - pad;
            const vbY = by - pad;
            svg.setAttribute('viewBox', vbX + ' ' + vbY + ' ' + vbW + ' ' + vbH);
            svg.removeAttribute('width');
            svg.removeAttribute('height');
            paddedW = Math.ceil(vbW);
            paddedH = Math.ceil(vbH);
          }
          const serialized = svg.outerHTML;
          const img = new Image();
          const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          img.onload = () => {
            try {
              const nw = img.naturalWidth;
              const nh = img.naturalHeight;
              const w = Math.max(paddedW || 0, hintW, nw > 0 ? nw : 0, 1);
              const h = Math.max(paddedH || 0, hintH, nh > 0 ? nh : 0, 1);
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(w * scale));
              canvas.height = Math.max(1, Math.round(h * scale));
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                reject(new Error('Canvas 2D context unavailable'));
                return;
              }
              ctx.scale(scale, scale);
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, w, h);
              ctx.drawImage(img, 0, 0, w, h);
              resolve({
                dataUri: canvas.toDataURL('image/png'),
                width: w,
                height: h,
              });
            } catch (error) {
              reject(error);
            } finally {
              URL.revokeObjectURL(url);
            }
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load SVG into image'));
          };
          img.src = url;
        });
      })();
    `);
    if (
      !result ||
      typeof result.dataUri !== 'string' ||
      !result.dataUri.startsWith('data:image/png;base64,')
    ) {
      throw new Error('SVG rasterization returned invalid PNG data.');
    }
    const width = Number(result.width);
    const height = Number(result.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      throw new Error('SVG rasterization returned invalid dimensions.');
    }
    return { dataUri: result.dataUri, width, height };
  } finally {
    if (!tempWindow.isDestroyed()) {
      tempWindow.destroy();
    }
  }
}

async function rasterizeMermaidSvgsInHtml(html, options) {
  const BrowserWindow = options?.BrowserWindow;
  if (!BrowserWindow) {
    throw new Error('BrowserWindow is required for Mermaid rasterization.');
  }
  const scale = Number(options?.scale) || 2;
  return replaceMermaidSvgsWithPngDataUri(html, {
    convertSvgToPngDataUri: (svgMarkup) => rasterizeSvgToPngDataUri(BrowserWindow, svgMarkup, scale),
  });
}

module.exports = {
  parseViewBoxDimensions,
  parseNumericSvgAttrs,
  chooseExportDimensionsFromSvgMarkup,
  computePaddingForBBoxSize,
  mergeRasterDimensions,
  replaceMermaidSvgsWithPngDataUri,
  rasterizeMermaidSvgsInHtml,
};

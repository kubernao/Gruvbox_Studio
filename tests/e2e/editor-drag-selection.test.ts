import { test, expect } from '@playwright/test';
import * as path from 'path';
import { launchElectronApp } from './helpers/electronApp';

type SelectionProbe = {
  codemirrorNonempty: boolean;
  nativeNonempty: boolean;
  codemirrorSliceLen: number;
};

async function readSelectionAfterDrag(
  page: import('@playwright/test').Page,
  editorRootSelector: string = '.markdown-codemirror-root'
): Promise<SelectionProbe> {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel) as
      | (HTMLElement & {
          gruvboxEditorView?: {
            state: {
              selection: { main: { from: number; to: number } };
              sliceDoc: (a: number, b: number) => string;
            };
          };
        })
      | null;
    const view = root?.gruvboxEditorView;
    let codemirrorSliceLen = 0;
    if (view) {
      const { from, to } = view.state.selection.main;
      if (from < to) {
        codemirrorSliceLen = view.state.sliceDoc(from, to).trim().length;
      }
    }
    const sel = window.getSelection();
    const nativeNonempty =
      !!(sel && sel.rangeCount > 0 && sel.toString().trim().length > 0);
    return {
      codemirrorNonempty: codemirrorSliceLen > 0,
      nativeNonempty,
      codemirrorSliceLen,
    };
  }, editorRootSelector);
}

test.describe('Editor click-drag selection', () => {
  test.describe.configure({ timeout: 120_000 });

  test('can select text in markdown editor by dragging (horizontal)', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');

    const { app, page } = await launchElectronApp({ fixtureRoot });

    const hasE2eBridge = await page.evaluate(
      () =>
        typeof (window as unknown as { electronAPI?: { e2eGetFixtureRoot?: unknown } }).electronAPI
          ?.e2eGetFixtureRoot === 'function'
    );
    expect(hasE2eBridge).toBe(true);

    await page.locator('[data-e2e-file-name="a.md"]').click({ timeout: 60_000 });
    await expect(page.locator('[data-editor-loading="reading"]')).toHaveCount(0, { timeout: 20_000 });

    const cmContent = page.locator('.markdown-codemirror-root .cm-content');
    await expect(cmContent).toBeVisible({ timeout: 15_000 });

    const box = await cmContent.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      await app.close();
      return;
    }

    const startX = box.x + 12;
    const startY = box.y + Math.min(box.height / 2, 24);
    const endX = box.x + Math.min(box.width - 8, 220);
    const endY = startY;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();

    await expect.poll(async () => (await readSelectionAfterDrag(page)).codemirrorSliceLen).toBeGreaterThan(0);

    const probe = await readSelectionAfterDrag(page);
    expect(
      probe.codemirrorNonempty || probe.nativeNonempty,
      `Expected non-empty selection (codemirror len=${probe.codemirrorSliceLen})`
    ).toBe(true);

    await app.close();
  });

  test('can select across lines in rich markdown (vertical drag)', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');

    const { app, page } = await launchElectronApp({ fixtureRoot });

    await page.locator('[data-e2e-file-name="rich-selection.md"]').click({ timeout: 60_000 });
    await expect(page.locator('[data-editor-loading="reading"]')).toHaveCount(0, { timeout: 20_000 });

    const cmContent = page.locator('.markdown-codemirror-root .cm-content');
    await expect(cmContent).toBeVisible({ timeout: 15_000 });

    const box = await cmContent.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      await app.close();
      return;
    }

    const startX = box.x + 16;
    const startY = box.y + 14;
    const endX = box.x + Math.min(box.width - 12, 280);
    const endY = box.y + Math.min(box.height - 16, 100);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 12 });
    await page.mouse.up();

    await expect.poll(async () => (await readSelectionAfterDrag(page)).codemirrorSliceLen).toBeGreaterThan(0);

    const probe = await readSelectionAfterDrag(page);
    expect(
      probe.codemirrorNonempty || probe.nativeNonempty,
      `Expected multi-line non-empty selection (codemirror len=${probe.codemirrorSliceLen})`
    ).toBe(true);

    await app.close();
  });

  test('can select text in code editor by dragging (compare with markdown stack)', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');

    const { app, page } = await launchElectronApp({ fixtureRoot });

    await page.locator('[data-e2e-file-name="hello.js"]').click({ timeout: 60_000 });
    await expect(page.locator('[data-editor-loading="reading"]')).toHaveCount(0, { timeout: 20_000 });

    const cmContent = page.locator('.code-codemirror-root .cm-content');
    await expect(cmContent).toBeVisible({ timeout: 15_000 });

    const box = await cmContent.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      await app.close();
      return;
    }

    const startX = box.x + 10;
    const startY = box.y + Math.min(box.height / 2, 28);
    const endX = box.x + Math.min(box.width - 8, 200);
    const endY = startY;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();

    await expect.poll(async () => (await readSelectionAfterDrag(page, '.code-codemirror-root')).codemirrorSliceLen).toBeGreaterThan(0);

    const probe = await readSelectionAfterDrag(page, '.code-codemirror-root');
    expect(
      probe.codemirrorNonempty || probe.nativeNonempty,
      `Expected code editor non-empty selection (codemirror len=${probe.codemirrorSliceLen})`
    ).toBe(true);

    await app.close();
  });
});

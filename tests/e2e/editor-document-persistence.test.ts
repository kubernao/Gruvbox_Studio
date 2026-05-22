import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { launchElectronApp } from './helpers/electronApp';

test.describe('Editor document persistence (E2E)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('dirty buffer survives switching files in the explorer', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
    const { app, page } = await launchElectronApp({ fixtureRoot });
    try {
      await expect(page.locator('#root')).toBeVisible({ timeout: 20_000 });

      await page.locator('[data-e2e-file-name="a.md"]').first().click({ timeout: 60_000 });
      await expect(page.locator('[data-editor-loading="reading"]')).toHaveCount(0, { timeout: 20_000 });

      const cmContent = page.locator('.markdown-codemirror-root .cm-content');
      await expect(cmContent).toBeVisible({ timeout: 15_000 });
      await cmContent.click();
      const marker = ` PERSIST_${Date.now()}`;
      await page.keyboard.type(marker);

      await page.locator('[data-e2e-file-name="b.md"]').first().click({ timeout: 30_000 });
      await expect(page.getByText('B file only', { exact: false })).toBeVisible({ timeout: 15_000 });

      await page.locator('[data-e2e-file-name="a.md"]').first().click({ timeout: 30_000 });
      await expect(cmContent).toBeVisible({ timeout: 15_000 });

      const docText = await page.evaluate(() => {
        const root = document.querySelector('.markdown-codemirror-root') as
          | (HTMLElement & { gruvboxEditorView?: { state: { doc: { toString: () => string } } } })
          | null;
        return root?.gruvboxEditorView?.state.doc.toString() ?? '';
      });
      expect(docText).toContain(marker.trim());
    } finally {
      await app.close();
    }
  });
});

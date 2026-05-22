import { test, expect } from '@playwright/test';
import { launchElectronApp } from './helpers/electronApp';

type OverflowIssue = {
  selector: string;
  text: string;
  clientWidth: number;
  scrollWidth: number;
};

test.describe('Visual critical UI checks', () => {
  test.describe.configure({ timeout: 120_000 });

  test('core chrome does not show clipped interactive labels', async () => {
    const { app, page } = await launchElectronApp();
    try {
      await expect(page.locator('.app-root')).toBeVisible();
      await page.locator('[data-e2e-file-name="a.md"]').click({ timeout: 60_000 });
      await expect(page.locator('[data-editor-loading="reading"]')).toHaveCount(0, { timeout: 20_000 });

      const issues = await page.evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            '.app-toolbar button, .sidebar button, [data-e2e-file-name], .document-tabs button'
          )
        );
        const result: OverflowIssue[] = [];

        for (const node of candidates) {
          const style = window.getComputedStyle(node);
          const mayClipText = style.overflowX !== 'visible' || style.textOverflow === 'ellipsis' || style.whiteSpace === 'nowrap';
          if (!mayClipText) {
            continue;
          }
          if (node.scrollWidth > node.clientWidth + 2) {
            result.push({
              selector: node.className || node.tagName.toLowerCase(),
              text: (node.textContent || '').trim().slice(0, 60),
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
            });
          }
        }

        return result;
      });

      expect(issues, `Detected clipped labels: ${JSON.stringify(issues, null, 2)}`).toEqual([]);
      await expect(page).toHaveScreenshot('critical-ui-shell.png', {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixelRatio: 0.01,
      });
    } finally {
      await app.close();
    }
  });
});

import { test, expect } from '@playwright/test';
import { launchElectronApp } from './helpers/electronApp';

test.describe('Editor layout', () => {
  test('welcome editor pane has positive bounding height', async () => {
    const { app, page } = await launchElectronApp();

    const pane = page.locator('.editor-pane').first();
    await expect(pane).toBeVisible({ timeout: 15_000 });

    const height = await pane.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(0);

    const welcome = page.locator('.editor-welcome');
    await expect(welcome).toBeVisible();
    const welcomeH = await welcome.evaluate((el) => el.getBoundingClientRect().height);
    expect(welcomeH).toBeGreaterThan(0);

    await app.close();
  });

  test('welcome ASCII logo sits slightly above editor pane center', async () => {
    const { app, page } = await launchElectronApp();

    await expect(page.locator('.editor-welcome')).toBeVisible({ timeout: 15_000 });
    const metrics = await page.evaluate(() => {
      const pane = document.querySelector('.editor-pane');
      const welcome = document.querySelector('.editor-welcome');
      const brand = document.querySelector('.editor-welcome-brand-stack');
      const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
      const pr = rect(pane);
      const wr = rect(welcome);
      const br = rect(brand);
      const paneCenter = pr ? pr.top + pr.height / 2 : null;
      const brandCenter = br ? br.top + br.height / 2 : null;
      return {
        brandOffsetFromPaneCenter:
          paneCenter != null && brandCenter != null ? brandCenter - paneCenter : null,
        welcomeFillsPane: pr && wr ? Math.abs(wr.height - pr.height) < 2 : false,
      };
    });

    expect(metrics.welcomeFillsPane).toBe(true);
    // Logo sits slightly above geometric center (deliberate upward bias).
    expect(metrics.brandOffsetFromPaneCenter).toBeLessThan(4);
    expect(metrics.brandOffsetFromPaneCenter).toBeGreaterThan(-80);

    await app.close();
  });

  test('Cmd/Ctrl+Shift+A toggles all layout chrome visible/collapsed', async () => {
    const { app, page } = await launchElectronApp();
    try {
      await expect(page.locator('.app-root')).toBeVisible({ timeout: 20_000 });
      await page.locator('.app-main').click({ position: { x: 8, y: 8 } });

      const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
      const pressLayoutShortcut = async (key: 'A' | 'L' | 'R' | 'T' | 'Z'): Promise<void> => {
        await page.keyboard.press(`${mod}+Shift+${key}`);
      };

      // All hidden by default; Shift+A expands all regions.
      await pressLayoutShortcut('A');
      await expect(page.locator('.sidebar-panel')).toBeVisible();
      await expect(page.locator('.right-sidebar-panel')).toBeVisible();
      await expect(page.locator('.app-top-toolbar')).toBeVisible();

      // Shift+A again collapses all regions.
      await pressLayoutShortcut('A');
      await expect(page.locator('.sidebar-panel')).toHaveCount(0);
      await expect(page.locator('.right-sidebar-panel')).toHaveCount(0);
      await expect(page.locator('.app-top-toolbar')).toHaveCount(0);
      await expect(page.locator('.app-hidden-top-hint')).toBeVisible();

      // Zen focus remains editor-only and does not reopen everything.
      await pressLayoutShortcut('Z');
      await expect(page.locator('.sidebar-panel')).toHaveCount(0);
      await expect(page.locator('.right-sidebar-panel')).toHaveCount(0);
      await expect(page.locator('.app-top-toolbar')).toHaveCount(0);

      // Individual shortcuts still work in collapsed state.
      await pressLayoutShortcut('L');
      await expect(page.locator('.sidebar-panel')).toBeVisible();
      await expect(page.locator('.right-sidebar-panel')).toHaveCount(0);
      await expect(page.locator('.app-top-toolbar')).toHaveCount(0);

      await pressLayoutShortcut('R');
      await expect(page.locator('.right-sidebar-panel')).toBeVisible();

      await pressLayoutShortcut('T');
      await expect(page.locator('.app-top-toolbar')).toBeVisible();

      // Shift+A from mixed visibility normalizes back to collapsed-all.
      await pressLayoutShortcut('A');
      await expect(page.locator('.sidebar-panel')).toHaveCount(0);
      await expect(page.locator('.right-sidebar-panel')).toHaveCount(0);
      await expect(page.locator('.app-top-toolbar')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});

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

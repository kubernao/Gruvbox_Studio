import { test, expect } from '@playwright/test';
import { launchElectronApp } from './helpers/electronApp';

test.describe('Memory tab global MD in editor', () => {
  test.describe.configure({ timeout: 120_000 });

  test('opens style.md and rules.md in the main editor from Memory tab', async () => {
    const { app, page } = await launchElectronApp();
    try {
      await expect(page.locator('.app-root')).toBeVisible({ timeout: 20_000 });
      await page.locator('.app-main').click({ position: { x: 8, y: 8 } });

      const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${mod}+Shift+R`);
      const rightPanel = page.locator('.right-sidebar-panel');
      await expect(rightPanel).toBeVisible({ timeout: 30_000 });

      await rightPanel.getByRole('button', { name: 'Memory', exact: true }).click();
      await expect(rightPanel.locator('[data-e2e-memory-open-style]')).toBeVisible({ timeout: 10_000 });

      await rightPanel.locator('[data-e2e-memory-open-style]').click();
      await expect(page.locator('.document-tab-react.active .filename-react')).toContainText('style.md', {
        timeout: 30_000,
      });

      await rightPanel.locator('[data-e2e-memory-open-rules]').click();
      await expect(page.locator('.document-tab-react.active .filename-react')).toContainText('rules.md', {
        timeout: 30_000,
      });
    } finally {
      await app.close();
    }
  });
});

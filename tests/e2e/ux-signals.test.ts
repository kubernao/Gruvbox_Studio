import { test, expect } from '@playwright/test';
import { launchElectronApp } from './helpers/electronApp';

type UxSignals = {
  totalClicks: number;
  deadClicks: number;
  rageClicks: number;
  lastUpdatedAt: number | null;
};

test.describe('UX signal instrumentation', () => {
  test.describe.configure({ timeout: 120_000 });

  test('tracks dead clicks and rage-click bursts', async () => {
    const { app, page } = await launchElectronApp();
    try {
      await expect(page.locator('.app-root')).toBeVisible();

      // Click in the middle of the app shell repeatedly to simulate friction.
      const shell = page.locator('.app-main');
      await expect(shell).toBeVisible();
      const box = await shell.boundingBox();
      expect(box).not.toBeNull();
      if (!box) {
        return;
      }

      const x = Math.floor(box.x + box.width / 2);
      const y = Math.floor(box.y + box.height / 2);
      await page.mouse.click(x, y);
      await page.mouse.click(x + 3, y + 2);
      await page.mouse.click(x + 4, y + 1);

      await expect
        .poll(async () => {
          return page.evaluate(() => {
            const snapshot = (window as unknown as { __gruvboxUxSignals?: UxSignals }).__gruvboxUxSignals;
            return snapshot?.totalClicks ?? 0;
          });
        })
        .toBeGreaterThanOrEqual(3);

      const snapshot = await page.evaluate(() => {
        return (window as unknown as { __gruvboxUxSignals?: UxSignals }).__gruvboxUxSignals ?? null;
      });
      expect(snapshot).not.toBeNull();
      if (!snapshot) {
        return;
      }
      expect(snapshot.totalClicks).toBeGreaterThanOrEqual(3);
      expect(snapshot.deadClicks).toBeGreaterThanOrEqual(1);
      expect(snapshot.rageClicks).toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
    }
  });
});

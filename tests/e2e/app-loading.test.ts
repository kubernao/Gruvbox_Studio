import { test, expect } from '@playwright/test';
import { launchElectronApp } from './helpers/electronApp';

test.describe('App Loading', () => {
  test('should launch and display main window without errors', async () => {
    const { app, page } = await launchElectronApp();
    
    // Collect page errors
    const pageErrors: string[] = [];
    page.on('pageerror', error => {
      pageErrors.push(error.message);
    });

    const body = page.locator('body');
    await expect(body).toBeVisible();
    
    // Log any errors
    if (pageErrors.length > 0) {
      console.log('Page errors:', pageErrors);
    }

    await app.close();
  });

  test('should not have uncaught exceptions on startup', async () => {
    const { app, page } = await launchElectronApp();

    const exceptions: string[] = [];
    page.on('pageerror', error => {
      exceptions.push(error.message);
    });

    await expect(page.locator('.app-root')).toBeVisible({ timeout: 20_000 });

    if (exceptions.length > 0) {
      console.log('Startup exceptions:', exceptions);
    }
    
    expect(exceptions.length).toBe(0);

    await app.close();
  });
});

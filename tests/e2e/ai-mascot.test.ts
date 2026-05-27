import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { launchElectronApp } from './helpers/electronApp';

test.describe('AI assistant', () => {
  test('shows composer on splash and streams assistant response into transcript', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
    const { app, page } = await launchElectronApp({
      fixtureRoot,
      extraEnv: { E2E_PI_STUB: '1' },
    });

    try {
      await expect(page.locator('[data-testid="ai-assistant-root"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="ai-composer"]')).toBeVisible();

      const input = page.locator('#ai-assistant-tab textarea');
      await input.fill('Please make one file change for mascot test');
      await input.press('Enter');

      await expect(page.locator('.ai-chat-body--chat')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="ai-streaming-loader"]')).toHaveCount(0);
      await expect(page.locator('.ai-chat-md.is-streaming')).toBeVisible({ timeout: 20_000 });
    } finally {
      await app.close();
    }
  });
});

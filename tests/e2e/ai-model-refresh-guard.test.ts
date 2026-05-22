import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'node:path';
import { launchElectronApp } from './helpers/electronApp';

async function launchE2EAppWithBrokenModels(): Promise<{ app: ElectronApplication; page: Page }> {
  const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
  const { app, page } = await launchElectronApp({
    fixtureRoot,
    extraEnv: {
      E2E_PI_STUB: '1',
      OPENROUTER_API_KEY: 'invalid-key-for-e2e',
    },
  });
  await expect(page.locator('[data-testid="ai-assistant-root"]')).toBeVisible({ timeout: 25_000 });
  return { app, page };
}

test.describe('AI model refresh guard', () => {
  test.describe.configure({ timeout: 120_000 });

  test('blocks sends when model refresh fails and no valid model is available', async () => {
    const { app, page } = await launchE2EAppWithBrokenModels();
    try {
      await page.locator('#ai-assistant-tab button[title^="Model:"]').click();
      const refreshButton = page.getByRole('button', { name: 'Refresh models' });
      await expect(refreshButton).toBeVisible({ timeout: 20_000 });

      const modelError = page.locator('.ai-chat-banner-error').filter({
        hasText: /failed to load models|openrouter|unauthorized|401|models/i,
      });
      await expect(modelError.first()).toBeVisible({ timeout: 25_000 });

      const modelSelect = page.locator('#ai-assistant-tab .ai-chat-banner-label select').first();
      await expect(modelSelect).toHaveValue('');

      const composer = page.locator('#ai-assistant-tab textarea');
      await composer.fill('Try sending without a valid model.');

      const sendButton = page.getByTitle('Send').or(page.getByTitle(/OpenRouter API key/i));
      await expect(sendButton.first()).toBeDisabled();

      await composer.press('Enter');
      await expect(page.locator('[data-testid="ai-chat-transcript"]')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});

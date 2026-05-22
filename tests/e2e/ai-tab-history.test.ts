import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchElectronApp } from './helpers/electronApp';

/**
 * This helper launches the packaged Electron app in deterministic E2E mode with
 * the Pi stub enabled so the AI tab can create sessions without external API
 * dependencies. The returned page is guaranteed to have the assistant root
 * mounted, which keeps each test focused on user interactions instead of boot
 * timing details.
 */
async function launchE2EApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
  const { app, page } = await launchElectronApp({
    fixtureRoot,
    extraEnv: {
      E2E_PI_STUB: '1',
    },
  });
  const aiTabButton = page.getByRole('button', { name: /^AI$/i }).first();
  if (await aiTabButton.count()) {
    await aiTabButton.click();
  }
  await expect(page.locator('[data-testid="ai-assistant-root"]')).toBeVisible({ timeout: 25_000 });
  return { app, page };
}

test.describe('AI tab history navigation', () => {
  test.describe.configure({ timeout: 120_000 });

  test('shows history button, opens modal, and restores prior session', async () => {
    const { app, page } = await launchE2EApp();
    try {
      const input = page.locator('#ai-assistant-tab textarea');
      await input.fill('History test: first session prompt');
      await input.press('Enter');
      await expect(page.locator('.ai-chat-body--chat')).toBeVisible({ timeout: 20_000 });

      const newConversationButton = page.getByTestId('ai-new-conversation-button');
      await newConversationButton.click();

      await input.fill('History test: second session prompt');
      await input.press('Enter');
      await expect(page.locator('.ai-chat-body--chat')).toBeVisible({ timeout: 20_000 });

      const historyButton = page.getByTestId('ai-chat-history-button');
      await expect(historyButton).toBeVisible();
      await historyButton.click();

      const historyList = page.getByTestId('ai-chat-history-list');
      await expect(historyList).toBeVisible({ timeout: 20_000 });
      await expect(historyList.getByRole('button')).toHaveCount(2, { timeout: 20_000 });

      await historyList.getByRole('button', { name: /first session prompt/i }).click();
      await expect(page.locator('.ai-chat-history-modal-backdrop')).toHaveCount(0, { timeout: 10_000 });
      await expect(page.locator('#ai-assistant-tab .ai-chat-turn.is-user .ai-chat-bubble')).toContainText(
        'History test: first session prompt',
      );
    } finally {
      await app.close();
    }
  });
});

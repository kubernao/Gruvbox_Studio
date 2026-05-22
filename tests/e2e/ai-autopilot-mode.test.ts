import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { launchElectronApp, setAssistantAutopilot } from './helpers/electronApp';

async function launchWithPiStub(): Promise<{ app: import('@playwright/test').ElectronApplication; page: Page }> {
  const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
  const { app, page } = await launchElectronApp({
    fixtureRoot,
    extraEnv: { E2E_PI_STUB: '1' },
  });
  await expect(page.locator('[data-testid="ai-assistant-root"]')).toBeVisible({ timeout: 25_000 });
  return { app, page };
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const input = page.locator('#ai-assistant-tab textarea');
  await input.fill(prompt);
  await page.getByTitle('Send').click();
}

test.describe('AI autopilot mode (E2E)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('autopilot off opens center diff / merge view', async () => {
    const { app, page } = await launchWithPiStub();
    try {
      await setAssistantAutopilot(page, false);
      await sendPrompt(page, 'Please edit story.md and add one line');
      await expect(page.locator('[data-testid="main-center-diff"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="diff-viewer-root"]')).toBeVisible({ timeout: 15_000 });
    } finally {
      await app.close();
    }
  });

  test('autopilot on keeps editor center with inline AI review chrome', async () => {
    const { app, page } = await launchWithPiStub();
    try {
      await setAssistantAutopilot(page, true);
      await sendPrompt(page, 'Please edit story.md and add one line');
      await expect(page.locator('[data-testid="main-center-editor"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="main-center-diff"]')).toHaveCount(0);
      await expect(page.locator('.editor-ai-inline-review-bar')).toBeVisible({ timeout: 20_000 });
    } finally {
      await app.close();
    }
  });
});

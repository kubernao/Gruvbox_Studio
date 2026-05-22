/**
 * Pi turn recovery E2E coverage: merge editor opens after a normal stub turn,
 * abort mid-stub still yields merge/done so a follow-up send is accepted,
 * and a fresh edit prompt after abort completes without “message in progress”.
 *
 * Skipped unless `RUN_PI_TURN_RECOVERY=1` is set (default E2E runs omit this suite).
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { launchElectronApp, setAssistantAutopilot } from './helpers/electronApp';

const describePiTurnRecovery =
  process.env.RUN_PI_TURN_RECOVERY === '1' ? test.describe : test.describe.skip;

async function launchWithPiStub(fixtureRoot: string): Promise<{ app: import('@playwright/test').ElectronApplication; page: Page }> {
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

describePiTurnRecovery('Pi turn recovery (E2E)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('normal Pi stub turn opens merge editor', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
    const { app, page } = await launchWithPiStub(fixtureRoot);
    try {
      await setAssistantAutopilot(page, false);
      await sendPrompt(page, 'Please edit story.md and add one line');
      await expect(page.locator('[data-testid="main-center-diff"]')).toBeVisible({ timeout: 20_000 });
    } finally {
      await app.close();
    }
  });

  test('bridged untracked files still open merge editor after AI edit', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'Essays');
    const { app, page } = await launchWithPiStub(fixtureRoot);
    try {
      await setAssistantAutopilot(page, false);
      await sendPrompt(page, 'Please edit story/chapter_1.md and add one line');
      await expect(page.locator('[data-testid="main-center-diff"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Failed to load file versions', { exact: false })).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('abort-after-edit stub then follow-up edit succeeds', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
    const { app, page } = await launchWithPiStub(fixtureRoot);
    try {
      await setAssistantAutopilot(page, false);
      await sendPrompt(page, '[E2E_CASE:ABORT_AFTER_EDIT] please edit story.md');
      const stopButton = page.getByTitle('Stop');
      await expect(stopButton).toBeVisible({ timeout: 15_000 });
      await stopButton.click();
      await expect(page.locator('[data-testid="main-center-diff"]')).toBeVisible({ timeout: 25_000 });
      await page.getByTitle('Close diff viewer').click();
      await expect(page.locator('[data-testid="main-center-editor"]')).toBeVisible({ timeout: 15_000 });
      await sendPrompt(page, 'Please edit story.md and add one line');
      const err = page.getByText('A message is already in progress', { exact: false });
      await expect(err).toHaveCount(0, { timeout: 2000 });
      await expect(page.locator('[data-testid="main-center-diff"]')).toBeVisible({ timeout: 20_000 });
    } finally {
      await app.close();
    }
  });
});

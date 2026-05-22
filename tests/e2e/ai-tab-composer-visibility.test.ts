import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchElectronApp } from './helpers/electronApp';

type OffscreenIssue = {
  title: string;
  bottom: number;
  viewportHeight: number;
  tabBottom: number;
};

async function launchE2EApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
  const { app, page } = await launchElectronApp({
    fixtureRoot,
    extraEnv: {
      E2E_PI_STUB: '1',
    },
  });
  await expect(page.locator('[data-testid="ai-assistant-root"]')).toBeVisible({ timeout: 25_000 });
  return { app, page };
}

test.describe('AI tab composer visibility regression', () => {
  test.describe.configure({ timeout: 120_000 });

  test('composer action buttons stay on-screen after first message', async () => {
    const { app, page } = await launchE2EApp();
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          win.setBounds({ width: 980, height: 540 });
        }
      });

      const input = page.locator('#ai-assistant-tab textarea');
      await input.fill('Repro: send one message and keep composer actions visible.');
      await input.press('Enter');

      await expect(page.locator('.ai-chat-body--chat')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.ai-chat-composer-bar--inline')).toBeVisible({ timeout: 20_000 });

      const issues = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll<HTMLButtonElement>('#ai-assistant-tab .ai-chat-composer-bar button')
        );
        const viewportHeight = window.innerHeight;
        const tab = document.querySelector<HTMLElement>('#ai-assistant-tab');
        const tabRect = tab?.getBoundingClientRect();
        const tabBottom = tabRect?.bottom ?? viewportHeight;
        const problems: OffscreenIssue[] = [];
        for (const button of buttons) {
          if (button.offsetParent === null) {
            continue;
          }
          const rect = button.getBoundingClientRect();
          if (rect.bottom > viewportHeight + 1 || rect.bottom > tabBottom + 1) {
            problems.push({
              title: button.getAttribute('title') || button.textContent?.trim() || 'unknown',
              bottom: rect.bottom,
              viewportHeight,
              tabBottom,
            });
          }
        }
        return problems;
      });

      expect(
        issues,
        `Composer action buttons rendered outside viewport after sending message: ${JSON.stringify(issues, null, 2)}`
      ).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

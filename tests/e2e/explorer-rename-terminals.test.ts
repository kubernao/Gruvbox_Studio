import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { launchElectronApp } from './helpers/electronApp';

test.describe('Explorer rename on terminals folder', () => {
  test.describe.configure({ timeout: 120_000 });

  test('renames terminals/1.txt via explorer context menu', async () => {
    const terminalsRoot =
      process.env.E2E_TERMINALS_ROOT ||
      'C:\\Users\\isick\\.cursor\\projects\\c-Users-isick-Desktop-Gruvbox\\terminals';
    test.skip(!fs.existsSync(terminalsRoot), `Missing terminals root: ${terminalsRoot}`);

    const originalName = '1.txt';
    const renamedName = `1-renamed-${Date.now()}.txt`;
    const renamedPath = `${terminalsRoot}\\${renamedName}`;

    // Best effort cleanup in case a prior local run left residue.
    try {
      if (fs.existsSync(renamedPath)) {
        fs.unlinkSync(renamedPath);
      }
    } catch {
      // ignore cleanup failures
    }

    const { app, page } = await launchElectronApp({ fixtureRoot: terminalsRoot });

    const fileNode = page.locator(`[data-e2e-file-name="${originalName}"]`).first();
    await expect(fileNode).toBeVisible({ timeout: 30_000 });

    page.once('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(renamedName);
        return;
      }
      await dialog.dismiss();
    });

    await fileNode.click({ button: 'right' });
    await page.getByRole('button', { name: 'Rename' }).click();

    const renamedNode = page.locator(`[data-e2e-file-name="${renamedName}"]`).first();
    await expect(renamedNode).toBeVisible({ timeout: 20_000 });

    await app.close();
  });
});

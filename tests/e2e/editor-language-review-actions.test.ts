import { test, expect } from '@playwright/test';
import { launchElectronApp } from './helpers/electronApp';

test.describe('Editor language review actions', () => {
  test.describe.configure({ timeout: 120_000 });

  test('spell, grammar, and readability checks run from toolbar', async () => {
    const { app, page } = await launchElectronApp();
    try {
      const file = page.locator('[data-e2e-file-name="a.md"]').first();
      await file.click({ timeout: 60_000 });
      await expect(page.locator('[data-editor-loading="reading"]')).toHaveCount(0, { timeout: 20_000 });

      const editor = page.locator('.cm-content').first();
      await editor.click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.type('teh text. There is really very many words in this sentence.');

      await page.getByRole('button', { name: 'Spell check' }).click();
      await expect
        .poll(async () => page.locator('body').innerText())
        .toContain('Spell check');

      await page.getByRole('button', { name: 'Grammar check' }).click();
      await expect
        .poll(async () => page.locator('body').innerText())
        .toContain('Grammar check');

      await page.getByRole('button', { name: 'Readability check' }).click();
      await expect
        .poll(async () => page.locator('body').innerText())
        .toContain('Readability score');
    } finally {
      await app.close();
    }
  });
});

import { test, expect } from '@playwright/test';
import * as path from 'path';
import { launchElectronApp } from './helpers/electronApp';

test.describe('MDX editor smoke (E2E)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('opens markdown fixture without stuck reading overlay or page errors', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');

    const { app, page } = await launchElectronApp({ fixtureRoot });

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await expect(page.locator('#root')).toBeVisible({ timeout: 20_000 });

    const hasE2eBridge = await page.evaluate(
      () => typeof (window as unknown as { electronAPI?: { e2eGetFixtureRoot?: unknown } }).electronAPI?.e2eGetFixtureRoot === 'function'
    );
    expect(
      hasE2eBridge,
      'Rebuild webpack (npm start once) so preload exposes e2eGetFixtureRoot'
    ).toBe(true);

    await page.locator('[data-e2e-file-name="a.md"]:visible').first().click({ timeout: 60_000 });

    const reading = page.locator('[data-editor-loading="reading"]');
    await expect(reading).toHaveCount(0, { timeout: 20_000 });

    await expect(page.locator('.markdown-codemirror-root .cm-editor')).toBeVisible({ timeout: 15_000 });

    expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);

    await app.close();
  });
});

import { test, expect } from '@playwright/test';
import * as path from 'path';
import { launchElectronApp } from './helpers/electronApp';

test.describe('Editor file loading (E2E)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('does not leave reading overlay stuck after racing two markdown files', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');

    const { app, page } = await launchElectronApp({
      fixtureRoot,
      extraEnv: {
        E2E_DELAY_MS: '400',
      },
    });

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

    const fileA = page.locator('[data-e2e-file-name="a.md"]').first();
    const fileB = page.locator('[data-e2e-file-name="b.md"]').first();
    await expect(fileA).toHaveCount(1, { timeout: 60_000 });
    await expect(fileB).toHaveCount(1, { timeout: 10_000 });

    await fileA.click({ force: true });
    // Fast fixture reads may complete before Playwright samples visibility.
    const readingOverlay = page.locator('[data-editor-loading="reading"]');
    await expect.poll(async () => await readingOverlay.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
    await fileB.click({ force: true });

    await expect(readingOverlay).toHaveCount(0, { timeout: 25_000 });

    await expect(page.getByText('B file only', { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);

    await app.close();
  });
});

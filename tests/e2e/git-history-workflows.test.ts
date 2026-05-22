import { test, expect } from '@playwright/test';
import { launchElectronApp } from './helpers/electronApp';
import { createGitE2EFixtures } from './helpers/gitFixture';

test.describe('Git / History tab (E2E)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('non-repo workspace shows git-state-non-repo', async () => {
    const { nonRepoDir } = createGitE2EFixtures();
    const { app, page } = await launchElectronApp({ fixtureRoot: nonRepoDir });
    try {
      await expect(page.locator('#root')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'History' }).click();
      await expect(page.locator('[data-testid="git-state-non-repo"]')).toBeVisible({ timeout: 25_000 });
    } finally {
      await app.close();
    }
  });

  test('repo workspace opens diff from History and save version commits dirty file', async () => {
    const { repoDir } = createGitE2EFixtures();
    const { app, page } = await launchElectronApp({ fixtureRoot: repoDir });
    try {
      await expect(page.locator('#root')).toBeVisible({ timeout: 20_000 });

      await page.locator('[data-e2e-file-name="tracked.md"]').first().click({ timeout: 60_000 });
      await expect(page.locator('[data-editor-loading="reading"]')).toHaveCount(0, { timeout: 20_000 });

      await page.getByRole('button', { name: 'History' }).click();

      const openDiff = page.locator('[data-testid="git-open-diff-button"]');
      await expect(openDiff).toBeEnabled({ timeout: 30_000 });
      await openDiff.click();

      await expect(page.locator('[data-testid="main-center-diff"]')).toBeVisible({ timeout: 25_000 });
      await expect(page.locator('[data-testid="diff-viewer-root"]')).toBeVisible();

      await page.getByTitle('Close diff viewer').click();
      await expect(page.locator('[data-testid="main-center-editor"]')).toBeVisible({ timeout: 15_000 });

      await page.locator('[data-testid="git-save-version-button"]').click();
      await expect(page.locator('.command-palette-commit-title')).toBeVisible({ timeout: 10_000 });
      await page.locator('.command-palette-commit-textarea').fill('e2e save version');
      await page
        .locator('.command-palette-panel--commit-message')
        .getByRole('button', { name: 'Save version' })
        .click();

      await expect(page.locator('[data-testid="git-save-version-message"]')).toContainText('Saved version', {
        timeout: 30_000,
      });
    } finally {
      await app.close();
    }
  });
});

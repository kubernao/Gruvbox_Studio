import { test, expect } from '@playwright/test';
import { launchElectronApp } from './helpers/electronApp';

test.describe('AppToolbar actions', () => {
  test.describe.configure({ timeout: 120_000 });

  test('format/history/review/print buttons execute real editor behavior', async () => {
    const { app, page } = await launchElectronApp();
    try {
      const file = page.locator('[data-e2e-file-name="a.md"]').first();
      await file.click({ timeout: 60_000 });
      await expect(page.locator('[data-editor-loading="reading"]')).toHaveCount(0, { timeout: 20_000 });

      const editor = page.locator('.cm-content').first();
      await editor.click();

      await page.getByRole('button', { name: 'Bold' }).click();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const host = document.querySelector('.editor-container') as
              | (HTMLElement & {
                  gruvboxEditorView?: { state: { doc: { toString(): string } } };
                })
              | null;
            return host?.gruvboxEditorView?.state.doc.toString() ?? '';
          })
        )
        .toContain('**bold text**');

      await page.getByRole('button', { name: 'Undo' }).click();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const host = document.querySelector('.editor-container') as
              | (HTMLElement & {
                  gruvboxEditorView?: { state: { doc: { toString(): string } } };
                })
              | null;
            return host?.gruvboxEditorView?.state.doc.toString() ?? '';
          })
        )
        .not.toContain('**bold text**');

      await page.getByRole('button', { name: 'Redo' }).click();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const host = document.querySelector('.editor-container') as
              | (HTMLElement & {
                  gruvboxEditorView?: { state: { doc: { toString(): string } } };
                })
              | null;
            return host?.gruvboxEditorView?.state.doc.toString() ?? '';
          })
        )
        .toContain('**bold text**');

      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('color me');
      await page.keyboard.press('Meta+A');
      await page.getByRole('button', { name: 'Font color' }).click();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const host = document.querySelector('.editor-container') as
              | (HTMLElement & {
                  gruvboxEditorView?: { state: { doc: { toString(): string } } };
                })
              | null;
            return host?.gruvboxEditorView?.state.doc.toString() ?? '';
          })
        )
        .toContain('color: #fabd2f');

      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('align me');
      await page.keyboard.press('Meta+A');
      await page.getByRole('button', { name: 'Text align' }).click();
      let alignDoc = '';
      await expect
        .poll(async () => {
          alignDoc = await page.evaluate(() => {
            const host = document.querySelector('.editor-container') as
              | (HTMLElement & {
                  gruvboxEditorView?: { state: { doc: { toString(): string } } };
                })
              | null;
            return host?.gruvboxEditorView?.state.doc.toString() ?? '';
          });
          return (
            alignDoc.includes('align me') &&
            (alignDoc.includes('text-align:left') || alignDoc.includes('<p align='))
          );
        })
        .toBe(true);
      if (alignDoc.includes('text-align:left')) {
        expect(alignDoc).toContain('display:block');
      }

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

      await page.evaluate(() => {
        (window as unknown as { __printWindowOpened?: boolean; __printCalled?: boolean }).__printWindowOpened =
          false;
        (window as unknown as { __printWindowOpened?: boolean; __printCalled?: boolean }).__printCalled = false;
        window.open = () =>
          ({
            document: {
              open() {},
              write() {},
              close() {},
            },
            focus() {},
            print() {
              (window as unknown as { __printWindowOpened?: boolean; __printCalled?: boolean }).__printCalled = true;
            },
          }) as unknown as Window;
      });

      await page.getByRole('button', { name: 'Print' }).click();
      const printCalled = await page.evaluate(
        () => (window as unknown as { __printCalled?: boolean }).__printCalled === true
      );
      expect(printCalled).toBe(true);
    } finally {
      await app.close();
    }
  });
});

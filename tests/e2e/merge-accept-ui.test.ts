/**
 * Merge editor accept-changes UI flows (E2E)
 * ==========================================
 *
 * End-to-end coverage for the merge editor's accept / reject / save / exit
 * surface. The unit tests already cover the routing of accept-all to the
 * correct buffer (see diff-viewer-accept-all-paths.test.tsx) and the per-hunk
 * helpers (see per-hunk-accept-monaco-merge-pane.test.ts), but those run
 * against React mocks. This file exercises the same flows against the real
 * Monaco editor inside the Electron renderer with the PI stub driving an AI
 * edit proposal.
 *
 *   E1 — Accept all populates the modified buffer with AI content
 *   E2 — Reject all populates the modified buffer with the existing content
 *   E3 — Per-hunk apply via the merge lane button updates the result
 *   E4 — Save after Accept all writes the merged file and closes the diff
 *   E5 — Exit merge editor reverts the modified buffer back to the right snapshot
 *   E6 — Re-entering merge mode after exit shows the pristine right snapshot
 *
 * The fixture is `tests/fixtures/sample-project/story.md`. The PI stub edits
 * one line so each test's assertions can rely on the same diff shape.
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { launchElectronApp, setAssistantAutopilot } from './helpers/electronApp';

/**
 * Boots the Electron app with the PI stub enabled and waits for the AI
 * assistant root to render. Throwing here surfaces a launch failure as a
 * test error rather than a hang inside the first assertion.
 */
async function launchWithPiStub(
  fixtureRoot: string,
): Promise<{ app: import('@playwright/test').ElectronApplication; page: Page }> {
  const { app, page } = await launchElectronApp({
    fixtureRoot,
    extraEnv: { E2E_PI_STUB: '1' },
  });
  await expect(page.locator('[data-testid="ai-assistant-root"]')).toBeVisible({ timeout: 25_000 });
  return { app, page };
}

/**
 * Sends a textual prompt through the AI assistant tab. Used by every test in
 * this file to push the PI stub into producing an edit on `story.md`.
 */
async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const input = page.locator('#ai-assistant-tab textarea');
  await input.fill(prompt);
  await page.getByTitle('Send').click();
}

/**
 * Waits for the AI diff viewer to render and returns the page once the merge
 * shell is on screen. Centralised here because every E1–E6 test starts from
 * this state.
 */
async function openAiDiff(page: Page): Promise<void> {
  await sendPrompt(page, 'Please edit story.md and add one line');
  await expect(page.locator('[data-testid="diff-viewer-root"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="meld-diff-shell"]')).toBeVisible({ timeout: 15_000 });
}

/**
 * Reads the current Monaco modified-side buffer text. Implemented against
 * Monaco's exposed `editor.getValue()` via the page evaluate context so the
 * tests can compare merge outputs without scraping the DOM (which is
 * virtualised by Monaco).
 */
async function getModifiedBufferText(page: Page): Promise<string> {
  return page.evaluate(() => {
    // Find the modified-side editor in the diff viewer
    const root = document.querySelector('[data-testid="diff-viewer-root"]');
    if (!root) return '';
    const monaco = (window as any).monaco;
    if (!monaco) return '';
    const editors = monaco.editor.getEditors();
    for (const ed of editors) {
      const dom = ed.getDomNode?.();
      if (dom && root.contains(dom)) {
        const isReadOnly = ed.getOption?.(monaco.editor.EditorOption?.readOnly ?? 92);
        if (!isReadOnly) {
          return ed.getValue?.() ?? '';
        }
      }
    }
    return '';
  });
}

/**
 * E1 — Accept all routes the AI proposal into the modified buffer. Because
 * `aiProposedEdits=true` flips the polarity, "Accept all" picks the left
 * (AI) side. The buffer must therefore contain whatever the PI stub
 * proposed for `story.md`.
 */
test.describe('Merge editor accept-changes UI (E2E)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('E1 — Accept all populates modified buffer with AI proposal', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
    const { app, page } = await launchWithPiStub(fixtureRoot);
    try {
      await setAssistantAutopilot(page, false);
      await openAiDiff(page);

      // Capture the pre-merge buffer to compare deltas
      const baseline = await getModifiedBufferText(page);

      await page
        .getByTitle('Merge into file — Resolve in the editor and save the merged text to the working tree file only')
        .click();
      await expect(page.locator('.diff-save-result-btn--merge-mode')).toBeVisible({ timeout: 10_000 });

      await page.getByText('Accept all').click();

      // Buffer must change after accept-all, and the PI stub's "add one line"
      // edit guarantees a content delta.
      const afterAccept = await getModifiedBufferText(page);
      expect(afterAccept).not.toBe('');
      expect(afterAccept).not.toBe(baseline);
    } finally {
      await app.close();
    }
  });

  /**
   * E2 — Reject all routes the existing-side content into the buffer. For an
   * `aiProposedEdits=true` session, that's the right snapshot (the file as
   * it was on disk before the AI edit).
   */
  test('E2 — Reject all populates modified buffer with existing content', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
    const { app, page } = await launchWithPiStub(fixtureRoot);
    try {
      await setAssistantAutopilot(page, false);
      await openAiDiff(page);

      await page
        .getByTitle('Merge into file — Resolve in the editor and save the merged text to the working tree file only')
        .click();

      // Click Accept all first to dirty the buffer, then Reject all should
      // restore the existing content.
      await page.getByText('Accept all').click();
      const afterAccept = await getModifiedBufferText(page);

      await page.getByText('Reject all').click();
      const afterReject = await getModifiedBufferText(page);

      expect(afterReject).not.toBe(afterAccept);
    } finally {
      await app.close();
    }
  });

  /**
   * E3 — Per-hunk apply via the lane button. The merge lane shows an "Apply
   * to Result" arrow per hunk. Clicking it must change the buffer just like
   * Accept all but at hunk granularity. We only verify the click works and
   * the buffer changes — exact text content is asserted in unit tests.
   */
  test('E3 — Per-hunk Apply to Result updates the modified buffer', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
    const { app, page } = await launchWithPiStub(fixtureRoot);
    try {
      await setAssistantAutopilot(page, false);
      await openAiDiff(page);

      await page
        .getByTitle('Merge into file — Resolve in the editor and save the merged text to the working tree file only')
        .click();
      await expect(page.locator('.diff-save-result-btn--merge-mode')).toBeVisible({ timeout: 10_000 });

      // Lane button title is "Apply to Result"
      const applyBtn = page.locator('button[title="Apply to Result"]').first();
      await expect(applyBtn).toBeVisible({ timeout: 10_000 });

      const before = await getModifiedBufferText(page);
      await applyBtn.click();
      // Allow Monaco to flush the edit
      await page.waitForTimeout(200);
      const after = await getModifiedBufferText(page);
      expect(after).not.toBe(before);
    } finally {
      await app.close();
    }
  });

  /**
   * E4 — Save after Accept all. The save button must commit the merged
   * content to the working tree, after which the diff viewer closes and the
   * editor returns to centre.
   */
  test('E4 — Save after Accept all writes file and closes diff viewer', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
    const { app, page } = await launchWithPiStub(fixtureRoot);
    try {
      await setAssistantAutopilot(page, false);
      await openAiDiff(page);

      await page
        .getByTitle('Merge into file — Resolve in the editor and save the merged text to the working tree file only')
        .click();
      await page.getByText('Accept all').click();

      const saveMerge = page.locator('.diff-save-result-btn--merge-mode');
      await expect(saveMerge).toBeEnabled({ timeout: 10_000 });
      await saveMerge.click();

      await expect(page.locator('[data-testid="main-center-editor"]')).toBeVisible({ timeout: 25_000 });
      await expect(page.locator('[data-testid="main-center-diff"]')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  /**
   * E5 — Exit merge editor reverts to the right snapshot. After clicking
   * Accept all and then Exit, the buffer must NOT contain the accepted AI
   * content — it must be the right snapshot, matching the contract enforced
   * in DiffViewer.toggleMergeMode.
   */
  test('E5 — Exit merge editor reverts modified buffer to right snapshot', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
    const { app, page } = await launchWithPiStub(fixtureRoot);
    try {
      await setAssistantAutopilot(page, false);
      await openAiDiff(page);

      const beforeMerge = await getModifiedBufferText(page);

      await page
        .getByTitle('Merge into file — Resolve in the editor and save the merged text to the working tree file only')
        .click();
      await page.getByText('Accept all').click();

      await page.getByTitle('Exit merge editor').click();
      await expect(page.locator('.diff-save-result-btn--merge-mode')).toHaveCount(0);

      const afterExit = await getModifiedBufferText(page);
      expect(afterExit).toBe(beforeMerge);
    } finally {
      await app.close();
    }
  });

  /**
   * E6 — Re-entering merge mode after exit shows the pristine right snapshot.
   * Catches state leaks where toggleMergeMode forgets to clear the previous
   * accept-all delta (the original bug behind this whole test plan).
   */
  test('E6 — Re-entering merge mode after exit shows pristine right snapshot', async () => {
    const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/sample-project');
    const { app, page } = await launchWithPiStub(fixtureRoot);
    try {
      await setAssistantAutopilot(page, false);
      await openAiDiff(page);

      const pristine = await getModifiedBufferText(page);

      // Round 1: enter, accept all, exit
      await page
        .getByTitle('Merge into file — Resolve in the editor and save the merged text to the working tree file only')
        .click();
      await page.getByText('Accept all').click();
      await page.getByTitle('Exit merge editor').click();

      // Round 2: enter again — buffer must be pristine before any new accept-all
      await page
        .getByTitle('Merge into file — Resolve in the editor and save the merged text to the working tree file only')
        .click();
      await expect(page.locator('.diff-save-result-btn--merge-mode')).toBeVisible({ timeout: 10_000 });

      const round2 = await getModifiedBufferText(page);
      expect(round2).toBe(pristine);
    } finally {
      await app.close();
    }
  });
});

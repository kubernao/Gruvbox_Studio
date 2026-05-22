import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

type LaunchOptions = {
  fixtureRoot?: string;
  extraEnv?: Record<string, string>;
};

function runNodeScript(scriptRelative: string): { status: number; stdout: string; stderr: string } {
  const scriptPath = path.resolve(process.cwd(), scriptRelative);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: 'pipe',
  });
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

/** Ensures `out/` has a packaged app (runs `npm run package` once if needed). */
function ensureE2EPackagedApp(): void {
  const res = runNodeScript('scripts/ensure-e2e-package.cjs');
  if (res.status !== 0) {
    throw new Error(
      `E2E packaged app preflight failed.\n${res.stderr || res.stdout || 'Run: npm run test:e2e:preflight'}`,
    );
  }
}

function resolvePackagedExecutablePath(): string {
  const res = runNodeScript('scripts/resolve-packaged-app.cjs');
  const exe = res.stdout.trim().split('\n').pop()?.trim() ?? '';
  if (res.status !== 0 || !exe) {
    throw new Error(
      `Could not resolve packaged app executable.\n${res.stderr || res.stdout || 'Run: npm run package'}`,
    );
  }
  return exe;
}

function resolvePackagedAppAsarPath(executablePath: string): string {
  if (process.platform === 'darwin') {
    const appRoot = path.resolve(executablePath, '..', '..', '..');
    return path.join(appRoot, 'Contents', 'Resources', 'app.asar');
  }
  if (process.platform === 'win32') {
    const appRoot = path.resolve(executablePath, '..');
    return path.join(appRoot, 'resources', 'app.asar');
  }
  const appRoot = path.resolve(executablePath, '..');
  return path.join(appRoot, 'resources', 'app.asar');
}

export async function pickAppPage(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const candidateUrl = candidate.url();
      if (/devtools/i.test(candidateUrl)) {
        continue;
      }
      if ((await candidate.locator('#root').count()) > 0) {
        return candidate;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return app.firstWindow();
}

export async function launchElectronApp(options: LaunchOptions = {}): Promise<{ app: ElectronApplication; page: Page }> {
  ensureE2EPackagedApp();
  const executablePath = resolvePackagedExecutablePath();
  const appAsarPath = resolvePackagedAppAsarPath(executablePath);
  const fixtureRoot = options.fixtureRoot ?? path.resolve(process.cwd(), 'tests/fixtures/sample-project');
  const launchEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GRUVBOX_E2E: '1',
    E2E_FIXTURE_ROOT: fixtureRoot,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || 'e2e-test-key',
    ...(options.extraEnv ?? {}),
  };
  // Some shells export this for Node helpers; E2E needs full Electron mode.
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'gruvbox-e2e-userdata-'));
  const app = await electron.launch({
    args: [appAsarPath, `--user-data-dir=${userDataDir}`],
    env: launchEnv,
  });
  await app.evaluate(async ({ BrowserWindow }) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
      const target =
        windows.find((win) => {
          const url = win.webContents?.getURL?.() ?? '';
          return !/devtools/i.test(url);
        }) ?? windows[0];

      if (target) {
        target.setFullScreen(true);
        if (!target.isFullScreen()) {
          target.maximize();
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
  const page = await pickAppPage(app);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#root')).toBeVisible({ timeout: 20_000 });
  return { app, page };
}

/** Align assistant autopilot with `enabled` by toggling the Pi tab control (default onboarding is autopilot on). */
export async function setAssistantAutopilot(page: Page, enabled: boolean): Promise<void> {
  const toggle = page.getByTestId('ai-autopilot-toggle');
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 3; i += 1) {
    const pressed = await toggle.getAttribute('aria-pressed');
    const isOn = pressed === 'true';
    if (isOn === enabled) {
      return;
    }
    await toggle.click();
  }
  const final = await toggle.getAttribute('aria-pressed');
  const isOn = final === 'true';
  if (isOn !== enabled) {
    throw new Error(`Could not set autopilot to ${enabled} (aria-pressed=${final ?? ''})`);
  }
}

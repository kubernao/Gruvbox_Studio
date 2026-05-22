import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Gruvbox Studio Electron app
 */
export default defineConfig({
  // Test directory and pattern
  testDir: './tests/e2e',
  testMatch: '**/*.test.ts',

  // Fully parallel execution
  fullyParallel: true,

  // Fail build on CI if test fails
  forbidOnly: !!process.env.CI,

  // Retry failed tests
  retries: process.env.CI ? 2 : 0,

  // Stable path layout for committed visual baselines
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',

  // Workers (set to 1 for Electron to avoid multi-instance issues)
  workers: 1,

  // Reporter
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : 'list',

  // Shared settings
  use: {
    // Stabilize rendering for visual comparisons
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    deviceScaleFactor: 1,

    // Collect traces on failure
    trace: 'on-first-retry',

    // Collect screenshots on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',
  },

  expect: {
    timeout: 10_000,
  },

  // Projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Output directory for test artifacts
  outputDir: 'test-results',
});

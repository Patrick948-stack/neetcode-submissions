import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 10_000,
  // Each test gets a fresh browser context and page by default.
  // file:// URLs don't need a baseURL.
  projects: [
    {
      name: 'chromium',
      use: {
        // Use the pre-installed Chromium in this environment rather than the
        // version bundled with the @playwright/test package.
        launchOptions: {
          executablePath: '/opt/pw-browsers/chromium',
          args: ['--no-sandbox'],
        },
      },
    },
  ],
  reporter: 'list',
});

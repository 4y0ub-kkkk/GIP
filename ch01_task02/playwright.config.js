import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const port = process.env.PORT ?? '5173';
const baseURL = `http://127.0.0.1:${port}`;
const systemChrome = '/usr/bin/google-chrome';
const executablePath =
  process.env.CHROME_PATH ||
  (existsSync(systemChrome) ? systemChrome : undefined);

export default defineConfig({
  testDir: './browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath,
      args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});

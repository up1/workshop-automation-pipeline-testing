import { defineConfig } from '@playwright/test';

const PORT = 3100;
const baseURL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

// ใช้ browser ที่ติดตั้งในเครื่องได้ เช่น PW_CHANNEL=chrome (ถ้าไม่ตั้ง จะใช้ Chromium ของ Playwright)
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0, // test ที่ผ่านตอน retry จะถูกรายงานเป็น "flaky"
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'results/junit.xml' }]],
  use: {
    baseURL,
    testIdAttribute: 'data-testid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.PW_VIDEO === 'off' ? 'off' : 'retain-on-failure',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'node src/server.js',
        url: `${baseURL}/api/health`,
        env: { PORT: String(PORT), DB_PATH: ':memory:' },
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
  projects: [
    {
      name: 'ui-mock',
      testMatch: /ui\/.*\.(mock|har)\.spec\.ts/,
      use: { browserName: 'chromium', channel },
    },
    {
      name: 'ui-real',
      testMatch: /ui\/.*\.real\.spec\.ts/,
      use: { browserName: 'chromium', channel },
    },
    {
      name: 'api',
      testMatch: /api\/.*\.spec\.ts/,
    },
  ],
});

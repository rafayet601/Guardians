import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_PORT ?? 8081);

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  // One retry on CI only: the first page load compiles the whole bundle, and a
  // cold, busy runner can occasionally push one assertion past its timeout.
  retries: process.env.CI ? 1 : 0,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices['iPhone 13'],
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx expo start --web --port ${port} --max-workers 2`,
    url: `http://127.0.0.1:${port}`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      CI: '1',
      EXPO_PUBLIC_SUPABASE_URL: 'https://release-test.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'release-test-public-anon-key',
    },
  },
});

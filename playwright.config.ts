import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', outputDir: 'test-results/browser-artifacts', retries: 0, workers: 1, timeout: 30000,
  use: { baseURL: process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), headless: true, trace: 'off', screenshot: 'only-on-failure' },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]]
});

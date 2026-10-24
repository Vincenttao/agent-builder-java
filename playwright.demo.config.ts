import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',testMatch:'prebuilt-sample.spec.ts',outputDir:'test-results/rp-01/browser',
  retries:0,workers:1,timeout:600_000,
  use:{baseURL:'http://127.0.0.1:5173',channel:process.env.PLAYWRIGHT_CHANNEL??'msedge',headless:true,trace:'off',screenshot:'only-on-failure',actionTimeout:15000},
  reporter:[['list'],['json',{outputFile:'test-results/rp-01/browser-report.json'}]]
});

import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
    baseURL: 'file://' + path.resolve(__dirname, 'e2e/harness/index.html'),
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
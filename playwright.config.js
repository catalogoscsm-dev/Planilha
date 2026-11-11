import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout:  30000,
  use: {
    baseURL:  'http://localhost:8000',
    headless: true,
  },
  webServer: {
    command:             'python -m http.server 8000',
    url:                 'http://localhost:8000',
    reuseExistingServer: true,
    timeout:             10000,
  },
});

import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block' },
  webServer: { command: 'npm run build -w shared && node --import tsx scripts/demo/server.ts', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 30_000 },
  reporter: 'list'
});

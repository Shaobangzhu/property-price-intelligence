import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: 'tests/e2e', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5173' }, webServer: { command: 'npm run build -w shared && npm run dev:client', url: 'http://127.0.0.1:5173', reuseExistingServer: false, timeout: 30_000 }, reporter: 'list' });

import { chromium } from '@playwright/test';
import { DEMO_ADDRESS, installMockApi } from '../../tests/e2e/support/mock-api.js';
import { DEMO_ORIGIN, startDemoServer } from './server.js';

const server = await startDemoServer();
try {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await installMockApi(page);
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const notice = document.createElement('div');
      notice.setAttribute('role', 'status');
      notice.textContent = 'SYNTHETIC DEMO · Prepared property and explanation · Schematic map · No live providers or database writes';
      notice.style.cssText = 'position:sticky;top:0;z-index:10000;background:#102b37;color:white;padding:10px 20px;text-align:center;font:600 13px system-ui';
      document.body.prepend(notice);
    });
  });
  await page.goto(`${DEMO_ORIGIN}/dashboard?mapTestMode=1`);
  await page.getByRole('textbox', { name: 'Search a property address' }).fill(DEMO_ADDRESS);
  console.log('Synthetic PPI demo ready. Click Search in the opened Chromium window. Close that window or press Ctrl+C to reset all demo records.');
  await new Promise<void>(resolve => {
    browser.once('disconnected', () => resolve());
    process.once('SIGINT', () => { void browser.close(); });
    process.once('SIGTERM', () => { void browser.close(); });
  });
} finally {
  await server.close();
}

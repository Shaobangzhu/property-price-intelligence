import { expect, it, vi } from 'vitest';
import { resolveConfig } from 'vite';
import devConfig from '../client/vite.config.js';
import { startDemoServer } from '../scripts/demo/server.js';

vi.mock('vite', async importOriginal => {
  const vite = await importOriginal<typeof import('vite')>();
  return { ...vite, createServer: vi.fn(async options => ({
    config: await vite.resolveConfig(options, 'serve'), listen: vi.fn()
  })) };
});

it('keeps E2E/demo optimization artifacts separate from live dev popup modules for the same client root', async () => {
  const demo = await startDemoServer();
  const dev = await resolveConfig({ ...devConfig, root: demo.config.root, configFile: false, envDir: false }, 'serve');
  expect(demo.config.root).toBe(dev.root);
  expect(demo.config.mode).not.toBe(dev.mode);
  expect(demo.config.cacheDir).not.toBe(dev.cacheDir);
  expect(demo.config.envDir).toBe(false);
  expect(demo.config.server.proxy).toBeUndefined();
});

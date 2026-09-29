import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['**/*.test.{ts,tsx}'], exclude: ['tests/e2e/**', '**/node_modules/**'], setupFiles: ['tests/setup.ts'], restoreMocks: true, unstubGlobals: true } });

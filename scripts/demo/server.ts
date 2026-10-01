import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

export const DEMO_ORIGIN = 'http://127.0.0.1:4173';

/** Isolated browser shell: no environment files, API proxy, database, or provider clients. */
export async function startDemoServer() {
  const server = await createServer({
    configFile: false, mode: 'test', root: fileURLToPath(new URL('../../client', import.meta.url)), envDir: false, plugins: [react()],
    server: { host: '127.0.0.1', port: 4173, strictPort: true },
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api'), 'import.meta.env.VITE_ARCGIS_API_KEY': JSON.stringify('') }
  });
  await server.listen();
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startDemoServer();
  console.log('Isolated PPI browser shell listening on loopback port 4173. API requests require the explicit test/demo adapter.');
  const stop = async () => { await server.close(); process.exit(0); };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

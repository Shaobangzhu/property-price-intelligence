import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const port = 5173;
const canonicalLoopbackOrigin = (): Plugin => ({
  name: 'ppi-canonical-loopback-origin',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      // The existing ArcGIS browser key is authorized for localhost. Canonicalize
      // only document navigation, leaving the API proxy and asset requests intact.
      if (request.method === 'GET' && request.headers.host === `127.0.0.1:${port}` && request.headers.accept?.includes('text/html')) {
        response.writeHead(302, { Location: `http://localhost:${port}${request.url ?? '/'}`, 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      next();
    });
  }
});

export default defineConfig({ plugins: [canonicalLoopbackOrigin(), react()], server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } } });

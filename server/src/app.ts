import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { CheckDatabase } from './infrastructure/database.js';

export function createApp(options: { checkDatabase: CheckDatabase; origins: string[]; log?: (entry: { code: string; requestId: string }) => void }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => { res.locals.requestId = randomUUID(); res.setHeader('x-request-id', res.locals.requestId); next(); });
  app.use(cors({ origin: options.origins }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health/live', (_req, res) => res.json({ status: 'live', requestId: res.locals.requestId }));
  app.get('/api/health/ready', async (_req, res) => { const ready = await options.checkDatabase(); res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable', requestId: res.locals.requestId }); });
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found', requestId: res.locals.requestId } }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const code = error?.type === 'entity.too.large' ? 'BODY_TOO_LARGE' : error instanceof SyntaxError && 'body' in error ? 'INVALID_JSON' : 'INTERNAL_ERROR';
    options.log?.({ code, requestId: res.locals.requestId });
    res.status(code === 'BODY_TOO_LARGE' ? 413 : code === 'INVALID_JSON' ? 400 : 500).json({ error: { code, message: code === 'INTERNAL_ERROR' ? 'Request failed' : 'Invalid request body', requestId: res.locals.requestId } });
  };
  app.use(errors);
  return app;
}

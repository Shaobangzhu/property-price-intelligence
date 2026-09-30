import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { CheckDatabase } from './infrastructure/database.js';
import type { PropertyService } from './properties/service.js';
import { PropertyError } from './properties/service.js';
import { propertyRouter } from './properties/routes.js';
import type { MarketEvidenceService } from './market/service.js';
import type { AssignedSchoolsService } from './context/schools.js';
import type { GroceryContextService } from './context/grocery.js';
import type { HazardContextService } from './context/hazards.js';
import type { PricingPreviewService } from './pricing/service.js';
import type { AnalysisService } from './analysis/service.js';
import { analysisRouter } from './analysis/routes.js';

export function createApp(options: { checkDatabase: CheckDatabase; origins: string[]; propertyService?: PropertyService; marketService?: MarketEvidenceService; schoolsService?: AssignedSchoolsService; groceryService?: GroceryContextService; hazardService?: HazardContextService; pricingService?: PricingPreviewService; analysisService?: AnalysisService; log?: (entry: { code: string; requestId: string }) => void }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => { res.locals.requestId = randomUUID(); res.setHeader('x-request-id', res.locals.requestId); next(); });
  app.use(cors({ origin: options.origins }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health/live', (_req, res) => res.json({ status: 'live', requestId: res.locals.requestId }));
  app.get('/api/health/ready', async (_req, res) => { const ready = await options.checkDatabase(); res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable', requestId: res.locals.requestId }); });
  if (options.propertyService) app.use('/api/properties', propertyRouter(options.propertyService, options.marketService, options.schoolsService, options.groceryService, options.hazardService, options.pricingService, options.analysisService));
  if (options.analysisService) app.use('/api/analyses', analysisRouter(options.analysisService));
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found', requestId: res.locals.requestId } }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const code = error instanceof PropertyError ? error.code : error?.type === 'entity.too.large' ? 'BODY_TOO_LARGE' : error instanceof SyntaxError && 'body' in error ? 'INVALID_JSON' : 'INTERNAL_ERROR';
    options.log?.({ code, requestId: res.locals.requestId });
    const status = error instanceof PropertyError ? error.status : code === 'BODY_TOO_LARGE' ? 413 : code === 'INVALID_JSON' ? 400 : 500;
    res.status(status).json({ error: { code, message: error instanceof PropertyError ? code.replaceAll('_', ' ').toLowerCase() : code === 'INTERNAL_ERROR' ? 'Request failed' : 'Invalid request body', requestId: res.locals.requestId } });
  };
  app.use(errors);
  return app;
}

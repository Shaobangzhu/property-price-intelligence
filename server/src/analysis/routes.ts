import { Router } from 'express';
import { PropertyId } from '@ppi/shared';
import { PropertyError } from '../properties/service.js';
import type { AnalysisService } from './service.js';

export function analysisRouter(service: AnalysisService) {
  const router = Router();
  router.get('/:id', async (req, res) => {
    const id = PropertyId.safeParse(req.params.id);
    if (!id.success) throw new PropertyError('INVALID_ANALYSIS_ID', 400);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(await service.get(id.data));
  });
  router.post('/:id/regenerate-explanation', async (req, res) => {
    const id = PropertyId.safeParse(req.params.id);
    const key = PropertyId.safeParse(req.header('Idempotency-Key'));
    if (!id.success) throw new PropertyError('INVALID_ANALYSIS_ID', 400);
    if (!key.success) throw new PropertyError('INVALID_REQUEST_KEY', 400);
    if (req.body && Object.keys(req.body).length) throw new PropertyError('INVALID_INPUT', 400);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(await service.regenerate(id.data, key.data));
  });
  return router;
}

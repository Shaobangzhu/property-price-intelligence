import { Router, type Request } from 'express';
import { ListPropertiesQuery, PropertyId, PropertyPatchInput, ResolvePropertyInput } from '@ppi/shared';
import { PropertyError, type PropertyService } from './service.js';
import type { MarketEvidenceService } from '../market/service.js';
import type { AssignedSchoolsService } from '../context/schools.js';
import type { GroceryContextService } from '../context/grocery.js';

function idFrom(request: Request): string {
  const parsed = PropertyId.safeParse(request.params.id);
  if (!parsed.success) throw new PropertyError('INVALID_PROPERTY_ID', 400);
  return parsed.data;
}

export function propertyRouter(service: PropertyService, market?: MarketEvidenceService, schools?: AssignedSchoolsService, grocery?: GroceryContextService) {
  const router = Router();
  router.post('/resolve', async (req, res) => {
    const parsed = ResolvePropertyInput.safeParse(req.body);
    if (!parsed.success) throw new PropertyError('INVALID_INPUT', 400);
    res.json(await service.resolve(parsed.data.address));
  });
  router.get('/', async (req, res) => {
    const parsed = ListPropertiesQuery.safeParse(req.query);
    if (!parsed.success) throw new PropertyError('INVALID_QUERY', 400);
    res.json(await service.list(parsed.data));
  });
  router.get('/:id', async (req, res) => res.json(await service.get(idFrom(req))));
  if (market) router.get('/:id/market-context', async (req, res) => res.json(await market.get(idFrom(req))));
  if (schools) router.get('/:id/assigned-schools', async (req, res) => res.json(await schools.get(idFrom(req))));
  if (grocery) router.get('/:id/nearby-places', async (req, res) => {
    if (req.query.category !== 'grocery' || Object.keys(req.query).length !== 1) throw new PropertyError('INVALID_QUERY', 400);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.json(await grocery.get(idFrom(req)));
  });
  router.patch('/:id', async (req, res) => {
    const parsed = PropertyPatchInput.safeParse(req.body);
    if (!parsed.success) throw new PropertyError('INVALID_INPUT', 400);
    res.json(await service.patch(idFrom(req), parsed.data));
  });
  router.post('/:id/refresh', async (req, res) => res.json(await service.refresh(idFrom(req))));
  router.delete('/:id', async (req, res) => { await service.delete(idFrom(req)); res.status(204).end(); });
  return router;
}

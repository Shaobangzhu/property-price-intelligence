import { Router, type Request } from 'express';
import { ListPropertiesQuery, PropertyId, PropertyPatchInput, ResolvePropertyInput } from '@ppi/shared';
import { PropertyError, type PropertyService } from './service.js';

function idFrom(request: Request): string {
  const parsed = PropertyId.safeParse(request.params.id);
  if (!parsed.success) throw new PropertyError('INVALID_PROPERTY_ID', 400);
  return parsed.data;
}

export function propertyRouter(service: PropertyService) {
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
  router.patch('/:id', async (req, res) => {
    const parsed = PropertyPatchInput.safeParse(req.body);
    if (!parsed.success) throw new PropertyError('INVALID_INPUT', 400);
    res.json(await service.patch(idFrom(req), parsed.data));
  });
  router.post('/:id/refresh', async (req, res) => res.json(await service.refresh(idFrom(req))));
  router.delete('/:id', async (req, res) => { await service.delete(idFrom(req)); res.status(204).end(); });
  return router;
}

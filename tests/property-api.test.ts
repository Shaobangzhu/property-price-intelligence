import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/src/app.js';
import { PropertyError, type PropertyService } from '../server/src/properties/service.js';
import type { MarketEvidenceService } from '../server/src/market/service.js';
import type { AssignedSchoolsService } from '../server/src/context/schools.js';
import type { GroceryContextService } from '../server/src/context/grocery.js';
import type { HazardContextService } from '../server/src/context/hazards.js';
import type { PricingPreviewService } from '../server/src/pricing/service.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function setup() {
  const service = {
    resolve: vi.fn().mockResolvedValue({ property: { id }, cache: { cacheStatus: 'MISS' } }),
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 }),
    get: vi.fn().mockResolvedValue({ property: { id } }),
    patch: vi.fn().mockResolvedValue({ property: { id, notes: 'reviewed' } }),
    refresh: vi.fn().mockResolvedValue({ property: { id }, cache: { cacheStatus: 'REFRESHED' } }),
    delete: vi.fn().mockResolvedValue(undefined)
  };
  const marketService = { get: vi.fn().mockResolvedValue({ propertyId: id, recordedSales: { kind: 'RECORDED_SALES', candidates: [] }, activeListings: { kind: 'ACTIVE_LISTINGS', candidates: [] } }) };
  const schoolsService = { get: vi.fn().mockResolvedValue({ propertyId: id, status: 'ASSIGNMENT_UNAVAILABLE', schools: [], assignmentSource: null }) };
  const groceryService = { get: vi.fn().mockResolvedValue({ propertyId: id, status: 'NO_RESULTS', places: [], source: 'ARCGIS_PLACES', radiusMeters: 1600 }) };
  const hazardService = { getWildfire: vi.fn().mockResolvedValue({ propertyId: id, status: 'NO_COVERAGE' }), getFaults: vi.fn().mockResolvedValue({ propertyId: id, contextType: 'FAULT_TRACE', status: 'NO_NEARBY_FEATURES' }) };
  const pricingService = { preview: vi.fn().mockResolvedValue({ status: 'INSUFFICIENT_EVIDENCE', engineVersion: 'ppi-pricing-v1', referencePrice: null }) };
  const app = createApp({ checkDatabase: async () => true, origins: ['http://localhost:5173'], propertyService: service as unknown as PropertyService, marketService: marketService as unknown as MarketEvidenceService, schoolsService: schoolsService as unknown as AssignedSchoolsService, groceryService: groceryService as unknown as GroceryContextService, hazardService: hazardService as unknown as HazardContextService, pricingService: pricingService as unknown as PricingPreviewService });
  return { app, service, marketService, schoolsService, groceryService, hazardService, pricingService };
}

describe('property REST routes', () => {
  it.each([
    ['https://untrusted.example', 'cross-site'], ['http://localhost:5174', 'same-site'], ['null', 'cross-site'],
    [null, 'cross-site'], [null, 'same-site']
  ])('blocks untrusted browser requests before provider work (%s, %s)', async (origin, fetchSite) => {
    const { app, service, groceryService } = setup();
    const grocery = request(app).get(`/api/properties/${id}/nearby-places?category=grocery`).set('Sec-Fetch-Site', fetchSite!);
    const resolve = request(app).post('/api/properties/resolve').set('Sec-Fetch-Site', fetchSite!).send({ address: '123 Main St, Austin, TX 78701' });
    if (origin !== null) { grocery.set('Origin', origin!); resolve.set('Origin', origin!); }
    for (const response of await Promise.all([grocery, resolve])) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('REQUEST_ORIGIN_NOT_ALLOWED');
    }
    expect(groceryService.get).not.toHaveBeenCalled();
    expect(service.resolve).not.toHaveBeenCalled();
  });

  it('allows the configured browser origin, same-origin proxy requests, and local CLI requests', async () => {
    const { app, groceryService } = setup();
    const path = `/api/properties/${id}/nearby-places?category=grocery`;
    expect((await request(app).get(path).set('Origin', 'http://localhost:5173').set('Sec-Fetch-Site', 'cross-site')).status).toBe(200);
    expect((await request(app).get(path).set('Sec-Fetch-Site', 'same-origin')).status).toBe(200);
    expect((await request(app).get(path)).status).toBe(200);
    expect(groceryService.get).toHaveBeenCalledTimes(3);
  });

  it('validates input and keeps provider-owned fields out of PATCH', async () => {
    const { app, service } = setup();
    expect((await request(app).post('/api/properties/resolve').send({ address: 'short' })).status).toBe(400);
    expect((await request(app).patch(`/api/properties/${id}`).send({ bedrooms: 9 })).status).toBe(400);
    expect((await request(app).patch(`/api/properties/${id}`).send({ overrides: { bedrooms: -1 } })).status).toBe(400);
    expect((await request(app).get('/api/properties?page=0')).status).toBe(400);
    expect((await request(app).get('/api/properties/not-a-uuid')).status).toBe(400);
    expect((await request(app).get('/api/properties/not-a-uuid/market-context')).status).toBe(400);
    expect((await request(app).get(`/api/properties/${id}/nearby-places?category=schools`)).status).toBe(400);
    expect((await request(app).get('/api/properties/not-a-uuid/wildfire-context')).status).toBe(400);
    expect((await request(app).get('/api/properties/not-a-uuid/fault-context')).status).toBe(400);
    expect((await request(app).post(`/api/properties/${id}/pricing/preview`).send({ mode: 'OFFER', strategyProfile: 'BALANCED', wildfire: 'High' })).status).toBe(400);
    expect((await request(app).post(`/api/properties/${id}/pricing/preview`).send({ mode: 'OFFER', strategyProfile: 'BALANCED', maxBudget: -1 })).status).toBe(400);
    expect((await request(app).post(`/api/properties/${id}/pricing/preview`).send({ mode: 'LISTING', strategyProfile: 'COMPETITIVE' })).status).toBe(400);
    expect(service.resolve).not.toHaveBeenCalled();
    expect(service.patch).not.toHaveBeenCalled();
  });

  it('routes resolve, pagination, view, patch, refresh, and delete', async () => {
    const { app, service, marketService, schoolsService, groceryService, hazardService, pricingService } = setup();
    const resolved = await request(app).post('/api/properties/resolve').send({ address: '123 Main St, Austin, TX 78701' });
    expect(resolved.status).toBe(200);
    expect(service.resolve).toHaveBeenCalledWith('123 Main St, Austin, TX 78701');
    expect((await request(app).get('/api/properties?page=2&pageSize=5&search=Main')).status).toBe(200);
    expect(service.list).toHaveBeenCalledWith({ page: 2, pageSize: 5, search: 'Main' });
    expect((await request(app).get(`/api/properties/${id}`)).status).toBe(200);
    expect((await request(app).get(`/api/properties/${id}/market-context`)).body.propertyId).toBe(id);
    expect(marketService.get).toHaveBeenCalledWith(id);
    expect((await request(app).get(`/api/properties/${id}/assigned-schools`)).body.status).toBe('ASSIGNMENT_UNAVAILABLE');
    expect(schoolsService.get).toHaveBeenCalledWith(id);
    const places = await request(app).get(`/api/properties/${id}/nearby-places?category=grocery`);
    expect(places.body.status).toBe('NO_RESULTS');
    expect(places.headers['cache-control']).toContain('no-store');
    expect(groceryService.get).toHaveBeenCalledWith(id);
    expect((await request(app).get(`/api/properties/${id}/wildfire-context`)).body.status).toBe('NO_COVERAGE');
    expect((await request(app).get(`/api/properties/${id}/fault-context`)).body.contextType).toBe('FAULT_TRACE');
    expect(hazardService.getWildfire).toHaveBeenCalledWith(id);
    expect(hazardService.getFaults).toHaveBeenCalledWith(id);
    const preview = await request(app).post(`/api/properties/${id}/pricing/preview`).send({ mode: 'OFFER', strategyProfile: 'BALANCED', maxBudget: 400000 });
    expect(preview.status).toBe(200);
    expect(preview.headers['cache-control']).toContain('no-store');
    expect(preview.body.engineVersion).toBe('ppi-pricing-v1');
    expect(pricingService.preview).toHaveBeenCalledWith(id, { mode: 'OFFER', strategyProfile: 'BALANCED', maxBudget: 400000 });
    expect((await request(app).patch(`/api/properties/${id}`).send({ notes: 'reviewed', overrides: { bedrooms: 3 } })).status).toBe(200);
    expect(service.patch).toHaveBeenCalledWith(id, { notes: 'reviewed', overrides: { bedrooms: 3 } });
    expect((await request(app).post(`/api/properties/${id}/refresh`)).status).toBe(200);
    expect((await request(app).delete(`/api/properties/${id}`)).status).toBe(204);
  });

  it('returns structured ambiguity without leaking provider details', async () => {
    const { app, service } = setup();
    service.resolve.mockRejectedValueOnce(new PropertyError('AMBIGUOUS_PROPERTY', 409));
    const response = await request(app).post('/api/properties/resolve').send({ address: '123 Main St, Austin, TX 78701' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('AMBIGUOUS_PROPERTY');
    expect(response.body.error.requestId).toBeTruthy();
  });
});

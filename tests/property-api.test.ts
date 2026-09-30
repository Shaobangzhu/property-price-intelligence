import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/src/app.js';
import { PropertyError, type PropertyService } from '../server/src/properties/service.js';
import type { MarketEvidenceService } from '../server/src/market/service.js';

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
  const app = createApp({ checkDatabase: async () => true, origins: ['http://localhost:5173'], propertyService: service as unknown as PropertyService, marketService: marketService as unknown as MarketEvidenceService });
  return { app, service, marketService };
}

describe('property REST routes', () => {
  it('validates input and keeps provider-owned fields out of PATCH', async () => {
    const { app, service } = setup();
    expect((await request(app).post('/api/properties/resolve').send({ address: 'short' })).status).toBe(400);
    expect((await request(app).patch(`/api/properties/${id}`).send({ bedrooms: 9 })).status).toBe(400);
    expect((await request(app).patch(`/api/properties/${id}`).send({ overrides: { bedrooms: -1 } })).status).toBe(400);
    expect((await request(app).get('/api/properties?page=0')).status).toBe(400);
    expect((await request(app).get('/api/properties/not-a-uuid')).status).toBe(400);
    expect((await request(app).get('/api/properties/not-a-uuid/market-context')).status).toBe(400);
    expect(service.resolve).not.toHaveBeenCalled();
    expect(service.patch).not.toHaveBeenCalled();
  });

  it('routes resolve, pagination, view, patch, refresh, and delete', async () => {
    const { app, service, marketService } = setup();
    const resolved = await request(app).post('/api/properties/resolve').send({ address: '123 Main St, Austin, TX 78701' });
    expect(resolved.status).toBe(200);
    expect(service.resolve).toHaveBeenCalledWith('123 Main St, Austin, TX 78701');
    expect((await request(app).get('/api/properties?page=2&pageSize=5&search=Main')).status).toBe(200);
    expect(service.list).toHaveBeenCalledWith({ page: 2, pageSize: 5, search: 'Main' });
    expect((await request(app).get(`/api/properties/${id}`)).status).toBe(200);
    expect((await request(app).get(`/api/properties/${id}/market-context`)).body.propertyId).toBe(id);
    expect(marketService.get).toHaveBeenCalledWith(id);
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

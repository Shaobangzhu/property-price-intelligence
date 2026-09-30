import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/src/app.js';
import { PropertyError, type PropertyService } from '../server/src/properties/service.js';
import type { AnalysisService } from '../server/src/analysis/service.js';

const propertyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const analysisId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestKey = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const settings = { mode: 'OFFER', strategyProfile: 'BALANCED', maxBudget: null };

function setup() {
  const property = { get: vi.fn().mockResolvedValue({ property: { id: propertyId } }) } as unknown as PropertyService;
  const analyses = {
    create: vi.fn().mockResolvedValue({ id: analysisId, status: 'SUCCEEDED' }),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    get: vi.fn().mockResolvedValue({ id: analysisId, status: 'SUCCEEDED' }),
    regenerate: vi.fn().mockResolvedValue({ id: analysisId, status: 'SUCCEEDED' })
  };
  const app = createApp({ checkDatabase: async () => true, origins: ['http://localhost:5173'],
    propertyService: property, analysisService: analyses as unknown as AnalysisService });
  return { app, analyses, property };
}

describe('analysis API', () => {
  it('validates create payloads and forwards idempotency identity', async () => {
    const { app, analyses } = setup();
    const invalid = await request(app).post(`/api/properties/${propertyId}/analyses`).send({ mode: 'OFFER', strategyProfile: 'UNKNOWN' });
    expect(invalid.status).toBe(400);
    expect(analyses.create).not.toHaveBeenCalled();
    const created = await request(app).post(`/api/properties/${propertyId}/analyses`).set('Idempotency-Key', requestKey).send(settings);
    expect(created.status).toBe(200);
    expect(created.headers['cache-control']).toContain('no-store');
    expect(analyses.create).toHaveBeenCalledWith(propertyId, settings, requestKey);
    const badKey = await request(app).post(`/api/properties/${propertyId}/analyses`).set('Idempotency-Key', 'not-a-uuid').send(settings);
    expect(badKey.status).toBe(400);
  });
  it('lists runs and retrieves an exact run without invoking the pricing engine', async () => {
    const { app, analyses, property } = setup();
    const listed = await request(app).get(`/api/properties/${propertyId}/analyses`);
    expect(listed.status).toBe(200);
    expect(analyses.list).toHaveBeenCalledWith(propertyId);
    expect(property.get).toHaveBeenCalledWith(propertyId);
    const exact = await request(app).get(`/api/analyses/${analysisId}`);
    expect(exact.status).toBe(200);
    expect(analyses.get).toHaveBeenCalledWith(analysisId);
    expect(analyses.create).not.toHaveBeenCalled();
  });
  it('requires request identity for regenerate and returns safe failures', async () => {
    const { app, analyses } = setup();
    expect((await request(app).post(`/api/analyses/${analysisId}/regenerate-explanation`).send({})).status).toBe(400);
    const renewed = await request(app).post(`/api/analyses/${analysisId}/regenerate-explanation`).set('Idempotency-Key', requestKey).send({});
    expect(renewed.status).toBe(200);
    expect(analyses.regenerate).toHaveBeenCalledWith(analysisId, requestKey);
    analyses.get.mockRejectedValueOnce(new PropertyError('ANALYSIS_NOT_FOUND', 404));
    const absent = await request(app).get(`/api/analyses/${analysisId}`);
    expect(absent.status).toBe(404);
    expect(JSON.stringify(absent.body)).not.toContain('OPENAI_API_KEY');
  });
});

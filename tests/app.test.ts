import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/src/app.js';

describe('health and safe errors', () => {
  it('keeps liveness independent of database and reports readiness', async () => {
    const checkDatabase = vi.fn().mockResolvedValue(false);
    const app = createApp({ checkDatabase, origins: ['http://localhost:5173'] });
    const live = await request(app).get('/api/health/live');
    expect(live.status).toBe(200); expect(live.body.status).toBe('live'); expect(checkDatabase).not.toHaveBeenCalled();
    const unavailable = await request(app).get('/api/health/ready');
    expect(unavailable.status).toBe(503); expect(unavailable.body.status).toBe('unavailable');
    checkDatabase.mockResolvedValue(true);
    expect((await request(app).get('/api/health/ready')).status).toBe(200);
  });
  it('returns safe JSON and logs no canary secret', async () => {
    const log = vi.fn(); const app = createApp({ checkDatabase: async () => true, origins: ['http://localhost:5173'], log });
    const canary = 'CANARY_SECRET_456';
    const result = await request(app).post('/api/health/live').set('Content-Type', 'application/json').send(`{"key":"${canary}"`);
    expect(result.status).toBe(400); expect(result.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(result.body) + JSON.stringify(log.mock.calls)).not.toContain(canary);
    expect(result.body.error.requestId).toBeTruthy();
  });
});

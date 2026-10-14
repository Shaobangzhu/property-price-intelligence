import { describe, expect, it, vi } from 'vitest';
import { ZillapiClient, ZillapiError } from '../server/src/context/zillapi.js';
import { runZillapiSmoke } from '../scripts/smoke/zillapi.js';

// Entirely synthetic, not copied from a provider response or a user's property.
const address = '123 Example Street Apt 4, Sample City, CA 90000';
const property = { zpid: '123456', address: { streetAddress: '123 Example St #4', city: 'Sample City', state: 'CA', zipcode: '90000' } };
const nearby = { name: 'Synthetic School', rating: 7, distance: 0.4, type: 'public', level: 'Elementary' };
const key = 'synthetic-server-secret';
const transportFor = (value: unknown) => vi.fn<typeof fetch>(async () => Response.json(value));

describe('Zillapi isolated diagnostic', () => {
  it('projects nearby records without assignment claims, invented coordinates or unrelated provider fields', async () => {
    const transport = transportFor({ data: { ...property, schools: [nearby, { name: 'Unknown level school', level: 'Combined', owner: key }], owner: key } });
    const result = await new ZillapiClient(key, transport).lookupSchools(address);
    expect(result.schools).toEqual([
      { id: expect.stringMatching(/^school:/), name: nearby.name, level: 'ELEMENTARY', levelLabel: 'Elementary', schoolType: 'public',
        rating: 7, distanceMiles: 0.4, latitude: null, longitude: null },
      { id: expect.stringMatching(/^school:/), name: 'Unknown level school', level: 'OTHER', levelLabel: 'Combined', schoolType: null,
        rating: null, distanceMiles: null, latitude: null, longitude: null }
    ]);
    expect(JSON.stringify(result.schools)).not.toMatch(/assignment|synthetic-server-secret|owner|district|grades/);
  });

  it.each([['Elementary', 'ELEMENTARY'], ['Middle', 'MIDDLE'], ['High', 'HIGH']])('groups documented %s levels as %s', async (label, level) => {
    const result = await new ZillapiClient(key, transportFor({ data: { ...property, schools: [{ ...nearby, level: label }] } })).lookupSchools(address);
    expect(result.schools?.[0]?.level).toBe(level);
  });

  it('authenticates on the fixed HTTPS endpoint, encodes addresses and projects schools in one request', async () => {
    const transport = transportFor({ data: { ...property, schools: [nearby], owner: 'discard' } });
    const result = await new ZillapiClient(key, transport).inspectSchools(address);
    const [input, init] = transport.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://api.zillapi.com/v1/properties/by-address');
    expect(url.searchParams.get('address')).toBe(address);
    expect(url.searchParams.get('fields')).toBe('zpid,address,schools');
    expect(url.hash).toBe('');
    expect(url.href).not.toContain(key);
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${key}` }, signal: expect.any(AbortSignal) });
    expect(result).toEqual({ cacheHit: false, requestCount: 1, requests: [{ endpoint: 'BY_ADDRESS', httpStatus: 200, creditsCharged: null }],
      hasZpid: true, hasSchoolRecords: true, assignmentRelatedFields: [], semanticsVerified: false });
    expect(JSON.stringify(result)).not.toMatch(/Synthetic School|discard|123456|Example|synthetic-server-secret/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(['Elementary', 'Middle', 'High'])('does not promote %s nearby records or hypothetical flags into assignments', async level => {
    const transport = transportFor({ data: { ...property, schools: [{ ...nearby, level, isAssigned: true, assigned: true,
      attendanceZone: { secret: 'discard' }, schoolAssignment: true }] } });
    const result = await new ZillapiClient(key, transport).inspectSchools(address);
    expect(result.semanticsVerified).toBe(false);
    expect(result.assignmentRelatedFields).toEqual(['isAssigned', 'assigned', 'attendanceZone', 'schoolAssignment']);
    expect(result).not.toHaveProperty('schools');
    expect(JSON.stringify(result)).not.toContain('discard');
  });

  it.each([{ schools: [] }, { schools: [nearby, { ...nearby, name: 'Second synthetic school' }] }, { schools: [{ name: 'Minimal school' }] }])('accepts empty, multiple and missing optional nearby metadata only as diagnostics', async ({ schools }) => {
    const transport = transportFor({ data: { ...property, schools } });
    expect(await new ZillapiClient(key, transport).inspectSchools(address)).toMatchObject({ requestCount: 1, hasSchoolRecords: !!schools.length, semanticsVerified: false });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('uses the schools subresource only if projection is absent, with at most two sequential requests', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: property }, { headers: { 'X-Credits-Charged': '3' } }))
      .mockResolvedValueOnce(Response.json({ data: [nearby], meta: { discarded: 'secret' } }, { headers: { 'X-Credits-Charged': '1' } }));
    const result = await new ZillapiClient(key, transport).inspectSchools(address);
    expect(String(transport.mock.calls[1]![0])).toBe('https://api.zillapi.com/v1/properties/123456/schools');
    expect(result).toMatchObject({ requestCount: 2, hasSchoolRecords: true, semanticsVerified: false,
      requests: [{ endpoint: 'BY_ADDRESS', creditsCharged: 3 }, { endpoint: 'SCHOOLS', creditsCharged: 1 }] });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('does not invent a zpid or spend another request when it is missing', async () => {
    const transport = transportFor({ data: { address: property.address } });
    expect(await new ZillapiClient(key, transport).inspectSchools(address)).toMatchObject({ requestCount: 1, hasZpid: false, hasSchoolRecords: false });
  });

  it.each([
    { ...property.address, streetAddress: '124 Example St #4' },
    { ...property.address, streetAddress: '123 Example St' },
    { ...property.address, streetAddress: '123 Example St #5' },
    { ...property.address, city: 'Other City' },
    { ...property.address, zipcode: '90001' }
  ])('rejects property and unit mismatches before a school subresource request', async returned => {
    const transport = transportFor({ data: { ...property, address: returned } });
    await expect(new ZillapiClient(key, transport).inspectSchools(address)).rejects.toMatchObject({ code: 'SUBJECT_MISMATCH' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 402, 429, 404, 500, 502, 504, 302])('sanitizes HTTP %s with no retry or upstream error body', async status => {
    const transport = vi.fn<typeof fetch>(async () => new Response(`secret ${key} ${address}`, { status }));
    const expected = status === 401 || status === 403 ? 'AUTH' : status === 402 ? 'CREDITS_EXHAUSTED'
      : status === 429 ? 'RATE_LIMIT' : status === 404 ? 'NOT_FOUND' : status === 504 ? 'TIMEOUT' : 'UPSTREAM';
    const error = await new ZillapiClient(key, transport).inspectSchools(address).catch(error => error);
    expect(error).toBeInstanceOf(ZillapiError);
    expect(error).toMatchObject({ code: expected, requests: [{ endpoint: 'BY_ADDRESS', httpStatus: status }] });
    expect(String(error) + JSON.stringify(error)).not.toMatch(/synthetic-server-secret|Example/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { data: [] }, { data: { ...property, zpid: '../untrusted' } },
    { data: { ...property, schools: [{}] } }, { data: { ...property, schools: Array(101).fill(nearby) } }])('rejects malformed runtime schemas', async value => {
    await expect(new ZillapiClient(key, transportFor(value)).inspectSchools(address)).rejects.toMatchObject({ code: 'MALFORMED' });
  });

  it('rejects malformed JSON and oversized responses by bytes with or without Content-Length', async () => {
    for (const response of [new Response('{bad-json'), new Response('x', { headers: { 'Content-Length': '262145' } }),
      new Response('é'.repeat(140000)), new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(131072)); controller.enqueue(new Uint8Array(131073)); controller.close();
      } }))]) {
      const transport = vi.fn<typeof fetch>(async () => response);
      await expect(new ZillapiClient(key, transport).inspectSchools(address)).rejects.toMatchObject({ code: 'MALFORMED' });
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });

  it.each(['TimeoutError', 'AbortError', 'Error'])('sanitizes transport %s', async name => {
    const transport = vi.fn<typeof fetch>(async () => { const error = new Error(`${key} ${address}`); error.name = name; throw error; });
    await expect(new ZillapiClient(key, transport).inspectSchools(address)).rejects.toMatchObject({ code: name === 'Error' ? 'UPSTREAM' : 'TIMEOUT' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('applies an eight-second abort deadline to fetch', async () => {
    const signal = vi.spyOn(AbortSignal, 'timeout');
    await new ZillapiClient(key, transportFor({ data: { ...property, schools: [] } })).inspectSchools(address);
    expect(signal).toHaveBeenCalledWith(8000);
  });

  it('stops an in-flight request when its deadline aborts, without retry', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const transport = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    const pending = new ZillapiClient(key, transport).inspectSchools(address);
    controller.abort(new DOMException('synthetic-secret', 'TimeoutError'));
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', requests: [{ httpStatus: null }] });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('preserves credit/request metadata if the second endpoint fails and never attempts a third request', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: property }, { headers: { 'X-Credits-Charged': '3' } }))
      .mockResolvedValueOnce(new Response(key, { status: 429 }));
    await expect(new ZillapiClient(key, transport).inspectSchools(address)).rejects.toMatchObject({ code: 'RATE_LIMIT',
      requests: [{ endpoint: 'BY_ADDRESS', httpStatus: 200, creditsCharged: 3 }, { endpoint: 'SCHOOLS', httpStatus: 429, creditsCharged: null }] });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('sanitizes body-read failures', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(key)); } })));
    const error = await new ZillapiClient(key, transport).inspectSchools(address).catch(error => error);
    expect(error.code).toBe('UPSTREAM');
    expect(String(error)).not.toContain(key);
  });

  it('checks configuration and input before spending credits', async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(new ZillapiClient('', transport).inspectSchools(address)).rejects.toMatchObject({ code: 'CONFIGURATION' });
    await expect(new ZillapiClient(key, transport).inspectSchools('short')).rejects.toMatchObject({ code: 'INPUT' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('coalesces same-subject requests, rejects cross-subject concurrency and expires its bounded projection after ten minutes', async () => {
    let time = 0;
    let release!: (value: Response) => void;
    const transport = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
    const client = new ZillapiClient(key, transport, () => time);
    const first = client.inspectSchools(address);
    const duplicate = client.inspectSchools(address);
    await expect(client.inspectSchools(address.replace('123', '124'))).rejects.toMatchObject({ code: 'BUSY' });
    release(Response.json({ data: { ...property, schools: [] } }));
    expect(await duplicate).toEqual(await first);
    expect(transport).toHaveBeenCalledTimes(1);
    const cached = await client.inspectSchools(address);
    expect(cached).toMatchObject({ cacheHit: true, requestCount: 0, requests: [] });
    cached.assignmentRelatedFields.push('should not poison cache');
    expect((await client.inspectSchools(address)).assignmentRelatedFields).toEqual([]);
    time = 600001;
    const expired = client.inspectSchools(address);
    release(Response.json({ data: { ...property, schools: [] } }));
    expect(await expired).toMatchObject({ cacheHit: false, requestCount: 1 });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('bounds metadata cache entries and does not cache failures', async () => {
    const transport = vi.fn<typeof fetch>(async input => {
      const queried = new URL(String(input)).searchParams.get('address')!;
      const number = queried.split(' ')[0];
      return Response.json({ data: { ...property, address: { ...property.address, streetAddress: `${number} Example St #4` }, schools: [] } });
    });
    const client = new ZillapiClient(key, transport);
    for (let i = 123; i < 156; i++) await client.inspectSchools(address.replace('123', String(i)));
    await client.inspectSchools(address);
    expect(transport).toHaveBeenCalledTimes(34);
    const failed = transportFor({ data: {} });
    const failingClient = new ZillapiClient(key, failed);
    for (let i = 0; i < 2; i++) await expect(failingClient.inspectSchools(address)).rejects.toMatchObject({ code: 'MALFORMED' });
    expect(failed).toHaveBeenCalledTimes(2);
  });
});

describe('Zillapi smoke gates', () => {
  it.each([[false, false], [false, true], [true, false]])('requires both --live=%s and environment gate=%s', async (live, gate) => {
    const transport = vi.fn<typeof fetch>();
    expect(await runZillapiSmoke({ ALLOW_LIVE_API_TESTS: gate, ZILLAPI_API_KEY: key, SMOKE_TEST_ADDRESS: address }, { live, transport }))
      .toMatchObject({ status: 'NOT_RUN', requestCount: 0 });
    expect(transport).not.toHaveBeenCalled();
  });
  it('requires an existing smoke address and key and reports sanitized bounded failures', async () => {
    const config = { ALLOW_LIVE_API_TESTS: true, ZILLAPI_API_KEY: key, SMOKE_TEST_ADDRESS: address };
    const transport = vi.fn<typeof fetch>(async () => new Response(key, { status: 402 }));
    for (const missing of [{ ZILLAPI_API_KEY: '' }, { SMOKE_TEST_ADDRESS: '' }]) {
      expect(await runZillapiSmoke({ ...config, ...missing }, { live: true, transport })).toMatchObject({ status: 'NOT_RUN', requestCount: 0 });
    }
    expect(transport).not.toHaveBeenCalled();
    const result = await runZillapiSmoke(config, { live: true, transport });
    expect(result).toMatchObject({ status: 'FAILED', code: 'CREDITS_EXHAUSTED', requestCount: 1, semanticsVerified: false });
    expect(JSON.stringify(result)).not.toContain(key);
  });
  it('never claims live assignment verification from a mocked successful diagnostic', async () => {
    const result = await runZillapiSmoke({ ALLOW_LIVE_API_TESTS: true, ZILLAPI_API_KEY: key, SMOKE_TEST_ADDRESS: address },
      { live: true, transport: transportFor({ data: { ...property, schools: [nearby] } }) });
    expect(result).toMatchObject({ status: 'COMPLETED_UNVERIFIED', requestCount: 1, semanticsVerified: false });
  });
});

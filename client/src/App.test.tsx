// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PropertyEnvelope } from '@ppi/shared';
import { App } from './App.js';

const firstId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const makeRecord = (id = firstId, address = '123 Main St, Apt 2, Austin, TX 78701'): PropertyEnvelope => ({
  property: {
    id, provider: 'RENTCAST', providerPropertyId: `provider-${id}`, normalizedAddressKey: address.toLowerCase().replace(/[^a-z0-9]/g, ''),
    formattedAddress: address, addressLine1: address.split(',')[0]!, unit: 'Apt 2', city: 'Austin', state: 'TX', zipCode: '78701',
    latitude: 30.1, longitude: -97.1, propertyType: 'Condo', bedrooms: 2, bathrooms: 2, livingAreaSqft: 1200,
    lotSizeSqft: null, yearBuilt: 2001, currentListPrice: null, refreshFailedAt: null, notes: null, userOverrides: {},
    effectiveValues: { bedrooms: 2, bathrooms: 2, livingAreaSqft: 1200, yearBuilt: 2001 },
    createdAt: '2026-09-29T12:00:00.000Z', updatedAt: '2026-09-29T12:00:00.000Z'
  },
  cache: { source: 'RENTCAST', fetchedAt: '2026-09-29T12:00:00.000Z', expiresAt: '2026-10-13T12:00:00.000Z', freshness: 'FRESH', cacheStatus: null }
});
const renderAt = (path = '/dashboard') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/health/live')) return Response.json({ status: 'live', requestId: 'synthetic' });
    if (url.includes('/properties?')) return Response.json({ items: [], total: 0, page: 1, pageSize: 5 });
    if (url.endsWith('/properties/resolve') && init?.method === 'POST') return Response.json(makeRecord());
    return Response.json({ error: { code: 'PROPERTY_NOT_FOUND', message: 'not found', requestId: 'synthetic' } }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Dashboard', () => {
  it('navigates to History and starts with no selected property or fixture prices', async () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText('No property selected')).toBeTruthy();
    expect(screen.queryByText('1847 Alder View Lane')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'History' }));
    expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('History empty')).toBeTruthy());
  });

  it('resolves an entered address and leaves pricing and comparables deferred', async () => {
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '123 Main St, Apt 2, Austin, TX 78701' })).toBeTruthy());
    expect(screen.getByText('Comparable sales not available yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Offer Price' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText('Not analyzed', { exact: true }).length).toBe(2);
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/properties/resolve'))).toHaveLength(1);
  });

  it('switches one map context at a time and turns the active layer off', async () => {
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const schools = await screen.findByRole('button', { name: 'Schools' });
    const grocery = screen.getByRole('button', { name: 'Grocery' });
    fireEvent.click(schools);
    expect(schools.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Assigned Schools' })).toBeTruthy();
    fireEvent.click(grocery);
    expect(schools.getAttribute('aria-pressed')).toBe('false');
    expect(grocery.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(grocery);
    expect(grocery.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps a late A response from replacing the newer B search', async () => {
    let resolveA: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (String(input).endsWith('/health/live')) return Promise.resolve(Response.json({ status: 'live', requestId: 'synthetic' }));
      const address = JSON.parse(String(init?.body)).address as string;
      if (address.startsWith('111')) return new Promise<Response>(resolve => { resolveA = resolve; });
      return Promise.resolve(Response.json(makeRecord(secondId, '222 Oak Ave, Apt 2, Austin, TX 78701')));
    });
    renderAt();
    const input = screen.getByRole('textbox', { name: 'Search a property address' });
    fireEvent.change(input, { target: { value: '111 Pine St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByText('Loading property')).toBeTruthy();
    fireEvent.change(input, { target: { value: '222 Oak Ave, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('heading', { name: '222 Oak Ave, Apt 2, Austin, TX 78701' });
    resolveA?.(Response.json(makeRecord(firstId, '111 Pine St, Apt 2, Austin, TX 78701')));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '111 Pine St, Apt 2, Austin, TX 78701' })).toBeNull());
  });

  it('shows server and property errors without substituting demo data', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      if (String(input).endsWith('/health/live')) throw new Error('server down');
      throw new Error('server down');
    });
    renderAt();
    await screen.findByText('API: unavailable');
    const input = screen.getByRole('textbox', { name: 'Search a property address' });
    fireEvent.change(input, { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Search failed');
    expect(screen.queryByText('1847 Alder View Lane')).toBeNull();
  });
});

describe('History', () => {
  it('shows loading, then empty, and handles list errors', async () => {
    let complete: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation((input: string) => String(input).endsWith('/health/live') ? Promise.resolve(Response.json({ status: 'live', requestId: 'synthetic' })) : new Promise<Response>(resolve => { complete = resolve; }));
    const view = renderAt('/history');
    expect(screen.getByText('Loading history')).toBeTruthy();
    complete?.(Response.json({ items: [], total: 0, page: 1, pageSize: 5 }));
    await screen.findByText('History empty');
    view.unmount();
    fetchMock.mockImplementation(async (input: string) => String(input).endsWith('/health/live') ? Response.json({ status: 'live', requestId: 'synthetic' }) : Response.json({ error: { code: 'REQUEST_FAILED', message: 'failed', requestId: 'synthetic' } }, { status: 503 }));
    renderAt('/history');
    await screen.findByText('History unavailable');
  });

  it('selects a saved row and sends only edited notes and overrides', async () => {
    const first = makeRecord();
    const second = makeRecord(secondId, '222 Oak Ave, Apt 2, Austin, TX 78701');
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (String(input).endsWith('/health/live')) return Response.json({ status: 'live', requestId: 'synthetic' });
      if (String(input).includes('/properties?')) return Response.json({ items: [first, second], total: 2, page: 1, pageSize: 5 });
      if (init?.method === 'PATCH') return Response.json(second);
      return Response.json({ error: { code: 'REQUEST_FAILED', message: 'failed', requestId: 'synthetic' } }, { status: 500 });
    });
    renderAt('/history');
    const row = await screen.findByRole('row', { name: /222 Oak Ave/ });
    fireEvent.click(within(row).getByRole('button', { name: 'View' }));
    const detail = screen.getByRole('complementary', { name: 'Selected Record Details' });
    expect(detail.textContent).toContain('222 Oak Ave');
    fireEvent.change(within(detail).getByRole('textbox', { name: 'Notes' }), { target: { value: 'Check disclosures' } });
    fireEvent.change(within(detail).getByRole('spinbutton', { name: /Living area/ }), { target: { value: '1300' } });
    fireEvent.click(within(detail).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === 'PATCH')).toBe(true));
    const patchCall = fetchMock.mock.calls.find(call => call[1]?.method === 'PATCH');
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ notes: 'Check disclosures', overrides: { livingAreaSqft: 1300 } });
  });
});

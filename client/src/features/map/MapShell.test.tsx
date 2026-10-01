// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { PropertyRecord } from '@ppi/shared';
import { MapShell } from './MapShell.js';

type Layer = { title: string; graphics: unknown[]; destroy: () => void };
type View = { destroy: ReturnType<typeof vi.fn>; handles: ReturnType<typeof vi.fn>[]; events: Record<string, (event: unknown) => void>; hitTest: ReturnType<typeof vi.fn> };
const sdk = vi.hoisted(() => ({ views: [] as View[], layers: [] as Layer[], basemapFailure: false }));
vi.mock('@arcgis/core/config.js', () => ({ default: { log: { level: 'none' }, apiKey: '' } }));
vi.mock('@arcgis/core/Graphic.js', () => ({ default: class { constructor(value: object) { Object.assign(this, value); } } }));
vi.mock('@arcgis/core/layers/GraphicsLayer.js', () => ({ default: class {
  title: string; graphics: unknown[] = []; destroy = vi.fn();
  constructor(value: { title: string }) { this.title = value.title; sdk.layers.push(this); }
  removeAll() { this.graphics = []; }
  add(graphic: unknown) { this.graphics.push(graphic); }
} }));
vi.mock('@arcgis/core/layers/FeatureLayer.js', () => ({ default: class {
  title: string; graphics: unknown[] = []; destroy = vi.fn();
  constructor(value: { title: string }) { this.title = value.title; sdk.layers.push(this); }
  queryFeatures() { return Promise.resolve({ exceededTransferLimit: false, features: [{ attributes: { FHSZ_Description: 'High' }, geometry: { type: 'polygon' } }] }); }
} }));
vi.mock('@arcgis/core/Map.js', () => ({ default: class {
  layers: Layer[];
  basemap = { loadAll: () => sdk.basemapFailure ? Promise.reject(new Error('synthetic outage')) : Promise.resolve() };
  constructor(value: { layers: Layer[] }) { this.layers = value.layers; }
  add(layer: Layer) { this.layers.push(layer); }
  remove(layer: Layer) { this.layers = this.layers.filter(value => value !== layer); }
} }));
vi.mock('@arcgis/core/views/MapView.js', () => ({ default: class {
  ready = true; extent = {}; resolution = 1; destroy = vi.fn(); handles: ReturnType<typeof vi.fn>[] = [];
  events: Record<string, (event: unknown) => void> = {};
  hitTest = vi.fn(async () => ({ results: [] }));
  constructor() { sdk.views.push(this); }
  when() { return Promise.resolve(); }
  on(name: string, callback: (event: unknown) => void) { this.events[name] = callback; const remove = vi.fn(); this.handles.push(remove); return { remove }; }
  watch(_name: string, callback: (event: unknown) => void) { this.events.stationary = callback; const remove = vi.fn(); this.handles.push(remove); return { remove }; }
} }));
const subject: PropertyRecord = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', provider: 'RENTCAST', providerPropertyId: 'synthetic-subject', normalizedAddressKey: 'synthetic',
  formattedAddress: 'Synthetic subject', addressLine1: 'Synthetic subject', unit: null, city: 'Test', state: 'CA', zipCode: '90000',
  latitude: 37, longitude: -122, propertyType: 'Condo', bedrooms: 2, bathrooms: 2, livingAreaSqft: 1200, lotSizeSqft: null, yearBuilt: 2000,
  currentListPrice: null, refreshFailedAt: null, notes: null, userOverrides: {}, effectiveValues: { bedrooms: 2, bathrooms: 2, livingAreaSqft: 1200, yearBuilt: 2000 },
  createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z'
};
const props = { subject, candidates: [], selectedId: null, onSelect: vi.fn(), activeContext: null, onContextChange: vi.fn(), contextMarkers: [], selectedContextId: null, onSelectContext: vi.fn() };
beforeEach(() => {
  sdk.views.length = 0; sdk.layers.length = 0; sdk.basemapFailure = false;
  vi.stubEnv('VITE_ARCGIS_API_KEY', 'synthetic-public-basemap-key-for-tests');
  window.history.replaceState({}, '', '/dashboard?mapUnavailableMode=1');
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); window.history.replaceState({}, '', '/'); });

it('reuses the MapView, clears switched context geometry, and removes every watcher on unmount', async () => {
  const view = render(<MapShell {...props} activeContext="wildfire" />);
  await waitFor(() => expect(sdk.layers.find(layer => layer.title === 'CAL FIRE Fire Hazard Severity Zones')?.graphics.length).toBe(2));
  const mapView = sdk.views[0]!;
  expect(sdk.views).toHaveLength(1);
  expect(sdk.layers.find(layer => layer.title === 'Subject Property')?.graphics).toHaveLength(1);
  view.rerender(<MapShell {...props} activeContext="faults" />);
  await waitFor(() => expect(sdk.layers.some(layer => layer.title.includes('CGS'))).toBe(true));
  expect(sdk.layers.find(layer => layer.title === 'CAL FIRE Fire Hazard Severity Zones')?.graphics).toHaveLength(0);
  expect(sdk.layers.find(layer => layer.title === 'Subject Property')?.graphics).toHaveLength(1);
  expect(sdk.views).toHaveLength(1);
  view.rerender(<MapShell {...props} />);
  view.unmount();
  expect(mapView.destroy).toHaveBeenCalledOnce();
  expect(mapView.handles).toHaveLength(3);
  expect(mapView.handles.every(remove => remove.mock.calls.length === 1)).toBe(true);
});

it('ignores a late hit test for context graphics that have been removed', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const select = vi.fn();
  const view = render(<MapShell {...props} activeContext="grocery" onSelectContext={select} contextMarkers={[{ id: 'synthetic-place', kind: 'grocery', label: '<b>Synthetic grocery</b>', detail: 'Synthetic only', latitude: 37, longitude: -122 }]} />);
  await waitFor(() => expect(sdk.views).toHaveLength(1));
  const mapView = sdk.views[0]!;
  const graphic = sdk.layers.find(layer => layer.title === 'Selected Context')?.graphics[0] as { popupTemplate: { title: string; content: () => HTMLElement } };
  expect(graphic.popupTemplate.title).toBe('Grocery place');
  expect(graphic.popupTemplate.content().textContent).toBe('<b>Synthetic grocery</b> · Synthetic only');
  expect(graphic.popupTemplate.content().querySelector('b')).toBeNull();
  mapView.hitTest.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mapView.events.click?.({});
  view.rerender(<MapShell {...props} activeContext="schools" onSelectContext={select} />);
  await act(async () => { finish?.({ results: [{ graphic: { attributes: { id: 'synthetic-place', context: true } } }] }); });
  expect(select).not.toHaveBeenCalled();
  expect(sdk.layers.find(layer => layer.title === 'Selected Context')?.graphics).toHaveLength(0);
});

it('shows a safe map fallback when basemap loading fails and cleans up its view', async () => {
  sdk.basemapFailure = true;
  const view = render(<MapShell {...props} />);
  await screen.findByText('Map unavailable. Property and market evidence remain available.');
  view.unmount();
  expect(sdk.views[0]?.destroy).toHaveBeenCalledOnce();
});

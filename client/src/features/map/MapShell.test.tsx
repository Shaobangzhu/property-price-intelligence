// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { MarketComparableCandidate, PropertyRecord } from '@ppi/shared';
import { MapShell } from './MapShell.js';
import { marketPopup, textPopup } from './popupContent.js';

type Layer = { title: string; visible: boolean; graphics: unknown[]; destroy: () => void };
type PopupFeature = { attributes?: Record<string, unknown> };
type View = { destroy: ReturnType<typeof vi.fn>; handles: ReturnType<typeof vi.fn>[]; events: Record<string, (event: unknown) => void>; hitTest: ReturnType<typeof vi.fn>; goTo: ReturnType<typeof vi.fn>; openPopup: ReturnType<typeof vi.fn>; closePopup: ReturnType<typeof vi.fn>; when: ReturnType<typeof vi.fn>; popup: { selectedFeature: PopupFeature | null } };
const sdk = vi.hoisted(() => ({ views: [] as View[], layers: [] as Layer[], basemaps: [] as object[], basemapFailure: false }));
vi.mock('@arcgis/core/Basemap.js', () => ({ default: class { constructor(value: object) { sdk.basemaps.push(value); } } }));
vi.mock('@arcgis/core/config.js', () => ({ default: { log: { level: 'none' }, apiKey: '', apiKeys: {} } }));
vi.mock('@arcgis/core/Graphic.js', () => ({ default: class { constructor(value: object) { Object.assign(this, value); } } }));
vi.mock('@arcgis/core/layers/GraphicsLayer.js', () => ({ default: class {
  title: string; visible: boolean; graphics: unknown[] = []; destroy = vi.fn();
  constructor(value: { title: string; visible?: boolean }) { this.title = value.title; this.visible = value.visible ?? true; sdk.layers.push(this); }
  removeAll() { this.graphics = []; }
  add(graphic: unknown) { this.graphics.push(graphic); }
} }));
vi.mock('@arcgis/core/layers/FeatureLayer.js', () => ({ default: class {
  title: string; visible = true; graphics: unknown[] = []; destroy = vi.fn();
  constructor(value: { title: string }) { this.title = value.title; Object.assign(this, value); sdk.layers.push(this); }
  queryFeatures() { return Promise.resolve({ exceededTransferLimit: false, features: [{ attributes: { FHSZ_Description: 'High' }, geometry: { type: 'polygon' } }] }); }
} }));
vi.mock('@arcgis/core/Map.js', () => ({ default: class {
  layers: Layer[];
  basemap = { loadAll: () => sdk.basemapFailure ? Promise.reject(new Error('synthetic token=DO_NOT_PRINT 498')) : Promise.resolve() };
  constructor(value: { layers: Layer[] }) { this.layers = value.layers; }
  add(layer: Layer) { this.layers.push(layer); }
  remove(layer: Layer) { this.layers = this.layers.filter(value => value !== layer); }
} }));
vi.mock('@arcgis/core/views/MapView.js', () => ({ default: class {
  ready = true; extent = {}; resolution = 1; destroy = vi.fn(); handles: ReturnType<typeof vi.fn>[] = [];
  events: Record<string, (event: unknown) => void> = {};
  hitTest = vi.fn(async () => ({ results: [] }));
  goTo = vi.fn<(target: unknown, options?: unknown) => Promise<void>>(async () => {});
  popup = { selectedFeature: null as PopupFeature | null };
  openPopup = vi.fn(async (options: { features: PopupFeature[] }) => { this.popup.selectedFeature = options.features[0] ?? null; });
  closePopup = vi.fn(() => { this.popup.selectedFeature = null; });
  constructor() { sdk.views.push(this); }
  when = vi.fn(async () => {});
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
const props = { subject, candidates: [], selectedId: null, onSelect: vi.fn(), activeContext: null, onContextChange: vi.fn(), contextMarkers: [], selectedContextId: null, onSelectContext: vi.fn(), marketVisibility: { recordedSales: false, activeListings: false }, onMarketVisibilityChange: vi.fn() };
beforeEach(() => {
  sdk.views.length = 0; sdk.layers.length = 0; sdk.basemaps.length = 0; sdk.basemapFailure = false;
  vi.stubEnv('VITE_ARCGIS_API_KEY', 'synthetic-public-basemap-key-for-tests');
  window.history.replaceState({}, '', '/dashboard?mapUnavailableMode=1');
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); window.history.replaceState({}, '', '/'); });

const candidate = (id: string, evidenceType: MarketComparableCandidate['evidenceType']): MarketComparableCandidate => ({
  id, evidenceType, providerId: id, address: `Synthetic ${id}`, latitude: 37.01, longitude: -122.01,
  propertyType: 'Condo', bedrooms: 2, bathrooms: 2, livingAreaSqft: 1200, lotSizeSqft: null, yearBuilt: null,
  price: 500000, eventDate: '2026-09-01', distanceMiles: 1, source: 'RENTCAST'
});

it('changes stable market layer visibility independently without rebuilding graphics or the view', async () => {
  const candidates = [candidate('sale-a', 'RECORDED_SALE'), candidate('listing-a', 'ACTIVE_ASKING_PRICE')];
  const view = render(<MapShell {...props} candidates={candidates} />);
  await waitFor(() => expect(sdk.views).toHaveLength(1));
  const sales = sdk.layers.find(layer => layer.title === 'Recorded Sales')!;
  const listings = sdk.layers.find(layer => layer.title === 'Active Listings')!;
  const subjectLayer = sdk.layers.find(layer => layer.title === 'Subject Property')!;
  const salesGraphics = sales.graphics, listingGraphics = listings.graphics, subjectGraphics = subjectLayer.graphics;
  expect([sales.visible, listings.visible]).toEqual([false, false]);
  expect(subjectLayer.visible).toBe(true);
  for (const [recordedSales, activeListings, context] of [
    [true, false, null], [false, false, null], [false, true, null], [false, false, null],
    [true, true, 'schools'], [true, true, 'grocery'], [true, true, 'wildfire'], [true, true, 'faults'], [false, true, null], [false, false, null]
  ] as const) {
    view.rerender(<MapShell {...props} candidates={candidates} marketVisibility={{ recordedSales, activeListings }} activeContext={context} />);
    expect([sales.visible, listings.visible]).toEqual([recordedSales, activeListings]);
    expect(subjectLayer.visible).toBe(true);
    expect(subjectLayer.graphics).toBe(subjectGraphics);
    expect(sales.graphics).toBe(salesGraphics);
    expect(listings.graphics).toBe(listingGraphics);
    expect(sdk.views).toHaveLength(1);
    expect(sdk.views[0]!.destroy).not.toHaveBeenCalled();
    expect(sales.destroy).not.toHaveBeenCalled();
    expect(listings.destroy).not.toHaveBeenCalled();
  }
});

it('ignores a market hit that resolves after its layer is hidden', async () => {
  const candidates = [candidate('sale-a', 'RECORDED_SALE')];
  const select = vi.fn();
  const view = render(<MapShell {...props} candidates={candidates} onSelect={select} marketVisibility={{ recordedSales: true, activeListings: false }} />);
  await waitFor(() => expect(sdk.views).toHaveLength(1));
  let finish: ((value: unknown) => void) | undefined;
  sdk.views[0]!.hitTest.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  sdk.views[0]!.events.click?.({});
  view.rerender(<MapShell {...props} candidates={candidates} onSelect={select} />);
  await act(async () => { finish?.({ results: [{ graphic: { attributes: { id: 'sale-a' } } }] }); });
  expect(select).not.toHaveBeenCalled();
});

it('replaces subject and market graphics completely when its data changes', async () => {
  const view = render(<MapShell {...props} candidates={[candidate('sale-a', 'RECORDED_SALE')]} />);
  await waitFor(() => expect(sdk.views).toHaveLength(1));
  const second = { ...subject, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', formattedAddress: 'Synthetic subject B', latitude: 38 };
  view.rerender(<MapShell {...props} subject={second} candidates={[candidate('listing-b', 'ACTIVE_ASKING_PRICE')]} marketVisibility={{ recordedSales: true, activeListings: false }} />);
  expect(sdk.layers.find(layer => layer.title === 'Recorded Sales')!.graphics).toEqual([]);
  expect(sdk.layers.find(layer => layer.title === 'Subject Property')!.graphics).toMatchObject([{ attributes: { id: second.id } }]);
  expect(sdk.layers.find(layer => layer.title === 'Active Listings')!.graphics).toMatchObject([{ attributes: { id: 'listing-b' } }]);
  expect(sdk.views).toHaveLength(1);
});

it('reuses the MapView, clears switched context geometry, and removes every watcher on unmount', async () => {
  const view = render(<MapShell {...props} activeContext="wildfire" />);
  await waitFor(() => expect(sdk.layers.filter(layer => layer.title.startsWith('CAL FIRE'))).toHaveLength(2));
  const wildfireLayers = sdk.layers.filter(layer => layer.title.startsWith('CAL FIRE'));
  for (const layer of wildfireLayers) expect(layer).toMatchObject({ minScale: 0, maxScale: 0,
    definitionExpression: "FHSZ_Description IN ('Moderate','High','Very High')", renderer: { type: 'unique-value', field: 'FHSZ_Description' } });
  expect(sdk.basemaps).toEqual([{ style: { id: 'arcgis/light-gray', apiKey: 'synthetic-public-basemap-key-for-tests' } }]);
  const mapView = sdk.views[0]!;
  expect(sdk.views).toHaveLength(1);
  expect(sdk.layers.find(layer => layer.title === 'Subject Property')?.graphics).toHaveLength(1);
  view.rerender(<MapShell {...props} activeContext="faults" />);
  await waitFor(() => expect(sdk.layers.some(layer => layer.title.includes('CGS'))).toBe(true));
  expect(wildfireLayers.every(layer => vi.mocked(layer.destroy).mock.calls.length === 1)).toBe(true);
  expect(sdk.layers.find(layer => layer.title.includes('CGS'))).toMatchObject({ minScale: 0, maxScale: 0,
    renderer: { type: 'simple', symbol: { type: 'simple-line', color: '#654675' } } });
  expect(sdk.layers.find(layer => layer.title === 'Subject Property')?.graphics).toHaveLength(1);
  expect(sdk.views).toHaveLength(1);
  view.rerender(<MapShell {...props} />);
  view.unmount();
  expect(mapView.destroy).toHaveBeenCalledOnce();
  expect(mapView.handles).toHaveLength(2);
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

it('isolates government layer errors from core markers and clears the notice when switching layers', async () => {
  const rendered = render(<MapShell {...props} activeContext="wildfire" />);
  await waitFor(() => expect(sdk.layers.filter(layer => layer.title.startsWith('CAL FIRE'))).toHaveLength(2));
  const layer = sdk.layers.find(layer => layer.title.startsWith('CAL FIRE'))!;
  await act(async () => { sdk.views[0]!.events['layerview-create-error']?.({ layer }); });
  expect(screen.getByText('Selected government map overlay unavailable. Property markers remain visible.')).toBeTruthy();
  expect(sdk.layers.find(layer => layer.title === 'Subject Property')?.graphics).toHaveLength(1);
  expect(sdk.views[0]!.destroy).not.toHaveBeenCalled();
  rendered.rerender(<MapShell {...props} activeContext="faults" />);
  await waitFor(() => expect(sdk.layers.some(layer => layer.title.includes('CGS'))).toBe(true));
  expect(screen.queryByText('Selected government map overlay unavailable. Property markers remain visible.')).toBeNull();
});

it('draws purple school circles, fits them with the subject once, and synchronizes selection without resetting the view', async () => {
  const markers = [{ id: 'school:synthetic', kind: 'school' as const, label: 'Synthetic school', detail: 'NCES location', latitude: 37.04, longitude: -122.04 }];
  const select = vi.fn();
  const view = render(<MapShell {...props} activeContext="schools" contextMarkers={markers} onSelectContext={select} />);
  await waitFor(() => expect(sdk.views[0]?.goTo).toHaveBeenCalledOnce());
  const layer = sdk.layers.find(layer => layer.title === 'Selected Context')!;
  expect(layer.graphics).toMatchObject([{ geometry: { latitude: 37.04, longitude: -122.04 }, symbol: { style: 'circle', color: '#7552a3', size: 14 } }]);
  expect(sdk.views[0]!.goTo.mock.calls[0]![0]).toHaveLength(2);
  sdk.views[0]!.hitTest.mockResolvedValue({ results: [{ graphic: { attributes: { id: 'school:synthetic', context: true } } }] });
  await act(async () => { sdk.views[0]!.events.click?.({}); });
  expect(select).toHaveBeenCalledWith('school:synthetic');
  view.rerender(<MapShell {...props} activeContext="schools" contextMarkers={markers} selectedContextId="school:synthetic" onSelectContext={select} />);
  expect(layer.graphics).toMatchObject([{ symbol: { style: 'circle', color: '#7552a3', size: 20 } }]);
  expect(sdk.views[0]!.goTo).toHaveBeenCalledOnce();
  view.rerender(<MapShell {...props} activeContext="grocery" />);
  expect(layer.graphics).toEqual([]);
  expect(sdk.views).toHaveLength(1);
});

it('shows a safe map fallback when basemap loading fails and cleans up its view', async () => {
  sdk.basemapFailure = true;
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const view = render(<MapShell {...props} />);
  await screen.findByText('Map unavailable. Property and market evidence remain available.');
  expect(warning).toHaveBeenCalledWith('PPI_MAP BASEMAP_LOAD_ERROR HTTP_498');
  expect(JSON.stringify(warning.mock.calls)).not.toContain('DO_NOT_PRINT');
  view.unmount();
  expect(sdk.views[0]?.destroy).toHaveBeenCalledOnce();
});

it('selects grocery graphics/popups by place ID after reordering and clears stale popups on off', async () => {
  const markers = [
    { id: 'alpha', label: 'Synthetic Alpha Grocery', detail: '100 Test Ave · 0.1 mi straight-line', latitude: 37.001, longitude: -122.001, kind: 'grocery' as const },
    { id: 'beta', label: 'Synthetic Beta Grocery', detail: '200 Test Ave · 0.3 mi straight-line', latitude: 37.003, longitude: -122.003, kind: 'grocery' as const },
    { id: 'seven', label: 'Synthetic 7-Eleven', detail: '300 Test Ave · 0.4 mi straight-line', latitude: 37.004, longitude: -122.004, kind: 'grocery' as const }
  ];
  const select = vi.fn();
  const rendered = render(<MapShell {...props} activeContext="grocery" contextMarkers={markers} selectedContextId="alpha" onSelectContext={select} />);
  await waitFor(() => expect(sdk.views[0]?.openPopup).toHaveBeenCalledOnce());
  const mapView = sdk.views[0]!;
  for (const marker of [...markers].reverse()) {
    rendered.rerender(<MapShell {...props} activeContext="grocery" contextMarkers={[...markers].reverse()} selectedContextId={marker.id} onSelectContext={select} />);
    await waitFor(() => expect(mapView.openPopup.mock.lastCall?.[0].features[0].attributes.placeId).toBe(marker.id));
    const graphic = mapView.openPopup.mock.lastCall![0].features[0];
    expect(graphic.geometry).toEqual({ type: 'point', latitude: marker.latitude, longitude: marker.longitude });
    expect(graphic.symbol.size).toBe(20);
    expect(graphic.popupTemplate.content().textContent).toBe(`${marker.label} · ${marker.detail}`);
    expect(mapView.openPopup.mock.lastCall![0].location).toBe(graphic.geometry);
    mapView.hitTest.mockResolvedValue({ results: [{ graphic }] });
    await act(async () => { mapView.events.click?.({}); });
    expect(select).toHaveBeenLastCalledWith(marker.id);
  }
  rendered.rerender(<MapShell {...props} />);
  expect(mapView.closePopup).toHaveBeenCalledOnce();
  expect(sdk.layers.find(layer => layer.title === 'Selected Context')?.graphics).toEqual([]);
});

it.each(['RECORDED_SALE', 'ACTIVE_ASKING_PRICE'] as const)('builds non-empty %s graphic content with its own ID and semantics', async kind => {
  const item = candidate('evidence-id', kind);
  render(<MapShell {...props} candidates={[item]} marketVisibility={{ recordedSales: true, activeListings: true }} />);
  await waitFor(() => expect(sdk.views).toHaveLength(1));
  const layer = sdk.layers.find(layer => layer.title === (kind === 'RECORDED_SALE' ? 'Recorded Sales' : 'Active Listings'))!;
  const graphic = layer.graphics[0] as { attributes: { id: string }; popupTemplate: ReturnType<typeof marketPopup> };
  expect(graphic.attributes.id).toBe(item.id);
  const content = graphic.popupTemplate.content().textContent!;
  expect(content).toContain(item.address);
  expect(content).toContain('$500,000');
  expect(content).toContain('2026-09-01');
  expect(content).toContain('1.00 mi away');
  expect(content).toContain(kind === 'RECORDED_SALE' ? 'Sold Price' : 'Asking Price');
  expect(content).not.toContain(kind === 'RECORDED_SALE' ? 'Asking Price' : 'Sold Price');
});

it('renders missing fields and provider markup as safe non-empty text with fresh DOM nodes', () => {
  const template = marketPopup({ ...candidate('missing', 'RECORDED_SALE'), address: '<img src=x onerror=alert(1)>', price: null, eventDate: null, distanceMiles: null, propertyType: null });
  const first = template.content(), second = template.content();
  expect(first).not.toBe(second);
  expect(first.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(first.textContent).toContain('Sold Price: Unavailable');
  expect(first.textContent).toContain('Sale date: Unavailable');
  expect(first.textContent).toContain('Distance unavailable');
  expect(first.querySelector('img')).toBeNull();
  expect(textPopup('Nearby school', 'Synthetic school · Type unavailable · Rating unavailable').content().textContent).toContain('Synthetic school');
});

it('opens row-selected market graphics by ID, closes hidden evidence, and clears old property popups', async () => {
  const candidates = [candidate('sale-a', 'RECORDED_SALE'), candidate('listing-b', 'ACTIVE_ASKING_PRICE')];
  const rendered = render(<MapShell {...props} candidates={candidates} selectedId="sale-a" marketVisibility={{ recordedSales: true, activeListings: true }} />);
  await waitFor(() => expect(sdk.views[0]?.openPopup).toHaveBeenCalledOnce());
  const mapView = sdk.views[0]!;
  const sale = mapView.openPopup.mock.lastCall![0].features[0];
  expect(sale.attributes.id).toBe('sale-a');
  expect(mapView.openPopup.mock.lastCall![0].location).toBe(sale.geometry);
  rendered.rerender(<MapShell {...props} candidates={candidates} selectedId="sale-a" marketVisibility={{ recordedSales: false, activeListings: true }} />);
  expect(mapView.popup.selectedFeature).toBeNull();
  rendered.rerender(<MapShell {...props} candidates={candidates} selectedId="listing-b" marketVisibility={{ recordedSales: false, activeListings: true }} />);
  await waitFor(() => expect(mapView.openPopup.mock.lastCall![0].features[0].attributes.id).toBe('listing-b'));
  expect(mapView.openPopup.mock.lastCall![0].features[0].popupTemplate.content().textContent).toContain('Asking Price');
  rendered.rerender(<MapShell {...props} subject={{ ...subject, id: 'new-subject' }} />);
  expect(mapView.popup.selectedFeature).toBeNull();
});

it('opens school content from the matching Graphic and closes it on a context switch', async () => {
  const markers = [{ id: 'school-a', kind: 'school' as const, label: 'Synthetic nearby school', detail: 'Public · 0.5 mi · nearby only', latitude: 37.01, longitude: -122.01 }];
  const rendered = render(<MapShell {...props} activeContext="schools" contextMarkers={markers} selectedContextId="school-a" />);
  await waitFor(() => expect(sdk.views[0]?.openPopup).toHaveBeenCalledOnce());
  const mapView = sdk.views[0]!;
  const graphic = mapView.openPopup.mock.lastCall![0].features[0];
  expect(graphic.attributes.id).toBe('school-a');
  expect(graphic.popupTemplate.content().textContent).toContain('Synthetic nearby school');
  expect(mapView.openPopup.mock.lastCall![0].location).toBe(graphic.geometry);
  rendered.rerender(<MapShell {...props} activeContext="grocery" />);
  expect(mapView.popup.selectedFeature).toBeNull();
});

it('cancels a pending popup open when its market layer is hidden', async () => {
  const candidates = [candidate('sale-a', 'RECORDED_SALE')];
  const rendered = render(<MapShell {...props} candidates={candidates} marketVisibility={{ recordedSales: true, activeListings: false }} />);
  await waitFor(() => expect(sdk.views).toHaveLength(1));
  const mapView = sdk.views[0]!;
  let release: (() => void) | undefined;
  mapView.when.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  rendered.rerender(<MapShell {...props} candidates={candidates} selectedId="sale-a" marketVisibility={{ recordedSales: true, activeListings: false }} />);
  rendered.rerender(<MapShell {...props} candidates={candidates} selectedId="sale-a" />);
  await act(async () => { release?.(); });
  expect(mapView.openPopup).not.toHaveBeenCalled();
});

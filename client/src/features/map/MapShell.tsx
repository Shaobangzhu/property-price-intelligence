import { useEffect, useRef, useState } from 'react';
import type { MapContext, MarketComparableCandidate, PropertyRecord } from '@ppi/shared';
import type { ContextMarker } from './contextMarkers.js';
import { governmentLayerSpecs } from './governmentLayers.js';

const contexts: { value: MapContext; label: string }[] = [
  { value: 'schools', label: 'Schools' }, { value: 'grocery', label: 'Grocery' },
  { value: 'wildfire', label: 'Wildfire' }, { value: 'faults', label: 'Faults' }
];
type MapData = { subject: PropertyRecord; candidates: MarketComparableCandidate[]; selectedId: string | null };
export type MarketLayerVisibility = { recordedSales: boolean; activeListings: boolean };
const isMarketVisible = (item: MarketComparableCandidate, visibility: MarketLayerVisibility) => item.evidenceType === 'RECORDED_SALE' ? visibility.recordedSales : visibility.activeListings;
type ContextData = { contextMarkers: ContextMarker[]; selectedContextId: string | null; onSelectContext: (id: string) => void };
const isTestMode = () => typeof location !== 'undefined' &&
  (import.meta.env.MODE === 'test' ? !new URLSearchParams(location.search).has('mapUnavailableMode') : import.meta.env.DEV && new URLSearchParams(location.search).has('mapTestMode'));

function reportMapFailure(stage: 'SDK_IMPORT_ERROR' | 'MAPVIEW_INIT_ERROR' | 'BASEMAP_LOAD_ERROR', error: unknown) {
  if (!import.meta.env.DEV) return;
  const candidate = error && typeof error === 'object' ? error as { message?: unknown; status?: unknown; details?: { httpStatus?: unknown; status?: unknown } } : null;
  const text = typeof candidate?.message === 'string' ? candidate.message : '';
  const status = [candidate?.status, candidate?.details?.httpStatus, candidate?.details?.status]
    .find(value => typeof value === 'number' && Number.isInteger(value)) ?? text.match(/\b(?:401|403|404|498|499|500)\b/)?.[0];
  // ArcGIS error messages and URLs may contain tokens; emit only a fixed stage and status.
  console.warn(`PPI_MAP ${stage}${status ? ` HTTP_${status}` : ''}`);
}

function ArcgisMap({ subject, candidates, selectedId, onSelect, contextMarkers, selectedContextId, onSelectContext, activeContext, marketVisibility }: MapData & ContextData & { onSelect: (id: string) => void; activeContext: MapContext | null; marketVisibility: MarketLayerVisibility }) {
  const testMode = isTestMode();
  const container = useRef<HTMLDivElement>(null);
  const data = useRef<MapData>({ subject, candidates, selectedId });
  const select = useRef(onSelect);
  const contextData = useRef({ contextMarkers, selectedContextId });
  const selectContext = useRef(onSelectContext);
  const redraw = useRef<(() => void) | null>(null);
  const redrawContext = useRef<(() => void) | null>(null);
  const syncGovernment = useRef<((context: MapContext | null) => void) | null>(null);
  const syncMarket = useRef<(() => void) | null>(null);
  const marketVisibilityRef = useRef(marketVisibility);
  const activeContextRef = useRef(activeContext);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [overlayUnavailable, setOverlayUnavailable] = useState(false);
  data.current = { subject, candidates, selectedId };
  select.current = onSelect;
  contextData.current = { contextMarkers, selectedContextId };
  selectContext.current = onSelectContext;
  activeContextRef.current = activeContext;
  marketVisibilityRef.current = marketVisibility;
  useEffect(() => { redraw.current?.(); }, [subject, candidates, selectedId]);
  useEffect(() => { redrawContext.current?.(); }, [contextMarkers, selectedContextId]);
  useEffect(() => { setOverlayUnavailable(false); syncGovernment.current?.(activeContext); }, [activeContext]);
  useEffect(() => { syncMarket.current?.(); }, [marketVisibility.recordedSales, marketVisibility.activeListings]);

  useEffect(() => {
    if (testMode) { setStatus('ready'); return; }
    const key = import.meta.env.VITE_ARCGIS_API_KEY?.trim();
    if (!key || key.length < 20 || !container.current || subject.latitude === null || subject.longitude === null) { setStatus('unavailable'); return; }
    let disposed = false;
    let destroy: (() => void) | null = null;
    void (async () => {
      let stage: 'SDK_IMPORT_ERROR' | 'MAPVIEW_INIT_ERROR' = 'SDK_IMPORT_ERROR';
      let reported = false;
      const report = (kind: 'MAPVIEW_INIT_ERROR' | 'BASEMAP_LOAD_ERROR', error: unknown) => { reported = true; if (!disposed) reportMapFailure(kind, error); };
      try {
        const [{ default: esriConfig }, { default: Map }, { default: MapView }, { default: GraphicsLayer }, { default: Graphic }] = await Promise.all([
          import('@arcgis/core/config.js'), import('@arcgis/core/Map.js'), import('@arcgis/core/views/MapView.js'),
          import('@arcgis/core/layers/GraphicsLayer.js'), import('@arcgis/core/Graphic.js')
        ]);
        if (disposed || !container.current) return;
        stage = 'MAPVIEW_INIT_ERROR';
        // ArcGIS error details may contain the browser token; show our redacted fallback instead.
        esriConfig.log.level = 'none';
        esriConfig.apiKey = key;
        const subjectLayer = new GraphicsLayer({ title: 'Subject Property' });
        const salesLayer = new GraphicsLayer({ title: 'Recorded Sales', visible: marketVisibilityRef.current.recordedSales });
        const listingsLayer = new GraphicsLayer({ title: 'Active Listings', visible: marketVisibilityRef.current.activeListings });
        syncMarket.current = () => {
          salesLayer.visible = marketVisibilityRef.current.recordedSales;
          listingsLayer.visible = marketVisibilityRef.current.activeListings;
        };
        const contextLayer = new GraphicsLayer({ title: 'Selected Context' });
        const wildfireLayer = new GraphicsLayer({ title: 'CAL FIRE Fire Hazard Severity Zones', opacity: 0.55 });
        const map = new Map({ basemap: 'arcgis/light-gray', layers: [wildfireLayer, salesLayer, listingsLayer, contextLayer, subjectLayer] });
        let governmentLayers: InstanceType<typeof import('@arcgis/core/layers/FeatureLayer.js').default>[] = [];
        let governmentRevision = 0;
        let wildfireQueryRevision = 0;
        let wildfireAbort: AbortController | null = null;
        let view: InstanceType<typeof MapView>;
        const loadWildfire = async (revision: number) => {
          const queryRevision = ++wildfireQueryRevision;
          if (!view?.ready || revision !== governmentRevision) return;
          wildfireAbort?.abort();
          const controller = new AbortController();
          wildfireAbort = controller;
          const timeout = setTimeout(() => controller.abort(), 8000);
          try {
            const results = await Promise.all(governmentLayers.map(layer => layer.queryFeatures({ geometry: view.extent,
              spatialRelationship: 'intersects', outFields: ['FHSZ_Description'], returnGeometry: true, num: 500,
              maxAllowableOffset: view.resolution * 2 }, { signal: controller.signal })));
            if (disposed || revision !== governmentRevision || queryRevision !== wildfireQueryRevision) return;
            if (results.some(result => result.exceededTransferLimit || result.features.length >= 500)) throw new Error('WILDFIRE_LIMIT');
            const colors: Record<string, string> = { Moderate: '#eadb69', High: '#ec9b53', 'Very High': '#ce6570' };
            wildfireLayer.removeAll();
            for (const result of results) for (const feature of result.features) {
              const color = colors[String(feature.attributes?.FHSZ_Description)];
              if (color && feature.geometry) wildfireLayer.add(new Graphic({ geometry: feature.geometry,
                symbol: { type: 'simple-fill', color, outline: { color, width: 0.5 } } }));
            }
            setOverlayUnavailable(false);
          } catch { if (!disposed && revision === governmentRevision && queryRevision === wildfireQueryRevision) { wildfireLayer.removeAll(); setOverlayUnavailable(true); } }
          finally { clearTimeout(timeout); if (wildfireAbort === controller) wildfireAbort = null; }
        };
        const sync = (context: MapContext | null) => {
          const revision = ++governmentRevision;
          wildfireQueryRevision++;
          wildfireAbort?.abort();
          wildfireAbort = null;
          wildfireLayer.removeAll();
          for (const layer of governmentLayers) { map.remove(layer); layer.destroy(); }
          governmentLayers = [];
          const specs = governmentLayerSpecs(context);
          if (!specs.length) return;
          void import('@arcgis/core/layers/FeatureLayer.js').then(({ default: FeatureLayer }) => {
            if (disposed || revision !== governmentRevision) return;
            governmentLayers = specs.map(spec => new FeatureLayer({ url: spec.url, title: spec.title, opacity: spec.opacity, popupEnabled: false,
              renderer: context === 'faults' ? { type: 'simple', symbol: { type: 'simple-line', color: '#654675', width: 2 } } : undefined }));
            if (context === 'faults') for (const layer of governmentLayers) map.add(layer, 0);
            else void loadWildfire(revision);
          }).catch(() => { if (!disposed && revision === governmentRevision) setOverlayUnavailable(true); });
        };
        syncGovernment.current = sync;
        view = new MapView({ container: container.current, map, center: [data.current.subject.longitude!, data.current.subject.latitude!], zoom: 13,
          constraints: { minZoom: 3, maxZoom: 19 } });
        sync(activeContextRef.current);
        const stationary = view.watch('stationary', value => { if (value && activeContextRef.current === 'wildfire') void loadWildfire(governmentRevision); });
        const popup = (title: string, detail: string) => ({ title, content: () => { const element = document.createElement('div'); element.textContent = detail; return element; } });
        const draw = () => {
          const { subject: current, candidates: items, selectedId: selected } = data.current;
          subjectLayer.removeAll(); salesLayer.removeAll(); listingsLayer.removeAll();
          if (current.latitude !== null && current.longitude !== null) subjectLayer.add(new Graphic({
            geometry: { type: 'point', latitude: current.latitude, longitude: current.longitude },
            symbol: { type: 'simple-marker', style: 'diamond', size: 22, color: '#174f9d', outline: { color: '#fff', width: 2 } },
            attributes: { id: current.id }, popupTemplate: popup('Subject property', `${current.formattedAddress} · ${current.propertyType ?? 'Type unavailable'} · ${current.effectiveValues.bedrooms ?? '—'} beds · ${current.effectiveValues.bathrooms ?? '—'} baths`)
          }));
          for (const item of items) {
            if (item.latitude === null || item.longitude === null) continue;
            const sale = item.evidenceType === 'RECORDED_SALE';
            const layer = sale ? salesLayer : listingsLayer;
            layer.add(new Graphic({
              geometry: { type: 'point', latitude: item.latitude, longitude: item.longitude },
              symbol: { type: 'simple-marker', style: sale ? 'circle' : 'square', size: item.id === selected ? 18 : 12,
                color: sale ? '#17896f' : '#d98b35', outline: { color: item.id === selected ? '#172b43' : '#fff', width: item.id === selected ? 3 : 1.5 } },
              attributes: { id: item.id }, popupTemplate: popup(sale ? 'Recorded sale' : 'Active listing', `${item.address} · ${sale ? 'Sold Price' : 'Asking Price'}: ${item.price === null ? 'Unavailable' : `$${item.price.toLocaleString()}`}`)
            }));
          }
        };
        redraw.current = draw;
        draw();
        const drawContext = () => {
          contextLayer.removeAll();
          for (const marker of contextData.current.contextMarkers) contextLayer.add(new Graphic({
            geometry: { type: 'point', latitude: marker.latitude, longitude: marker.longitude },
            symbol: { type: 'simple-marker', style: marker.kind === 'school' ? 'triangle' : 'circle', size: marker.id === contextData.current.selectedContextId ? 20 : 14,
              color: marker.kind === 'school' ? '#7552a3' : '#bf5268', outline: { color: marker.id === contextData.current.selectedContextId ? '#172b43' : '#fff', width: marker.id === contextData.current.selectedContextId ? 3 : 1.5 } },
            attributes: { id: marker.id, context: true }, popupTemplate: popup(marker.kind === 'school' ? 'Assigned school' : 'Grocery place', `${marker.label} · ${marker.detail}`)
          }));
        };
        redrawContext.current = drawContext;
        drawContext();
        const click = view.on('click', event => {
          const clickedContext = activeContextRef.current;
          void view.hitTest(event, { include: [contextLayer, ...[salesLayer, listingsLayer].filter(layer => layer.visible)] }).then(result => {
            if (disposed) return;
            const graphic = result.results.find(hit => 'graphic' in hit)?.graphic;
            const id = graphic?.attributes?.id;
            if (typeof id === 'string') {
              if (graphic?.attributes?.context === true) {
                if (clickedContext === activeContextRef.current && contextData.current.contextMarkers.some(marker => marker.id === id)) selectContext.current(id);
              } else if (data.current.candidates.some(candidate => candidate.id === id && isMarketVisible(candidate, marketVisibilityRef.current))) select.current(id);
            }
          }).catch(() => {});
        });
        let layerFailed = false;
        const layerError = view.on('layerview-create-error', event => {
          if (event.layer === wildfireLayer || governmentLayers.includes(event.layer as (typeof governmentLayers)[number])) {
            if (!disposed) setOverlayUnavailable(true);
          } else if ([subjectLayer, salesLayer, listingsLayer, contextLayer].includes(event.layer as typeof subjectLayer)) {
            layerFailed = true; if (!disposed) setStatus('unavailable');
          }
        });
        destroy = () => { click.remove(); layerError.remove(); stationary.remove(); governmentRevision++; wildfireQueryRevision++; wildfireAbort?.abort(); syncGovernment.current = null; syncMarket.current = null; redraw.current = null; redrawContext.current = null; for (const layer of governmentLayers) if (!map.layers.includes(layer)) layer.destroy(); view.destroy(); };
        await Promise.all([
          view.when().catch(error => { report('MAPVIEW_INIT_ERROR', error); throw error; }),
          map.basemap?.loadAll().catch(error => { report('BASEMAP_LOAD_ERROR', error); throw error; })
        ]);
        if (activeContextRef.current === 'wildfire') void loadWildfire(governmentRevision);
        if (!disposed && !layerFailed) setStatus('ready');
      } catch (error) { if (!disposed) { if (!reported) reportMapFailure(stage, error); setStatus('unavailable'); } }
    })();
    return () => { disposed = true; destroy?.(); syncGovernment.current = null; syncMarket.current = null; redraw.current = null; redrawContext.current = null; };
  }, []);

  if (testMode) return <div className="map-test-mode" aria-label="Map test mode"><span role="img" aria-label={`Subject property marker: ${subject.formattedAddress}`}>Subject Property</span>{governmentLayerSpecs(activeContext).map(spec => <span key={spec.url} data-testid="government-overlay">{spec.title}</span>)}{candidates.filter(item => isMarketVisible(item, marketVisibility) && item.latitude !== null && item.longitude !== null).map(item =>
    <button type="button" key={item.id} aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}>{item.evidenceType === 'RECORDED_SALE' ? 'Recorded sale marker' : 'Active listing marker'}: {item.address}</button>)}{contextMarkers.map(marker =>
    <button type="button" key={`context:${marker.id}`} aria-pressed={selectedContextId === marker.id} onClick={() => onSelectContext(marker.id)}>{marker.kind === 'school' ? 'Assigned school marker' : 'Grocery marker'}: {marker.label}</button>)}</div>;
  return <div className="map-canvas arcgis-canvas" aria-label="ArcGIS property map"><div ref={container} className="arcgis-view" />{status !== 'ready' && <div className="map-fallback" role="status">{status === 'loading' ? 'Loading ArcGIS map…' : 'Map unavailable. Property and market evidence remain available.'}</div>}{overlayUnavailable && status === 'ready' && <div className="map-overlay-notice" role="status">Selected government map overlay unavailable. Property markers remain visible.</div>}</div>;
}

export function MapShell({ subject, candidates, selectedId, onSelect, activeContext, onContextChange, contextMarkers, selectedContextId, onSelectContext, marketVisibility, onMarketVisibilityChange }: MapData & ContextData & { onSelect: (id: string) => void; activeContext: MapContext | null; onContextChange: (context: MapContext | null) => void; marketVisibility: MarketLayerVisibility; onMarketVisibilityChange: (visibility: MarketLayerVisibility) => void }) {
  return <section className="card map-card" aria-labelledby="map-title"><div className="card-heading map-heading"><div><span className="eyebrow">Location context</span><h2 id="map-title">Property map</h2></div><span className="section-tag">ArcGIS</span></div>
    <div className="map-context-picker" role="group" aria-label="Market layers"><span className="map-context-label">Market layers</span><div className="context-buttons">{([['recordedSales', 'Recorded Sales'], ['activeListings', 'Active Listings']] as const).map(([key, label]) => <button type="button" key={key} className={`context-button${marketVisibility[key] ? ' is-active' : ''}`} aria-pressed={marketVisibility[key]} onClick={() => onMarketVisibilityChange({ ...marketVisibility, [key]: !marketVisibility[key] })}>{marketVisibility[key] && <span aria-hidden="true">✓ </span>}{label}</button>)}</div></div>
    <div className="map-context-picker" role="group" aria-label="Map context"><span className="map-context-label">Context layers</span><div className="context-buttons">{contexts.map(context => <button type="button" key={context.value} className={`context-button${activeContext === context.value ? ' is-active' : ''}`} aria-pressed={activeContext === context.value} onClick={() => onContextChange(activeContext === context.value ? null : context.value)}>{activeContext === context.value && <span aria-hidden="true">✓ </span>}{context.label}</button>)}</div></div>
    <ArcgisMap subject={subject} candidates={candidates} selectedId={selectedId} onSelect={onSelect} contextMarkers={contextMarkers} selectedContextId={selectedContextId} onSelectContext={onSelectContext} activeContext={activeContext} marketVisibility={marketVisibility} />
    <div className="map-legend" role="group" aria-label="Visible map layers"><span className="legend-label">Map markers</span><span><i className="legend-dot subject-dot"/>Subject Property</span>{marketVisibility.recordedSales && <span><i className="legend-dot comp-dot"/>Recorded Sales</span>}{marketVisibility.activeListings && <span><i className="legend-dot listing-dot"/>Active Listings</span>}{activeContext === 'schools' && <span><i className="legend-dot school-dot"/>Assigned Schools</span>}{activeContext === 'grocery' && <span><i className="legend-dot grocery-dot"/>Grocery</span>}{activeContext === 'wildfire' && <span><i className="legend-dot wildfire-dot"/>Fire Hazard Severity Zones</span>}{activeContext === 'faults' && <span><i className="legend-line fault-line"/>Mapped Fault Traces</span>}</div>
    <p className="map-selection-note">Select a row or marker to inspect a candidate. Context results appear only for the selected layer.</p>
  </section>;
}

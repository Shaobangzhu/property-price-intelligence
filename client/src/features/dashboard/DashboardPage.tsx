import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AnalysisMode, MapContext, MarketContextResponse, PricingPreviewResponse, PropertyEnvelope } from '@ppi/shared';
import { ApiClientError, apiErrorMessage, getAssignedSchools, getFaultContext, getGroceryPlaces, getMarketContext, getWildfireContext, resolveProperty } from '../../api/properties.js';
import { FeedbackState } from '../../components/FeedbackState.js';
import { PropertySummary } from './PropertySummary.js';
import { MapShell } from '../map/MapShell.js';
import { ContextPanel, type ContextState } from '../map/ContextPanel.js';
import { getContextMarkers } from '../map/contextMarkers.js';
import { ComparableTable } from './ComparableTable.js';
import { PricingAnalysisDialog } from '../pricing/PricingAnalysisDialog.js';
import { money, range } from '../../format.js';

function PriceInsights({ offer, listing, onOpen }: { offer: PricingPreviewResponse | null; listing: PricingPreviewResponse | null; onOpen: (mode: AnalysisMode) => void }) {
  const reference = offer?.referenceRange ?? listing?.referenceRange ?? null;
  return <section className="card insights-card" aria-labelledby="insights-title"><div className="card-heading"><div><span className="eyebrow">Decision support</span><h2 id="insights-title">Price Insights</h2></div><span className="section-tag">Preview</span></div>
    <div className="insight-reference"><span>Market Reference Range</span><strong>{range(reference)}</strong><small>{reference ? 'Recorded-sale evidence · current preview' : 'Open a pricing preview to assess evidence'}</small></div>
    <div className="insight-metric"><span>Current Offer Preview</span><strong>{offer ? money(offer.offerResult?.suggestedPrice ?? null) : 'Not analyzed'}</strong><small>{offer ? labelEvidence(offer) : 'No offer preview yet'}</small></div>
    <div className="insight-metric"><span>Current Listing Preview</span><strong>{listing ? money(listing.listingResult?.suggestedPrice ?? null) : 'Not analyzed'}</strong><small>{listing ? labelEvidence(listing) : 'No listing preview yet'}</small></div>
    <div className="insight-actions"><button className="button button-primary" type="button" onClick={() => onOpen('OFFER')}>Offer Price</button><button className="button button-outline" type="button" onClick={() => onOpen('LISTING')}>Listing Price</button></div>
    <p className="insight-footnote">Deterministic preview only. No AI price calculation or saved analysis.</p>
  </section>;
}
const labelEvidence = (value: PricingPreviewResponse) => value.status === 'READY' ? `${value.evidenceQuality.toLowerCase()} evidence · ${value.engineVersion}` : 'Insufficient recorded-sale evidence';

export function DashboardPage() {
  const [query, setQuery] = useState('');
  const [record, setRecord] = useState<PropertyEnvelope | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'not-found' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [activeContext, setActiveContext] = useState<MapContext | null>(null);
  const [market, setMarket] = useState<{ propertyId: string; data: MarketContextResponse | null; status: 'loading' | 'ready' | 'error' } | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [contextState, setContextState] = useState<ContextState | null>(null);
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode | null>(null);
  const [pricingResults, setPricingResults] = useState<{ propertyId: string; offer: PricingPreviewResponse | null; listing: PricingPreviewResponse | null } | null>(null);
  const request = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const marketController = useRef<AbortController | null>(null);
  const contextController = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current.controller?.abort(); marketController.current?.abort(); contextController.current?.abort(); }, []);
  useEffect(() => {
    const propertyId = record?.property.id;
    if (!propertyId) return;
    const controller = new AbortController();
    marketController.current = controller;
    setMarket({ propertyId, data: null, status: 'loading' });
    getMarketContext(propertyId, controller.signal).then(data => {
      if (!controller.signal.aborted && data.propertyId === propertyId) setMarket({ propertyId, data, status: 'ready' });
    }).catch(() => { if (!controller.signal.aborted) setMarket({ propertyId, data: null, status: 'error' }); });
    return () => controller.abort();
  }, [record?.property.id]);
  useEffect(() => {
    const propertyId = record?.property.id;
    if (!propertyId || !activeContext) { setContextState(null); return; }
    const controller = new AbortController();
    contextController.current = controller;
    const context = activeContext;
    const empty = { schools: null, grocery: null, wildfire: null, faults: null };
    setContextState({ propertyId, context, status: 'loading', ...empty });
    const load = async (): Promise<Pick<ContextState, 'schools' | 'grocery' | 'wildfire' | 'faults'>> => {
      if (context === 'schools') return { ...empty, schools: await getAssignedSchools(propertyId, controller.signal) };
      if (context === 'grocery') return { ...empty, grocery: await getGroceryPlaces(propertyId, controller.signal) };
      if (context === 'wildfire') return { ...empty, wildfire: await getWildfireContext(propertyId, controller.signal) };
      return { ...empty, faults: await getFaultContext(propertyId, controller.signal) };
    };
    void load().then(data => {
      const responseId = data.schools?.propertyId ?? data.grocery?.propertyId ?? data.wildfire?.propertyId ?? data.faults?.propertyId;
      if (!controller.signal.aborted && responseId === propertyId) setContextState({ propertyId, context, status: 'ready', ...data });
    }).catch(() => { if (!controller.signal.aborted) setContextState({ propertyId, context, status: 'error', ...empty }); });
    return () => controller.abort();
  }, [record?.property.id, activeContext]);

  const changeContext = (context: MapContext | null) => { contextController.current?.abort(); setContextState(null); setSelectedContextId(null); setActiveContext(context); };

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = query.trim();
    request.current.controller?.abort();
    marketController.current?.abort();
    contextController.current?.abort();
    const id = ++request.current.id;
    if (!address) { setState('idle'); setRecord(null); return; }
    const controller = new AbortController();
    request.current.controller = controller;
    setState('loading'); setMessage(''); setRecord(null); setMarket(null); setSelectedCandidateId(null); setActiveContext(null); setContextState(null); setSelectedContextId(null); setAnalysisMode(null); setPricingResults(null);
    try {
      const result = await resolveProperty(address, controller.signal);
      if (request.current.id !== id) return;
      setRecord(result); setState('idle');
    } catch (error) {
      if (controller.signal.aborted || request.current.id !== id) return;
      setState(error instanceof ApiClientError && error.code === 'PROPERTY_NOT_FOUND' ? 'not-found' : 'error');
      setMessage(apiErrorMessage(error));
    }
  };
  const clear = () => { request.current.controller?.abort(); marketController.current?.abort(); contextController.current?.abort(); request.current.id++; setQuery(''); setRecord(null); setMarket(null); setSelectedCandidateId(null); setContextState(null); setSelectedContextId(null); setState('idle'); setMessage(''); setActiveContext(null); setAnalysisMode(null); setPricingResults(null); };

  const currentMarket = market?.propertyId === record?.property.id ? market : null;
  const candidates = currentMarket?.data ? [...currentMarket.data.recordedSales.candidates, ...currentMarket.data.activeListings.candidates] : [];
  const currentContext = contextState && contextState.propertyId === record?.property.id && contextState.context === activeContext ? contextState : null;
  const markers = getContextMarkers(activeContext, currentContext?.schools ?? null, currentContext?.grocery ?? null);

  return <div className="page dashboard-page"><div className="page-intro"><div><span className="page-kicker">WORKSPACE / DASHBOARD</span><h1>Dashboard</h1><p>Search a subject property and review nearby market evidence.</p></div><span className="demo-banner">Live property and market data · Deterministic pricing preview</span></div>
    <section className="card search-card" aria-labelledby="search-title"><div className="search-card-header"><div><span className="eyebrow">Property lookup</span><h2 id="search-title">Find a property</h2></div><span className="search-hint">Enter the full address, including unit when applicable</span></div>
      <form className="search-form" onSubmit={search}><label className="sr-only" htmlFor="property-address">Search a property address</label><div className="search-input-wrap"><span aria-hidden="true" className="search-icon">⌕</span><input id="property-address" value={query} onChange={event => setQuery(event.target.value)} placeholder="Street, unit, city, state, ZIP" autoComplete="street-address" /></div><button className="button button-primary" type="submit">Search</button>{(query || record) && <button className="button button-quiet" type="button" onClick={clear}>Clear</button>}</form>
      <p className="lookup-note">Fresh saved profiles come from the PPI cache. A missing or expired profile makes one server-side RentCast request.</p>
    </section>
    {state === 'loading' ? <div className="card dashboard-empty"><FeedbackState kind="loading" title="Loading property" message="Checking saved data and, if needed, requesting the property record." /></div> : record ? <>
      {record.cache.cacheStatus === 'STALE_FALLBACK' && <p className="stale-warning" role="alert">Refresh failed. Showing the saved profile as stale; its fetched time has not changed.</p>}
      <PropertySummary record={record} /><div className="dashboard-grid"><PriceInsights offer={pricingResults?.propertyId === record.property.id ? pricingResults.offer : null} listing={pricingResults?.propertyId === record.property.id ? pricingResults.listing : null} onOpen={setAnalysisMode} /><MapShell subject={record.property} candidates={candidates} selectedId={selectedCandidateId} onSelect={setSelectedCandidateId} activeContext={activeContext} onContextChange={changeContext} contextMarkers={markers} selectedContextId={selectedContextId} onSelectContext={setSelectedContextId} /><ContextPanel activeContext={activeContext} state={currentContext} selectedId={selectedContextId} onSelect={setSelectedContextId} /></div><ComparableTable market={currentMarket} selectedId={selectedCandidateId} onSelect={setSelectedCandidateId} />
      {analysisMode && <PricingAnalysisDialog key={`${record.property.id}:${analysisMode}`} property={record} mode={analysisMode} onClose={() => setAnalysisMode(null)} onResult={value => setPricingResults(previous => ({ propertyId: record.property.id, offer: analysisMode === 'OFFER' ? value : previous?.propertyId === record.property.id ? previous.offer : null, listing: analysisMode === 'LISTING' ? value : previous?.propertyId === record.property.id ? previous.listing : null }))} />}
    </> : <div className="card dashboard-empty"><FeedbackState kind={state === 'error' || state === 'not-found' ? 'error' : 'empty'} title={state === 'not-found' ? 'Property unavailable' : state === 'error' ? 'Search failed' : 'No property selected'} message={message || 'Enter a full address to find a subject property. No demo records are substituted for live results.'} /></div>}
  </div>;
}

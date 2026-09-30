import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MapContext, MarketContextResponse, PropertyEnvelope } from '@ppi/shared';
import { ApiClientError, apiErrorMessage, getMarketContext, resolveProperty } from '../../api/properties.js';
import { FeedbackState } from '../../components/FeedbackState.js';
import { PropertySummary } from './PropertySummary.js';
import { MapShell } from '../map/MapShell.js';
import { ContextPanel } from '../map/ContextPanel.js';
import { ComparableTable } from './ComparableTable.js';

function PriceInsights() {
  return <section className="card insights-card" aria-labelledby="insights-title"><div className="card-heading"><div><span className="eyebrow">Decision support</span><h2 id="insights-title">Price Insights</h2></div><span className="section-tag">Deferred</span></div>
    <div className="insight-reference"><span>Market Reference Range</span><strong>Not available</strong><small>Comparable evidence is not connected</small></div>
    <div className="insight-metric"><span>Latest Suggested Offer</span><strong>Not analyzed</strong><small>No pricing analysis exists</small></div>
    <div className="insight-metric"><span>Latest Suggested Listing</span><strong>Not analyzed</strong><small>No pricing analysis exists</small></div>
    <div className="insight-actions"><button className="button button-primary" type="button" disabled title="Pricing evidence not available yet">Offer Price</button><button className="button button-outline" type="button" disabled title="Pricing evidence not available yet">Listing Price</button></div>
    <p className="insight-footnote">Pricing evidence not available yet. No values are calculated or generated.</p>
  </section>;
}

export function DashboardPage() {
  const [query, setQuery] = useState('');
  const [record, setRecord] = useState<PropertyEnvelope | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'not-found' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [activeContext, setActiveContext] = useState<MapContext | null>(null);
  const [market, setMarket] = useState<{ propertyId: string; data: MarketContextResponse | null; status: 'loading' | 'ready' | 'error' } | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const request = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const marketController = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current.controller?.abort(); marketController.current?.abort(); }, []);
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

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = query.trim();
    request.current.controller?.abort();
    marketController.current?.abort();
    const id = ++request.current.id;
    if (!address) { setState('idle'); setRecord(null); return; }
    const controller = new AbortController();
    request.current.controller = controller;
    setState('loading'); setMessage(''); setRecord(null); setMarket(null); setSelectedCandidateId(null); setActiveContext(null);
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
  const clear = () => { request.current.controller?.abort(); marketController.current?.abort(); request.current.id++; setQuery(''); setRecord(null); setMarket(null); setSelectedCandidateId(null); setState('idle'); setMessage(''); setActiveContext(null); };

  const currentMarket = market?.propertyId === record?.property.id ? market : null;
  const candidates = currentMarket?.data ? [...currentMarket.data.recordedSales.candidates, ...currentMarket.data.activeListings.candidates] : [];

  return <div className="page dashboard-page"><div className="page-intro"><div><span className="page-kicker">WORKSPACE / DASHBOARD</span><h1>Dashboard</h1><p>Search a subject property and review nearby market evidence.</p></div><span className="demo-banner">Live property and market data · Pricing deferred</span></div>
    <section className="card search-card" aria-labelledby="search-title"><div className="search-card-header"><div><span className="eyebrow">Property lookup</span><h2 id="search-title">Find a property</h2></div><span className="search-hint">Enter the full address, including unit when applicable</span></div>
      <form className="search-form" onSubmit={search}><label className="sr-only" htmlFor="property-address">Search a property address</label><div className="search-input-wrap"><span aria-hidden="true" className="search-icon">⌕</span><input id="property-address" value={query} onChange={event => setQuery(event.target.value)} placeholder="Street, unit, city, state, ZIP" autoComplete="street-address" /></div><button className="button button-primary" type="submit">Search</button>{(query || record) && <button className="button button-quiet" type="button" onClick={clear}>Clear</button>}</form>
      <p className="lookup-note">Fresh saved profiles come from the PPI cache. A missing or expired profile makes one server-side RentCast request.</p>
    </section>
    {state === 'loading' ? <div className="card dashboard-empty"><FeedbackState kind="loading" title="Loading property" message="Checking saved data and, if needed, requesting the property record." /></div> : record ? <>
      {record.cache.cacheStatus === 'STALE_FALLBACK' && <p className="stale-warning" role="alert">Refresh failed. Showing the saved profile as stale; its fetched time has not changed.</p>}
      <PropertySummary record={record} /><div className="dashboard-grid"><PriceInsights /><MapShell subject={record.property} candidates={candidates} selectedId={selectedCandidateId} onSelect={setSelectedCandidateId} activeContext={activeContext} onContextChange={setActiveContext} /><ContextPanel activeContext={activeContext} /></div><ComparableTable market={currentMarket} selectedId={selectedCandidateId} onSelect={setSelectedCandidateId} />
    </> : <div className="card dashboard-empty"><FeedbackState kind={state === 'error' || state === 'not-found' ? 'error' : 'empty'} title={state === 'not-found' ? 'Property unavailable' : state === 'error' ? 'Search failed' : 'No property selected'} message={message || 'Enter a full address to find a subject property. No demo records are substituted for live results.'} /></div>}
  </div>;
}

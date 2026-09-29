import { useState, type FormEvent } from 'react';
import type { AnalysisMode, MapContext } from '@ppi/shared';
import { demoProperties, searchDemoProperty, type DemoProperty } from '../../fixtures/demo.js';
import { money, range } from '../../format.js';
import { FeedbackState } from '../../components/FeedbackState.js';
import { PropertySummary } from './PropertySummary.js';
import { MapShell } from '../map/MapShell.js';
import { ContextPanel } from '../map/ContextPanel.js';
import { ComparableTable } from './ComparableTable.js';
import { PricingAnalysisDialog } from '../pricing/PricingAnalysisDialog.js';

function PriceInsights({ property, onOpen }: { property: DemoProperty; onOpen: (mode: AnalysisMode) => void }) {
  return <section className="card insights-card" aria-labelledby="insights-title"><div className="card-heading"><div><span className="eyebrow">Decision support</span><h2 id="insights-title">Price Insights</h2></div><span className="section-tag">Demo</span></div>
    <div className="insight-reference"><span>Market Reference Range</span><strong>{range(property.referenceRange)}</strong><small>Illustrative fixture range</small></div>
    <div className="insight-metric"><span>Latest Suggested Offer</span><strong>{property.analyses.OFFER ? money(property.analyses.OFFER.suggestedPrice) : 'Not analyzed'}</strong><small>{property.analyses.OFFER ? 'Demo analysis' : 'No analysis available'}</small></div>
    <div className="insight-metric"><span>Latest Suggested Listing</span><strong>{property.analyses.LISTING ? money(property.analyses.LISTING.suggestedPrice) : 'Not analyzed'}</strong><small>{property.analyses.LISTING ? 'Demo analysis' : 'No analysis available'}</small></div>
    <div className="insight-actions"><button className="button button-primary" type="button" onClick={() => onOpen('OFFER')}>Offer Price</button><button className="button button-outline" type="button" onClick={() => onOpen('LISTING')}>Listing Price</button></div>
    <p className="insight-footnote">No pricing is calculated or generated in this milestone.</p>
  </section>;
}

export function DashboardPage() {
  const initial = demoProperties[0]!;
  const [query, setQuery] = useState(initial.address);
  const [property, setProperty] = useState<DemoProperty | null>(initial);
  const [searchState, setSearchState] = useState<'ready' | 'clear' | 'not-found'>('ready');
  const [activeContext, setActiveContext] = useState<MapContext | null>(null);
  const [selectedComparableId, setSelectedComparableId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<AnalysisMode | null>(null);

  const chooseProperty = (next: DemoProperty) => { setProperty(next); setQuery(next.address); setSearchState('ready'); setActiveContext(null); setSelectedComparableId(null); setDialogMode(null); };
  const search = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const found = searchDemoProperty(query); setProperty(found); setSearchState(found ? 'ready' : query.trim() ? 'not-found' : 'clear'); setActiveContext(null); setSelectedComparableId(null); setDialogMode(null); };
  const clear = () => { setQuery(''); setProperty(null); setSearchState('clear'); setActiveContext(null); setSelectedComparableId(null); setDialogMode(null); };

  return <div className="page dashboard-page"><div className="page-intro"><div><span className="page-kicker">WORKSPACE / DASHBOARD</span><h1>Dashboard</h1><p>Explore a property, compare evidence, and review pricing views.</p></div><span className="demo-banner">Fixture data only · No live property lookup</span></div>
    <section className="card search-card" aria-labelledby="search-title"><div className="search-card-header"><div><span className="eyebrow">Property lookup</span><h2 id="search-title">Find a demo property</h2></div><span className="search-hint">Only the listed synthetic addresses are searchable</span></div><form className="search-form" onSubmit={search}><label className="sr-only" htmlFor="property-address">Search a demo address</label><div className="search-input-wrap"><span aria-hidden="true" className="search-icon">⌕</span><input id="property-address" value={query} onChange={event => setQuery(event.target.value)} placeholder="Enter a demo address" autoComplete="off" /></div><button className="button button-primary" type="submit">Search</button>{(query || property) && <button className="button button-quiet" type="button" onClick={clear}>Clear</button>}</form><div className="demo-shortcuts"><span>Try a demo address:</span>{demoProperties.map(item => <button key={item.id} type="button" onClick={() => chooseProperty(item)}>{item.address.split(',')[0]}</button>)}</div></section>
    {property ? <><PropertySummary property={property} /><div className="dashboard-grid"><PriceInsights property={property} onOpen={setDialogMode} /><MapShell property={property} activeContext={activeContext} onContextChange={setActiveContext} selectedComparableId={selectedComparableId} /><ContextPanel property={property} activeContext={activeContext} /></div><ComparableTable comparables={property.comparables} selectedId={selectedComparableId} onSelect={setSelectedComparableId} /></> : <div className="card dashboard-empty"><FeedbackState kind={searchState === 'not-found' ? 'error' : 'empty'} title={searchState === 'not-found' ? 'Demo property not found' : 'No property selected'} message={searchState === 'not-found' ? 'No synthetic address matched your search. Try one of the demo addresses above.' : 'Choose a demo address above to explore the Dashboard. No live search is connected.'} /></div>}
    {property && dialogMode && <PricingAnalysisDialog property={property} mode={dialogMode} onClose={() => setDialogMode(null)} />}
  </div>;
}

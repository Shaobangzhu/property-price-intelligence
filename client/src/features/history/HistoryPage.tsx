import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PropertyPatchInput, type AnalysisRun, type AnalysisSummary, type PropertyEnvelope, type PropertyListResponse, type PropertyOverrideField } from '@ppi/shared';
import { apiErrorMessage, deleteProperty, getAnalysis, listAnalysisSummaries, listProperties, patchProperty, refreshProperty } from '../../api/properties.js';
import { dateTime, money, number } from '../../format.js';
import { FeedbackState } from '../../components/FeedbackState.js';
import { PricingAnalysisDialog } from '../pricing/PricingAnalysisDialog.js';

const PAGE_SIZE = 5;
const overrideFields: { key: PropertyOverrideField; label: string; step: string }[] = [
  { key: 'bedrooms', label: 'Bedrooms', step: '0.5' }, { key: 'bathrooms', label: 'Bathrooms', step: '0.5' },
  { key: 'livingAreaSqft', label: 'Living area (sqft)', step: '1' }, { key: 'yearBuilt', label: 'Year built', step: '1' }
];

type AnalysisHistory = { items: AnalysisSummary[]; total: number; page: number; latestOffer: AnalysisSummary | null; latestListing: AnalysisSummary | null; status: 'loading' | 'ready' | 'error' };
const latest = (history: AnalysisHistory | undefined, mode: AnalysisRun['mode']) => (mode === 'OFFER' ? history?.latestOffer : history?.latestListing) ?? null;
const suggested = (item: AnalysisSummary | null) => item ? money(item.suggestedPrice) : 'Not analyzed';
const summary = (run: AnalysisRun): AnalysisSummary => ({
  id: run.id, propertyId: run.propertyId, mode: run.mode, status: run.status, strategyProfile: run.strategyProfile,
  engineVersion: run.engineVersion, promptVersion: run.promptVersion, model: run.model, reasoningEffort: run.reasoningEffort,
  createdAt: run.createdAt, completedAt: run.completedAt, failureCode: run.failureCode,
  suggestedPrice: run.mode === 'OFFER' ? run.engineResult.offerResult?.suggestedPrice ?? null : run.engineResult.listingResult?.suggestedPrice ?? null
});

function DetailPanel({ record, history, onView, onLoadOlder, openingId, onSave, busy }: { record: PropertyEnvelope | null; history: AnalysisHistory | undefined; onView: (run: AnalysisSummary) => void; onLoadOlder: () => void; openingId: string | null; onSave: (id: string, patch: PropertyPatchInput) => Promise<void>; busy: boolean }) {
  const analyses = history?.items ?? [];
  const historyLabel = history?.status === 'error' ? 'Analysis history unavailable' : history?.status !== 'ready' ? 'Loading analyses…' : 'Not analyzed';
  const property = record?.property;
  const [notes, setNotes] = useState(property?.notes ?? '');
  const [overrides, setOverrides] = useState<Record<PropertyOverrideField, string>>({
    bedrooms: String(property?.userOverrides.bedrooms?.value ?? ''), bathrooms: String(property?.userOverrides.bathrooms?.value ?? ''),
    livingAreaSqft: String(property?.userOverrides.livingAreaSqft?.value ?? ''), yearBuilt: String(property?.userOverrides.yearBuilt?.value ?? '')
  });
  const [validation, setValidation] = useState('');
  const hasChanges = !!property && (notes !== (property.notes ?? '') || overrideFields.some(({ key }) => overrides[key] !== String(property.userOverrides[key]?.value ?? '')));
  const save = async () => {
    if (!property || !hasChanges) return;
    const payload: Record<string, unknown> = {};
    if (notes !== (property.notes ?? '')) payload.notes = notes || null;
    const changedOverrides: Record<string, number | null> = {};
    for (const { key } of overrideFields) {
      if (overrides[key] !== String(property.userOverrides[key]?.value ?? '')) changedOverrides[key] = overrides[key].trim() === '' ? null : Number(overrides[key]);
    }
    if (Object.keys(changedOverrides).length) payload.overrides = changedOverrides;
    const parsed = PropertyPatchInput.safeParse(payload);
    if (!parsed.success) { setValidation('Check the override values before saving.'); return; }
    setValidation('');
    await onSave(property.id, parsed.data);
  };

  return <aside className="card history-detail" aria-labelledby="detail-title"><div className="card-heading"><div><span className="eyebrow">Saved subject</span><h2 id="detail-title">Selected Record Details</h2></div><span className="section-tag">PostgreSQL</span></div>
    {record && property ? <><h3>{property.formattedAddress}</h3><p className="detail-type">{property.propertyType ?? 'Type unavailable'} · {record.cache.freshness.toLowerCase()}</p>
      <dl className="detail-facts"><div><dt>Beds / Baths</dt><dd>{property.effectiveValues.bedrooms ?? '—'} / {property.effectiveValues.bathrooms ?? '—'}</dd></div><div><dt>Living area</dt><dd>{property.effectiveValues.livingAreaSqft === null ? 'Not available' : `${number(property.effectiveValues.livingAreaSqft)} sqft`}</dd></div><div><dt>Lot size</dt><dd>{property.lotSizeSqft === null ? 'Not available' : `${number(property.lotSizeSqft)} sqft`}</dd></div><div><dt>Year built</dt><dd>{property.effectiveValues.yearBuilt ?? 'Not available'}</dd></div></dl>
      {(['OFFER', 'LISTING'] as const).map(mode => { const item = latest(history, mode); return <div className="detail-analysis" key={mode}><span>Latest {mode === 'OFFER' ? 'Offer' : 'Listing'} Analysis</span><strong>{item ? suggested(item) : historyLabel}</strong><small>{item ? `${dateTime(item.createdAt)} · ${item.status.toLowerCase()} · ${item.model}` : history?.status === 'ready' ? 'Not analyzed' : ''}</small>{item && <button type="button" className="button button-quiet" disabled={openingId !== null} onClick={() => onView(item)}>{openingId === item.id ? 'Opening…' : 'View Analysis'}</button>}</div>; })}
      {!!analyses.length && <div className="detail-analysis"><span>Analysis versions</span><ul className="pricing-evidence-list">{analyses.map(item => <li key={item.id}>{dateTime(item.createdAt)} · {item.mode} · {suggested(item)} · {item.status.toLowerCase()} <button type="button" className="button button-quiet" disabled={openingId !== null} onClick={() => onView(item)}>{openingId === item.id ? 'Opening…' : 'View Analysis'}</button></li>)}</ul></div>}
      {history?.status === 'error' && <p className="form-error" role="alert">Saved analyses could not be loaded. Property details remain available.</p>}
      {history && (history.total > analyses.length || history.status === 'error') && <button className="button button-quiet" type="button" disabled={history.status === 'loading'} onClick={onLoadOlder}>{history.status === 'loading' ? 'Loading analyses…' : history.status === 'error' ? 'Retry analysis history' : 'Load older analyses'}</button>}
      <div className="detail-source"><strong>Source &amp; freshness</strong><p>{record.cache.source ?? 'Unknown'} · fetched {dateTime(record.cache.fetchedAt)} · expires {dateTime(record.cache.expiresAt)}.{property.refreshFailedAt && ` Last refresh failed ${dateTime(property.refreshFailedAt)}.`}</p></div>
      <div className="detail-notes"><label htmlFor="property-notes"><strong>Notes</strong></label><textarea id="property-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={5000} rows={3} placeholder="Add private notes for this PPI record" /></div>
      <div className="detail-overrides"><strong>User overrides</strong><p>Provider values remain unchanged. Blank fields use the provider value.</p>{overrideFields.map(({ key, label, step }) => <label key={key}>{label}<span>Provider: {property[key] === null ? 'Unavailable' : number(property[key])}{property.userOverrides[key] ? ` · user override saved ${dateTime(property.userOverrides[key].updatedAt)}` : ''}</span><input type="number" step={step} value={overrides[key]} onChange={event => setOverrides({ ...overrides, [key]: event.target.value })} placeholder="No override" /></label>)}</div>
      {validation && <p className="form-error" role="alert">{validation}</p>}
      <button className="button button-primary detail-save" type="button" disabled={!hasChanges || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
    </> : <FeedbackState kind="empty" title="No record selected" message="Select a saved property row to inspect its details." compact />}
  </aside>;
}

export function HistoryPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<PropertyListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analysesByProperty, setAnalysesByProperty] = useState<Record<string, AnalysisHistory>>({});
  const [view, setView] = useState<{ run: AnalysisRun; property: PropertyEnvelope } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const listController = useRef<AbortController | null>(null), viewController = useRef<AbortController | null>(null);
  const mutationPending = useRef(false);
  useEffect(() => () => { viewController.current?.abort(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setResult(null);
    listProperties({ page, pageSize: PAGE_SIZE, search }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch(reason => { if (!controller.signal.aborted) setError(apiErrorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, search, reload]);
  useEffect(() => {
    const controller = new AbortController();
    listController.current = controller;
    const ids = result?.items.map(item => item.property.id) ?? [];
    setAnalysesByProperty(Object.fromEntries(ids.map(id => [id, { items: [], total: 0, page: 0, latestOffer: null, latestListing: null, status: 'loading' }])));
    for (const id of ids) void listAnalysisSummaries(id, controller.signal).then(data => {
      if (!controller.signal.aborted) setAnalysesByProperty(previous => ({ ...previous, [id]: { ...data, status: 'ready' } }));
    }).catch(() => {
      if (!controller.signal.aborted) setAnalysesByProperty(previous => ({ ...previous, [id]: { items: [], total: 0, page: 0, latestOffer: null, latestListing: null, status: 'error' } }));
    });
    return () => controller.abort();
  }, [result]);

  const rows = result?.items ?? [];
  const selected = rows.find(item => item.property.id === selectedId) ?? rows[0] ?? null;
  const selectedHistory = selected ? analysesByProperty[selected.property.id] : undefined;
  const pageAnalyses = Object.values(analysesByProperty).flatMap(value => value.items);
  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
  const selectProperty = (id: string) => {
    if (selected?.property.id !== id) { viewController.current?.abort(); setOpeningId(null); }
    setSelectedId(id);
  };
  const mutate = async (id: string, action: () => Promise<unknown>) => {
    if (mutationPending.current) return;
    mutationPending.current = true; setBusyId(id); setActionError('');
    try { await action(); setReload(value => value + 1); }
    catch (reason) { setActionError(apiErrorMessage(reason)); }
    finally { mutationPending.current = false; setBusyId(null); }
  };
  const refresh = (id: string) => mutate(id, async () => {
    const refreshed = await refreshProperty(id);
    if (refreshed.cache.cacheStatus === 'STALE_FALLBACK') setActionError('Refresh failed. Saved property data remains stale and its fetched time has not changed.');
  });
  const remove = (id: string) => {
    if (!window.confirm('Delete this PPI property, its saved snapshots, and all analysis versions?')) return;
    void mutate(id, async () => { await deleteProperty(id); if (view?.property.property.id === id) setView(null); viewController.current?.abort(); setOpeningId(null); if (selectedId === id) setSelectedId(null); if (rows.length === 1 && page > 1) setPage(page - 1); });
  };

  const openAnalysis = async (item: AnalysisSummary) => {
    const property = rows.find(row => row.property.id === item.propertyId);
    if (!property) return;
    viewController.current?.abort();
    const controller = new AbortController();
    viewController.current = controller;
    setOpeningId(item.id); setActionError('');
    try {
      const run = await getAnalysis(item.id, controller.signal);
      if (controller.signal.aborted) return;
      if (run.propertyId !== property.property.id || run.id !== item.id) throw new Error('ANALYSIS_IDENTITY_MISMATCH');
      setView({ run, property });
    } catch { if (!controller.signal.aborted) setActionError('This saved analysis could not be opened. Try again.'); }
    finally { if (!controller.signal.aborted) setOpeningId(null); }
  };
  const loadOlder = async () => {
    if (!selected || !selectedHistory || selectedHistory.status === 'loading') return;
    const id = selected.property.id, current = selectedHistory, controller = listController.current;
    if (!controller || controller.signal.aborted) return;
    setAnalysesByProperty(previous => ({ ...previous, [id]: { ...current, status: 'loading' } }));
    try {
      const data = await listAnalysisSummaries(id, controller.signal, current.page + 1);
      if (!controller.signal.aborted) setAnalysesByProperty(previous => ({ ...previous, [id]: { ...data, items: [...current.items, ...data.items].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index), status: 'ready' } }));
    } catch { if (!controller.signal.aborted) setAnalysesByProperty(previous => ({ ...previous, [id]: { ...current, status: 'error' } })); }
  };
  const saveSummary = (run: AnalysisRun) => {
    setAnalysesByProperty(previous => {
      const history = previous[run.propertyId];
      if (!history) return previous;
      const exists = history.items.some(item => item.id === run.id);
      const latestField = run.mode === 'OFFER' ? 'latestOffer' : 'latestListing';
      const next = summary(run);
      const newest = history[latestField];
      return { ...previous, [run.propertyId]: { ...history, [latestField]: !newest || next.createdAt >= newest.createdAt ? next : newest, items: [next, ...history.items.filter(item => item.id !== run.id)], total: history.total + (exists ? 0 : 1) } };
    });
  };

  return <div className="page history-page"><div className="page-intro"><div><span className="page-kicker">WORKSPACE / HISTORY</span><h1>History</h1><p>Review saved properties and exact analysis versions.</p></div><span className="demo-banner">PostgreSQL records · Versioned pricing analyses</span></div>
    <div className="card history-toolbar history-toolbar-live"><div className="history-search-field"><label htmlFor="history-search">Search by address</label><input id="history-search" type="search" value={search} onChange={event => { viewController.current?.abort(); setOpeningId(null); setSearch(event.target.value); setPage(1); }} placeholder="Search saved property addresses" /></div><Link className="button button-primary new-search" to="/dashboard">New Search</Link></div>
    <div className="history-heading"><div><span className="eyebrow">Saved subjects</span><h2>Property History</h2></div><p>Only properties explicitly searched as subjects appear here.</p></div>
    <div className="history-stats"><div className="card stat-card"><span>Total Properties</span><strong>{result?.total ?? '—'}</strong><small>Matching saved records</small></div><div className="card stat-card"><span>Offer Analyses</span><strong>{pageAnalyses.filter(item => item.mode === 'OFFER').length}</strong><small>Loaded versions on this page</small></div><div className="card stat-card"><span>Listing Analyses</span><strong>{pageAnalyses.filter(item => item.mode === 'LISTING').length}</strong><small>Loaded versions on this page</small></div><div className="card stat-card"><span>Last Updated</span><strong className="stat-date">{dateTime(rows[0]?.property.updatedAt ?? null)}</strong><small>Current result page</small></div></div>
    {actionError && <p className="stale-warning" role="alert">{actionError}</p>}
    <div className="history-layout"><section className="card history-table-card" aria-label="Saved property history"><div className="card-heading"><div><span className="eyebrow">Property records</span><h2>All properties</h2></div><span className="count-pill">{result?.total ?? 0} results</span></div>
      {loading && !result ? <FeedbackState kind="loading" title="Loading history" message="Reading saved properties from PPI PostgreSQL." compact /> : error ? <FeedbackState kind="error" title="History unavailable" message={error} compact /> : rows.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Address</th><th scope="col">Property Type</th><th scope="col">Last Property Data Update</th><th scope="col">Latest Offer Analysis</th><th scope="col">Latest Listing Analysis</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{rows.map(item => { const property = item.property, history = analysesByProperty[property.id], missingAnalysis = history?.status === 'error' ? 'Unavailable' : history?.status !== 'ready' ? 'Loading…' : 'Not analyzed'; return <tr key={property.id} tabIndex={0} className={`history-row${selected?.property.id === property.id ? ' selected-row' : ''}`} aria-selected={selected?.property.id === property.id} onClick={() => selectProperty(property.id)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectProperty(property.id); } }}><td className="history-address"><strong>{property.addressLine1}{property.unit ? `, ${property.unit}` : ''}</strong><small>{property.city}, {property.state} {property.zipCode}</small></td><td>{property.propertyType ?? 'Unavailable'}</td><td>{dateTime(item.cache.fetchedAt)}</td><td>{latest(history, 'OFFER') ? suggested(latest(history, 'OFFER')) : missingAnalysis}</td><td>{latest(history, 'LISTING') ? suggested(latest(history, 'LISTING')) : missingAnalysis}</td><td><span className={`status-tag status-${item.cache.freshness === 'FRESH' ? 'fresh' : 'stale'}`}>{item.cache.freshness}</span></td><td><div className="row-actions"><button type="button" onClick={() => selectProperty(property.id)}>View</button><button type="button" disabled={busyId !== null} onClick={() => void refresh(property.id)}>Refresh</button><button type="button" disabled={busyId !== null} onClick={() => remove(property.id)}>Delete</button></div></td></tr>; })}</tbody></table></div> : <FeedbackState kind="empty" title="History empty" message="No saved subject properties match this search. Use New Search to add one." compact />}
      {loading && result && <p className="table-note" role="status">Updating history…</p>}
      <div className="pagination"><span>Showing {result?.total ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, result?.total ?? 0)} of {result?.total ?? 0}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => { viewController.current?.abort(); setOpeningId(null); setPage(page - 1); }}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={page >= pageCount || loading} onClick={() => { viewController.current?.abort(); setOpeningId(null); setPage(page + 1); }}>Next</button></div></div></section>
      <DetailPanel key={selected?.property.id ?? 'empty'} record={selected} history={selectedHistory} onView={item => void openAnalysis(item)} onLoadOlder={() => void loadOlder()} openingId={openingId} busy={busyId !== null} onSave={async (id, patch) => { await mutate(id, () => patchProperty(id, patch)); }} />
    </div>
    {view && <PricingAnalysisDialog key={view.run.id} property={view.property} mode={view.run.mode} historicalRun={view.run} onClose={() => setView(null)} onSaved={saveSummary} />}
  </div>;
}

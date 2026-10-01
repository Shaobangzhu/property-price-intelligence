import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AnalysisMode, AnalysisRun, PricingPreviewRequest, PricingPreviewResponse, PropertyEnvelope } from '@ppi/shared';
import { createAnalysis, getAnalysis, regenerateAnalysis } from '../../api/properties.js';
import { dateTime, money, range } from '../../format.js';
import { FeedbackState } from '../../components/FeedbackState.js';

const offerProfiles = ['CONSERVATIVE', 'BALANCED', 'COMPETITIVE'] as const;
const listingProfiles = ['QUICK_SALE', 'BALANCED', 'TEST_MARKET'] as const;
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());

function PriceScale({ reference, recommended, suggested }: { reference: [number, number]; recommended: [number, number]; suggested: number }) {
  const values = [...reference, ...recommended, suggested];
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * 0.12, 1000);
  const start = low - padding, span = high - low + padding * 2;
  const position = (value: number) => `${((value - start) / span) * 100}%`;
  return <div className="price-scale" role="img" aria-label={`Market Reference Range ${range(reference)}; recommended range ${range(recommended)}; suggested price ${money(suggested)}`}>
    <div className="scale-track"><span className="scale-market" style={{ left: position(reference[0]), width: `${((reference[1] - reference[0]) / span) * 100}%` }} /><span className="scale-recommended" style={{ left: position(recommended[0]), width: `${((recommended[1] - recommended[0]) / span) * 100}%` }} /><span className="scale-marker suggested-marker" style={{ left: position(suggested) }} /></div>
    <div className="scale-key"><span><i className="scale-key-line" />Recommended range</span><span><i className="scale-key-dot suggested-key" />Suggested</span></div>
    <div className="scale-bounds"><span>{money(low)}</span><span>{money(high)}</span></div>
  </div>;
}

export function PricingAnalysisDialog({ property, mode, historicalRun, onClose, onResult, onSaved }: {
  property: PropertyEnvelope; mode: AnalysisMode; historicalRun?: AnalysisRun; onClose: () => void;
  onResult?: (result: PricingPreviewResponse) => void; onSaved?: (run: AnalysisRun) => void;
}) {
  const titleId = useId(), descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null), closeRef = useRef<HTMLButtonElement>(null), onCloseRef = useRef(onClose);
  const onResultRef = useRef(onResult), onSavedRef = useRef(onSaved), pending = useRef(false), mounted = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  const retryIdentity = useRef<{ signature: string; key: string } | null>(null);
  const retryRegeneration = useRef(false);
  onCloseRef.current = onClose; onResultRef.current = onResult; onSavedRef.current = onSaved;
  const [strategy, setStrategy] = useState<string>(historicalRun?.strategyProfile ?? 'BALANCED');
  const [budget, setBudget] = useState(historicalRun?.userInputs.mode === 'OFFER' ? String(historicalRun.userInputs.maxBudget ?? '') : '');
  const [run, setRun] = useState<AnalysisRun | null>(historicalRun ?? null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(historicalRun ? 'ready' : 'loading');
  const isOffer = mode === 'OFFER';

  useEffect(() => {
    mounted.current = true;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])') ?? []);
      if (!focusable.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { mounted.current = false; requestRef.current?.abort(); pending.current = false; document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow; if (opener?.isConnected) opener.focus(); };
  }, []);

  const settle = async (value: AnalysisRun, controller: AbortController) => {
    let current = value;
    const active = () => mounted.current && !controller.signal.aborted && requestRef.current === controller;
    if (!active()) return;
    // Show saved deterministic values even when a later status poll fails.
    setRun(current); onResultRef.current?.(current.engineResult);
    for (let attempt = 0; current.status === 'RUNNING' && attempt < 15 && active(); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!active()) return;
      current = await getAnalysis(current.id, controller.signal);
      if (current.propertyId !== property.property.id || current.mode !== mode) throw new Error('ANALYSIS_IDENTITY_MISMATCH');
    }
    if (active()) { setRun(current); setStatus('ready'); onResultRef.current?.(current.engineResult); onSavedRef.current?.(current); }
  };
  const generate = async (regenerate = false) => {
    if (pending.current) return;
    retryRegeneration.current = regenerate;
    const maxBudget = budget.trim() ? Number(budget) : null;
    if (isOffer && maxBudget !== null && (!Number.isFinite(maxBudget) || maxBudget <= 0 || maxBudget > 1_000_000_000)) { setStatus('error'); return; }
    const payload: PricingPreviewRequest = isOffer
      ? { mode: 'OFFER', strategyProfile: strategy as typeof offerProfiles[number], maxBudget }
      : { mode: 'LISTING', strategyProfile: strategy as typeof listingProfiles[number] };
    const signature = JSON.stringify({ propertyId: property.property.id, payload, regenerate: regenerate ? run?.id : null });
    if (retryIdentity.current?.signature !== signature) retryIdentity.current = { signature, key: crypto.randomUUID() };
    const key = retryIdentity.current.key;
    const controller = new AbortController();
    requestRef.current = controller;
    pending.current = true; setStatus('loading');
    try {
      const value = regenerate && run ? await regenerateAnalysis(run.id, key, controller.signal) :
        await createAnalysis(property.property.id, payload, key, controller.signal);
      if (value.propertyId !== property.property.id || value.mode !== mode) throw new Error('ANALYSIS_IDENTITY_MISMATCH');
      await settle(value, controller);
      if (!controller.signal.aborted) retryIdentity.current = null;
    } catch { if (mounted.current && !controller.signal.aborted && requestRef.current === controller) setStatus('error'); }
    finally { if (requestRef.current === controller) pending.current = false; }
  };
  const checkStatus = async () => {
    if (!run || pending.current) return;
    const controller = new AbortController();
    requestRef.current = controller; pending.current = true; setStatus('loading');
    try { await settle(run, controller); }
    catch { if (!controller.signal.aborted) setStatus('error'); }
    finally { if (requestRef.current === controller) pending.current = false; }
  };
  useEffect(() => {
    // Defer the initial request until effect setup is stable, including StrictMode's cleanup/replay.
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (!historicalRun) void generate();
      else if (historicalRun.status === 'RUNNING') {
        const controller = new AbortController();
        requestRef.current = controller; pending.current = true; setStatus('loading');
        void settle(historicalRun, controller).catch(() => { if (!controller.signal.aborted) setStatus('error'); })
          .finally(() => { if (requestRef.current === controller) pending.current = false; });
      }
    });
    return () => { active = false; };
  }, []);

  const desired: PricingPreviewRequest = isOffer ? { mode: 'OFFER', strategyProfile: strategy as typeof offerProfiles[number], maxBudget: budget.trim() ? Number(budget) : null }
    : { mode: 'LISTING', strategyProfile: strategy as typeof listingProfiles[number] };
  const settingsChanged = !!run && JSON.stringify(desired) !== JSON.stringify(run.userInputs);
  const result = run?.engineResult;
  const strategyResult = isOffer ? result?.offerResult : result?.listingResult;
  const snapshotSubject = run?.inputSnapshot as { subject?: { currentListPrice?: number | null } } | undefined;
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="analysis-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
    <header className="dialog-header"><div><span className="eyebrow">Saved pricing analysis</span><h2 id={titleId}>{isOffer ? 'Offer Price Analysis' : 'Listing Price Analysis'}</h2><p id={descriptionId}>{isOffer ? 'Buyer strategy' : 'Seller strategy'} from recorded-sale evidence.</p></div><button ref={closeRef} type="button" className="icon-button dialog-close" aria-label="Close dialog" onClick={onClose}>×</button></header>
    <div className="dialog-body"><p className="dialog-property">{property.property.formattedAddress}</p>
      <div className="pricing-controls"><label>Strategy profile<select aria-label="Strategy profile" value={strategy} disabled={!!historicalRun || status === 'loading'} onChange={event => setStrategy(event.target.value)}>{(isOffer ? offerProfiles : listingProfiles).map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
        {isOffer && <label>Maximum budget (optional)<input aria-label="Maximum budget" type="number" min="1" max="1000000000" step="100" value={budget} disabled={!!historicalRun || status === 'loading'} onChange={event => setBudget(event.target.value)} placeholder="No limit" /></label>}
        {!historicalRun && <button className="button button-outline" type="button" disabled={status === 'loading' || !settingsChanged} onClick={() => void generate()}>Generate analysis</button>}</div>
      {status === 'loading' && <FeedbackState kind="loading" title="Generating analysis" message="Calculating the price and requesting an AI-assisted explanation." compact />}
      {status === 'error' && <><FeedbackState kind="error" title="Analysis request unavailable" message="Check the budget or retry the analysis request. Existing saved results remain available." compact /><button className="button button-outline" type="button" onClick={() => void (run?.status === 'RUNNING' ? checkStatus() : generate(retryRegeneration.current))}>Retry analysis</button></>}
      {run && result && <>
        <div className="analysis-summary-row"><div><span>List Price at Analysis</span><strong>{money(snapshotSubject?.subject?.currentListPrice ?? null)}</strong></div><div><span>Market Reference Range</span><strong>{range(result.referenceRange)}</strong></div><div><span>{isOffer ? 'Recommended Offer Range' : 'Recommended Listing Range'}</span><strong>{range(strategyResult?.recommendedRange ?? null)}</strong></div><div className="highlight-summary"><span>{isOffer ? 'Suggested Offer' : 'Suggested Listing Price'}</span><strong>{money(strategyResult?.suggestedPrice ?? null)}</strong></div></div>
        <p className="pricing-meta">Price calculated by PPI pricing engine; explanation AI-assisted. {result.engineVersion} · {label(result.evidenceQuality)} evidence · saved {dateTime(run.createdAt)}</p>
        {settingsChanged && <p className="stale-warning">The settings above differ from this saved run. Generate an analysis to use them.</p>}
        {result.status === 'INSUFFICIENT_EVIDENCE' && <FeedbackState kind="empty" title="Insufficient evidence" message="The engine made no numeric recommendation from the available recorded sales." compact />}
        {strategyResult?.status === 'BUDGET_BELOW_REFERENCE_RANGE' && <FeedbackState kind="empty" title="Budget below reference range" message="The maximum budget is below the observed Market Reference Range, so no offer is suggested." compact />}
        {result.referenceRange && strategyResult?.recommendedRange && strategyResult.suggestedPrice !== null && <section className="dialog-section"><div className="section-title-row"><h3>Price Range Visualization</h3><span className="section-tag">Recorded sales</span></div><PriceScale reference={result.referenceRange} recommended={strategyResult.recommendedRange} suggested={strategyResult.suggestedPrice} /></section>}
        <section className="dialog-section"><h3>{isOffer ? 'Why this offer range' : 'Why this listing range'}</h3><span className="section-tag">AI-assisted</span>
          {run.aiResult ? <><p>{run.aiResult.summary}</p><ul className="pricing-evidence-list">{run.aiResult.reasons.map((reason, index) => <li key={index}>{reason.claim} <small>Evidence: {reason.evidenceIds.join(', ')}</small></li>)}</ul></> : <p role="status">Explanation unavailable{run.status === 'RUNNING' ? ' while generation is in progress' : ''}. The deterministic price remains available.</p>}</section>
        <div className="dialog-detail-grid"><section className="dialog-section"><h3>Evidence decisions</h3><ul className="pricing-evidence-list">{result.includedComparables.map(comp => <li key={`in:${comp.candidateId}`}>{comp.candidateId}: included · {money(comp.soldPrice)} · weight {comp.normalizedWeight.toFixed(3)}</li>)}{result.excludedComparables.map((comp, index) => <li key={`out:${comp.candidateId}:${index}`}>{comp.candidateId}: {label(comp.reasonCode)}</li>)}</ul></section>
          <section className="dialog-section strategy-section"><h3>Suggested strategy</h3><strong>{label(run.strategyProfile)}</strong><ul>{(run.aiResult?.strategySteps ?? [...new Set([...result.reasonCodes, ...(strategyResult?.reasonCodes ?? [])])].map(label)).map((step, index) => <li key={index}>{step}</li>)}</ul><p className="pricing-context-note">Active listing asks: {result.activeListingContext.length} shown as competitive context only.</p></section></div>
        <section className="dialog-section assumptions-section"><h3>Assumptions &amp; Limits</h3><ul className="pricing-evidence-list">{[...result.assumptions, ...result.warnings, ...(run.aiResult?.assumptions ?? []), ...(run.aiResult?.unknowns ?? []), ...(run.aiResult?.warnings ?? [])].map((text, index) => <li key={index}>{text}</li>)}</ul></section>
        <p className="pricing-meta">Run {run.id} · {run.status.toLowerCase()} · {run.model} · {run.promptVersion}</p>
      </>}
    </div>
    <footer className="dialog-actions"><span>{run ? `Saved ${dateTime(run.createdAt)}` : 'Preparing saved analysis'}</span><div>{run?.status === 'RUNNING' && <button type="button" className="button button-outline" disabled={status === 'loading'} onClick={() => void checkStatus()}>Check analysis status</button>}{run && run.status !== 'RUNNING' && <button type="button" className="button button-outline" disabled={status === 'loading' || settingsChanged} onClick={() => void generate(true)}>Regenerate explanation</button>}<button type="button" className="button button-quiet" onClick={onClose}>Close</button></div></footer>
  </div></div>, document.body);
}

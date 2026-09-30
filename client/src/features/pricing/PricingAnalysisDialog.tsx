import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AnalysisMode, PricingPreviewResponse, PropertyEnvelope } from '@ppi/shared';
import { previewPricing } from '../../api/properties.js';
import { money, range } from '../../format.js';
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

export function PricingAnalysisDialog({ property, mode, onClose, onResult }: { property: PropertyEnvelope; mode: AnalysisMode; onClose: () => void; onResult: (result: PricingPreviewResponse) => void }) {
  const titleId = useId(), descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null), closeRef = useRef<HTMLButtonElement>(null), onCloseRef = useRef(onClose), onResultRef = useRef(onResult);
  onCloseRef.current = onClose; onResultRef.current = onResult;
  const [strategy, setStrategy] = useState<string>('BALANCED');
  const [budget, setBudget] = useState('');
  const [result, setResult] = useState<PricingPreviewResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'invalid'>('loading');
  const isOffer = mode === 'OFFER';
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? []);
      if (!focusable.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow; opener?.focus(); };
  }, []);
  useEffect(() => {
    const parsedBudget = budget.trim() ? Number(budget) : null;
    if (isOffer && parsedBudget !== null && (!Number.isFinite(parsedBudget) || parsedBudget <= 0 || parsedBudget > 1_000_000_000)) {
      setStatus('invalid'); setResult(null); return;
    }
    const controller = new AbortController();
    setStatus('loading'); setResult(null);
    const payload = isOffer
      ? { mode: 'OFFER' as const, strategyProfile: strategy as typeof offerProfiles[number], maxBudget: parsedBudget }
      : { mode: 'LISTING' as const, strategyProfile: strategy as typeof listingProfiles[number] };
    void previewPricing(property.property.id, payload, controller.signal).then(value => {
      if (!controller.signal.aborted) { setResult(value); setStatus('ready'); onResultRef.current(value); }
    }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [property.property.id, mode, strategy, budget, isOffer]);

  const strategyResult = isOffer ? result?.offerResult : result?.listingResult;
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="analysis-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
    <header className="dialog-header"><div><span className="eyebrow">Deterministic pricing preview</span><h2 id={titleId}>{isOffer ? 'Offer Price Analysis' : 'Listing Price Analysis'}</h2><p id={descriptionId}>{isOffer ? 'Buyer strategy from recorded-sale evidence' : 'Seller strategy from recorded-sale evidence'}.</p></div><button ref={closeRef} type="button" className="icon-button dialog-close" aria-label="Close dialog" onClick={onClose}>×</button></header>
    <div className="dialog-body"><p className="dialog-property">{property.property.formattedAddress}</p>
      <div className="pricing-controls"><label>Strategy profile<select aria-label="Strategy profile" value={strategy} onChange={event => setStrategy(event.target.value)}>{(isOffer ? offerProfiles : listingProfiles).map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
        {isOffer && <label>Maximum budget (optional)<input aria-label="Maximum budget" type="number" min="1" max="1000000000" step="100" value={budget} onChange={event => setBudget(event.target.value)} placeholder="No limit" /></label>}</div>
      {status === 'invalid' && <FeedbackState kind="error" title="Invalid budget" message="Enter a positive budget no greater than $1,000,000,000, or leave it blank." compact />}
      {status === 'loading' && <FeedbackState kind="loading" title="Calculating pricing preview" message="Checking the configured recorded-sale evidence set." compact />}
      {status === 'error' && <FeedbackState kind="error" title="Pricing preview unavailable" message="The preview request failed. Change the strategy to retry." compact />}
      {status === 'ready' && result && <>
        <div className="analysis-summary-row"><div><span>Market Reference</span><strong>{money(result.referencePrice)}</strong></div><div><span>Market Reference Range</span><strong>{range(result.referenceRange)}</strong></div><div><span>{isOffer ? 'Recommended Offer Range' : 'Recommended Listing Range'}</span><strong>{range(strategyResult?.recommendedRange ?? null)}</strong></div><div className="highlight-summary"><span>{isOffer ? 'Suggested Offer' : 'Suggested Listing Price'}</span><strong>{money(strategyResult?.suggestedPrice ?? null)}</strong></div></div>
        <p className="pricing-meta">{result.engineVersion} · Evidence quality: {label(result.evidenceQuality)} · {result.includedComparables.length} included sale{result.includedComparables.length === 1 ? '' : 's'} · {result.excludedComparables.length} excluded</p>
        {result.status === 'INSUFFICIENT_EVIDENCE' && <FeedbackState kind="empty" title="Insufficient evidence" message="No numeric recommendation is made. Review the reason codes and available recorded sales below." compact />}
        {strategyResult?.status === 'BUDGET_BELOW_REFERENCE_RANGE' && <FeedbackState kind="empty" title="Budget below reference range" message="The maximum budget is below the observed Market Reference Range, so no offer is suggested." compact />}
        {result.referenceRange && strategyResult?.recommendedRange && strategyResult.suggestedPrice !== null && <section className="dialog-section"><div className="section-title-row"><h3>Price Range Visualization</h3><span className="section-tag">Recorded sales</span></div><PriceScale reference={result.referenceRange} recommended={strategyResult.recommendedRange} suggested={strategyResult.suggestedPrice} /></section>}
        <div className="dialog-detail-grid"><section className="dialog-section"><h3>Evidence decisions</h3><ul className="pricing-evidence-list">{result.includedComparables.map(comp => <li key={`in:${comp.candidateId}`}>{comp.candidateId}: included · {money(comp.soldPrice)} · {comp.normalizedWeight.toFixed(3)} weight · distance {comp.factors.distance.toFixed(2)}, recency {comp.factors.recency.toFixed(2)}, size {comp.factors.sizeSimilarity.toFixed(2)}</li>)}{result.excludedComparables.map((comp, index) => <li key={`out:${comp.candidateId}:${index}`}>{comp.candidateId}: {label(comp.reasonCode)}</li>)}</ul></section>
          <section className="dialog-section strategy-section"><h3>{isOffer ? 'Offer' : 'Listing'} strategy</h3><strong>{label(strategy)}</strong><ul>{[...new Set([...result.reasonCodes, ...(strategyResult?.reasonCodes ?? [])])].map(code => <li key={code}>{label(code)}</li>)}</ul><p className="pricing-context-note">Active listing asks: {result.activeListingContext.length} shown as competitive context only.</p><ul className="pricing-evidence-list">{result.activeListingContext.map(listing => <li key={listing.candidateId}>{listing.candidateId}: {money(listing.askingPrice)} · {label(listing.position)}</li>)}</ul></section></div>
        <section className="dialog-section assumptions-section"><h3>Assumptions &amp; Limits</h3><ul className="pricing-evidence-list">{result.assumptions.map(text => <li key={text}>{text}</li>)}{result.warnings.map(text => <li key={text}>{text}</li>)}</ul><p>AI explanation is available in the next milestone. This preview is not saved.</p></section>
      </>}
    </div>
    <footer className="dialog-actions"><span>Preview only · no analysis is saved</span><div><button type="button" className="button button-quiet" onClick={onClose}>Close</button></div></footer>
  </div></div>, document.body);
}

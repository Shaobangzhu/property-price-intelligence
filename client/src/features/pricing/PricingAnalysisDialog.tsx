import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { AnalysisMode } from '@ppi/shared';
import type { DemoAnalysis, DemoProperty } from '../../fixtures/demo.js';
import { date, money, range } from '../../format.js';
import { FeedbackState } from '../../components/FeedbackState.js';

function PriceScale({ analysis }: { analysis: DemoAnalysis }) {
  const values = [analysis.primaryValue, analysis.marketRange[0], analysis.marketRange[1], analysis.recommendedRange[0], analysis.recommendedRange[1], analysis.suggestedPrice];
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * 0.12, 1000);
  const start = low - padding, span = high - low + padding * 2;
  const position = (value: number) => `${((value - start) / span) * 100}%`;
  return <div className="price-scale" aria-label={`Recommended range ${range(analysis.recommendedRange)}; suggested price ${money(analysis.suggestedPrice)}; ${analysis.mode === 'OFFER' ? 'list price' : 'reference value'} ${money(analysis.primaryValue)}`} role="img">
    <div className="scale-track"><span className="scale-market" style={{ left: position(analysis.marketRange[0]), width: `${((analysis.marketRange[1] - analysis.marketRange[0]) / span) * 100}%` }} /><span className="scale-recommended" style={{ left: position(analysis.recommendedRange[0]), width: `${((analysis.recommendedRange[1] - analysis.recommendedRange[0]) / span) * 100}%` }} /><span className="scale-marker suggested-marker" style={{ left: position(analysis.suggestedPrice) }} /><span className="scale-marker primary-marker" style={{ left: position(analysis.primaryValue) }} /></div>
    <div className="scale-key"><span><i className="scale-key-line" />Recommended range</span><span><i className="scale-key-dot suggested-key" />Suggested</span><span><i className="scale-key-dot primary-key" />{analysis.mode === 'OFFER' ? 'List price' : 'Reference value'}</span></div>
    <div className="scale-bounds"><span>{money(low)}</span><span>{money(high)}</span></div>
  </div>;
}

export function PricingAnalysisDialog({ property, mode, onClose }: { property: DemoProperty; mode: AnalysisMode; onClose: () => void }) {
  const titleId = useId(), descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null), closeRef = useRef<HTMLButtonElement>(null), onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const analysis = property.analyses[mode];
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

  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="analysis-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
    <header className="dialog-header"><div><span className="eyebrow">Pricing analysis · demo fixture</span><h2 id={titleId}>{isOffer ? 'Offer Price Analysis' : 'Listing Price Analysis'}</h2><p id={descriptionId}>{isOffer ? 'Buyer-side recommendation' : 'Seller-side listing guidance'} for the selected demo property.</p></div><button ref={closeRef} type="button" className="icon-button dialog-close" aria-label="Close dialog" onClick={onClose}>×</button></header>
    <div className="dialog-body"><p className="dialog-property">{property.address}</p>{analysis ? <>
      <div className="analysis-summary-row"><div><span>{isOffer ? 'List Price' : 'Estimated / Reference Value'}</span><strong>{money(analysis.primaryValue)}</strong></div><div><span>Market Reference Range</span><strong>{range(analysis.marketRange)}</strong></div><div><span>{isOffer ? 'Recommended Offer Range' : 'Recommended Listing Range'}</span><strong>{range(analysis.recommendedRange)}</strong></div><div className="highlight-summary"><span>{isOffer ? 'Suggested Offer' : 'Suggested Listing Price'}</span><strong>{money(analysis.suggestedPrice)}</strong></div></div>
      <section className="dialog-section"><div className="section-title-row"><h3>Price Range Visualization</h3><span className="section-tag">Illustrative scale</span></div><PriceScale analysis={analysis} /></section>
      <div className="dialog-detail-grid"><section className="dialog-section"><h3>{isOffer ? 'Why this offer range' : 'Why this listing range'}</h3><ol className="reasons-list">{analysis.reasons.map(reason => <li key={reason}>{reason}</li>)}</ol></section><section className="dialog-section strategy-section"><h3>Suggested {isOffer ? 'Offer' : 'Listing'} Strategy</h3><strong>{analysis.strategyTitle}</strong><ul>{analysis.strategyPoints.map(point => <li key={point}>{point}</li>)}</ul></section></div>
      <section className="dialog-section assumptions-section"><h3>Assumptions &amp; Limits</h3><div className="assumption-chips"><span>Based on available demo property and comparable data</span><span>Not a formal appraisal</span><span>AI-assisted explanation planned, not generated</span></div><p>Fixture analysis dated {date(analysis.generatedAt)}. These values are illustrative and were not calculated in this application.</p></section>
    </> : <FeedbackState kind="empty" title="Analysis not generated" message={`No ${isOffer ? 'offer' : 'listing'} analysis fixture exists for this property. Pricing calculations and generation arrive in later milestones.`} />}</div>
    <footer className="dialog-actions"><span>Demo view · no data is saved</span><div><button type="button" className="button button-quiet" onClick={onClose}>Close</button><button type="button" className="button button-outline" disabled title="Regeneration is not implemented">Regenerate</button><button type="button" className="button button-primary" disabled title="Saving analyses requires persistence">Save Analysis</button></div></footer>
  </div></div>, document.body);
}

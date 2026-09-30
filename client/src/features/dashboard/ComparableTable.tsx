import type { MarketComparableCandidate, MarketContextResponse, MarketEvidenceGroup } from '@ppi/shared';
import { FeedbackState } from '../../components/FeedbackState.js';

type MarketState = { propertyId: string; data: MarketContextResponse | null; status: 'loading' | 'ready' | 'error' } | null;
const money = (value: number | null) => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const fact = (value: number | string | null) => value === null ? '—' : String(value);
const displayDate = (value: string | null) => value ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : '—';

function EvidenceSection({ group, selectedId, onSelect }: { group: MarketEvidenceGroup; selectedId: string | null; onSelect: (id: string) => void }) {
  const sale = group.kind === 'RECORDED_SALES';
  return <div className="evidence-section"><div className="evidence-heading"><h3>{sale ? 'Recorded Sales' : 'Active Listings'}</h3><span>{group.freshness === 'FRESH' ? 'Fresh' : group.freshness === 'STALE' ? 'Saved data · stale' : 'Unavailable'} · {group.source ?? 'No source'}</span></div>
    {group.errorCode && <p className="evidence-message" role="status">{group.cacheStatus === 'STALE_FALLBACK' ? 'Provider refresh failed; showing the last saved evidence.' : group.cacheStatus === 'NO_COORDINATES' ? 'Subject coordinates are unavailable.' : 'Market evidence is unavailable.'}</p>}
    {group.candidates.length ? <div className="table-scroll"><table><thead><tr><th>Address</th><th>{sale ? 'Sold Price' : 'Asking Price'}</th><th>Type</th><th>Beds</th><th>Baths</th><th>Sqft</th><th>Distance</th><th>{sale ? 'Sold' : 'Listed'}</th></tr></thead><tbody>
      {group.candidates.map((candidate: MarketComparableCandidate) => <tr key={candidate.id} className={selectedId === candidate.id ? 'selected-row' : ''} aria-selected={selectedId === candidate.id}>
        <td><button className="table-link" type="button" aria-label={`Select ${sale ? 'recorded sale' : 'active listing'} ${candidate.address}`} onClick={() => onSelect(candidate.id)}>{candidate.address}</button></td>
        <td className="strong-cell">{money(candidate.price)}</td><td>{fact(candidate.propertyType)}</td><td>{fact(candidate.bedrooms)}</td><td>{fact(candidate.bathrooms)}</td><td>{fact(candidate.livingAreaSqft)}</td><td>{candidate.distanceMiles === null ? '—' : `${candidate.distanceMiles.toFixed(2)} mi`}</td><td>{displayDate(candidate.eventDate)}</td>
      </tr>)}</tbody></table></div> : <p className="evidence-message">{group.freshness === 'UNAVAILABLE' ? 'No evidence available.' : `No ${sale ? 'recorded sales' : 'active listings'} found within this bounded search.`}</p>}
    {group.query && <p className="table-note">RentCast · {group.query.radiusMiles} mi radius · up to {group.query.limit} results{sale ? ` · last ${group.query.saleDateRangeDays} days` : ''} · fetched {group.fetchedAt ? displayDate(group.fetchedAt) : '—'}</p>}
  </div>;
}

export function ComparableTable({ market, selectedId, onSelect }: { market: MarketState; selectedId: string | null; onSelect: (id: string) => void }) {
  const selected = market?.data ? [...market.data.recordedSales.candidates, ...market.data.activeListings.candidates].find(candidate => candidate.id === selectedId) : null;
  return <section className="card comparable-card" aria-labelledby="comparable-title">
    <div className="card-heading"><div><span className="eyebrow">Market evidence</span><h2 id="comparable-title">Comparable Candidates</h2></div><span className="section-tag">Candidate evidence</span></div>
    {market?.status === 'loading' ? <FeedbackState kind="loading" title="Loading market evidence" message="Checking saved sales and active listings." compact /> : market?.status === 'error' ? <FeedbackState kind="error" title="Market evidence unavailable" message="The property remains available. Try again later for nearby evidence." compact /> : market?.data ? <>
      <EvidenceSection group={market.data.recordedSales} selectedId={selectedId} onSelect={onSelect} />
      <EvidenceSection group={market.data.activeListings} selectedId={selectedId} onSelect={onSelect} />
      {selected && <aside className="selected-evidence" aria-live="polite"><strong>{selected.evidenceType === 'RECORDED_SALE' ? 'Recorded sale' : 'Active asking price'}: {selected.address}</strong><span>{selected.evidenceType === 'RECORDED_SALE' ? 'Sold Price' : 'Asking Price'} {money(selected.price)} · {selected.distanceMiles === null ? 'Distance unavailable' : `${selected.distanceMiles.toFixed(2)} mi away`}</span></aside>}
    </> : <FeedbackState kind="empty" title="Market evidence unavailable" message="No market request has completed." compact />}
  </section>;
}

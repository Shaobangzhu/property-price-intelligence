import type { DemoComparable } from '../../fixtures/demo.js';
import { date, money, number } from '../../format.js';
import { FeedbackState } from '../../components/FeedbackState.js';

export function ComparableTable({ comparables, selectedId, onSelect }: { comparables: readonly DemoComparable[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <section className="card comparable-card" aria-labelledby="comparable-title"><div className="card-heading"><div><span className="eyebrow">Market evidence · fixture only</span><h2 id="comparable-title">Comparable Sales</h2></div><span className="count-pill">{comparables.length} demo sales</span></div>
    {comparables.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Address</th><th scope="col">Sold Price</th><th scope="col">Beds</th><th scope="col">Baths</th><th scope="col">Sqft</th><th scope="col">Distance</th><th scope="col">Sold Date</th></tr></thead><tbody>{comparables.map(item => <tr key={item.id} className={selectedId === item.id ? 'selected-row' : undefined}><td><button type="button" className="table-link" aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}>{item.address}</button></td><td className="strong-cell">{money(item.soldPrice)}</td><td>{item.beds}</td><td>{item.baths}</td><td>{number(item.squareFeet)}</td><td>{item.distanceMiles.toFixed(1)} mi</td><td>{date(item.soldDate)}</td></tr>)}</tbody></table></div> : <FeedbackState kind="empty" title="No comparable sales" message="This demo property has no comparable sale fixtures. No prices are inferred." compact />}
    <p className="table-note">Synthetic transaction examples. Selection is reserved for future map synchronization.</p>
  </section>;
}

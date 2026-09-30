import { FeedbackState } from '../../components/FeedbackState.js';

export function ComparableTable() {
  return <section className="card comparable-card" aria-labelledby="comparable-title">
    <div className="card-heading"><div><span className="eyebrow">Market evidence</span><h2 id="comparable-title">Comparable Sales</h2></div><span className="section-tag">Deferred</span></div>
    <FeedbackState kind="empty" title="Comparable sales not available yet" message="Milestone 03 stores only searched subject properties. Comparable sales and map synchronization arrive later." compact />
  </section>;
}

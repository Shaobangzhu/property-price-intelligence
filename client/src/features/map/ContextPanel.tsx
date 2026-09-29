import type { MapContext } from '@ppi/shared';
import type { DemoProperty } from '../../fixtures/demo.js';
import { FeedbackState } from '../../components/FeedbackState.js';

export function ContextPanel({ property, activeContext }: { property: DemoProperty; activeContext: MapContext | null }) {
  let title = 'Context details';
  let content = <FeedbackState kind="empty" title="No context selected" message="Choose one map context to preview its demo panel. All layers can be off." compact />;
  if (activeContext === 'schools') {
    title = 'Assigned Schools';
    const assigned = property.assignedSchools?.filter(school => school.assignment === 'assigned-in-fixture') ?? [];
    content = assigned.length ? <><p className="context-disclaimer">Assigned only within this synthetic fixture. Real attendance assignments are unverified.</p><ul className="context-list">{assigned.map(school => <li key={school.id}><span className="context-icon" aria-hidden="true">S</span><span><small>{school.level} · demo assignment</small><strong>{school.name}</strong></span></li>)}</ul></> : <FeedbackState kind="empty" title="No assigned-school data" message="No assignment is available for this demo property. Nearby schools are not treated as assigned." compact />;
  } else if (activeContext === 'grocery') {
    title = 'Grocery nearby';
    content = property.grocery?.length ? <><p className="context-disclaimer">Synthetic points of interest for layout only. No Places request was made.</p><ul className="context-list">{property.grocery.map(place => <li key={place.id}><span className="context-icon grocery-icon" aria-hidden="true">G</span><span><small>{place.category} · demo</small><strong>{place.name}</strong></span><em>{place.distanceMiles.toFixed(1)} mi</em></li>)}</ul></> : <FeedbackState kind="empty" title="No grocery demo data" message="No grocery points are included for this fixture property." compact />;
  } else if (activeContext === 'wildfire') {
    title = 'Wildfire context';
    content = <div className="context-callout"><span className="context-callout-icon" aria-hidden="true">!</span><strong>Data unavailable</strong><p>This is a demo panel only. No live wildfire boundary or property risk assessment is connected.</p><small>Future GIS layer · Milestone 04+</small></div>;
  } else if (activeContext === 'faults') {
    title = 'Fault context';
    content = <div className="context-callout"><span className="context-callout-icon" aria-hidden="true">⌁</span><strong>Mapped-fault data unavailable</strong><p>Distance to the nearest mapped fault cannot be shown until a verified source is connected.</p><small>Future GIS layer · Milestone 04+</small></div>;
  }
  return <aside className="card context-card" aria-labelledby="context-panel-title"><div className="card-heading"><div><span className="eyebrow">Selected layer</span><h2 id="context-panel-title">{title}</h2></div><span className="section-tag">Demo</span></div>{content}</aside>;
}

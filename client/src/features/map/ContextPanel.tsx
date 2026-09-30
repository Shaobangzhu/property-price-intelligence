import type { MapContext } from '@ppi/shared';
import { FeedbackState } from '../../components/FeedbackState.js';

const contexts: Record<MapContext, { title: string; message: string }> = {
  schools: { title: 'Assigned Schools', message: 'Verified attendance assignments are not connected. Nearby schools are not presented as assigned.' },
  grocery: { title: 'Grocery nearby', message: 'ArcGIS Places is not connected in this milestone.' },
  wildfire: { title: 'Wildfire context', message: 'Hazard-area data is unavailable. No property risk assessment has been made.' },
  faults: { title: 'Fault context', message: 'Mapped-fault data is unavailable. Nearest-fault distance cannot be shown.' }
};

export function ContextPanel({ activeContext }: { activeContext: MapContext | null }) {
  const selected = activeContext ? contexts[activeContext] : null;
  return <aside className="card context-card" aria-labelledby="context-panel-title"><div className="card-heading"><div><span className="eyebrow">Selected layer</span><h2 id="context-panel-title">{selected?.title ?? 'Context details'}</h2></div><span className="section-tag">Deferred</span></div>
    <FeedbackState kind="empty" title={selected ? 'Data unavailable' : 'No context selected'} message={selected?.message ?? 'Choose one context layer to see its availability. All layers can be off.'} compact />
  </aside>;
}

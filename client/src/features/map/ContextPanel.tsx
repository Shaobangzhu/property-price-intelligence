import type { AssignedSchoolsResponse, GroceryResponse, MapContext } from '@ppi/shared';
import { FeedbackState } from '../../components/FeedbackState.js';

export type ContextState = { propertyId: string; context: 'schools' | 'grocery'; status: 'loading' | 'ready' | 'error'; schools: AssignedSchoolsResponse | null; grocery: GroceryResponse | null };
const titles: Record<MapContext, string> = { schools: 'Assigned Schools', grocery: 'Grocery nearby', wildfire: 'Wildfire context', faults: 'Fault context' };
const deferred: Record<'wildfire' | 'faults', string> = {
  wildfire: 'Hazard-area data is unavailable. No property risk assessment has been made.',
  faults: 'Mapped-fault data is unavailable. Nearest-fault distance cannot be shown.'
};
const levels = ['ELEMENTARY', 'MIDDLE', 'HIGH', 'OTHER'] as const;

export function ContextPanel({ activeContext, state, selectedId, onSelect }: { activeContext: MapContext | null; state: ContextState | null; selectedId: string | null; onSelect: (id: string) => void }) {
  const current = state?.context === activeContext ? state : null;
  return <aside className="card context-card" aria-labelledby="context-panel-title"><div className="card-heading"><div><span className="eyebrow">Selected layer</span><h2 id="context-panel-title">{activeContext ? titles[activeContext] : 'Context details'}</h2></div><span className="section-tag">{activeContext === 'schools' || activeContext === 'grocery' ? 'On demand' : 'Deferred'}</span></div>
    {!activeContext && <FeedbackState kind="empty" title="No context selected" message="Choose one context layer to see its availability. All layers can be off." compact />}
    {(activeContext === 'wildfire' || activeContext === 'faults') && <FeedbackState kind="empty" title="Unavailable" message={deferred[activeContext]} compact />}
    {(activeContext === 'schools' || activeContext === 'grocery') && (!current || current.status === 'loading') && <FeedbackState kind="loading" title="Loading context" message="Checking availability for this property." compact />}
    {(activeContext === 'schools' || activeContext === 'grocery') && current?.status === 'error' && <FeedbackState kind="error" title="Context unavailable" message="The context request failed. Select the layer again to retry." compact />}
    {activeContext === 'schools' && current?.status === 'ready' && current.schools && (current.schools.status === 'ASSIGNMENT_UNAVAILABLE' || current.schools.status === 'PROVIDER_ERROR') &&
      <FeedbackState kind="empty" title="Assignment unavailable" message="Assigned school information is unavailable for this property." compact />}
    {activeContext === 'schools' && current?.status === 'ready' && current.schools && current.schools.schools.length > 0 && <div className="context-results">
      <p className="context-source">Assignments: {current.schools.assignmentSource}. Only verified assignments appear here.</p>
      {current.schools.status === 'UNMATCHED' && <p className="context-source">School locations could not be matched; no school markers are shown.</p>}
      {current.schools.status === 'PARTIAL' && <p className="context-source">Some school locations could not be matched; only resolved schools have markers.</p>}
      {levels.map(level => { const schools = current.schools!.schools.filter(school => school.assignmentLevel === level); return schools.length ? <div className="context-group" key={level}><h3>{level.charAt(0) + level.slice(1).toLowerCase()}</h3><ul className="context-list">{schools.map(school => <li key={school.id}><button type="button" className="context-result" aria-label={`Select assigned school ${school.name}`} aria-pressed={selectedId === school.id} onClick={() => onSelect(school.id)}><strong>{school.name}</strong><span>{school.district ?? 'District unavailable'} · {school.grades ?? 'Grades unavailable'}</span><small>{school.distanceMiles === null ? 'Distance unavailable' : `${school.distanceMiles.toFixed(2)} mi`} · {school.metadataSource ? `Metadata: ${school.metadataSource}` : 'Assignment source only'}{school.matchStatus === 'UNMATCHED' ? ' · Reference unmatched' : ''}</small></button></li>)}</ul></div> : null; })}
    </div>}
    {activeContext === 'grocery' && current?.status === 'ready' && current.grocery && <GroceryResults data={current.grocery} selectedId={selectedId} onSelect={onSelect} />}
  </aside>;
}

function GroceryResults({ data, selectedId, onSelect }: { data: GroceryResponse; selectedId: string | null; onSelect: (id: string) => void }) {
  const messages: Partial<Record<GroceryResponse['status'], string>> = {
    NO_RESULTS: 'No grocery places were returned within the search radius.',
    NO_COORDINATES: 'This property has no coordinates for a nearby search.',
    CREDENTIAL_UNAVAILABLE: 'ArcGIS Places credential is missing or unavailable on the server.',
    RATE_LIMIT: 'ArcGIS Places is rate limited. Try again later.',
    PROVIDER_ERROR: 'ArcGIS Places could not return grocery places. Try again later.'
  };
  if (data.status !== 'AVAILABLE') return <FeedbackState kind={data.status === 'NO_RESULTS' || data.status === 'NO_COORDINATES' ? 'empty' : 'error'} title={data.status === 'NO_RESULTS' ? 'No places found' : 'Grocery unavailable'} message={messages[data.status] ?? 'Grocery unavailable.'} compact />;
  return <div className="context-results"><p className="context-source">ArcGIS Places · within {(data.radiusMeters / 1609.344).toFixed(1)} mi · on demand</p><ul className="context-list">{data.places.map(place => <li key={place.id}><button type="button" className="context-result" aria-label={`Select grocery ${place.name}`} aria-pressed={selectedId === place.id} onClick={() => onSelect(place.id)}><strong>{place.name}</strong><span>{place.category ?? 'Grocery'}</span><small>{place.distanceMiles === null ? 'Distance unavailable' : `${place.distanceMiles.toFixed(2)} mi`}</small></button></li>)}</ul></div>;
}

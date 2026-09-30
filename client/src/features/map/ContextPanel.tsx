import type { AssignedSchoolsResponse, FaultContextResponse, GroceryResponse, MapContext, WildfireContextResponse } from '@ppi/shared';
import { FeedbackState } from '../../components/FeedbackState.js';

export type ContextState = { propertyId: string; context: MapContext; status: 'loading' | 'ready' | 'error'; schools: AssignedSchoolsResponse | null; grocery: GroceryResponse | null; wildfire: WildfireContextResponse | null; faults: FaultContextResponse | null };
const titles: Record<MapContext, string> = { schools: 'Assigned Schools', grocery: 'Grocery nearby', wildfire: 'Wildfire Context', faults: 'Earthquake Fault Context' };
const levels = ['ELEMENTARY', 'MIDDLE', 'HIGH', 'OTHER'] as const;

export function ContextPanel({ activeContext, state, selectedId, onSelect }: { activeContext: MapContext | null; state: ContextState | null; selectedId: string | null; onSelect: (id: string) => void }) {
  const current = state?.context === activeContext ? state : null;
  return <aside className="card context-card" aria-labelledby="context-panel-title"><div className="card-heading"><div><span className="eyebrow">Selected layer</span><h2 id="context-panel-title">{activeContext ? titles[activeContext] : 'Context details'}</h2></div><span className="section-tag">{activeContext ? 'On demand' : 'Context'}</span></div>
    {!activeContext && <FeedbackState kind="empty" title="No context selected" message="Choose one context layer to see its availability. All layers can be off." compact />}
    {activeContext && (!current || current.status === 'loading') && <FeedbackState kind="loading" title="Loading context" message="Checking availability for this property." compact />}
    {activeContext && current?.status === 'error' && <FeedbackState kind="error" title="Context unavailable" message="The context request failed. Select the layer again to retry." compact />}
    {activeContext === 'schools' && current?.status === 'ready' && current.schools && (current.schools.status === 'ASSIGNMENT_UNAVAILABLE' || current.schools.status === 'PROVIDER_ERROR') &&
      <FeedbackState kind="empty" title="Assignment unavailable" message="Assigned school information is unavailable for this property." compact />}
    {activeContext === 'schools' && current?.status === 'ready' && current.schools && current.schools.schools.length > 0 && <div className="context-results">
      <p className="context-source">Assignments: {current.schools.assignmentSource}. Only verified assignments appear here.</p>
      {current.schools.status === 'UNMATCHED' && <p className="context-source">School locations could not be matched; no school markers are shown.</p>}
      {current.schools.status === 'PARTIAL' && <p className="context-source">Some school locations could not be matched; only resolved schools have markers.</p>}
      {levels.map(level => { const schools = current.schools!.schools.filter(school => school.assignmentLevel === level); return schools.length ? <div className="context-group" key={level}><h3>{level.charAt(0) + level.slice(1).toLowerCase()}</h3><ul className="context-list">{schools.map(school => <li key={school.id}><button type="button" className="context-result" aria-label={`Select assigned school ${school.name}`} aria-pressed={selectedId === school.id} onClick={() => onSelect(school.id)}><strong>{school.name}</strong><span>{school.district ?? 'District unavailable'} · {school.grades ?? 'Grades unavailable'}</span><small>{school.distanceMiles === null ? 'Distance unavailable' : `${school.distanceMiles.toFixed(2)} mi`} · {school.metadataSource ? `Metadata: ${school.metadataSource}` : 'Assignment source only'}{school.matchStatus === 'UNMATCHED' ? ' · Reference unmatched' : ''}</small></button></li>)}</ul></div> : null; })}
    </div>}
    {activeContext === 'grocery' && current?.status === 'ready' && current.grocery && <GroceryResults data={current.grocery} selectedId={selectedId} onSelect={onSelect} />}
    {activeContext === 'wildfire' && current?.status === 'ready' && current.wildfire && <WildfireResults data={current.wildfire} />}
    {activeContext === 'faults' && current?.status === 'ready' && current.faults && <FaultResults data={current.faults} />}
  </aside>;
}

const disclaimer = 'Map context is informational and is not an engineering, insurance, or hazard assessment.';
function WildfireResults({ data }: { data: WildfireContextResponse }) {
  const message = data.status === 'INSIDE_DISPLAYED_ZONE' ? `Subject point intersects a displayed ${data.classification} Fire Hazard Severity Zone.`
    : data.status === 'OUTSIDE_DISPLAYED_ZONE' ? 'Outside the currently displayed hazard zone.'
    : data.status === 'NO_COVERAGE' ? 'No CAL FIRE Fire Hazard Severity Zone coverage is shown for this subject point.'
    : data.status === 'NO_COORDINATES' ? 'This property has no coordinates for a map context check.' : 'Data unavailable from CAL FIRE.';
  return <div className="hazard-results"><p className="hazard-summary">{message}</p><dl><dt>Displayed classification</dt><dd>{data.classification ?? 'Not shown'}</dd><dt>Responsibility area</dt><dd>{data.responsibilityArea ?? 'Not established'}</dd><dt>Source</dt><dd>{data.sourceName}</dd><dt>Data version</dt><dd>{data.sourceVersion ?? 'Not available'}</dd><dt>Checked</dt><dd>{new Date(data.checkedAt).toLocaleString()}</dd></dl><p className="hazard-disclaimer">{disclaimer}</p></div>;
}

function FaultResults({ data }: { data: FaultContextResponse }) {
  const message = data.status === 'NEAREST_MAPPED_FAULT' ? 'Approximate distance to the nearest returned mapped Quaternary fault trace.'
    : data.status === 'NO_NEARBY_FEATURES' ? `No mapped Quaternary fault trace was returned within ${data.searchRadiusMiles} miles.`
    : data.status === 'NO_COVERAGE' ? 'Subject point is outside the displayed California fault map extent.'
    : data.status === 'NO_COORDINATES' ? 'This property has no coordinates for a map context check.' : 'Data unavailable from California Geological Survey.';
  return <div className="hazard-results"><p className="hazard-summary">{message}</p><dl><dt>Displayed feature</dt><dd>Mapped Quaternary fault traces</dd><dt>Nearest mapped fault</dt><dd>{data.nearestFeatureName ?? 'Not named or not found'}</dd><dt>Approximate distance</dt><dd>{data.distanceMiles === null ? 'Not available' : `${data.distanceMiles.toFixed(2)} mi`}</dd><dt>Search radius</dt><dd>{data.searchRadiusMiles} mi</dd><dt>Source</dt><dd>{data.sourceName}</dd><dt>Data version</dt><dd>{data.sourceVersion ?? 'Not available'}</dd><dt>Checked</dt><dd>{new Date(data.checkedAt).toLocaleString()}</dd></dl><p className="hazard-disclaimer">{disclaimer}</p></div>;
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

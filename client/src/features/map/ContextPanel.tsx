import type { NearbySchoolsResponse, FaultContextResponse, GroceryResponse, MapContext, WildfireContextResponse } from '@ppi/shared';
import { FeedbackState } from '../../components/FeedbackState.js';

export type ContextState = { propertyId: string; context: MapContext; status: 'loading' | 'ready' | 'error'; errorCode?: string; schools: NearbySchoolsResponse | null; grocery: GroceryResponse | null; wildfire: WildfireContextResponse | null; faults: FaultContextResponse | null };
const titles: Record<MapContext, string> = { schools: 'Nearby Schools', grocery: 'Grocery nearby', wildfire: 'Wildfire Context', faults: 'Earthquake Fault Context' };
const levels = ['ELEMENTARY', 'MIDDLE', 'HIGH', 'OTHER'] as const;

export function ContextPanel({ activeContext, state, selectedId, onSelect }: { activeContext: MapContext | null; state: ContextState | null; selectedId: string | null; onSelect: (id: string) => void }) {
  const current = state?.context === activeContext ? state : null;
  return <aside className="card context-card" aria-labelledby="context-panel-title"><div className="card-heading"><div><span className="eyebrow">Selected layer</span><h2 id="context-panel-title">{activeContext ? titles[activeContext] : 'Context details'}</h2></div><span className="section-tag">{activeContext ? 'On demand' : 'Context'}</span></div>
    {!activeContext && <FeedbackState kind="empty" title="No context selected" message="Choose one context layer to see its availability. All layers can be off." compact />}
    {activeContext && (!current || current.status === 'loading') && <FeedbackState kind="loading" title="Loading context" message={activeContext === 'schools' ? 'Fetching nearby schools. This may take up to two minutes. You can switch layers while it loads.' : 'Checking availability for this property.'} compact />}
    {activeContext && current?.status === 'error' && (activeContext === 'schools' ? <SchoolRequestError code={current.errorCode} /> : <FeedbackState kind="error" title="Context unavailable" message="The context request failed. Select the layer again to retry." compact />)}
    {activeContext === 'schools' && current?.status === 'ready' && current.schools && <SchoolResults data={current.schools} selectedId={selectedId} onSelect={onSelect} />}
    {activeContext === 'grocery' && current?.status === 'ready' && current.grocery && <GroceryResults data={current.grocery} selectedId={selectedId} onSelect={onSelect} />}
    {activeContext === 'wildfire' && current?.status === 'ready' && current.wildfire && <WildfireResults data={current.wildfire} />}
    {activeContext === 'faults' && current?.status === 'ready' && current.faults && <FaultResults data={current.faults} />}
  </aside>;
}

function SchoolRequestError({ code }: { code?: string }) {
  const malformed = code === 'SCHOOL_PROVIDER_MALFORMED' || code === 'SCHOOL_RESPONSE_INVALID' || code === 'CONTEXT_PROPERTY_MISMATCH';
  const messages: Record<string, string> = {
    SCHOOL_PROVIDER_AUTH: 'Zillapi authentication or access failed.',
    SCHOOL_PROVIDER_CREDITS_EXHAUSTED: 'Zillapi credits are exhausted.',
    SCHOOL_PROVIDER_RATE_LIMIT: 'Zillapi is rate limited. Try again later.',
    SCHOOL_PROVIDER_BUSY: 'Another school lookup is in progress. Try again later.',
    SCHOOL_PROVIDER_TIMEOUT: 'The school provider timed out.',
    SCHOOL_PROVIDER_SUBJECT_MISMATCH: 'The provider returned a different property. School results were rejected.'
  };
  return <FeedbackState kind="error" title={malformed ? 'School response invalid' : 'School request failed'}
    message={malformed ? 'School information could not be read safely. Select Schools again to retry.' : messages[code ?? ''] ?? 'The school request failed. Select Schools again to retry.'} compact />;
}

function SchoolResults({ data, selectedId, onSelect }: { data: NearbySchoolsResponse; selectedId: string | null; onSelect: (id: string) => void }) {
  if (data.status === 'SOURCE_UNAVAILABLE') return <FeedbackState kind="empty" title="Nearby schools not connected" message="A nearby-school provider is not configured." compact />;
  if (data.status === 'NO_RESULTS') return <FeedbackState kind="empty" title="No nearby schools returned" message="Zillapi returned an empty nearby-school list for this property. This does not establish school coverage or attendance eligibility." compact />;
  if (data.status === 'DATA_UNAVAILABLE') return <FeedbackState kind="empty" title="School data unavailable" message="Zillapi did not provide nearby-school data for this property." compact />;
  if (data.status === 'PROVIDER_ERROR') return <SchoolRequestError />;
  const located = data.schools.filter(school => school.latitude !== null && school.longitude !== null).length;
  return <div className="context-results">
    <p className="context-source">Source: Zillapi (third-party property data)</p>
    <p className="context-source">Nearby schools only. Attendance eligibility is not verified. Confirm with the local school district.</p>
    {data.schools.some(school => school.locationSource === 'NCES_EDGE_2024_25') && <p className="context-source">School locations: NCES EDGE (2024–25 public school data).</p>}
    {located < data.schools.length && <p className="context-source">{located === 0 ? 'School coordinates are unavailable; no school markers are shown.' : 'Only schools with coordinates have map markers.'}</p>}
    {levels.map(level => { const schools = data.schools.filter(school => school.level === level); return schools.length ? <div className="context-group" key={level}><h3>{level.charAt(0) + level.slice(1).toLowerCase()}</h3><ul className="context-list">{schools.map(school => <li key={school.id}><button type="button" className="context-result" aria-label={`Select nearby school ${school.name}`} aria-pressed={selectedId === school.id} onClick={() => onSelect(school.id)}><strong>{school.name}</strong><span>{school.levelLabel ?? 'Level unavailable'} · {school.schoolType ?? 'Type unavailable'}</span><small>{school.distanceMiles === null ? 'Distance unavailable' : `${school.distanceMiles.toFixed(2)} mi`} · {school.rating === null ? 'Rating unavailable' : `Rating ${school.rating}/10`}</small></button></li>)}</ul></div> : null; })}
  </div>;
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

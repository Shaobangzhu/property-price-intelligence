import type { MapContext } from '@ppi/shared';
import type { DemoProperty } from '../../fixtures/demo.js';

const contexts: { value: MapContext; label: string }[] = [
  { value: 'schools', label: 'Schools' }, { value: 'grocery', label: 'Grocery' },
  { value: 'wildfire', label: 'Wildfire' }, { value: 'faults', label: 'Faults' }
];

export function MapShell({ property, activeContext, onContextChange, selectedComparableId }: { property: DemoProperty; activeContext: MapContext | null; onContextChange: (context: MapContext | null) => void; selectedComparableId: string | null }) {
  const selectedComparable = property.comparables.find(item => item.id === selectedComparableId);
  return <section className="card map-card" aria-labelledby="map-title"><div className="card-heading map-heading"><div><span className="eyebrow">Location context</span><h2 id="map-title">Property map</h2></div><span className="section-tag">Schematic demo</span></div>
    <div className="map-context-picker" role="group" aria-label="Map context"><span className="map-context-label">Context layers</span><div className="context-buttons">{contexts.map(context => <button type="button" key={context.value} className={`context-button${activeContext === context.value ? ' is-active' : ''}`} aria-pressed={activeContext === context.value} onClick={() => onContextChange(activeContext === context.value ? null : context.value)}>{context.label}</button>)}</div></div>
    <div className="map-canvas" role="img" aria-label="Schematic map placeholder; no geographic positions are represented"><span className="map-road map-road-a"/><span className="map-road map-road-b"/><span className="map-road map-road-c"/><span className="map-block map-block-a"/><span className="map-block map-block-b"/><span className="map-block map-block-c"/><span className="map-block map-block-d"/><div className="map-status-label">Illustrative layout · no GIS data</div><div className="map-placeholder-content"><span className="map-pin" aria-hidden="true">⌖</span><strong>Map integration available in Milestone 04</strong><span>Subject, comparable, and context layers will appear here.</span></div><div className="map-control-reserve" aria-label="Zoom and location controls reserved for future map integration"><span>+</span><span>−</span><span>⌖</span></div></div>
    <div className="map-legend"><span className="legend-label">Layer slots</span><span><i className="legend-dot subject-dot"/>Subject Property</span><span><i className="legend-dot comp-dot"/>Comparable Sales</span><span><i className="legend-dot context-dot"/>Context: {activeContext ? contexts.find(item => item.value === activeContext)?.label : 'Off'}</span></div>
    <p className="map-selection-note">{selectedComparable ? `Selected comparable: ${selectedComparable.address}. Map synchronization arrives in Milestone 04.` : 'Select a comparable below to prepare for future map synchronization.'}</p>
  </section>;
}

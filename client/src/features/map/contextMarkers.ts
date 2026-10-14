import type { NearbySchoolsResponse, GroceryResponse, MapContext } from '@ppi/shared';

export type ContextMarker = { id: string; label: string; detail: string; latitude: number; longitude: number; kind: 'school' | 'grocery' };

export function getContextMarkers(context: MapContext | null, schools: NearbySchoolsResponse | null, grocery: GroceryResponse | null): ContextMarker[] {
  if (context === 'schools') return (schools && schools.status === 'AVAILABLE' ? schools.schools : []).flatMap(school => school.latitude === null || school.longitude === null ? [] : [{
    id: school.id, label: school.name, detail: `${school.levelLabel ?? 'School'} · nearby · ${school.distanceMiles === null ? 'Distance unavailable' : `${school.distanceMiles.toFixed(2)} mi`}`,
    latitude: school.latitude, longitude: school.longitude, kind: 'school' as const
  }]);
  if (context === 'grocery') return (grocery?.status === 'AVAILABLE' ? grocery.places : []).map(place => ({ id: place.id, label: place.name,
    detail: `${place.category ?? 'Grocery'} · ${place.distanceMiles === null ? 'Distance unavailable' : `${place.distanceMiles.toFixed(2)} mi`}`,
    latitude: place.latitude, longitude: place.longitude, kind: 'grocery' as const }));
  return [];
}

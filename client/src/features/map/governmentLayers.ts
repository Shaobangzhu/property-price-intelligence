import { OfficialGisLayers, type MapContext } from '@ppi/shared';

export type GovernmentLayerSpec = { url: string; title: string; opacity: number };
export function governmentLayerSpecs(context: MapContext | null): GovernmentLayerSpec[] {
  if (context === 'wildfire') return [
    { url: OfficialGisLayers.wildfireSra, title: 'CAL FIRE SRA Fire Hazard Severity Zones, effective 2024', opacity: 0.3 },
    { url: OfficialGisLayers.wildfireLra, title: 'CAL FIRE LRA recommended Fire Hazard Severity Zones, 2025', opacity: 0.3 }
  ];
  if (context === 'faults') return [{ url: OfficialGisLayers.faultTraces, title: 'CGS mapped Quaternary fault traces, 2010', opacity: 0.7 }];
  return [];
}

import { OfficialGisLayers, type FaultContextResponse, type WildfireContextResponse } from '@ppi/shared';
import type { PropertyRepository } from '../properties/repository.js';
import { PropertyError } from '../properties/service.js';

type Point = { latitude: number; longitude: number };
type Json = Record<string, unknown>;
const object = (value: unknown): Json | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
const sourceName = 'CAL FIRE Fire Hazard Severity Zones';
const faultSourceName = 'California Geological Survey 2010 Fault Activity Map — Quaternary Faults';
export const faultSearchRadiusMiles = 20;
const metersPerMile = 1609.344;

export interface GisQuery { query(url: string, params: URLSearchParams): Promise<unknown>; }
export class OfficialArcGisQuery implements GisQuery {
  constructor(private readonly transport: typeof fetch = fetch) {}
  async query(url: string, params: URLSearchParams): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.transport(`${url}/query?${params}`, { signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error('GIS_RESPONSE');
      const raw = await response.text();
      if (raw.length > 2_000_000) throw new Error('GIS_SIZE');
      const parsed = JSON.parse(raw) as unknown;
      if (!object(parsed) || object(parsed)?.error) throw new Error('GIS_PAYLOAD');
      return parsed;
    } catch { throw new Error('GIS_UNAVAILABLE'); }
    finally { clearTimeout(timeout); }
  }
}

function pointQuery(point: Point, outFields: string, returnGeometry = false): URLSearchParams {
  return new URLSearchParams({ f: 'json', geometry: `${point.longitude},${point.latitude}`, geometryType: 'esriGeometryPoint',
    inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', where: '1=1', outFields,
    returnGeometry: String(returnGeometry), resultRecordCount: returnGeometry ? '500' : '5' });
}
function features(payload: unknown): Json[] {
  if (object(payload)?.exceededTransferLimit === true) throw new Error('TRUNCATED_GIS_FEATURES');
  const value = object(payload)?.features;
  if (!Array.isArray(value)) throw new Error('GIS_FEATURES');
  const parsed = value.map(object);
  if (parsed.some(item => item === null)) throw new Error('GIS_FEATURE');
  return parsed as Json[];
}
function singleAttribute(payload: unknown, field: string): string | null {
  const found = features(payload);
  if (found.length > 1) throw new Error('AMBIGUOUS_GIS_FEATURE');
  if (found.length === 0) return null;
  const value = object(found[0]?.attributes)?.[field];
  return typeof value === 'string' ? value.trim() : null;
}

export type WildfireProviderResult = Pick<WildfireContextResponse, 'status' | 'classification' | 'responsibilityArea' | 'sourceVersion'>;
export interface WildfireProvider { check(point: Point): Promise<WildfireProviderResult>; }
export class CalFireWildfireProvider implements WildfireProvider {
  constructor(private readonly gis: GisQuery = new OfficialArcGisQuery()) {}
  async check(point: Point): Promise<WildfireProviderResult> {
    const empty = { classification: null, responsibilityArea: null, sourceVersion: null };
    const coverage = await this.gis.query(OfficialGisLayers.responsibility, pointQuery(point, 'SRA'));
    const area = singleAttribute(coverage, 'SRA');
    if (area !== 'SRA' && area !== 'LRA' && area !== 'FRA') return { ...empty, status: 'NO_COVERAGE' };
    if (area === 'FRA') return { ...empty, responsibilityArea: area, status: 'NO_COVERAGE' };
    const version = area === 'SRA' ? 'effective 2024-04-01' : 'recommended 2025-03-24';
    const layer = area === 'SRA' ? OfficialGisLayers.wildfireSra : OfficialGisLayers.wildfireLra;
    const zone = await this.gis.query(layer, pointQuery(point, 'FHSZ_Description,SRA'));
    const matches = features(zone);
    if (matches.length > 1) throw new Error('OVERLAPPING_ZONES');
    if (matches.length === 0) return { status: area === 'LRA' ? 'OUTSIDE_DISPLAYED_ZONE' : 'NO_COVERAGE', classification: null, responsibilityArea: area, sourceVersion: version };
    const classification = singleAttribute(zone, 'FHSZ_Description');
    if (area === 'LRA' && classification === 'NonWildland') return { status: 'OUTSIDE_DISPLAYED_ZONE', classification: null, responsibilityArea: area, sourceVersion: version };
    if (classification !== 'Moderate' && classification !== 'High' && classification !== 'Very High') throw new Error('UNKNOWN_CLASSIFICATION');
    return { status: 'INSIDE_DISPLAYED_ZONE', classification, responsibilityArea: area, sourceVersion: version };
  }
}

type FaultCandidate = { name: string | null; paths: [number, number][][] };
function normalizeFaultCandidates(payload: unknown): FaultCandidate[] {
  if (object(payload)?.exceededTransferLimit === true) throw new Error('TRUNCATED_FAULTS');
  return features(payload).map(feature => {
    const paths = object(feature.geometry)?.paths;
    if (!Array.isArray(paths)) throw new Error('FAULT_GEOMETRY');
    const parsed = paths.map(path => {
      if (!Array.isArray(path)) throw new Error('FAULT_PATH');
      return path.map(vertex => {
        if (!Array.isArray(vertex) || vertex.length < 2 || typeof vertex[0] !== 'number' || typeof vertex[1] !== 'number' ||
          !Number.isFinite(vertex[0]) || !Number.isFinite(vertex[1]) || Math.abs(vertex[0]) > 180 || Math.abs(vertex[1]) > 90) throw new Error('FAULT_VERTEX');
        return [vertex[0], vertex[1]] as [number, number];
      });
    }).filter(path => path.length >= 2);
    if (!parsed.length) throw new Error('EMPTY_FAULT_GEOMETRY');
    const nameValue = object(feature.attributes)?.FLT_NAME;
    return { name: typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : null, paths: parsed };
  });
}

// Local tangent plane in miles, adequate for the bounded 20-mile search. Nearest segment, not a vertex or screen pixel.
export function pointToFaultMiles(point: Point, paths: [number, number][][]): number {
  const milesPerDegreeLat = 69.05;
  const milesPerDegreeLon = 69.172 * Math.cos(point.latitude * Math.PI / 180);
  let nearest = Infinity;
  for (const path of paths) for (let index = 1; index < path.length; index++) {
    const a = path[index - 1]!, b = path[index]!;
    const ax = (a[0] - point.longitude) * milesPerDegreeLon, ay = (a[1] - point.latitude) * milesPerDegreeLat;
    const bx = (b[0] - point.longitude) * milesPerDegreeLon, by = (b[1] - point.latitude) * milesPerDegreeLat;
    const dx = bx - ax, dy = by - ay, squared = dx * dx + dy * dy;
    const t = squared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / squared));
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return nearest;
}

export type FaultProviderResult = Pick<FaultContextResponse, 'status' | 'nearestFeatureName' | 'distanceMiles'>;
export interface FaultProvider { check(point: Point): Promise<FaultProviderResult>; }
export class CgsFaultProvider implements FaultProvider {
  constructor(private readonly gis: GisQuery = new OfficialArcGisQuery()) {}
  async check(point: Point): Promise<FaultProviderResult> {
    if (point.longitude < -124.6 || point.longitude > -114 || point.latitude < 32.4 || point.latitude > 42.1)
      return { status: 'NO_COVERAGE', nearestFeatureName: null, distanceMiles: null };
    const query = pointQuery(point, 'OBJECTID,FLT_NAME');
    query.set('distance', String(faultSearchRadiusMiles * metersPerMile));
    query.set('units', 'esriSRUnit_Meter');
    query.set('returnGeometry', 'true');
    query.set('resultRecordCount', '500');
    query.set('geometryPrecision', '6');
    const candidates = normalizeFaultCandidates(await this.gis.query(OfficialGisLayers.faultTraces, query));
    if (candidates.length === 0) return { status: 'NO_NEARBY_FEATURES', nearestFeatureName: null, distanceMiles: null };
    const ranked = candidates.map(candidate => ({ name: candidate.name, distance: pointToFaultMiles(point, candidate.paths) })).sort((a, b) => a.distance - b.distance);
    const nearest = ranked[0]!;
    if (!Number.isFinite(nearest.distance)) throw new Error('FAULT_DISTANCE');
    return { status: 'NEAREST_MAPPED_FAULT', nearestFeatureName: nearest.name, distanceMiles: Math.round(nearest.distance * 100) / 100 };
  }
}

export class HazardContextService {
  constructor(private readonly properties: PropertyRepository, private readonly wildfire: WildfireProvider, private readonly faults: FaultProvider,
    private readonly now: () => Date = () => new Date()) {}
  private async subject(propertyId: string): Promise<Point | null> {
    const record = await this.properties.findById(propertyId);
    if (!record) throw new PropertyError('PROPERTY_NOT_FOUND', 404);
    const { latitude, longitude } = record.property;
    return latitude === null || longitude === null ? null : { latitude, longitude };
  }
  async getWildfire(propertyId: string): Promise<WildfireContextResponse> {
    const point = await this.subject(propertyId);
    const base = { propertyId, sourceName, checkedAt: this.now().toISOString() };
    if (!point) return { ...base, status: 'NO_COORDINATES', classification: null, responsibilityArea: null, sourceVersion: null };
    try { return { ...base, ...await this.wildfire.check(point) }; }
    catch { return { ...base, status: 'UNAVAILABLE', classification: null, responsibilityArea: null, sourceVersion: null }; }
  }
  async getFaults(propertyId: string): Promise<FaultContextResponse> {
    const point = await this.subject(propertyId);
    const base = { propertyId, contextType: 'FAULT_TRACE' as const, sourceName: faultSourceName, sourceVersion: '2010 map', checkedAt: this.now().toISOString(), searchRadiusMiles: faultSearchRadiusMiles };
    if (!point) return { ...base, status: 'NO_COORDINATES', nearestFeatureName: null, distanceMiles: null };
    try { return { ...base, ...await this.faults.check(point) }; }
    catch { return { ...base, status: 'UNAVAILABLE', nearestFeatureName: null, distanceMiles: null }; }
  }
}

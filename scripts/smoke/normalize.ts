import { PropertySummary, type PropertySummary as Summary } from '@ppi/shared';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const stringOrNull = (value: unknown) => typeof value === 'string' ? value : null;
const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const addressKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export type SchoolObservation = 'MISSING' | 'UNVERIFIED' | 'VERIFIED_STRUCTURE';
export function inspectSchools(value: unknown): SchoolObservation {
  if (!record(value)) return 'MISSING';
  if (Array.isArray(value.assignedSchools)) return 'VERIFIED_STRUCTURE';
  return Object.keys(value).some(key => /school/i.test(key)) ? 'UNVERIFIED' : 'MISSING';
}
export function selectProperty(value: unknown, requestedAddress: string): { summary: Summary; schoolObservation: SchoolObservation; fields: Record<string, string> } | { error: 'empty' | 'malformed' | 'ambiguous' | 'no_match' } {
  if (!Array.isArray(value)) return { error: 'malformed' };
  if (!value.length) return { error: 'empty' };
  const matches = value.filter(record).filter(item => typeof item.formattedAddress === 'string' && addressKey(item.formattedAddress) === addressKey(requestedAddress));
  if (matches.length > 1) return { error: 'ambiguous' };
  if (!matches.length) return { error: 'no_match' };
  const item = matches[0]!;
  const summary = PropertySummary.safeParse({ id: stringOrNull(item.id), formattedAddress: item.formattedAddress, latitude: numberOrNull(item.latitude), longitude: numberOrNull(item.longitude), propertyType: stringOrNull(item.propertyType), bedrooms: numberOrNull(item.bedrooms), bathrooms: numberOrNull(item.bathrooms), squareFootage: numberOrNull(item.squareFootage), lotSize: numberOrNull(item.lotSize), yearBuilt: numberOrNull(item.yearBuilt), lastSaleDate: stringOrNull(item.lastSaleDate), lastSalePrice: numberOrNull(item.lastSalePrice) });
  if (!summary.success) return { error: 'malformed' };
  const paths = ['id', 'formattedAddress', 'addressLine1', 'addressLine2', 'city', 'state', 'zipCode', 'latitude', 'longitude', 'propertyType', 'bedrooms', 'bathrooms', 'squareFootage', 'lotSize', 'yearBuilt', 'lastSaleDate', 'lastSalePrice', 'photos', 'status', 'price', 'schools', 'assignedSchools'];
  return { summary: summary.data, schoolObservation: inspectSchools(item), fields: Object.fromEntries(paths.map(path => [path, item[path] === undefined || item[path] === null ? 'missing' : Array.isArray(item[path]) ? 'array' : typeof item[path]])) };
}
export function inspectList(value: unknown, priceField: 'lastSalePrice' | 'price'): { count: number; priceFieldCount: number } | null {
  if (!Array.isArray(value) || !value.every(record)) return null;
  return { count: value.length, priceFieldCount: value.filter(item => typeof item[priceField] === 'number').length };
}
export function inspectCategories(value: unknown, suppliedId?: string): string | null {
  if (!record(value) || !Array.isArray(value.categories)) return null;
  const matches = value.categories.filter(record).filter(item => typeof item.label === 'string' && /^(grocery store|supermarket)$/i.test(item.label) && typeof item.categoryId === 'string' && /^[a-f0-9]{24}$/i.test(item.categoryId) && (!suppliedId || item.categoryId === suppliedId));
  return matches.length === 1 ? matches[0]!.categoryId as string : null;
}
export function inspectPlaces(value: unknown): number | null {
  if (!record(value) || !Array.isArray(value.results) || !value.results.every(record)) return null;
  return value.results.length;
}

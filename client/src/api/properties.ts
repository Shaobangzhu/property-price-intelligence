import { ApiErrorResponse, MarketContextResponse, PropertyEnvelope, PropertyListResponse, type PropertyPatchInput } from '@ppi/shared';

const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export class ApiClientError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

async function request<T>(path: string, schema: { parse: (value: unknown) => T }, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  if (!response.ok) {
    const parsed = ApiErrorResponse.safeParse(await response.json().catch(() => null));
    throw new ApiClientError(parsed.success ? parsed.data.error.code : 'REQUEST_FAILED', response.status);
  }
  return schema.parse(await response.json());
}

export function resolveProperty(address: string, signal?: AbortSignal) {
  return request('/properties/resolve', PropertyEnvelope, { method: 'POST', body: JSON.stringify({ address }), signal });
}
export function getProperty(id: string, signal?: AbortSignal) { return request(`/properties/${encodeURIComponent(id)}`, PropertyEnvelope, { signal }); }
export function getMarketContext(id: string, signal?: AbortSignal) { return request(`/properties/${encodeURIComponent(id)}/market-context`, MarketContextResponse, { signal }); }
export function listProperties(options: { page: number; pageSize: number; search: string }, signal?: AbortSignal) {
  const query = new URLSearchParams({ page: String(options.page), pageSize: String(options.pageSize), search: options.search });
  return request(`/properties?${query}`, PropertyListResponse, { signal });
}
export function patchProperty(id: string, payload: PropertyPatchInput) {
  return request(`/properties/${encodeURIComponent(id)}`, PropertyEnvelope, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function refreshProperty(id: string) { return request(`/properties/${encodeURIComponent(id)}/refresh`, PropertyEnvelope, { method: 'POST' }); }
export async function deleteProperty(id: string): Promise<void> {
  const response = await fetch(`${base}/properties/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) {
    const parsed = ApiErrorResponse.safeParse(await response.json().catch(() => null));
    throw new ApiClientError(parsed.success ? parsed.data.error.code : 'REQUEST_FAILED', response.status);
  }
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    const messages: Record<string, string> = {
      PROPERTY_NOT_FOUND: 'No exact property record matched this address.',
      AMBIGUOUS_PROPERTY: 'More than one property matched. Include the full address and unit.',
      RENTCAST_API_KEY_MISSING: 'RENTCAST_API_KEY is missing on the server.',
      PROVIDER_AUTH_FAILED: 'RentCast authentication failed. Check the server configuration.',
      PROVIDER_RATE_LIMIT: 'RentCast is temporarily rate limited. Try again later.',
      PROVIDER_MALFORMED: 'RentCast returned an unsupported property record.',
      PROVIDER_UNAVAILABLE: 'RentCast is unavailable. Existing saved properties remain in History.'
    };
    return messages[error.code] ?? 'The property request failed. Please try again.';
  }
  return 'The server could not be reached. Please try again.';
}

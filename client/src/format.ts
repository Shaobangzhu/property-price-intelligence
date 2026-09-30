export const money = (value: number | null): string => value === null ? 'Not available' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
export const number = (value: number | null): string => value === null ? 'Not available' : new Intl.NumberFormat('en-US').format(value);
export const date = (value: string | null): string => value === null ? 'Not available' : new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
export const dateTime = (value: string | null): string => value === null ? 'Not available' : new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
export const range = (value: readonly [number, number] | null): string => value === null ? 'Not available' : `${money(value[0])} – ${money(value[1])}`;

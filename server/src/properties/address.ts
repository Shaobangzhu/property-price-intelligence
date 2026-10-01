const replacements: Record<string, string> = {
  street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', lane: 'ln', boulevard: 'blvd', court: 'ct', place: 'pl',
  apartment: 'unit', apt: 'unit', suite: 'unit', ste: 'unit', '#': 'unit'
};

/** Keep token boundaries for exact identity checks, including street numbers. */
export function normalizeAddressIdentity(input: string): string {
  return input.toLowerCase().replace(/#/g, ' unit ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .map(token => replacements[token] ?? token).join(' ');
}

/** Existing persisted lookup keys; token-aware identity checks guard collisions. */
export function normalizeAddressKey(input: string): string { return normalizeAddressIdentity(input).replaceAll(' ', ''); }

export function requestedUnit(input: string): string | null {
  const match = input.toLowerCase().match(/(?:\b(?:apt|apartment|unit|suite|ste)\b|#)\s*([a-z0-9-]+)/);
  return match?.[1]?.replace(/[^a-z0-9]/g, '') ?? null;
}

export function addressMatches(input: string, candidate: { formattedAddress: string; unit: string | null }): boolean {
  const inputUnit = requestedUnit(input);
  const candidateUnit = candidate.unit ? candidate.unit.toLowerCase().replace(/^(?:apt|apartment|unit|suite|ste)\s*/i, '').replace(/[^a-z0-9]/g, '') : null;
  if (inputUnit !== candidateUnit) return false;
  return normalizeAddressIdentity(input) === normalizeAddressIdentity(candidate.formattedAddress);
}

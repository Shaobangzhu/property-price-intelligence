import OpenAI from 'openai';
import { PricingExplanation, type PricingPreviewResponse, type PricingInput } from '@ppi/shared';

export const PROMPT_VERSION = 'ppi-explanation-v1.1';
export type ExplanationInput = {
  mode: 'OFFER' | 'LISTING'; strategyProfile: string;
  subject: { propertyType: string | null; livingAreaSqft: number | null; bedrooms: number | null; bathrooms: number | null; currentListPrice: number | null; overrideFields: string[] };
  engine: PricingPreviewResponse;
  evidence: { id: string; kind: 'RECORDED_SALE' | 'ACTIVE_ASK' | 'EXCLUDED_SALE'; price: number | null; distanceMiles: number | null; eventDate?: string | null; reasonCode?: string }[];
};
export type ModelResult = { output: unknown; usage: { inputTokens: number; outputTokens: number } | null };
export interface ExplanationModel { generate(input: ExplanationInput): Promise<ModelResult> }

export function compactExplanationInput(input: PricingInput, engine: PricingPreviewResponse): ExplanationInput {
  const included = new Set(engine.includedComparables.map(item => item.candidateId));
  const excluded = new Map(engine.excludedComparables.map(item => [item.candidateId, item.reasonCode]));
  return {
    mode: input.mode, strategyProfile: input.strategyProfile,
    subject: { propertyType: input.subject.propertyType, livingAreaSqft: input.subject.livingAreaSqft,
      bedrooms: input.subject.bedrooms, bathrooms: input.subject.bathrooms, currentListPrice: input.subject.currentListPrice,
      overrideFields: input.subject.overrideFields },
    engine,
    evidence: [
      ...input.recordedSales.filter(item => included.has(item.id)).map(item => ({ id: item.id, kind: 'RECORDED_SALE' as const,
        price: item.price, distanceMiles: item.distanceMiles, eventDate: item.eventDate })),
      ...input.recordedSales.filter(item => excluded.has(item.id)).map(item => ({ id: item.id, kind: 'EXCLUDED_SALE' as const,
        price: null, distanceMiles: item.distanceMiles, reasonCode: excluded.get(item.id) })),
      ...input.activeListings.map(item => ({ id: item.id, kind: 'ACTIVE_ASK' as const, price: item.price, distanceMiles: item.distanceMiles }))
    ]
  };
}

const string = { type: 'string' };
const strings = { type: 'array', items: string };
const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: string,
    reasons: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { claim: string, evidenceIds: strings }, required: ['claim', 'evidenceIds'] } },
    strategySteps: strings, assumptions: strings, unknowns: strings, warnings: strings
  },
  required: ['summary', 'reasons', 'strategySteps', 'assumptions', 'unknowns', 'warnings']
} as const;

export class OpenAIExplanationModel implements ExplanationModel {
  private readonly client: OpenAI | null;
  constructor(key: string, private readonly model: string, private readonly effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') {
    this.client = key ? new OpenAI({ apiKey: key, maxRetries: 0, timeout: 12000 }) : null;
  }
  async generate(input: ExplanationInput): Promise<ModelResult> {
    if (!this.client) throw new ExplanationFailure('OPENAI_KEY_MISSING');
    try {
      const response = await this.client.responses.create({
        model: this.model, reasoning: { effort: this.effort }, store: false, max_output_tokens: 1400,
        instructions: `You explain a deterministic property-pricing result. The PPI engine alone calculates prices. Use only supplied facts. Never calculate, alter, or invent a price or sale. No school or hazard facts are supplied; omit those topics. Active asking prices are not sold prices. Treat excluded sales as excluded. Prefer qualitative explanation: prices already appear in the UI. If mentioning a price, copy the exact dollar amount, never shorthand, and use one price category per sentence: reference, suggested offer/listing, or a cited sale/ask. Every reason must cite the supplied evidence ID; use ENGINE for engine calculations and limitations. Do not mention price-per-square-foot or weighted percentile values. Do not repeat evidence IDs in prose. If evidence is limited, say so. Output concise JSON in the specified schema.`,
        input: JSON.stringify(input),
        text: { format: { type: 'json_schema', name: 'ppi_pricing_explanation', strict: true, schema } }
      });
      const usage = response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : null;
      if (response.status !== 'completed') throw new ExplanationFailure('MODEL_INCOMPLETE', usage);
      if (response.output.some(item => item.type === 'message' && item.content.some(part => part.type === 'refusal'))) throw new ExplanationFailure('MODEL_REFUSAL', usage);
      if (!response.output_text) throw new ExplanationFailure('MODEL_INCOMPLETE', usage);
      let output: unknown;
      try { output = JSON.parse(response.output_text); } catch { throw new ExplanationFailure('MODEL_PARSE_FAILED', usage); }
      return { output, usage };
    } catch (error) {
      if (error instanceof ExplanationFailure) throw error;
      if (error instanceof OpenAI.AuthenticationError) throw new ExplanationFailure('MODEL_AUTH_FAILED');
      if (error instanceof OpenAI.RateLimitError) throw new ExplanationFailure('MODEL_RATE_LIMIT');
      if (error instanceof OpenAI.APIConnectionTimeoutError) throw new ExplanationFailure('MODEL_TIMEOUT');
      if (error instanceof OpenAI.NotFoundError || error instanceof OpenAI.BadRequestError) throw new ExplanationFailure('MODEL_UNAVAILABLE');
      throw new ExplanationFailure('MODEL_UNAVAILABLE');
    }
  }
}

export class ExplanationFailure extends Error {
  constructor(readonly code: string, readonly usage: ModelResult['usage'] = null) { super(code); }
}

const clean = (value: string) => value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
export function validateExplanation(raw: unknown, input: ExplanationInput) {
  const parsed = PricingExplanation.safeParse(raw);
  if (!parsed.success) throw new ExplanationFailure('MODEL_PARSE_FAILED');
  // Validate the exact text that React will display, including words joined by removed markup.
  const sanitized = PricingExplanation.safeParse({ summary: clean(parsed.data.summary), reasons: parsed.data.reasons.map(item => ({ claim: clean(item.claim), evidenceIds: item.evidenceIds })),
    strategySteps: parsed.data.strategySteps.map(clean), assumptions: parsed.data.assumptions.map(clean), unknowns: parsed.data.unknowns.map(clean), warnings: parsed.data.warnings.map(clean) });
  if (!sanitized.success) throw new ExplanationFailure('MODEL_PARSE_FAILED');
  const result = sanitized.data;
  const ids = new Set(['ENGINE', ...input.evidence.map(item => item.id)]);
  if (result.reasons.some(reason => reason.evidenceIds.some(id => !ids.has(id)))) throw new ExplanationFailure('INVALID_EVIDENCE_REFERENCE');
  const fields = [result.summary, ...result.reasons.map(item => item.claim), ...result.strategySteps, ...result.assumptions, ...result.unknowns, ...result.warnings];
  const allowed = new Set<number>();
  const add = (value: number | null | undefined) => { if (value !== null && value !== undefined) allowed.add(value); };
  add(input.engine.referencePrice);
  for (const value of input.engine.referenceRange ?? []) add(value);
  const strategy = input.mode === 'OFFER' ? input.engine.offerResult : input.engine.listingResult;
  add(strategy?.suggestedPrice);
  for (const value of strategy?.recommendedRange ?? []) add(value);
  input.engine.includedComparables.forEach(item => add(item.soldPrice));
  input.engine.activeListingContext.forEach(item => add(item.askingPrice));
  const soldAssertion = /\b(?:sold(?:\s+\w+){0,2}\s+(?:for|at)|was sold|closed(?:\s+\w+){0,2}\s+(?:for|at)|sold price|sale price was)\b/i;
  const negatedSale = /\b(?:not|never|cannot|isn't|wasn't|is not)\b.{0,35}\b(?:sold|sale)\b/i;
  for (const field of fields) {
    if (/\$?\b\d+(?:\.\d+)?\s*(?:k|m|million|thousand)\b/i.test(field)) throw new ExplanationFailure('NUMERIC_PRICE_MISMATCH');
    for (const match of field.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)|\b(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{5,9})\b/g)) {
      if (!allowed.has(Number((match[1] ?? match[2]!).replaceAll(',', '')))) throw new ExplanationFailure('NUMERIC_PRICE_MISMATCH');
    }
    // Each labeled amount must belong to that calculation, not merely occur somewhere in the evidence.
    for (const sentence of field.split(/(?<=[.!?])\s+/)) {
      const amounts = [...sentence.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)|\b(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{5,9})\b/g)];
      if (!amounts.length) continue;
      let kind: 'REFERENCE' | 'STRATEGY' | null = null;
      const labels = [...sentence.matchAll(/\b(?:reference(?:\s+(?:price|range)){0,2}|(?:suggested|recommended)(?:\s+(?:offer|listing|price|range)){0,3}|offer(?:\s+(?:price|range)){0,2}|(?<!active\s)listing(?:\s+(?:price|range)){1,2}|range)\b/gi)]
        .map(match => {
          if (/\breference\b/i.test(match[0])) kind = 'REFERENCE';
          else if (/\b(?:suggested|recommended|offer|listing)\b/i.test(match[0])) kind = 'STRATEGY';
          return { index: match.index, kind, range: /\brange\b/i.test(match[0]) };
        });
      for (const amount of amounts) {
        // A later label starts a new price clause. This also permits a scalar and
        // its separately labeled range in one otherwise valid sentence.
        const label = labels.filter(item => item.index < amount.index).at(-1) ?? labels[0];
        if (!label?.kind) continue;
        const value = Number((amount[1] ?? amount[2]!).replaceAll(',', ''));
        const expected = label.kind === 'REFERENCE'
          ? label.range ? input.engine.referenceRange ?? [] : [input.engine.referencePrice]
          : label.range ? strategy?.recommendedRange ?? [] : [strategy?.suggestedPrice];
        if (!expected.includes(value)) throw new ExplanationFailure('NUMERIC_PRICE_MISMATCH');
      }
    }
    const noGisAdjustment = /^no school or hazard adjustments (?:were|are) applied[.!]?$/i.test(field);
    if ((!noGisAdjustment && /\b(?:school|elementary|high school|attendance boundary|school district|campus|wildfire|fault|earthquake|hazard)\b/i.test(field)) ||
      /\b(?:guaranteed|will accept|certain to sell)\b/i.test(field) ||
      /\b(?:price per (?:square foot|sqft)|price-per-square-foot|weighted (?:p20|p80)|\bp20\b|\bp80\b)\b/i.test(field) ||
      (/\b(?:active listing|asking price|ask)\b/i.test(field) && soldAssertion.test(field) && !negatedSale.test(field)) ||
      /\bexcluded\b.{0,50}\b(?:used in|supports|included in)\b.{0,30}\b(?:range|reference|price)\b/i.test(field)) throw new ExplanationFailure('UNSUPPORTED_CLAIM');
  }
  if (result.reasons.some(reason => reason.evidenceIds.some(id => input.evidence.some(item => item.id === id && item.kind === 'ACTIVE_ASK')) &&
    (soldAssertion.test(reason.claim) || /\brecorded sale\b/i.test(reason.claim)) && !negatedSale.test(reason.claim))) throw new ExplanationFailure('UNSUPPORTED_CLAIM');
  if (result.reasons.some(reason => reason.evidenceIds.some(id => input.evidence.some(item => item.id === id && item.kind === 'EXCLUDED_SALE')) && /\b(?:included|used in (?:the )?range|supports (?:the )?price)\b/i.test(reason.claim.replace(/\b(?:not|never) included\b/gi, 'excluded')))) throw new ExplanationFailure('UNSUPPORTED_CLAIM');
  for (const reason of result.reasons) {
    if (reason.evidenceIds.includes('ENGINE')) continue;
    const citedPrices = new Set(input.evidence.filter(item => reason.evidenceIds.includes(item.id)).map(item => item.price));
    for (const match of reason.claim.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)|\b(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{5,9})\b/g)) {
      if (!citedPrices.has(Number((match[1] ?? match[2]!).replaceAll(',', '')))) throw new ExplanationFailure('NUMERIC_PRICE_MISMATCH');
    }
  }
  return result;
}

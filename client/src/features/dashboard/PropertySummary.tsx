import type { PropertyEnvelope, PropertyOverrideField } from '@ppi/shared';
import { dateTime, money, number } from '../../format.js';

export function PropertySummary({ record }: { record: PropertyEnvelope }) {
  const { property, cache } = record;
  const facts: { label: string; field: PropertyOverrideField | 'lotSizeSqft'; value: number | null; suffix?: string }[] = [
    { label: 'Beds', field: 'bedrooms', value: property.effectiveValues.bedrooms },
    { label: 'Baths', field: 'bathrooms', value: property.effectiveValues.bathrooms },
    { label: 'Living area', field: 'livingAreaSqft', value: property.effectiveValues.livingAreaSqft, suffix: 'sqft' },
    { label: 'Lot size', field: 'lotSizeSqft', value: property.lotSizeSqft, suffix: 'sqft' },
    { label: 'Year built', field: 'yearBuilt', value: property.effectiveValues.yearBuilt }
  ];
  return <section className="card property-summary" aria-labelledby="property-summary-title">
    <div className="property-illustration" aria-label="Neutral property placeholder graphic" role="img"><svg viewBox="0 0 180 120" fill="none" aria-hidden="true"><path d="M12 61 90 11l78 50v48H12V61Z" fill="#d7e7f6"/><path d="M24 59 90 17l66 42v48H24V59Z" fill="#ecf4fc" stroke="#a9c4e0" strokeWidth="2"/><path d="M70 107V68h40v39" fill="#bdd6ee"/><path d="M34 69h22v20H34zM124 69h22v20h-22z" fill="#b7d6ee"/><path d="M8 109h164" stroke="#9fbfdd" strokeWidth="3" strokeLinecap="round"/></svg><span>Property image unavailable</span></div>
    <div className="property-overview"><div className="eyebrow-row"><span className="eyebrow">Selected property</span><span className="demo-pill">RentCast property record</span></div><h2 id="property-summary-title">{property.formattedAddress}</h2><p className="property-type">{property.propertyType ?? 'Property type unavailable'}{property.unit ? ` · ${property.unit}` : ''}</p>
      <div className="property-price"><span>Verified current list price</span><strong>{money(property.currentListPrice)}</strong></div>
      <dl className="fact-grid">{facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value === null ? 'Not available' : `${number(fact.value)}${fact.suffix ? ` ${fact.suffix}` : ''}`}{fact.field !== 'lotSizeSqft' && property.userOverrides[fact.field] && <small className="override-mark">User override</small>}</dd></div>)}</dl>
      <p className="metadata-line">Source: {cache.source ?? 'Unavailable'} · Fetched {dateTime(cache.fetchedAt)} · {cache.freshness.toLowerCase()} · Cached until {dateTime(cache.expiresAt)}</p>
    </div>
  </section>;
}

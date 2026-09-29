import type { DemoProperty } from '../../fixtures/demo.js';
import { date, money, number } from '../../format.js';

export function PropertySummary({ property }: { property: DemoProperty }) {
  const facts = [
    ['Beds', property.beds === null ? 'Not available' : String(property.beds)],
    ['Baths', property.baths === null ? 'Not available' : String(property.baths)],
    ['Living area', property.squareFeet === null ? 'Not available' : `${number(property.squareFeet)} sqft`],
    ['Lot size', property.lotSquareFeet === null ? 'Not available' : `${number(property.lotSquareFeet)} sqft`],
    ['Year built', property.yearBuilt === null ? 'Not available' : String(property.yearBuilt)]
  ];
  return <section className="card property-summary" aria-labelledby="property-summary-title">
    <div className="property-illustration" aria-label="Neutral property placeholder graphic" role="img"><svg viewBox="0 0 180 120" fill="none" aria-hidden="true"><path d="M12 61 90 11l78 50v48H12V61Z" fill="#d7e7f6"/><path d="M24 59 90 17l66 42v48H24V59Z" fill="#ecf4fc" stroke="#a9c4e0" strokeWidth="2"/><path d="M70 107V68h40v39" fill="#bdd6ee"/><path d="M34 69h22v20H34zM124 69h22v20h-22z" fill="#b7d6ee"/><path d="M8 109h164" stroke="#9fbfdd" strokeWidth="3" strokeLinecap="round"/></svg><span>Property image unavailable</span></div>
    <div className="property-overview"><div className="eyebrow-row"><span className="eyebrow">Selected property</span><span className="demo-pill">Demo fixture</span></div><h2 id="property-summary-title">{property.address}</h2><p className="property-type">{property.propertyType}</p><div className="property-price"><span>Demo listing ask</span><strong>{money(property.listPrice)}</strong></div><dl className="fact-grid">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="metadata-line">Fixture record updated {date(property.updatedAt)} · Not live provider data</p></div>
  </section>;
}

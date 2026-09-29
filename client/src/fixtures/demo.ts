import type { AnalysisMode } from '@ppi/shared';

/** Synthetic UI fixtures only. Never use this module as a fallback for a failed live request. */
export const DEMO_SOURCE = 'DEMO_FIXTURE' as const;

export type DemoComparable = {
  id: string;
  address: string;
  soldPrice: number;
  beds: number;
  baths: number;
  squareFeet: number;
  distanceMiles: number;
  soldDate: string;
};

export type DemoSchool = {
  id: string;
  name: string;
  level: 'Elementary' | 'Middle' | 'High';
  assignment: 'assigned-in-fixture';
};

export type DemoGrocery = { id: string; name: string; category: string; distanceMiles: number };

export type DemoAnalysis = {
  mode: AnalysisMode;
  primaryValue: number;
  marketRange: readonly [number, number];
  recommendedRange: readonly [number, number];
  suggestedPrice: number;
  generatedAt: string;
  reasons: readonly string[];
  strategyTitle: string;
  strategyPoints: readonly string[];
};

export type DemoProperty = {
  source: typeof DEMO_SOURCE;
  id: string;
  address: string;
  propertyType: string;
  listPrice: number | null;
  referenceRange: readonly [number, number] | null;
  beds: number | null;
  baths: number | null;
  squareFeet: number | null;
  lotSquareFeet: number | null;
  yearBuilt: number | null;
  updatedAt: string;
  status: 'Fresh' | 'Stale' | 'Needs Refresh' | 'Draft';
  comparables: readonly DemoComparable[];
  assignedSchools: readonly DemoSchool[] | null;
  grocery: readonly DemoGrocery[] | null;
  analyses: Record<AnalysisMode, DemoAnalysis | null>;
};

export const demoProperties: readonly DemoProperty[] = [
  {
    source: DEMO_SOURCE,
    id: 'demo-alder',
    address: '1847 Alder View Lane, Demo City, CA 90000',
    propertyType: 'Single-family home',
    listPrice: 825000,
    referenceRange: [780000, 830000],
    beds: 3,
    baths: 2,
    squareFeet: 1840,
    lotSquareFeet: 6200,
    yearBuilt: 1988,
    updatedAt: '2026-09-24',
    status: 'Fresh',
    comparables: [
      { id: 'demo-comp-alder-1', address: '1812 Alder View Lane', soldPrice: 798000, beds: 3, baths: 2, squareFeet: 1790, distanceMiles: 0.2, soldDate: '2026-08-18' },
      { id: 'demo-comp-alder-2', address: '37 Juniper Court', soldPrice: 814000, beds: 3, baths: 2, squareFeet: 1905, distanceMiles: 0.5, soldDate: '2026-07-30' },
      { id: 'demo-comp-alder-3', address: '902 Linden Way', soldPrice: 775000, beds: 3, baths: 2, squareFeet: 1735, distanceMiles: 0.8, soldDate: '2026-06-12' }
    ],
    assignedSchools: [
      { id: 'demo-school-elementary', name: 'Demo Grove Elementary', level: 'Elementary', assignment: 'assigned-in-fixture' },
      { id: 'demo-school-middle', name: 'Demo Ridge Middle', level: 'Middle', assignment: 'assigned-in-fixture' },
      { id: 'demo-school-high', name: 'Demo Valley High', level: 'High', assignment: 'assigned-in-fixture' }
    ],
    grocery: [
      { id: 'demo-grocery-1', name: 'Demo Market', category: 'Grocery', distanceMiles: 0.6 },
      { id: 'demo-grocery-2', name: 'Cedar Pantry', category: 'Supermarket', distanceMiles: 1.1 }
    ],
    analyses: {
      OFFER: {
        mode: 'OFFER', primaryValue: 825000, marketRange: [780000, 830000], recommendedRange: [790000, 812000], suggestedPrice: 805000, generatedAt: '2026-09-24',
        reasons: [
          'The demo comparable sales cluster within a narrow range of size and layout.',
          'The suggested offer sits below the fixture asking price while remaining within the demo reference range.',
          'The fixture does not include condition, inspection, or seller motivation evidence.'
        ],
        strategyTitle: 'Start with a measured opening offer',
        strategyPoints: ['Confirm property condition and disclosures before submitting.', 'Keep room for inspection findings and negotiation.', 'Reassess if new recorded sales become available.']
      },
      LISTING: {
        mode: 'LISTING', primaryValue: 805000, marketRange: [780000, 830000], recommendedRange: [819000, 849000], suggestedPrice: 835000, generatedAt: '2026-09-24',
        reasons: [
          'The demo sales suggest a reference band rather than one exact market value.',
          'The fixture listing range allows room to test buyer response.',
          'Condition, timing, and active competition are not verified in this demo.'
        ],
        strategyTitle: 'Launch with a clear review point',
        strategyPoints: ['Review showing activity after the first week.', 'Confirm condition and presentation before finalizing.', 'Adjust only after checking new market evidence.']
      }
    }
  },
  {
    source: DEMO_SOURCE,
    id: 'demo-crescent',
    address: '26 Crescent Court, Demo City, CA 90000',
    propertyType: 'Townhome',
    listPrice: null,
    referenceRange: null,
    beds: 2,
    baths: 2.5,
    squareFeet: 1310,
    lotSquareFeet: null,
    yearBuilt: 2006,
    updatedAt: '2026-08-19',
    status: 'Needs Refresh',
    comparables: [],
    assignedSchools: null,
    grocery: null,
    analyses: { OFFER: null, LISTING: null }
  },
  {
    source: DEMO_SOURCE,
    id: 'demo-cedar',
    address: '901 Cedar Row, Demo City, CA 90000',
    propertyType: 'Condominium',
    listPrice: 612000,
    referenceRange: [575000, 625000],
    beds: 2,
    baths: 2,
    squareFeet: 1180,
    lotSquareFeet: null,
    yearBuilt: 2015,
    updatedAt: '2026-09-08',
    status: 'Stale',
    comparables: [
      { id: 'demo-comp-cedar-1', address: '880 Cedar Row', soldPrice: 603000, beds: 2, baths: 2, squareFeet: 1215, distanceMiles: 0.3, soldDate: '2026-07-02' }
    ],
    assignedSchools: null,
    grocery: null,
    analyses: {
      OFFER: { mode: 'OFFER', primaryValue: 612000, marketRange: [575000, 625000], recommendedRange: [585000, 605000], suggestedPrice: 598000, generatedAt: '2026-09-09', reasons: ['The single demo sale is a limited reference point.', 'The fixture does not include HOA or condition evidence.'], strategyTitle: 'Verify before committing', strategyPoints: ['Review HOA documents.', 'Request more recent closed sales.'] },
      LISTING: null
    }
  },
  {
    source: DEMO_SOURCE,
    id: 'demo-harbor',
    address: '73 Harbor Lane, Demo City, CA 90000',
    propertyType: 'Single-family home',
    listPrice: null,
    referenceRange: null,
    beds: 4,
    baths: 2,
    squareFeet: 2060,
    lotSquareFeet: 7100,
    yearBuilt: 1976,
    updatedAt: '2026-08-03',
    status: 'Draft',
    comparables: [],
    assignedSchools: null,
    grocery: null,
    analyses: { OFFER: null, LISTING: null }
  }
] satisfies readonly DemoProperty[];

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
export function searchDemoProperty(query: string): DemoProperty | null {
  const term = normalized(query.trim());
  if (!term) return null;
  const exact = demoProperties.find(property => normalized(property.address) === term);
  if (exact) return exact;
  const matches = demoProperties.filter(property => normalized(property.address).includes(term));
  return matches.length === 1 ? matches[0]! : null;
}

import { createHash } from 'node:crypto';
import { AssignedSchool, type AssignedSchoolsResponse } from '@ppi/shared';
import type { PropertyRepository, StoredProperty } from '../properties/repository.js';
import { PropertyError } from '../properties/service.js';
import { distanceMiles } from '../market/provider.js';

export type VerifiedAssignment = {
  assignmentLevel: 'ELEMENTARY' | 'MIDDLE' | 'HIGH' | 'OTHER'; sourceSchoolId: string | null;
  name: string; district: string | null; city: string | null;
  latitude: number | null; longitude: number | null; grades: string | null; schoolType: string | null;
};
export type SchoolReference = { sourceId: string; name: string; district: string | null; city: string | null;
  latitude: number | null; longitude: number | null; grades: string | null; schoolType: string | null; source: string };
export interface VerifiedAssignmentSource {
  get(subject: StoredProperty): Promise<{ source: string; schools: VerifiedAssignment[] } | null>;
}
export interface SchoolReferenceSource { lookup(assignments: VerifiedAssignment[]): Promise<SchoolReference[]>; }

// No verified RentCast assignment contract is documented or observed. Production must stay unavailable.
export class UnavailableAssignmentSource implements VerifiedAssignmentSource {
  async get(): Promise<null> { return null; }
}

const normalize = (value: string | null) => value?.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '') ?? '';
export function matchSchool(assignment: VerifiedAssignment, references: SchoolReference[]): { reference: SchoolReference | null; status: AssignedSchool['matchStatus'] } {
  const stages: { status: AssignedSchool['matchStatus']; matches: SchoolReference[] }[] = [
    { status: 'EXACT_ID', matches: assignment.sourceSchoolId ? references.filter(item => item.sourceId === assignment.sourceSchoolId) : [] },
    { status: 'NAME_DISTRICT', matches: assignment.district ? references.filter(item => normalize(item.name) === normalize(assignment.name) && normalize(item.district) === normalize(assignment.district)) : [] },
    { status: 'NAME_CITY', matches: assignment.city ? references.filter(item => normalize(item.name) === normalize(assignment.name) && normalize(item.city) === normalize(assignment.city)) : [] }
  ];
  for (const stage of stages) {
    if (stage.matches.length > 1) return { reference: null, status: 'UNMATCHED' };
    if (stage.matches.length === 1) return { reference: stage.matches[0]!, status: stage.status };
  }
  return { reference: null, status: 'UNMATCHED' };
}

export class AssignedSchoolsService {
  constructor(private readonly properties: PropertyRepository, private readonly assignments: VerifiedAssignmentSource,
    private readonly references?: SchoolReferenceSource) {}

  async get(propertyId: string): Promise<AssignedSchoolsResponse> {
    const record = await this.properties.findById(propertyId);
    if (!record) throw new PropertyError('PROPERTY_NOT_FOUND', 404);
    let result: Awaited<ReturnType<VerifiedAssignmentSource['get']>>;
    try { result = await this.assignments.get(record.property); }
    catch { return { propertyId, status: 'PROVIDER_ERROR', schools: [], assignmentSource: null }; }
    if (!result) return { propertyId, status: 'ASSIGNMENT_UNAVAILABLE', schools: [], assignmentSource: null };
    let references: SchoolReference[] = [];
    if (this.references) {
      try { references = await this.references.lookup(result.schools); }
      catch { /* Verified identities can still be displayed without enrichment. */ }
    }
    const schools = result.schools.map(assignment => {
      const matched = matchSchool(assignment, references);
      const reference = matched.reference;
      const latitude = assignment.latitude ?? reference?.latitude ?? null;
      const longitude = assignment.longitude ?? reference?.longitude ?? null;
      const distance = record.property.latitude !== null && record.property.longitude !== null && latitude !== null && longitude !== null
        ? distanceMiles({ latitude: record.property.latitude, longitude: record.property.longitude }, { latitude, longitude }) : null;
      return AssignedSchool.parse({
        id: `school:${createHash('sha256').update(`${result.source}:${assignment.sourceSchoolId ?? normalize(assignment.name)}`).digest('hex').slice(0, 20)}`,
        assignmentLevel: assignment.assignmentLevel, sourceSchoolId: assignment.sourceSchoolId, name: assignment.name,
        district: assignment.district ?? reference?.district ?? null, city: assignment.city ?? reference?.city ?? null,
        latitude, longitude, grades: assignment.grades ?? reference?.grades ?? null, schoolType: assignment.schoolType ?? reference?.schoolType ?? null,
        distanceMiles: distance === null ? null : Math.round(distance * 100) / 100,
        assignmentSource: result.source, metadataSource: reference?.source ?? null, matchStatus: matched.status
      });
    });
    const located = schools.filter(school => school.latitude !== null && school.longitude !== null).length;
    const status = schools.length === 0 ? 'ASSIGNMENT_UNAVAILABLE' : located === schools.length ? 'AVAILABLE' : located === 0 ? 'UNMATCHED' : 'PARTIAL';
    return { propertyId, status, schools, assignmentSource: result.source };
  }
}

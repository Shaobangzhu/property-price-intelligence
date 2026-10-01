import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AssignedSchool, AssignmentLevel, type AssignedSchoolsResponse } from '@ppi/shared';
import type { PropertyRepository, StoredProperty } from '../properties/repository.js';
import { PropertyError } from '../properties/service.js';
import { distanceMiles } from '../market/provider.js';

const text = z.string().trim().min(1).max(250);
const VerifiedAssignment = z.object({
  assignmentLevel: AssignmentLevel, sourceSchoolId: text.nullable(),
  name: text, district: text.nullable(), city: text.nullable(),
  latitude: z.number().finite().min(-90).max(90).nullable(), longitude: z.number().finite().min(-180).max(180).nullable(),
  grades: text.nullable(), schoolType: text.nullable()
});
export type VerifiedAssignment = z.infer<typeof VerifiedAssignment>;
// This is the internal verified-source adapter contract, not a RentCast schema.
const AssignmentResult = z.object({ source: text, schools: z.array(VerifiedAssignment).max(100) }).nullable();
export type SchoolReference = { sourceId: string; name: string; district: string | null; city: string | null;
  latitude: number | null; longitude: number | null; grades: string | null; schoolType: string | null; source: string };
export interface VerifiedAssignmentSource {
  get(subject: StoredProperty): Promise<unknown>;
}
export interface SchoolReferenceSource { lookup(assignments: VerifiedAssignment[]): Promise<SchoolReference[]>; }

class AssignmentSourceUnavailable extends Error {}

// No verified assignment adapter is connected. This is not an empty provider result.
export class UnavailableAssignmentSource implements VerifiedAssignmentSource {
  async get(): Promise<never> { throw new AssignmentSourceUnavailable(); }
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
    let raw: unknown;
    try { raw = await this.assignments.get(record.property); }
    catch (error) {
      if (error instanceof AssignmentSourceUnavailable) return { propertyId, status: 'SOURCE_UNAVAILABLE', schools: [], assignmentSource: null };
      throw new PropertyError('SCHOOL_ASSIGNMENT_PROVIDER_ERROR', 502);
    }
    const parsed = AssignmentResult.safeParse(raw);
    if (!parsed.success) throw new PropertyError('SCHOOL_ASSIGNMENT_PROVIDER_MALFORMED', 502);
    const result = parsed.data;
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

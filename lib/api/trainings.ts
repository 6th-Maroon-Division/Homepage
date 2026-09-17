import type { Training } from '@/generated/prisma/client';
import { apiError } from './response';
type TrainingPatch = { name?: string; description?: string | null; duration?: number | null; categoryId?: number | null; isActive?: boolean; requiresTrainingSession?: boolean; requiresOrbatQualification?: boolean; orbatQualificationNotes?: string | null };
export const trainingCountInclude = { _count: { select: { userTrainings: true, trainingRequests: true } } } as const;
export function trainingDto(value: Training & { _count: { userTrainings: number; trainingRequests: number } }) {
  const { _count, ...training } = value;
  return { ...training, counts: _count };
}
export function parseTrainingBody(body: unknown, creating: boolean): { data: TrainingPatch; error?: never } | { error: Response; data?: never } {
  const invalid = (message: string) => ({ error: apiError(422, 'validation_failed', message) });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be an object.');
  const input = body as Record<string, unknown>;
  if (!Object.keys(input).length || Object.keys(input).some(key => !['name', 'description', 'duration', 'categoryId', 'isActive', 'requiresTrainingSession', 'requiresOrbatQualification', 'orbatQualificationNotes'].includes(key))) return invalid('Provide editable training fields only.');
  if ((creating || input.name !== undefined) && (typeof input.name !== 'string' || !input.name.trim())) return invalid('name must be a non-empty string.');
  const data: TrainingPatch = {};
  if (typeof input.name === 'string') data.name = input.name.trim();
  for (const field of ['description', 'orbatQualificationNotes'] as const) {
    if (input[field] === undefined) continue;
    if (input[field] !== null && typeof input[field] !== 'string') return invalid(`${field} must be a string or null.`);
    data[field] = typeof input[field] === 'string' ? input[field].trim() || null : null;
  }
  for (const field of ['duration', 'categoryId'] as const) {
    const value = input[field];
    if (value === undefined) continue;
    const max = field === 'duration' ? 1440 : 2147483647;
    if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)) return invalid(`${field} must be null or an integer between 1 and ${max}.`);
    data[field] = value as number | null;
  }
  for (const field of ['isActive', 'requiresTrainingSession', 'requiresOrbatQualification'] as const) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== 'boolean') return invalid(`${field} must be a boolean.`);
    data[field] = input[field];
  }
  return { data };
}
export function trainingSnapshot(value: Training) {
  return { name: value.name, description: value.description === null ? null : '[REDACTED]', duration: value.duration, categoryId: value.categoryId, isActive: value.isActive, requiresTrainingSession: value.requiresTrainingSession, requiresOrbatQualification: value.requiresOrbatQualification, orbatQualificationNotes: value.orbatQualificationNotes === null ? null : '[REDACTED]', requiredForNewPeople: value.requiredForNewPeople };
}
export function trainingDatabaseError(error: unknown): Response {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2025') return apiError(404, 'not_found', 'Training not found.');
    if (error.code === 'P2003' || error.code === 'P2002') return apiError(409, 'conflict', 'Training references changed or prevent this operation.');
  }
  throw error;
}

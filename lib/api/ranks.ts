import type { Rank } from '@/generated/prisma/client';
import { apiError } from './response';
type RankPatch = { name?: string; abbreviation?: string; orderIndex?: number; attendanceRequiredSinceLastRank?: number | null; autoRankupEnabled?: boolean };
const nonnegativeInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647;
export function parseRankBody(body: unknown, creating: boolean): { data: RankPatch; error?: never } | { error: Response; data?: never } {
  const invalid = (message: string) => ({ error: apiError(422, 'validation_failed', message) });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be an object.');
  const input = body as Record<string, unknown>;
  if (!Object.keys(input).length || Object.keys(input).some(key => !['name', 'abbreviation', 'orderIndex', 'attendanceRequiredSinceLastRank', 'autoRankupEnabled'].includes(key))) return invalid('Provide supported rank fields only.');
  const data: RankPatch = {};
  for (const field of ['name', 'abbreviation'] as const) {
    if ((creating || input[field] !== undefined) && (typeof input[field] !== 'string' || !input[field].trim())) return invalid(`${field} must be a non-empty string.`);
    if (typeof input[field] === 'string') data[field] = input[field].trim();
  }
  if ((creating || input.orderIndex !== undefined) && !nonnegativeInt(input.orderIndex)) return invalid('orderIndex must be a nonnegative 32-bit integer.');
  if (typeof input.orderIndex === 'number') data.orderIndex = input.orderIndex;
  if (input.attendanceRequiredSinceLastRank !== undefined) {
    if (input.attendanceRequiredSinceLastRank !== null && !nonnegativeInt(input.attendanceRequiredSinceLastRank)) return invalid('attendanceRequiredSinceLastRank must be null or a nonnegative 32-bit integer.');
    data.attendanceRequiredSinceLastRank = input.attendanceRequiredSinceLastRank;
  }
  if (input.autoRankupEnabled !== undefined) {
    if (typeof input.autoRankupEnabled !== 'boolean') return invalid('autoRankupEnabled must be a boolean.');
    data.autoRankupEnabled = input.autoRankupEnabled;
  }
  return { data };
}
export function parseRankReorder(body: unknown): { data: { id: number; orderIndex: number }[]; error?: never } | { error: Response; data?: never } {
  const invalid = () => ({ error: apiError(422, 'validation_failed', 'Provide a non-empty ranks array with unique positive integer IDs and nonnegative integer orderIndex values.') });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Array.isArray(input.ranks) || !input.ranks.length) return invalid();
  const seen = new Set<number>();
  const data: { id: number; orderIndex: number }[] = [];
  for (const item of input.ranks) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 2 || !nonnegativeInt(item.id) || item.id === 0 || !nonnegativeInt(item.orderIndex) || seen.has(item.id)) return invalid();
    seen.add(item.id); data.push({ id: item.id, orderIndex: item.orderIndex });
  }
  return { data };
}
export function rankSnapshot(rank: Rank) {
  return { name: rank.name, abbreviation: rank.abbreviation, orderIndex: rank.orderIndex, attendanceRequiredSinceLastRank: rank.attendanceRequiredSinceLastRank, autoRankupEnabled: rank.autoRankupEnabled };
}
export function rankDatabaseError(error: unknown): Response {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2002') return apiError(409, 'conflict', 'Rank name or abbreviation already exists.');
    if (error.code === 'P2025') return apiError(404, 'not_found', 'Rank not found.');
    if (error.code === 'P2003') return apiError(409, 'conflict', 'Rank is referenced by another record.');
  }
  throw error;
}

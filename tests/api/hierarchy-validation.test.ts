import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { userPermission: { findMany: mocks.findMany } } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { canAccessApiUser } from '@/lib/api/auth';
import { canManageTrainingRequest } from '@/lib/api/training-requests';
import type { ApiPrincipal } from '@/lib/api/principal';
const actor: ApiPrincipal = { kind: 'user', userId: 1, permissions: { 'user:manage': 10, 'training:mark': 10 } };
const bot: ApiPrincipal = { kind: 'bot', tokenId: 9, permissions: { 'system:super_admin': 255 } };
const grant = (key: string, value: unknown) => ({ permission: { key }, value });
beforeEach(() => { mocks.findMany.mockReset(); });
test.each([
  [grant('system:super_admin', 1), grant('legacy:unknown', 1)],
  [grant('system:super_admin', 1), grant('training:mark', 256)],
  [grant('system:super_admin', 1), grant('user:manage', -1)],
  [grant('system:super_admin', 1), grant('user:manage', '10')],
  [grant('system:super_admin', 256)],
].map(rows => [rows] as const))('malformed target grants fail closed for human managers in both hierarchy helpers', async rows => {
  mocks.findMany.mockResolvedValue(rows);
  expect(await canAccessApiUser(actor, 2, 'user:manage')).toBe(false);
  expect(await canManageTrainingRequest(actor, 2)).toBe(false);
  expect(await canAccessApiUser(bot, 2, 'user:manage')).toBe(true);
  expect(await canManageTrainingRequest(bot, 2)).toBe(true);
});
test('valid lower grants and self access remain allowed while valid superadmin targets remain protected', async () => {
  mocks.findMany.mockResolvedValue([grant('user:manage', 1), grant('training:mark', 1)]);
  expect(await canAccessApiUser(actor, 2, 'user:manage')).toBe(true); expect(await canManageTrainingRequest(actor, 2)).toBe(true);
  mocks.findMany.mockResolvedValue([grant('system:super_admin', 1)]);
  expect(await canAccessApiUser(actor, 2, 'user:manage')).toBe(false); expect(await canManageTrainingRequest(actor, 2)).toBe(false);
  mocks.findMany.mockClear(); expect(await canAccessApiUser(actor, 1, 'user:manage')).toBe(true); expect(await canManageTrainingRequest(actor, 1)).toBe(true); expect(mocks.findMany).not.toHaveBeenCalled();
});

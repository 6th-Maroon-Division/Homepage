import { afterAll, beforeAll, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId ? { user: { id: session.userId } } : null }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { GET, POST } from '@/app/api/radio-frequencies/route';
import { PATCH, DELETE } from '@/app/api/radio-frequencies/[id]/route';
let userId: number;
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (method: string, body?: unknown, token?: string) => new Request('http://localhost/api/radio-frequencies', { method, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Use the isolated integration runner.');
  const permission = await prisma.permission.upsert({ where: { key: 'system:super_admin' }, create: { key: 'system:super_admin' }, update: {} });
  const user = await prisma.user.create({ data: { username: 'Radio integration admin', userPermissions: { create: { permissionId: permission.id, value: 255 } } } });
  userId = user.id;
  session.userId = userId;
});
afterAll(async () => { await prisma.$disconnect(); });

test('radio catalog persists strict create/update/delete with audits and handles duplicate conflicts', async () => {
  const response = await POST(request('POST', { frequency: ' 97.5 ', type: 'LR', channel: ' ' }));
  expect(response.status).toBe(201);
  const { data } = await response.json();
  expect(data).toMatchObject({ frequency: '97.5', channel: null, type: 'LR' });
  expect(data.createdAt).toMatch(/Z$/);
  expect((await POST(request('POST', { frequency: '97.5', type: 'LR' }))).status).toBe(409);
  expect((await PATCH(request('PATCH', { callsign: 'Eagle', isAdditional: true }), ctx(data.id))).status).toBe(200);
  expect(await prisma.radioFrequency.findUniqueOrThrow({ where: { id: data.id } })).toMatchObject({ callsign: 'Eagle', isAdditional: true });
  const orbat = await prisma.orbat.create({ data: { name: 'Radio relation check', createdById: userId } });
  await prisma.orbatRadioFrequency.create({ data: { orbatId: orbat.id, radioFrequencyId: data.id } });
  expect((await DELETE(request('DELETE'), ctx(data.id))).status).toBe(200);
  expect(await prisma.orbatRadioFrequency.count({ where: { radioFrequencyId: data.id } })).toBe(0);
  expect(await prisma.orbat.findUnique({ where: { id: orbat.id } })).not.toBeNull();
  expect((await prisma.apiAuditLog.findMany({ where: { resource: 'radio_frequency', resourceId: String(data.id) }, orderBy: { id: 'asc' } })).map(row => row.action)).toEqual(['radio_frequency.created', 'radio_frequency.updated', 'radio_frequency.deleted']);
});

test('valid bots can access frequencies while revoked tokens cannot fall back to sessions', async () => {
  const bot = await prisma.botToken.create({ data: { name: 'Radio test bot', token: 'radio-integration-secret' } });
  expect((await GET(request('GET', undefined, bot.token))).status).toBe(200);
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  expect((await GET(request('GET', undefined, bot.token))).status).toBe(401);
});

test('an actual frequency insert rolls back when its transactional audit fails', async () => {
  const transaction = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async tx => {
    const createAudit = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('audit unavailable'));
    try { return await work(tx); } finally { createAudit.mockRestore(); }
  })) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await POST(request('POST', { frequency: '98.123', type: 'SR' }))).status).toBe(500);
    expect(await prisma.radioFrequency.findUnique({ where: { frequency: '98.123' } })).toBeNull();
  } finally { spy.mockRestore(); log.mockRestore(); }
});

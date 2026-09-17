import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), orbat: model(), training: model(), rank: model(), apiAuditLog: model() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET } from '@/app/api/orbats/[id]/full/route';
import { getPublicOrbat } from '@/lib/api/public-orbat';
const date = new Date('2026-09-17T12:30:00Z');
const person = { id: 4, username: 'Member', userRank: { currentRank: { name: 'Private', abbreviation: 'Pvt' } } };
const slot = { id: 3, orderIndex: 0, maxSignups: 1, squadRoleId: 5, squadRole: { id: 5, name: 'Medic', requiredTrainingIds: [6], requiredRankIds: [7] }, signups: [{ id: 8, user: person }] };
const record = { id: 1, name: 'Operation', description: 'Mission', isSideOp: false, startsAtUtc: date, endsAtUtc: new Date('2026-09-17T14:45:00Z'), eventDate: date, startTime: '10:00', endTime: '11:00', timezone: 'UTC', bluforCountry: 'A', bluforRelationship: 'B', opforCountry: 'C', opforRelationship: 'D', indepCountry: 'E', indepRelationship: 'F', iedThreat: 'G', civilianRelationship: 'H', rulesOfEngagement: 'I', airspace: 'J', inGameTimezone: 'K', operationDay: 'L', squads: [{ id: 2, name: 'Alpha', orderIndex: 0, slots: [slot] }], frequencies: [{ id: 9, radioFrequencyId: 10, orbatId: 1, radioFrequency: { id: 10, frequency: '70', type: 'SR', createdAt: date } }], attendanceNotes: [{ id: 11, orbatId: 1, userId: 4, status: 'late', reason: 'Public delay note', lateMinutes: 10, leaveEarlyMinutes: null, createdAt: date, updatedAt: date, user: person }], tempFrequencies: [{ frequency: '80', type: 'LR' }] };
const req = (authorization?: string, query = '') => new Request(`http://localhost/api/orbats/1/full${query}`, { headers: authorization === undefined ? {} : { authorization } });
const ctx = (id = '1') => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 12 });
  mocks.db.orbat.findUnique.mockResolvedValue(record);
  mocks.db.training.findMany.mockResolvedValue([{ id: 6, name: 'Medical' }]);
  mocks.db.rank.findMany.mockResolvedValue([{ id: 7, name: 'Private', abbreviation: 'Pvt' }]);
});
describe('optional public authentication', () => {
  it('permits anonymous, valid sessions and active bot tokens with the same DTO', async () => {
    const anonymous = await (await GET(req(), ctx())).json();
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    expect(await (await GET(req(), ctx())).json()).toEqual(anonymous);
    expect(await (await GET(req('Bearer valid'), ctx())).json()).toEqual(anonymous);
    expect(mocks.db.botToken.update).toHaveBeenCalled();
  });
  it.each(['Basic secret', 'Bearer', 'Bearer two tokens', 'Bearer revoked'])('rejects explicit invalid credentials %s without session fallback', async authorization => {
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await GET(req(authorization), ctx())).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.db.orbat.findUnique).not.toHaveBeenCalled();
  });
  it('treats invalid/deleted stale sessions as anonymous on public data', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'bad' } });
    expect((await GET(req(), ctx())).status).toBe(200);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.user.findUnique.mockResolvedValue(null);
    expect((await GET(req(), ctx())).status).toBe(200);
    expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.actorType).toBe('anonymous');
  });
});
describe('public ORBAT projection', () => {
  it('shares SSR/API data, UTC nested dates, visible fields and restricted user selections', async () => {
    const shared = await getPublicOrbat(1);
    expect((await (await GET(req(), ctx())).json()).data).toEqual(shared);
    expect(shared).toMatchObject({ startTime: '12:30', endTime: '14:45', eventDate: '2026-09-17T12:30:00.000Z', frequencies: [{ radioFrequency: { createdAt: '2026-09-17T12:30:00.000Z' } }], attendanceNotes: [{ createdAt: '2026-09-17T12:30:00.000Z', updatedAt: '2026-09-17T12:30:00.000Z', reason: 'Public delay note', user: person }], tempFrequencies: record.tempFrequencies });
    expect(shared?.squads[0].slots[0]).toMatchObject({ name: 'Medic', requiredTrainings: [{ id: 6, name: 'Medical' }], requiredRanks: [{ id: 7, name: 'Private' }], signups: [{ user: { id: 4, username: 'Member', rankName: 'Private', rankAbbreviation: 'Pvt' } }] });
    const include = mocks.db.orbat.findUnique.mock.lastCall![0].include;
    expect(Object.keys(include.squads.include.slots.include.signups.include.user.select).sort()).toEqual(['id', 'username', 'userRank'].sort());
    expect(Object.keys(include.attendanceNotes.select.user.select).sort()).toEqual(['id', 'username', 'userRank'].sort());
    expect(Object.keys(include.attendanceNotes.select).sort()).toEqual(['id', 'orbatId', 'userId', 'status', 'reason', 'lateMinutes', 'leaveEarlyMinutes', 'createdAt', 'updatedAt', 'user'].sort());
  });
  it('preserves side operation suppression, legacy time fallback and null dates', async () => {
    mocks.db.orbat.findUnique.mockResolvedValue({ ...record, isSideOp: true, startsAtUtc: null, endsAtUtc: null });
    const side = await getPublicOrbat(1);
    expect(side).toMatchObject({ startTime: '10:00', endTime: '11:00', startsAtUtc: null, endsAtUtc: null });
    expect(side?.squads[0].slots[0]).toMatchObject({ requiredTrainings: [], requiredRanks: [], requiredTraining: null, requiredRank: null });
    const nullFields = Object.fromEntries(['eventDate', 'startTime', 'endTime', 'timezone', 'bluforCountry', 'bluforRelationship', 'opforCountry', 'opforRelationship', 'indepCountry', 'indepRelationship', 'iedThreat', 'civilianRelationship', 'rulesOfEngagement', 'airspace', 'inGameTimezone', 'operationDay'].map(key => [key, null]));
    mocks.db.orbat.findUnique.mockResolvedValue({ ...record, ...nullFields, startsAtUtc: null, endsAtUtc: null });
    expect(await getPublicOrbat(1)).toMatchObject(nullFields);
  });
  it('preserves unassigned slots, unlimited capacity, missing users and rank fallback', async () => {
    mocks.db.orbat.findUnique.mockResolvedValue({ ...record, squads: [{ id: 2, name: 'Alpha', orderIndex: 0, slots: [{ ...slot, maxSignups: null, squadRole: null, squadRoleId: null, signups: [{ id: 8, user: null }, { id: 9, user: { id: 5, username: null, userRank: null } }] }] }] });
    const data = await getPublicOrbat(1);
    expect(data?.squads[0].slots[0]).toMatchObject({ name: 'Unassigned Role', maxSignups: 9999, requiredTrainings: [], requiredRanks: [], signups: [{ user: null }, { user: { username: 'Unknown', rankAbbreviation: null, rankName: null } }] });
  });
  it('filters missing training/rank references out of enriched requirements', async () => {
    mocks.db.training.findMany.mockResolvedValue([]);
    mocks.db.rank.findMany.mockResolvedValue([]);
    expect((await getPublicOrbat(1))?.squads[0].slots[0]).toMatchObject({ requiredTrainings: [], requiredRanks: [] });
  });
  it('validates identifiers/query parameters and missing ORBAT', async () => {
    for (const id of ['bad', '0', '2147483648']) expect((await GET(req(), ctx(id))).status).toBe(400);
    expect((await GET(req(undefined, '?other=1'), ctx())).status).toBe(400);
    mocks.db.orbat.findUnique.mockResolvedValue(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(await getPublicOrbat(1)).toBeNull();
  });
});
describe('public ORBAT personal read auditing', () => {
  it('audits anonymous and bot views without copying people or attendance reasons', async () => {
    const response = await GET(req(), ctx());
    const audit = mocks.db.apiAuditLog.create.mock.lastCall![0].data;
    expect(audit).toMatchObject({ actorType: 'anonymous', actorUserId: null, action: 'user_data.read', resource: 'orbat', resourceId: '1', targetUserIds: [4], correlationId: response.headers.get('X-Request-Id') });
    expect(audit).not.toHaveProperty('before'); expect(audit).not.toHaveProperty('after');
    expect(JSON.stringify(audit)).not.toContain('Public delay note');
    await GET(req('Bearer valid'), ctx());
    expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data).toMatchObject({ actorType: 'bot', actorTokenId: 12, targetUserIds: [4] });
  });
  it('skips self-only people and empty public data, audits only other displayed IDs', async () => {
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    await GET(req(), ctx());
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
    mocks.db.orbat.findUnique.mockResolvedValue({ ...record, attendanceNotes: [{ ...record.attendanceNotes[0], userId: 5, user: { ...person, id: 5 } }] });
    await GET(req(), ctx());
    expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]);
    mocks.db.apiAuditLog.create.mockClear();
    mocks.db.orbat.findUnique.mockResolvedValue({ ...record, squads: [], attendanceNotes: [] });
    await GET(req('Bearer valid'), ctx());
    mocks.session.mockResolvedValue(null);
    await GET(req(), ctx());
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it('withholds all personal data when required audit fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
    const response = await GET(req(), ctx());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).not.toHaveProperty('data');
    expect(JSON.stringify(body)).not.toContain('Member');
    log.mockRestore();
  });
});

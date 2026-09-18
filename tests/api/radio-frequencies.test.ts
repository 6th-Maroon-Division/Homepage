import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() });
  return { session: vi.fn(), prisma: { user: model(), userPermission: model(), botToken: model(), radioFrequency: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET, POST } from '@/app/api/radio-frequencies/route';
import { PATCH, DELETE } from '@/app/api/radio-frequencies/[id]/route';
import { parseRadioFrequencyBody, isDuplicateFrequency } from '@/lib/api/radio-frequencies';
const row = { id: 4, frequency: '50', type: 'SR', isAdditional: false, channel: null, callsign: null };
const ctx = (id = '4') => ({ params: Promise.resolve({ id }) });
const req = (method = 'GET', body?: unknown, bearer?: string, query = '') => new Request(`http://localhost/api/radio-frequencies${query}`, { method, headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const methods = [
  ['GET', (bearer?: string) => GET(req('GET', undefined, bearer))],
  ['POST', (bearer?: string) => POST(req('POST', { frequency: '50', type: 'SR' }, bearer))],
  ['PATCH', (bearer?: string) => PATCH(req('PATCH', { channel: '1' }, bearer), ctx())],
  ['DELETE', (bearer?: string) => DELETE(req('DELETE', undefined, bearer), ctx())],
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 1 } });
  mocks.prisma.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] });
  mocks.prisma.botToken.findFirst.mockResolvedValue({ id: 2 });
  mocks.prisma.radioFrequency.findMany.mockResolvedValue([row]);
  mocks.prisma.radioFrequency.findUnique.mockResolvedValue(row);
  mocks.prisma.radioFrequency.create.mockResolvedValue(row);
  mocks.prisma.radioFrequency.update.mockResolvedValue({ ...row, channel: '1' });
  mocks.prisma.$transaction.mockImplementation(work => work(mocks.prisma));
});
test.each(methods)('%s accepts authorized user and bot identities', async (_name, call) => {
  expect((await call()).status).toBeLessThan(300);
  expect((await call('valid')).status).toBeLessThan(300);
});
test.each(methods)('%s denies missing/revoked credentials and audits denial', async (_name, call) => {
  mocks.session.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
  mocks.prisma.botToken.findFirst.mockResolvedValue(null);
  expect((await call('revoked')).status).toBe(401);
  expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'access.denied' }) }));
});
test.each(methods.slice(1))('%s denies users without required rights', async (_name, call) => {
  mocks.prisma.user.findUnique.mockResolvedValue({ userPermissions: [] });
  expect((await call()).status).toBe(403);
});
test('catalog reads require a valid identity but no management right and no read audit', async () => {
  mocks.prisma.user.findUnique.mockResolvedValue({ userPermissions: [] });
  const response = await GET(req());
  expect(await response.json()).toEqual({ data: [row], meta: { limit: 50, nextCursor: null } });
  expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
});
test('list validates pagination and returns a cursor only with lookahead', async () => {
  expect((await GET(req('GET', undefined, undefined, '?limit=1.5'))).status).toBe(400);
  mocks.prisma.radioFrequency.findMany.mockResolvedValue([row, { ...row, id: 5 }]);
  const response = await GET(req('GET', undefined, undefined, '?limit=1&cursor=3'));
  expect((await response.json()).meta).toEqual({ limit: 1, nextCursor: '4' });
  expect(mocks.prisma.radioFrequency.findMany).toHaveBeenLastCalledWith({ where: { id: { gt: 3 } }, orderBy: { id: 'asc' }, take: 2 });
});
test.each([null, [], {}, { frequency: 2, type: 'SR' }, { frequency: ' ', type: 'SR' }, { frequency: '50', type: 'bad' }, { frequency: '50', type: 'SR', isAdditional: 'false' }, { frequency: '50', type: 'SR', channel: 1 }, { frequency: '50', type: 'SR', callsign: false }, { frequency: '50', type: 'SR', id: 1 }])('rejects invalid create payload %j', async body => {
  expect((await POST(req('POST', body))).status).toBe(422);
  expect(mocks.prisma.radioFrequency.create).not.toHaveBeenCalled();
});
test('normalizes optional values and rejects empty PATCH without replacing omitted fields', async () => {
  expect(parseRadioFrequencyBody({ frequency: ' 50 ', type: 'LR', isAdditional: false, channel: ' ', callsign: ' Alpha ' }, true).data).toEqual({ frequency: '50', type: 'LR', isAdditional: false, channel: null, callsign: 'Alpha' });
  expect(parseRadioFrequencyBody({ callsign: null }, false).data).toEqual({ callsign: null });
  expect(parseRadioFrequencyBody({ channel: null }, false).data).toEqual({ channel: null });
  expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(422);
  expect((await POST(new Request('http://localhost/api/radio-frequencies', { method: 'POST', body: '{' }))).status).toBe(400);
});
test.each(['bad', '0', '2147483648'])('item mutations reject invalid database id %s', async id => {
  expect((await PATCH(req('PATCH', { channel: '2' }), ctx(id))).status).toBe(400);
  expect((await DELETE(req('DELETE'), ctx(id))).status).toBe(400);
});
test('missing items return404 and successful mutations record matching audit snapshots', async () => {
  await POST(req('POST', { frequency: '50', type: 'SR' }));
  await PATCH(req('PATCH', { channel: '1' }), ctx());
  await DELETE(req('DELETE'), ctx());
  expect(mocks.prisma.apiAuditLog.create.mock.calls.map(([value]) => value.data.action)).toEqual(['radio_frequency.created', 'radio_frequency.updated', 'radio_frequency.deleted']);
  mocks.prisma.radioFrequency.findUnique.mockResolvedValue(null);
  expect((await PATCH(req('PATCH', { channel: '1' }), ctx())).status).toBe(404);
  expect((await DELETE(req('DELETE'), ctx())).status).toBe(404);
});
test('duplicate frequency conflicts are409 and unexpected/audit failures are500', async () => {
  mocks.prisma.radioFrequency.create.mockRejectedValue({ code: 'P2002' });
  expect((await POST(req('POST', { frequency: '50', type: 'SR' }))).status).toBe(409);
  mocks.prisma.radioFrequency.update.mockRejectedValue({ code: 'P2002' });
  expect((await PATCH(req('PATCH', { channel: '1' }), ctx())).status).toBe(409);
  mocks.prisma.radioFrequency.create.mockRejectedValue(new Error('database unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await POST(req('POST', { frequency: '50', type: 'SR' }))).status).toBe(500);
  mocks.prisma.radioFrequency.update.mockRejectedValue(new Error('database unavailable'));
  expect((await PATCH(req('PATCH', { channel: '1' }), ctx())).status).toBe(500);
  mocks.prisma.apiAuditLog.create.mockRejectedValue(new Error('audit unavailable'));
  expect((await DELETE(req('DELETE'), ctx())).status).toBe(500);
  expect(isDuplicateFrequency(null)).toBe(false);
  log.mockRestore();
});

test('out-of-range cursors return400 and concurrent deletion returns404', async () => {
  expect((await GET(req('GET', undefined, undefined, '?cursor=2147483648'))).status).toBe(400);
  mocks.prisma.radioFrequency.update.mockRejectedValue({ code: 'P2025' });
  expect((await PATCH(req('PATCH', { channel: '1' }), ctx())).status).toBe(404);
  mocks.prisma.radioFrequency.delete.mockRejectedValue({ code: 'P2025' });
  expect((await DELETE(req('DELETE'), ctx())).status).toBe(404);
});
test('radio callsign can be cleared explicitly with null',()=>{
 expect(parseRadioFrequencyBody({callsign:null},false)).toEqual({data:{callsign:null}});
});
test('blank callsign normalizes to null',()=>{
 expect(parseRadioFrequencyBody({callsign:'  '},false)).toEqual({data:{callsign:null}});
});

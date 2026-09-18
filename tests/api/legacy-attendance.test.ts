import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => { const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), createManyAndReturn: vi.fn(), update: vi.fn() }); return { session: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), legacyAttendanceData: model(), apiAuditLog: model(), $transaction: vi.fn() } }; });
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db })); vi.mock('next-auth', () => ({ getServerSession: mocks.session })); vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET } from '@/app/api/attendance/legacy-records/route';
import { PATCH } from '@/app/api/attendance/legacy-records/[id]/route';
import { POST } from '@/app/api/attendance/legacy-records/import/route';
import { parseAttendanceMatrix } from '@/lib/api/legacy-attendance';
import { parseLegacyCsv } from '@/lib/api/legacy-csv';
const csv = 'YEAR: 2025\nRANK,NAME,ID,26-Dec,2-Jan\nPvt,"Doe, John",123,P,A';
const req = (method = 'GET', body?: unknown, auth?: string, query = '') => new Request(`http://localhost/api/test${query}`, { method, headers: auth ? { authorization: auth } : {}, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const ctx = () => ({ params: Promise.resolve({ id: '7' }) });
const row = (overrides: Record<string, unknown> = {}) => ({ id: 7, legacyName: 'Private Person', legacyUserId: '123', legacyStatus: 'P', legacyEventDate: new Date('2024-12-26T00:00:00Z'), legacyNotes: null, mappedUserId: null, isMapped: false, createdAt: new Date('2025-01-01T00:00:00Z'), updatedAt: new Date('2025-01-01T00:00:00Z'), mappedUser: null, ...overrides });
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: 4 } }); mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] }); mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 }); mocks.db.legacyAttendanceData.findMany.mockResolvedValue([]); mocks.db.legacyAttendanceData.findUnique.mockResolvedValue(row()); mocks.db.legacyAttendanceData.update.mockImplementation(async ({ data }) => row(data)); mocks.db.legacyAttendanceData.createManyAndReturn.mockResolvedValue([{ id: 8 }, { id: 9 }]); mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db)); });
const calls = [() => GET(req()), () => PATCH(req('PATCH', { mappedUserId: 4 }), ctx()), () => POST(req('POST', { csvData: csv }))];
test.each([0,1,2])('method %s requires identity and live grants; bot uses same API', async index => {
  mocks.session.mockResolvedValue(null); expect((await calls[index]()).status).toBe(401); mocks.session.mockResolvedValue({ user: { id: 4 } }); mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] }); expect((await calls[index]()).status).toBe(403);
  const response = index === 0 ? await GET(req('GET',undefined,'Bearer active')) : index === 1 ? await PATCH(req('PATCH',{mappedUserId:null},'Bearer active'),ctx()) : await POST(req('POST',{csvData:csv},'Bearer active')); expect(response.status).toBe(200);
  mocks.db.botToken.findFirst.mockResolvedValue(null); expect((await GET(req('GET',undefined,'Bearer revoked'))).status).toBe(401);
});
test('listing filters before pagination and audits only returned other/unmapped records, not lookahead', async () => {
  mocks.db.legacyAttendanceData.findMany.mockResolvedValue([row({ mappedUserId: 4 }), row({ id: 8, mappedUserId: 99 })]); const response = await GET(req('GET',undefined,undefined,'?limit=1&cursor=6&search=Private&isMapped=true')); const body = await response.json(); expect(body.meta).toEqual({limit:1,nextCursor:'7'}); expect(body.data[0].createdAt).toBe('2025-01-01T00:00:00.000Z'); expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  expect(mocks.db.legacyAttendanceData.findMany.mock.lastCall![0].where).toEqual({id:{gt:6},legacyName:{contains:'Private',mode:'insensitive'},isMapped:true});
  mocks.db.legacyAttendanceData.findMany.mockResolvedValue([row()]); expect((await GET(req())).status).toBe(200); expect(mocks.db.apiAuditLog.create).toHaveBeenCalled();
});
test.each(['?isMapped=1','?cursor=2147483648','?limit=0','?search=a&search=b','?unknown=1'])('strict listing query %s', async query => { expect((await GET(req('GET',undefined,undefined,query))).status).toBe(400); });
test('mapping clears explicitly, audits both old and new targets and contains no names', async () => { mocks.db.legacyAttendanceData.findUnique.mockResolvedValue(row({mappedUserId:5,isMapped:true})); const response = await PATCH(req('PATCH',{mappedUserId:6}),ctx()); expect((await response.json()).data).toMatchObject({mappedUserId:6,isMapped:true}); expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5,6]); expect(JSON.stringify(mocks.db.apiAuditLog.create.mock.calls)).not.toContain('Private Person'); expect((await PATCH(req('PATCH',{mappedUserId:null}),ctx())).status).toBe(200); expect(mocks.db.legacyAttendanceData.update.mock.lastCall![0].data).toEqual({mappedUserId:null,isMapped:false}); });
test.each([{}, {mappedUserId:'4'}, {mappedUserId:0}, {mappedUserId:2147483648}, {mappedUserId:4,extra:true}])('mapping rejects payload %#', async body => { expect((await PATCH(req('PATCH',body),ctx())).status).toBe(422); });
test('missing mapping refs return404, audit failure returns500', async () => { mocks.db.legacyAttendanceData.findUnique.mockResolvedValue(null); expect((await PATCH(req('PATCH',{mappedUserId:4}),ctx())).status).toBe(404); mocks.db.legacyAttendanceData.findUnique.mockResolvedValue(row()); mocks.db.user.findUnique.mockResolvedValueOnce({userPermissions:[{permission:{key:'system:super_admin'},value:255}]}).mockResolvedValueOnce(null); expect((await PATCH(req('PATCH',{mappedUserId:4}),ctx())).status).toBe(404); });
test('CSV handles quoting CRLF, strict missing year, correct December-to-January UTC rollover and missing IDs', () => {
  expect(parseLegacyCsv('"a,b","c""d"\r\nx,y')).toEqual([['a,b','c"d'],['x','y']]); const parsed = parseAttendanceMatrix(csv); expect(parsed.records.map(row => row.legacyEventDate.toISOString())).toEqual(['2024-12-26T00:00:00.000Z','2025-01-02T00:00:00.000Z']); expect(parsed.records[0].legacyName).toBe('Pvt Doe, John'); expect(parseAttendanceMatrix('YEAR: 2025\nRANK,NAME,2-Jan\nPvt,A,P').records[0].legacyUserId).toBeNull();
});
test.each(['x', '"unclosed', '"a"b', 'YEAR: 2025\nRANK,NAME,31-Feb\nPvt,A,P','YEAR: 2025\nRANK,NAME,2-Jan,2-Jan\nPvt,A,P,P','YEAR: 2025\nRANK,NAME,2-Jan\nPvt,A,XYZ','YEAR: 2025\nRANK,NAME,2-Jan\nPvt,A,LOA'])('invalid matrix %# yields422', async csvData => { expect((await POST(req('POST',{csvData}))).status).toBe(422); });
test('preview and import deduplicate within file and DB, conflicts never write, missing IDs use names', async () => {
  const input = 'YEAR: 2025\nRANK,NAME,2-Jan\nPvt,A,P\nPvt,B,P\nPvt,A,P';
  let response = await POST(req('POST',{csvData:input,previewOnly:true})); let body = await response.json(); expect(body.data.imported).toBe(2); expect(body.data.duplicates.same).toBe(1); expect(mocks.db.legacyAttendanceData.createManyAndReturn).not.toHaveBeenCalled(); expect(mocks.db.legacyAttendanceData.findMany.mock.calls[0][0].where).toMatchObject({legacyUserId:null,legacyName:'Pvt A'});
  mocks.db.legacyAttendanceData.findMany.mockResolvedValue([{legacyStatus:'A',mappedUserId:6}]); response=await POST(req('POST',{csvData:input,previewOnly:true})); body=await response.json(); expect(body.data.conflicts).toHaveLength(3); expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([6]); expect((await POST(req('POST',{csvData:input}))).status).toBe(409); expect(mocks.db.legacyAttendanceData.createManyAndReturn).not.toHaveBeenCalled();
});
test('successful import snapshots IDs only and duplicate-only import is a no-op', async () => { expect((await POST(req('POST',{csvData:csv}))).status).toBe(200); expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.after).toMatchObject({recordIds:[8,9],importedCount:2}); expect(JSON.stringify(mocks.db.apiAuditLog.create.mock.calls)).not.toContain('Doe'); mocks.db.legacyAttendanceData.findMany.mockImplementation(async ({where})=>[{legacyStatus:where.legacyEventDate.getUTCFullYear()===2024?'P':'A',mappedUserId:null}]); const response=await POST(req('POST',{csvData:csv})); expect((await response.json()).data.imported).toBe(0); });
test('read audit fails closed and writes map concurrency errors', async () => { const log=vi.spyOn(console,'error').mockImplementation(()=>{}); mocks.db.legacyAttendanceData.findMany.mockResolvedValue([row()]); mocks.db.apiAuditLog.create.mockRejectedValue(new Error('private details')); expect((await GET(req())).status).toBe(500); mocks.db.$transaction.mockRejectedValue({code:'P2034'}); expect((await POST(req('POST',{csvData:csv}))).status).toBe(409); log.mockRestore(); });

test.each([`?search=${'a'.repeat(201)}`, '?cursor=2147483648'])('legacy history rejects oversized filters %s', async query => {
  expect((await GET(req('GET', undefined, undefined, query))).status).toBe(400);
});

test('self-only legacy records omit read auditing and absent historic dates serialize null', async () => {
  mocks.db.legacyAttendanceData.findMany.mockResolvedValue([row({ mappedUserId: 4, legacyEventDate: null })]);
  expect((await (await GET(req())).json()).data[0].legacyEventDate).toBeNull();
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
});

test('legacy attendance preview rejects invalid flag and omits audits for matching self records', async () => {
  expect((await POST(req('POST', { csvData: csv, previewOnly: 'yes' }))).status).toBe(422);
  mocks.db.legacyAttendanceData.findMany.mockResolvedValue([{ legacyStatus: 'P', mappedUserId: 4 }]);
  expect((await POST(req('POST', { csvData: 'YEAR: 2025\nRANK,NAME,ID,2-Jan\nPvt,Self,4,P', previewOnly: true }))).status).toBe(200);
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
});

test('viewing another mapped legacy user audits that user once', async () => {
  mocks.db.legacyAttendanceData.findMany.mockResolvedValue([row({ mappedUserId: 5 }), row({ id: 8, mappedUserId: 5 })]);
  expect((await GET(req())).status).toBe(200);
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]);
});

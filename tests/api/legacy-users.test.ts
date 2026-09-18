import { beforeEach, expect, test, vi } from 'vitest';
const mocks=vi.hoisted(()=>{const model=()=>({findUnique:vi.fn(),findFirst:vi.fn(),findMany:vi.fn(),create:vi.fn(),createManyAndReturn:vi.fn(),update:vi.fn(),upsert:vi.fn(),deleteMany:vi.fn()});return{session:vi.fn(),db:{user:model(),userPermission:model(),botToken:model(),legacyUserData:model(),rank:model(),userRank:model(),rankHistory:model(),authAccount:model(),botEvent:model(),apiAuditLog:model(),$transaction:vi.fn()}};});
vi.mock('@/lib/prisma',()=>({prisma:mocks.db}));vi.mock('next-auth',()=>({getServerSession:mocks.session}));vi.mock('@/app/api/auth/[...nextauth]/route',()=>({authOptions:{}}));
import { GET, PATCH } from '@/app/api/attendance/legacy-users/route';
import { POST as importCSV } from '@/app/api/attendance/legacy-users/import/route';
import { POST as apply } from '@/app/api/attendance/legacy-users/apply/route';
import { legacyJoinedDate,parseLegacyUsers } from '@/lib/api/legacy-users';
const csv='ID,NAME,Rank,Date Joined,TIG Since Last Promo,TOTAL TIG,Old Data\nlegacy-a,Person,Pvt,2/1/2020,3,5,7';
const request=(method='GET',body?:unknown,auth?:string,query='')=>new Request(`http://localhost/api/test${query}`,{method,headers:auth?{authorization:auth}:{},...(body!==undefined?{body:JSON.stringify(body)}:{})});
const row=(overrides:Record<string,unknown>={})=>({id:7,legacyId:'legacy-a',discordUsername:'Person',rankName:'Pvt',dateJoined:'2/1/2020',tigSinceLastPromo:3,totalTig:5,oldData:7,mappedUserId:5,isMapped:true,isApplied:false,importedAt:new Date('2025-01-01T00:00:00Z'),notes:null,mappedUser:{id:5,username:'Person'},...overrides});
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue({user:{id:4}});mocks.db.user.findUnique.mockResolvedValue({id:4,userPermissions:[{permission:{key:'system:super_admin'},value:255}]});mocks.db.botToken.findFirst.mockResolvedValue({id:9});mocks.db.legacyUserData.findMany.mockResolvedValue([]);mocks.db.legacyUserData.findUnique.mockResolvedValue(row());mocks.db.legacyUserData.update.mockImplementation(async({data})=>row(data));mocks.db.legacyUserData.createManyAndReturn.mockResolvedValue([{id:7,mappedUserId:null}]);mocks.db.rank.findMany.mockResolvedValue([{id:2,name:'Private',abbreviation:'Pvt'}]);mocks.db.user.findMany.mockResolvedValue([{id:5}]);mocks.db.userRank.findUnique.mockResolvedValue({currentRankId:1,currentRank:{name:'Recruit'},attendanceSinceLastRank:0,lastRankedUpAt:new Date('2019-01-01T00:00:00Z'),retired:true,interviewDone:true});mocks.db.userRank.upsert.mockImplementation(async({update})=>({...update,retired:true,interviewDone:true}));mocks.db.rankHistory.create.mockResolvedValue({id:12});mocks.db.$transaction.mockImplementation(async cb=>cb(mocks.db));});
const calls=[()=>GET(request()),()=>PATCH(request('PATCH',{updates:[{id:7,mappedUserId:5}]})),()=>importCSV(request('POST',{csvData:csv})),()=>apply(request('POST',{ids:[7]}))];
test.each([0,1,2,3])('method %s requires live permission and authentication',async index=>{expect((await calls[index]()).status).toBe(200);mocks.session.mockResolvedValue(null);expect((await calls[index]()).status).toBe(401);mocks.session.mockResolvedValue({user:{id:4}});mocks.db.user.findUnique.mockResolvedValue({userPermissions:[]});expect((await calls[index]()).status).toBe(403);});
test('active bot uses same contracts and revoked bearer never falls back',async()=>{expect((await apply(request('POST',{ids:[7]},'Bearer active'))).status).toBe(200);expect(mocks.db.rankHistory.create.mock.lastCall![0].data.triggeredByUserId).toBeNull();expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.actorType).toBe('bot');mocks.db.botToken.findFirst.mockResolvedValue(null);expect((await GET(request('GET',undefined,'Bearer revoked'))).status).toBe(401);});
test('list applies filters before pagination, narrows dates and audits only returned others',async()=>{mocks.db.legacyUserData.findMany.mockResolvedValue([row({mappedUserId:4}),row({id:8,mappedUserId:6})]);const response=await GET(request('GET',undefined,undefined,'?limit=1&cursor=6&search=Person&isMapped=true&isApplied=false'));const body=await response.json();expect(body.meta).toEqual({limit:1,nextCursor:'7'});expect(body.data[0].dateJoined).toBe('2020-01-02');expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();expect(mocks.db.legacyUserData.findMany.mock.lastCall![0].where).toMatchObject({id:{gt:6},isMapped:true,isApplied:false});mocks.db.legacyUserData.findMany.mockResolvedValue([row({mappedUserId:null,dateJoined:'old invalid'})]);expect((await GET(request())).status).toBe(200);expect(mocks.db.apiAuditLog.create).toHaveBeenCalled();});
test.each(['?page=1','?isApplied=yes','?limit=0','?cursor=2147483648','?search=a&search=b'])('strict query %s',async query=>{expect((await GET(request('GET',undefined,undefined,query))).status).toBe(400);});
test('CSV normalization handles ordered headers, strict numbers and UTC legacy calendar dates',()=>{expect(parseLegacyUsers(csv)[0]).toMatchObject({dateJoined:'2020-01-02',tigSinceLastPromo:3,oldData:7});expect(legacyJoinedDate('2020-02-29')).toBe('2020-02-29');expect(legacyJoinedDate(null)).toBeNull();expect(()=>legacyJoinedDate('31/2/2020')).toThrow();expect(()=>parseLegacyUsers(csv.replace(',3,5,7',',3oops,5,7'))).toThrow();expect(()=>parseLegacyUsers(csv+'\nlegacy-a,Other,Pvt,,0,0,0')).toThrow();});
test('import preserves duplicate skipping and unknown rank notices, automatic mapping only for unambiguous matches',async()=>{mocks.db.user.findMany.mockResolvedValue([{id:5},{id:6}]);const response=await importCSV(request('POST',{csvData:csv.replace('Pvt','Unknown'),autoMap:true,previewOnly:true}));const body=await response.json();expect(body.data.preview[0]).toMatchObject({mappedUserId:null,isMapped:false,notes:'Invalid rank: Unknown'});expect(mocks.db.legacyUserData.createManyAndReturn).not.toHaveBeenCalled();mocks.db.legacyUserData.findMany.mockResolvedValue([{legacyId:'legacy-a'}]);expect((await(await importCSV(request('POST',{csvData:csv}))).json()).data.imported).toBe(0);});
test('lower attendance editors cannot enable automatic mapping',async()=>{mocks.db.user.findUnique.mockResolvedValue({userPermissions:[{permission:{key:'attendance:edit'},value:1}]});expect((await importCSV(request('POST',{csvData:csv,autoMap:true}))).status).toBe(403);expect((await importCSV(request('POST',{csvData:csv}))).status).toBe(200);});
test.each([{updates:[]},{updates:[{id:'7',mappedUserId:5}]},{updates:[{id:7}]},{updates:[{id:7,mappedUserId:5},{id:7,mappedUserId:6}]},{updates:[{id:7,mappedUserId:5,extra:true}]}])('strict mapping payload %#',async body=>{expect((await PATCH(request('PATCH',body))).status).toBe(422);});
test('mapping preflights all records and rejects applied remaps before any update',async()=>{mocks.db.legacyUserData.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({id:8,isApplied:true}));expect((await PATCH(request('PATCH',{updates:[{id:7,mappedUserId:6},{id:8,mappedUserId:null}]}))).status).toBe(409);expect(mocks.db.legacyUserData.update).not.toHaveBeenCalled();mocks.db.legacyUserData.findUnique.mockResolvedValue(row({isApplied:true}));expect((await PATCH(request('PATCH',{updates:[{id:7,mappedUserId:5}]}))).status).toBe(200);});
test('apply preserves existing flags, uses actual previous rank, UTC baseline, audit and outbox in transaction',async()=>{expect((await apply(request('POST',{ids:[7]}))).status).toBe(200);expect(mocks.db.userRank.upsert.mock.lastCall![0].update).toEqual({currentRankId:2,attendanceSinceLastRank:3,lastRankedUpAt:new Date('2020-01-02T00:00:00Z')});expect(mocks.db.rankHistory.create.mock.lastCall![0].data).toMatchObject({previousRankName:'Recruit',newRankName:'Private',attendanceTotalAtChange:7,attendanceDeltaSinceLastRank:3,triggeredBy:'import',triggeredByUserId:4});expect(mocks.db.botEvent.create.mock.lastCall![0].data.payload).toMatchObject({source:'legacy_import',changeType:'correction',oldRankId:1,newRankId:2});expect(mocks.db.$transaction.mock.lastCall![1]).toEqual({isolationLevel:'Serializable',timeout:30000});expect(JSON.stringify(mocks.db.apiAuditLog.create.mock.calls)).not.toContain('Person');});
test('apply creates missing state with defaults, skips already applied, refuses repeated target',async()=>{mocks.db.userRank.findUnique.mockResolvedValue(null);expect((await apply(request('POST',{ids:[7]}))).status).toBe(200);expect(mocks.db.rankHistory.create.mock.lastCall![0].data.previousRankName).toBeNull();mocks.db.legacyUserData.findUnique.mockResolvedValue(row({isApplied:true}));expect((await(await apply(request('POST',{ids:[7]}))).json()).data).toEqual({applied:0,skipped:1});mocks.db.legacyUserData.findUnique.mockResolvedValue(row());expect((await apply(request('POST',{ids:[7,8]}))).status).toBe(409);});
test('apply rejects missing records, unmapped state, applied-to-user conflicts and missing rank',async()=>{mocks.db.legacyUserData.findUnique.mockResolvedValue(null);expect((await apply(request('POST',{ids:[7]}))).status).toBe(404);mocks.db.legacyUserData.findUnique.mockResolvedValue(row({isMapped:false}));expect((await apply(request('POST',{ids:[7]}))).status).toBe(409);mocks.db.legacyUserData.findUnique.mockResolvedValue(row());mocks.db.legacyUserData.findFirst.mockResolvedValue({id:8});expect((await apply(request('POST',{ids:[7]}))).status).toBe(409);mocks.db.legacyUserData.findFirst.mockResolvedValue(null);mocks.db.rank.findMany.mockResolvedValue([]);expect((await apply(request('POST',{ids:[7]}))).status).toBe(404);expect(mocks.db.userRank.upsert).not.toHaveBeenCalled();});
test.each([{ids:[]},{ids:[7,7]},{ids:['7']},{ids:Array(101).fill(7)},{ids:[7],extra:true}])('strict apply payload %#',async body=>{expect((await apply(request('POST',body))).status).toBe(422);});
test('audit failures fail closed and transactional conflicts return409',async()=>{const log=vi.spyOn(console,'error').mockImplementation(()=>{});mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Private error'));expect((await apply(request('POST',{ids:[7]}))).status).toBe(500);mocks.db.legacyUserData.findMany.mockResolvedValue([row()]);expect((await GET(request())).status).toBe(500);mocks.db.$transaction.mockRejectedValue({code:'P2034'});expect((await apply(request('POST',{ids:[7]}))).status).toBe(409);log.mockRestore();});

test.each([`?search=${'a'.repeat(201)}`, '?isMapped=false&isApplied=true'])('legacy baseline supports boolean filtering and limits text %s', async query => {
  const response = await GET(request('GET', undefined, undefined, query));
  expect(response.status).toBe(query.includes('search=') ? 400 : 200);
  if (response.ok) expect(mocks.db.legacyUserData.findMany.mock.lastCall![0].where).toMatchObject({ isMapped: false, isApplied: true });
});

test.each([{ csvData: csv, previewOnly: 'yes' }, { csvData: csv, autoMap: 1 }])('legacy baseline rejects non-boolean options %#', async body => {
  expect((await importCSV(request('POST', body))).status).toBe(422);
});

test('legacy mapping rejects missing rows and missing targets before writing', async () => {
  mocks.db.legacyUserData.findUnique.mockResolvedValueOnce(null);
  expect((await PATCH(request('PATCH', { updates: [{ id: 7, mappedUserId: 5 }] }))).status).toBe(404);
  mocks.db.user.findUnique.mockResolvedValueOnce({ id: 4, userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] }).mockResolvedValueOnce(null);
  expect((await PATCH(request('PATCH', { updates: [{ id: 7, mappedUserId: 5 }] }))).status).toBe(404);
  expect(mocks.db.legacyUserData.update).not.toHaveBeenCalled();
});

test('legacy baseline rejects missing mapped accounts and invalid stored counters', async () => {
  mocks.db.user.findUnique.mockResolvedValueOnce({ id: 4, userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] }).mockResolvedValueOnce(null);
  expect((await apply(request('POST', { ids: [7] }))).status).toBe(404);
  mocks.db.legacyUserData.findUnique.mockResolvedValue(row({ oldData: -1 }));
  expect((await apply(request('POST', { ids: [7] }))).status).toBe(422);
});

test.each([false, true])('missing join date uses existing rank date or current time, existing=%s', async existing => {
  mocks.db.legacyUserData.findUnique.mockResolvedValue(row({ dateJoined: null }));
  mocks.db.userRank.findUnique.mockResolvedValue(existing ? { currentRankId: null, currentRank: null, attendanceSinceLastRank: 0, lastRankedUpAt: new Date('2019-01-01T00:00:00Z') } : null);
  expect((await apply(request('POST', { ids: [7] }))).status).toBe(200);
  const data = mocks.db.userRank.upsert.mock.lastCall![0].create;
  expect(data.lastRankedUpAt).toBeInstanceOf(Date);
  if (existing) expect(data.lastRankedUpAt.toISOString()).toBe('2019-01-01T00:00:00.000Z');
  expect(mocks.db.rankHistory.create.mock.lastCall![0].data.note).toContain('Date Joined Unknown');
});

test('legacy apply rejects already-established baselines and ambiguous rank abbreviations', async () => {
  mocks.db.legacyUserData.findFirst.mockResolvedValueOnce({ id: 9 });
  expect((await apply(request('POST', { ids: [7] }))).status).toBe(409);
  mocks.db.rank.findMany.mockResolvedValue([{ id: 2, name: 'Private', abbreviation: 'Pvt' }, { id: 3, name: 'PRIVATE', abbreviation: 'PVT' }]);
  expect((await apply(request('POST', { ids: [7] }))).status).toBe(409);
  expect(mocks.db.userRank.upsert).not.toHaveBeenCalled();
});

test('preview without mapping is read-only while automatic imports audit linked targets', async () => {
  expect((await importCSV(request('POST', { csvData: csv, previewOnly: true }))).status).toBe(200);
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  mocks.db.legacyUserData.createManyAndReturn.mockResolvedValue([{ id: 7, mappedUserId: 5 }]);
  expect((await importCSV(request('POST', { csvData: csv, autoMap: true }))).status).toBe(200);
  expect(mocks.db.legacyUserData.createManyAndReturn.mock.lastCall![0].data[0]).toMatchObject({ mappedUserId: 5, isMapped: true });
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]);
});
test('legacy user CSV rejects a header without data', () => expect(() => parseLegacyUsers(csv.split('\n')[0])).toThrow());

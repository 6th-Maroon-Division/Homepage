import { beforeEach, expect, test, vi } from 'vitest';
const m=vi.hoisted(()=>({session:vi.fn(),db:{user:{findUnique:vi.fn()},botToken:{findFirst:vi.fn(),update:vi.fn()},orbat:{findMany:vi.fn()},apiAuditLog:{create:vi.fn()}}}));
vi.mock('@/lib/prisma',()=>({prisma:m.db}));vi.mock('next-auth',()=>({getServerSession:m.session}));vi.mock('@/app/api/auth/[...nextauth]/route',()=>({authOptions:{}}));
import { GET } from '@/app/api/orbats/management/route';
import { GET as publicList } from '@/app/api/orbats/route';
const req=(query='',token?:string)=>new Request(`http://localhost/api/orbats/management${query}`,{headers:token?{authorization:token}:{}});
const row=(id:number, creatorId:number|null=4)=>({id,name:'Operation',description:null,startsAtUtc:new Date('2099-01-01T12:00:00Z'),endsAtUtc:null,eventDate:null,startTime:'12:00',endTime:null,createdAt:new Date('2026-01-01T00:00:00Z'),createdBy:creatorId?{id:creatorId,username:'Creator'}:null,squads:[{_count:{slots:2},slots:[{_count:{signups:2}},{_count:{signups:1}}]}]});
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({user:{id:4}});m.db.user.findUnique.mockResolvedValue({userPermissions:[{permission:{key:'orbat:edit'},value:1}]});m.db.botToken.findFirst.mockResolvedValue({id:9});m.db.orbat.findMany.mockResolvedValue([row(5)]);});
test('management lists explicit metadata and counts with no participant identities',async()=>{const body=await(await GET(req())).json();expect(body.data[0]).toMatchObject({id:5,startsAtUtc:'2099-01-01T12:00:00.000Z',slotCount:1,totalSubslots:2,totalSignups:3});expect(body.data[0].squads).toBeUndefined();expect(body.meta).toEqual({limit:50,nextCursor:null});expect(m.db.apiAuditLog.create).not.toHaveBeenCalled();});
test('creator audit excludes self and lookahead; bots audit all returned creators and tolerate null creators',async()=>{m.db.orbat.findMany.mockResolvedValue([row(5,7),row(4,8)]);const body=await(await GET(req('?limit=1&cursor=6'))).json();expect(body.meta.nextCursor).toBe('5');expect(m.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([7]);m.db.orbat.findMany.mockResolvedValue([row(5,null),row(4)]);expect((await GET(req('', 'Bearer valid'))).status).toBe(200);expect(m.db.apiAuditLog.create.mock.lastCall![0].data).toMatchObject({actorType:'bot',targetUserIds:[4]});});
test.each(['?page=1','?limit=1&limit=2','?cursor=0'])('rejects %s',async query=>{expect((await GET(req(query))).status).toBe(400);expect(m.db.orbat.findMany).not.toHaveBeenCalled();});
test('anonymous403/401 and invalid explicit tokens never gain management access',async()=>{m.session.mockResolvedValue(null);expect((await GET(req())).status).toBe(401);m.session.mockResolvedValue({user:{id:4}});m.db.user.findUnique.mockResolvedValue({userPermissions:[]});expect((await GET(req())).status).toBe(403);m.db.botToken.findFirst.mockResolvedValue(null);expect((await GET(req('', 'Bearer bad'))).status).toBe(401);});
test('failed required creator audit withholds result',async()=>{const log=vi.spyOn(console,'error').mockImplementation(()=>{});m.db.apiAuditLog.create.mockRejectedValue(new Error());try{expect((await GET(req('', 'Bearer valid'))).status).toBe(500);}finally{log.mockRestore();}});
test('public time range uses UTC offsets and event-date fallback without changing minimal response',async()=>{m.session.mockResolvedValue(null);m.db.orbat.findMany.mockResolvedValue([{id:5,name:'Operation'}]);expect((await publicList(req('?startAt=2099-01-01T12:00:00%2B02:00&endBefore=2099-01-02T00:00:00Z'))).status).toBe(200);expect(m.db.orbat.findMany.mock.lastCall![0].where.OR).toEqual([{startsAtUtc:{gte:new Date('2099-01-01T10:00Z'),lt:new Date('2099-01-02Z')}},{startsAtUtc:null,eventDate:{gte:new Date('2099-01-01T10:00Z'),lt:new Date('2099-01-02Z')}}]);});
test.each(['?includePast=bad','?startAt=2099-01-01','?startAt=2099-01-02T00:00:00Z&endBefore=2099-01-01T00:00:00Z'])('public list rejects %s',async query=>{expect((await publicList(req(query))).status).toBe(400);});
test('includePast false uses the current UTC day while true leaves the range unrestricted',async()=>{m.db.orbat.findMany.mockResolvedValue([]);await publicList(req('?includePast=false'));const boundary=m.db.orbat.findMany.mock.lastCall![0].where.OR[0].startsAtUtc.gte as Date;expect(boundary.toISOString().slice(11)).toBe('00:00:00.000Z');await publicList(req('?includePast=true'));expect(m.db.orbat.findMany.mock.lastCall![0].where).toEqual({});});

test('undated operations and unnamed creators have explicit fallback values', async () => {
  m.db.orbat.findMany.mockResolvedValue([{ ...row(5), startsAtUtc: null, createdBy: { id: 4, username: null } }]);
  const body = await (await GET(req())).json();
  expect(body.data[0]).toMatchObject({ startsAtUtc: null, createdBy: { id: 4, username: 'Unknown' } });
});
test('public list accepts an exclusive upper boundary without a lower boundary', async () => {
  m.db.orbat.findMany.mockResolvedValue([]);
  expect((await publicList(req('?includePast=true&endBefore=2099-01-01T00:00:00Z'))).status).toBe(200);
  expect(m.db.orbat.findMany.mock.lastCall![0].where.OR[0]).toEqual({ startsAtUtc: { lt: new Date('2099-01-01Z') } });
});

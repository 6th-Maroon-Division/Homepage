import {beforeEach,expect,test,vi} from 'vitest';
const m=vi.hoisted(()=>{const model=()=>({findUnique:vi.fn(),findFirst:vi.fn(),findMany:vi.fn(),count:vi.fn(),create:vi.fn(),createMany:vi.fn(),update:vi.fn(),updateMany:vi.fn()});return {session:vi.fn(),publish:vi.fn(),db:{user:model(),userPermission:model(),botToken:model(),apiAuditLog:model(),message:model(),messageRecipient:model(),$transaction:vi.fn()}}});
vi.mock('@/lib/prisma',()=>({prisma:m.db}));vi.mock('next-auth',()=>({getServerSession:m.session}));vi.mock('@/app/api/auth/[...nextauth]/route',()=>({authOptions:{}}));vi.mock('@/lib/realtime/inbox-events',()=>({publishInboxEvents:m.publish}));
import {POST} from '@/app/api/messages/route';import {GET,PATCH} from '@/app/api/users/[id]/messages/route';import {PATCH as mark} from '@/app/api/users/[id]/messages/[recipientId]/route';
import {validMessageUrl} from '@/lib/api/messages';
const date=new Date('2026-01-01T00:00:00Z');const row=(id:number,creator=4)=>({id,isRead:false,readAt:null,deliveredAt:date,message:{id:30,title:'Title',body:'Private body',type:'general',actionUrl:null,createdAt:date,createdBy:{id:creator,username:'Author'}}});
const ctx=(id='me',recipientId='9')=>({params:Promise.resolve({id,recipientId})});
const req=(method='GET',body?:unknown,query='',bot=false)=>new Request('http://localhost/api/users/me/messages'+query,{method,headers:bot?{authorization:'Bearer valid'}:{},...(body===undefined?{}:{body:JSON.stringify(body)})});
const payload={title:' Notice ',body:' Text ',audience:{type:'users',userIds:[4,5]}};
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({user:{id:4}});m.db.user.findUnique.mockImplementation(async a=>a.select.userPermissions?{userPermissions:[{permission:{key:'system:super_admin'},value:255}]}:{id:4});m.db.botToken.findFirst.mockResolvedValue({id:7});m.db.user.findMany.mockResolvedValue([{id:4},{id:5}]);m.db.message.create.mockResolvedValue({id:30,createdAt:date});m.db.messageRecipient.findMany.mockResolvedValue([row(9)]);m.db.messageRecipient.findFirst.mockResolvedValue({id:9});m.db.messageRecipient.count.mockResolvedValue(1);m.db.messageRecipient.updateMany.mockResolvedValue({count:1});m.db.$transaction.mockImplementation(async cb=>cb(m.db));});
test('send canonical payload creates all deliveries and audit atomically; bot has nullable creator',async()=>{
 const response=await POST(req('POST',payload));expect(response.status).toBe(201);expect((await response.json()).data).toEqual({id:30,createdAt:date.toISOString(),recipientCount:2});
 expect(m.db.message.create.mock.lastCall![0].data).toMatchObject({title:'Notice',body:'Text',createdById:4});expect(m.db.apiAuditLog.create.mock.lastCall![0].data.after).toEqual({type:'general',recipientCount:2});expect(m.publish).toHaveBeenCalledWith([4,5]);
 await POST(req('POST',payload,'',true));expect(m.db.message.create.mock.lastCall![0].data.createdById).toBeNull();
});
test.each([null,{},[],{...payload,message:'alias'},{...payload,title:''},{...payload,body:'x'.repeat(10001)},{...payload,type:'bad'},{...payload,actionUrl:'javascript:alert(1)'},{...payload,audience:'all'},{...payload,audience:{type:'users',userIds:['4']}},{...payload,audience:{type:'users',userIds:[4,4]}},{...payload,audience:{type:'all',userIds:[]}},{...payload,audience:{type:'rank'}}])('strict send validation %j',async body=>{expect((await POST(req('POST',body))).status).toBe(422);expect(m.db.message.create).not.toHaveBeenCalled()});
test('all/admin audiences expand inside transaction; missing recipients prevent writes',async()=>{
 expect((await POST(req('POST',{...payload,audience:{type:'all'}}))).status).toBe(201);
 await POST(req('POST',{...payload,audience:{type:'admin'}}));expect(m.db.user.findMany.mock.lastCall![0].where).toMatchObject({userPermissions:{some:{permission:{key:'system:super_admin'},value:{gt:0}}}});
 m.db.user.findMany.mockResolvedValue([{id:4}]);expect((await POST(req('POST',payload))).status).toBe(404);
 m.db.user.findMany.mockResolvedValue([]);expect((await POST(req('POST',{...payload,audience:{type:'all'}}))).status).toBe(422);
});
test.each(['/safe','https://example.test/path',null])('safe action URL %s',value=>expect(validMessageUrl(value)).toBe(true));
test.each(['//evil.test','/\\evil.test','https://user:pass@evil.test','bad','file:///tmp/a','/space here',5])('unsafe URL %s',value=>expect(validMessageUrl(value)).toBe(false));
test('inbox pages use real lookahead and audit returned author and target only',async()=>{
 m.db.messageRecipient.findMany.mockResolvedValue([row(9,5),row(8,6)]);const response=await GET(req('GET',undefined,'?limit=1&cursor=10&unread=true&type=alert'),ctx());const body=await response.json();expect(body.meta).toEqual({limit:1,nextCursor:'9',unreadCount:1});expect(body.data[0].deliveredAt).toBe(date.toISOString());expect(m.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]);
 expect(m.db.messageRecipient.findMany.mock.lastCall![0]).toMatchObject({where:{userId:4,id:{lt:10},isRead:false,message:{type:'alert'}},take:2});
});
test('self inbox without other authors has no audit; bot target reads do',async()=>{
 await GET(req(),ctx());expect(m.db.apiAuditLog.create).not.toHaveBeenCalled();await GET(req('GET',undefined,'',true),ctx('4'));expect(m.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([4]);
});
test.each(['?type=bad','?unread=1','?offset=1','?limit=2&limit=3','?cursor=-1'])('rejects invalid query %s',async query=>expect((await GET(req('GET',undefined,query),ctx())).status).toBe(400));
test('mark one and all read are audited mutations; no-op does not add audit',async()=>{
 expect((await mark(req('PATCH',{isRead:true}),ctx())).status).toBe(200);expect(m.db.messageRecipient.updateMany.mock.lastCall![0].where).toEqual({id:9,userId:4,isRead:false});
 expect((await PATCH(req('PATCH',{isRead:true}),ctx())).status).toBe(200);expect(m.db.messageRecipient.updateMany.mock.lastCall![0].where).toEqual({userId:4,isRead:false});expect(m.db.apiAuditLog.create).toHaveBeenCalledTimes(2);
 m.db.messageRecipient.updateMany.mockResolvedValue({count:0});expect((await PATCH(req('PATCH',{isRead:true}),ctx())).status).toBe(200);expect(m.db.apiAuditLog.create).toHaveBeenCalledTimes(2);
});
test('strict read mutations and ownership',async()=>{
 expect((await PATCH(req('PATCH',{}),ctx())).status).toBe(422);expect((await PATCH(req('PATCH',{isRead:false}),ctx())).status).toBe(422);expect((await PATCH(req('PATCH',{isRead:true},'?x=1'),ctx())).status).toBe(400);
 m.db.messageRecipient.findFirst.mockResolvedValue(null);expect((await mark(req('PATCH',{isRead:true}),ctx())).status).toBe(404);
 expect((await mark(req('PATCH',{isRead:true}),ctx('me','2147483648'))).status).toBe(400);
});
test('live authorization prevents ordinary users accessing other inboxes or sending; invalid bot never falls back',async()=>{
 m.db.user.findUnique.mockImplementation(async a=>a.select.userPermissions?{userPermissions:[]}:{id:4});expect((await GET(req(),ctx('5'))).status).toBe(403);expect((await POST(req('POST',payload))).status).toBe(403);expect((await GET(req(),ctx())).status).toBe(200);
 m.db.botToken.findFirst.mockResolvedValue(null);expect((await GET(req('GET',undefined,'',true),ctx('4'))).status).toBe(401);m.session.mockResolvedValue(null);expect((await GET(req(),ctx())).status).toBe(401);
});
test('audit failures fail closed, serializable conflicts409, notifications cannot undo successful writes',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});m.db.apiAuditLog.create.mockRejectedValue(new Error('audit'));expect((await POST(req('POST',payload))).status).toBe(500);expect(m.publish).not.toHaveBeenCalled();expect((await GET(req(),ctx('5'))).status).toBe(500);expect((await PATCH(req('PATCH',{isRead:true}),ctx())).status).toBe(500);
 m.db.apiAuditLog.create.mockResolvedValue({});m.publish.mockImplementation(()=>{throw Error('listener')});expect((await POST(req('POST',payload))).status).toBe(201);
 m.db.$transaction.mockRejectedValue({code:'P2034'});expect((await POST(req('POST',payload))).status).toBe(409);expect((await PATCH(req('PATCH',{isRead:true}),ctx())).status).toBe(409);log.mockRestore();
});

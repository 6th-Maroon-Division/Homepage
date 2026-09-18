import {beforeEach,afterEach,expect,test,vi} from 'vitest';
const m=vi.hoisted(()=>({session:vi.fn(),db:{user:{findUnique:vi.fn()},userPermission:{findMany:vi.fn()},botToken:{findFirst:vi.fn(),update:vi.fn()},apiAuditLog:{create:vi.fn()},orbat:{findUnique:vi.fn()},trainingRequest:{findUnique:vi.fn()}}}));
vi.mock('@/lib/prisma',()=>({prisma:m.db}));vi.mock('next-auth',()=>({getServerSession:m.session}));vi.mock('@/app/api/auth/[...nextauth]/route',()=>({authOptions:{}}));
import {GET as publicAll} from '@/app/api/orbats/events/route';import {GET as publicOne} from '@/app/api/orbats/[id]/events/route';
import {GET as user} from '@/app/api/users/[id]/events/route';import {GET as users} from '@/app/api/users/events/route';import {GET as inbox} from '@/app/api/users/[id]/messages/events/route';import {GET as catalog} from '@/app/api/catalog/events/route';import {GET as promotions} from '@/app/api/ranks/promotions/events/route';import {GET as training} from '@/app/api/training-requests/[id]/events/route';
import {eventStream} from '@/lib/api/event-stream';
import {publishOrbatEvent} from '@/lib/realtime/orbat-events';import {publishUserProfileEvent} from '@/lib/realtime/user-events';import {publishInboxEvent} from '@/lib/realtime/inbox-events';import {publishTrainingChatEvent} from '@/lib/realtime/training-chat-events';import {publishAdminCatalogEvent} from '@/lib/realtime/admin-catalog-events';import {publishPromotionEvent} from '@/lib/realtime/promotion-events';
const req=(query='',token?:string,signal?:AbortSignal)=>new Request('http://localhost/api/events'+query,{headers:token?{authorization:token}:{},signal});const ctx=(id='me')=>({params:Promise.resolve({id})});
const consume=async(response:Response)=>{expect(response.status).toBe(200);const reader=response.body!.getReader();await reader.read();await reader.read();return reader};
const text=async(reader:ReadableStreamDefaultReader<Uint8Array>)=>new TextDecoder().decode((await reader.read()).value);
let grants:Record<string,number>;
beforeEach(()=>{vi.resetAllMocks();grants={'system:super_admin':255};m.session.mockResolvedValue({user:{id:4}});m.db.user.findUnique.mockImplementation(async a=>a.select.userPermissions?{userPermissions:Object.entries(grants).map(([key,value])=>({permission:{key},value}))}:{id:4});m.db.userPermission.findMany.mockResolvedValue([]);m.db.botToken.findFirst.mockResolvedValue({id:9});m.db.orbat.findUnique.mockResolvedValue({id:1});m.db.trainingRequest.findUnique.mockResolvedValue({userId:5})});
afterEach(()=>vi.useRealTimers());
test('public streams support anonymous viewers, exclude staff/actor/user payloads and retain calendar fields',async()=>{
 m.session.mockResolvedValue(null);const reader=await consume(await publicAll(req()));publishOrbatEvent({type:'orbat.created',orbatId:1,actorUserId:99,payload:{id:1,name:'Public',description:'Operation',userId:88,token:'secret'}});
 const event=await text(reader);expect(event).toContain('Public');expect(event).not.toContain('99');expect(event).not.toContain('88');expect(event).not.toContain('secret');expect(m.db.apiAuditLog.create).not.toHaveBeenCalled();await reader.cancel();
});
test('scoped operation validation and explicit invalid token reject',async()=>{
 expect((await publicOne(req(),ctx('1junk'))).status).toBe(400);m.db.orbat.findUnique.mockResolvedValue(null);expect((await publicOne(req(),ctx('1'))).status).toBe(404);m.db.botToken.findFirst.mockResolvedValue(null);expect((await publicAll(req('','Bearer bad'))).status).toBe(401);expect((await publicAll(req('?x=1'))).status).toBe(400);
});
test('every protected route accepts bot principal and rejects unauthenticated or invalid alias',async()=>{
 for(const [handler,context] of [[user,ctx('5')],[inbox,ctx('5')],[training,ctx('7')]] as const){const reader=await consume(await handler(req('','Bearer valid'),context));await reader.cancel();expect((await handler(req('','Bearer valid'),ctx())).status).toBe(400)}
 for(const handler of [users,catalog,promotions]){const reader=await consume(await handler(req('','Bearer valid')));await reader.cancel()}
 m.session.mockResolvedValue(null);for(const handler of [users,catalog,promotions])expect((await handler(req())).status).toBe(401);
});
test('self streams redact arbitrary payloads and skip audit, staff other-user streams audit actual delivered targets',async()=>{
 const own=await consume(await user(req(),ctx()));publishUserProfileEvent(4,{secret:'private'});expect(await text(own)).not.toContain('private');expect(m.db.apiAuditLog.create).not.toHaveBeenCalled();await own.cancel();
 const other=await consume(await user(req(),ctx('5')));publishUserProfileEvent(5,{secret:'private'});expect(await text(other)).toContain('"userId":5');expect(m.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]);await other.cancel();
});
test('broadcast hierarchy filters peer changes before returning user IDs',async()=>{
 grants={'user:manage':10};m.db.userPermission.findMany.mockImplementation(async a=>a.where.userId===6?[{permission:{key:'user:manage'},value:10}]:[]);
 const reader=await consume(await users(req()));publishUserProfileEvent(6);publishUserProfileEvent(5);const event=await text(reader);expect(event).toContain('"userId":5');expect(event).not.toContain('"userId":6');await reader.cancel();
});
test('inbox/training scopes redact sender metadata and audit owners only',async()=>{
 const a=await consume(await inbox(req(),ctx('5')));publishInboxEvent(5,{body:'secret'});expect(await text(a)).not.toContain('secret');await a.cancel();
 const b=await consume(await training(req(),ctx('7')));publishTrainingChatEvent(7,{senderId:99,body:'secret'});const event=await text(b);expect(event).toContain('"requestId":7');expect(event).not.toContain('senderId');expect(m.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]);await b.cancel();
});
test('catalog and promotion streams deliver metadata only, with catalog-specific grants',async()=>{
 grants={'template:edit':5};const a=await consume(await catalog(req()));publishAdminCatalogEvent({type:'orbat.changed',actorUserId:55});publishAdminCatalogEvent({type:'template.changed',actorUserId:66,payload:{secret:true}});const event=await text(a);expect(event).toContain('template.changed');expect(event).not.toContain('actorUserId');await a.cancel();
 grants={'rank:manage_promotions':5};const b=await consume(await promotions(req()));publishPromotionEvent({userId:99});expect(await text(b)).not.toContain('userId');await b.cancel();expect(m.db.apiAuditLog.create).not.toHaveBeenCalled();
});
test('revocation closes private stream before delivering queued event; heartbeat detects permission loss',async()=>{
 const a=await consume(await inbox(req('','Bearer valid'),ctx('5')));m.db.botToken.findFirst.mockResolvedValue(null);publishInboxEvent(5);expect((await a.read()).done).toBe(true);
 vi.useFakeTimers();const b=await consume(await users(req()));grants={};await vi.advanceTimersByTimeAsync(15000);expect((await b.read()).done).toBe(true);expect(m.db.apiAuditLog.create.mock.lastCall![0].data.outcome).toBe('denied');
});
test('required stream read audit failure closes without returning personal event',async()=>{
 const reader=await consume(await user(req(),ctx('5')));m.db.apiAuditLog.create.mockRejectedValue(new Error('audit'));publishUserProfileEvent(5);expect((await reader.read()).done).toBe(true);
});
test('missing rights, invalid query, and missing targets do not open protected streams',async()=>{
 grants={};for(const handler of [users,catalog,promotions])expect((await handler(req())).status).toBe(403);expect((await user(req(),ctx('5'))).status).toBe(403);expect((await inbox(req(),ctx('5'))).status).toBe(403);expect((await training(req(),ctx('7'))).status).toBe(403);expect((await user(req('?x=1'),ctx())).status).toBe(400);m.db.trainingRequest.findUnique.mockResolvedValue(null);expect((await training(req(),ctx('7'))).status).toBe(403);
});
test('transport cleanup handles abort, cancel, already-aborted request, heartbeat and subscription failure',async()=>{
 vi.useFakeTimers();const stop=vi.fn(),project=vi.fn(async()=>null),validate=vi.fn(async()=>true);const abort=new AbortController();const reader=await consume(eventStream(req('',undefined,abort.signal),{subscribe:()=>stop,project,validate}));await vi.advanceTimersByTimeAsync(15000);expect(await text(reader)).toContain('ping');abort.abort();expect(stop).toHaveBeenCalledTimes(1);expect((await reader.read()).done).toBe(true);
 const cancelled=await consume(eventStream(req(),{subscribe:()=>stop,project,validate}));await cancelled.cancel();expect(stop).toHaveBeenCalledTimes(2);
 const already=eventStream(req('',undefined,abort.signal),{subscribe:()=>stop,project,validate});expect((await already.body!.getReader().read()).done).toBe(true);
 const failing=await consume(eventStream(req(),{subscribe:()=>{throw Error('subscribe')},project,validate}));expect((await failing.read()).done).toBe(true);
});
test('transport bounds pending callbacks and closes if validation throws',async()=>{
 let push:(event:number)=>void=()=>{};const stop=vi.fn();const reader=await consume(eventStream<number>(req(),{subscribe:listener=>{push=listener;return stop},project:async()=>null,validate:async()=>{throw Error('db')}}));push(1);expect((await reader.read()).done).toBe(true);expect(stop).toHaveBeenCalled();
 const bounded=await consume(eventStream<number>(req(),{subscribe:listener=>{push=listener;return stop},project:async()=>null,validate:async()=>true}));for(let i=0;i<101;i++)push(i);expect((await bounded.read()).done).toBe(true);
});

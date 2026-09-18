import {afterAll,beforeAll,expect,test,vi} from 'vitest';
const session=vi.hoisted(()=>({id:null as number|null}));vi.mock('next-auth',()=>({getServerSession:async()=>session.id===null?null:{user:{id:session.id}}}));vi.mock('@/app/api/auth/[...nextauth]/route',()=>({authOptions:{}}));
import {prisma} from '@/lib/prisma';import {GET as user} from '@/app/api/users/[id]/events/route';import {GET as inbox} from '@/app/api/users/[id]/messages/events/route';import {GET as publicAll} from '@/app/api/orbats/events/route';
import {publishUserProfileEvent} from '@/lib/realtime/user-events';import {publishInboxEvent} from '@/lib/realtime/inbox-events';import {publishOrbatEvent} from '@/lib/realtime/orbat-events';
let actor:number,target:number,permissionId:number;
const ctx=(id:number|string)=>({params:Promise.resolve({id:String(id)})});const req=(bot=false)=>new Request('http://localhost/api/events',{headers:bot?{authorization:'Bearer realtime-integration'}:{}});
const consume=async(response:Response)=>{expect(response.status).toBe(200);expect(response.headers.get('X-Request-Id')).toBeTruthy();const reader=response.body!.getReader();await reader.read();await reader.read();return reader};
beforeAll(async()=>{permissionId=(await prisma.permission.upsert({where:{key:'user:manage'},update:{},create:{key:'user:manage'}})).id;actor=(await prisma.user.create({data:{username:'Stream actor',userPermissions:{create:{permissionId,value:10}}}})).id;target=(await prisma.user.create({data:{username:'Stream target'}})).id;await prisma.botToken.create({data:{name:'Stream integration',token:'realtime-integration'}})});
afterAll(async()=>{await prisma.$disconnect()});
test('actual live permission removal closes stream before another profile event',async()=>{
 session.id=actor;const response=await user(req(),ctx(target));const reader=await consume(response);publishUserProfileEvent(target,{private:'hidden'});const first=new TextDecoder().decode((await reader.read()).value);expect(first).toContain('"data":');expect(first).not.toContain('hidden');
 const audit=await prisma.apiAuditLog.findFirstOrThrow({where:{correlationId:response.headers.get('X-Request-Id')!,action:'user_data.read'}});expect(audit.targetUserIds).toEqual([target]);
 await prisma.userPermission.delete({where:{userId_permissionId:{userId:actor,permissionId}}});publishUserProfileEvent(target);expect((await reader.read()).done).toBe(true);
});
test('bot inbox stream audits real target and stops after token revocation',async()=>{
 session.id=null;const response=await inbox(req(true),ctx(target));const reader=await consume(response);publishInboxEvent(target,{messageBody:'hidden'});expect(new TextDecoder().decode((await reader.read()).value)).not.toContain('hidden');expect(await prisma.apiAuditLog.findFirstOrThrow({where:{correlationId:response.headers.get('X-Request-Id')!,action:'user_data.read'}})).toMatchObject({actorType:'bot',targetUserIds:[target]});
 await prisma.botToken.update({where:{token:'realtime-integration'},data:{isActive:false}});publishInboxEvent(target);expect((await reader.read()).done).toBe(true);
});
test('anonymous public stream preserves calendar metadata without personal read audit',async()=>{
 session.id=null;const response=await publicAll(req());const reader=await consume(response);publishOrbatEvent({type:'orbat.created',orbatId:123,actorUserId:actor,payload:{id:123,name:'Public operation',userId:target}});const event=new TextDecoder().decode((await reader.read()).value);expect(event).toContain('Public operation');expect(event).not.toContain('userId');expect(await prisma.apiAuditLog.count({where:{correlationId:response.headers.get('X-Request-Id')!}})).toBe(0);await reader.cancel();
});

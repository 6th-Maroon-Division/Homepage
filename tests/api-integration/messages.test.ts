import {afterAll,beforeAll,expect,test,vi} from 'vitest';
import type {Prisma} from '@/generated/prisma/client';
const session=vi.hoisted(()=>({id:null as number|null}));vi.mock('next-auth',()=>({getServerSession:async()=>session.id===null?null:{user:{id:session.id}}}));vi.mock('@/app/api/auth/[...nextauth]/route',()=>({authOptions:{}}));
import {prisma} from '@/lib/prisma';import {POST} from '@/app/api/messages/route';import {GET,PATCH} from '@/app/api/users/[id]/messages/route';import {PATCH as mark} from '@/app/api/users/[id]/messages/[recipientId]/route';
let admin:number,member:number,other:number;const ctx=(id:number|string,recipientId=1)=>({params:Promise.resolve({id:String(id),recipientId:String(recipientId)})});
const req=(method='GET',body?:unknown,query='',bot=false)=>new Request('http://localhost/api/users/me/messages'+query,{method,headers:bot?{authorization:'Bearer messaging-integration'}:{},...(body===undefined?{}:{body:JSON.stringify(body)})});
const body=()=>({title:'Inbox integration',body:'Private text',audience:{type:'users',userIds:[member,other]}});
beforeAll(async()=>{const p=await prisma.permission.upsert({where:{key:'system:super_admin'},update:{},create:{key:'system:super_admin'}});admin=(await prisma.user.create({data:{username:'Messaging admin',userPermissions:{create:{permissionId:p.id,value:255}}}})).id;member=(await prisma.user.create({data:{username:'Messaging member'}})).id;other=(await prisma.user.create({data:{username:'Messaging other'}})).id;await prisma.botToken.create({data:{name:'Messaging integration',token:'messaging-integration'}})});
afterAll(async()=>{await prisma.$disconnect()});
test('admin and bot sends create actual recipients with minimal auditable metadata',async()=>{
 session.id=admin;const response=await POST(req('POST',body()));expect(response.status).toBe(201);const data=(await response.json()).data;expect(await prisma.messageRecipient.count({where:{messageId:data.id}})).toBe(2);
 const audit=await prisma.apiAuditLog.findFirstOrThrow({where:{correlationId:response.headers.get('X-Request-Id')!}});expect(audit).toMatchObject({targetUserIds:[member,other],after:{type:'general',recipientCount:2}});expect(JSON.stringify(audit)).not.toContain('Private text');
 const bot=await POST(req('POST',body(),'',true));expect(bot.status).toBe(201);expect((await prisma.message.findUniqueOrThrow({where:{id:(await bot.json()).data.id}})).createdById).toBeNull();
});
test('inbox ownership, author read auditing and genuine cursor pages',async()=>{
 session.id=member;expect((await GET(req(),ctx(other))).status).toBe(403);expect((await POST(req('POST',body()))).status).toBe(403);
 const first=await GET(req('GET',undefined,'?limit=1'),ctx('me'));const page=await first.json();expect(page.data).toHaveLength(1);expect(page.meta.nextCursor).not.toBeNull();expect(page.meta.unreadCount).toBe(2);
 const second=await GET(req('GET',undefined,'?limit=1&cursor='+page.meta.nextCursor),ctx('me'));const page2=await second.json();expect(page2.meta.nextCursor).toBeNull();expect(page2.data[0].id).not.toBe(page.data[0].id);
 const audit=await prisma.apiAuditLog.findFirstOrThrow({where:{correlationId:second.headers.get('X-Request-Id')!}});expect(audit.targetUserIds).toEqual([admin]);expect(audit.before).toBeNull();
});
test('read-state mutations respect recipient ownership and count actual changes',async()=>{
 session.id=member;const recipient=await prisma.messageRecipient.findFirstOrThrow({where:{userId:member}}),alien=await prisma.messageRecipient.findFirstOrThrow({where:{userId:other}});
 expect((await mark(req('PATCH',{isRead:true}),ctx('me',alien.id))).status).toBe(404);
 const response=await mark(req('PATCH',{isRead:true}),ctx('me',recipient.id));expect((await response.json()).data.updatedCount).toBe(1);expect((await prisma.messageRecipient.findUniqueOrThrow({where:{id:recipient.id}})).readAt).toBeInstanceOf(Date);
 expect((await (await PATCH(req('PATCH',{isRead:true}),ctx('me'))).json()).data.updatedCount).toBe(1);
 expect((await (await PATCH(req('PATCH',{isRead:true}),ctx('me'))).json()).data.updatedCount).toBe(0);
});
test('audit failure rolls back message delivery and read states',async()=>{
 session.id=admin;const before=await prisma.message.count();const transact=prisma.$transaction.bind(prisma);
 const spy=vi.spyOn(prisma,'$transaction').mockImplementation(((operation:(tx:Prisma.TransactionClient)=>Promise<unknown>,options?:{isolationLevel?:Prisma.TransactionIsolationLevel})=>transact(async tx=>{const fail=vi.spyOn(tx.apiAuditLog,'create').mockRejectedValue(new Error('audit'));try{return await operation(tx)}finally{fail.mockRestore()}},options)) as typeof prisma.$transaction);const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{expect((await POST(req('POST',body()))).status).toBe(500);expect((await PATCH(req('PATCH',{isRead:true}),ctx(other))).status).toBe(500)}finally{spy.mockRestore();log.mockRestore()}
 expect(await prisma.message.count()).toBe(before);expect(await prisma.messageRecipient.count({where:{userId:other,isRead:false}})).toBe(2);
});
test('revoked token rejects explicit authorization despite valid session',async()=>{session.id=admin;await prisma.botToken.update({where:{token:'messaging-integration'},data:{isActive:false}});expect((await GET(req('GET',undefined,'',true),ctx(member))).status).toBe(401)});

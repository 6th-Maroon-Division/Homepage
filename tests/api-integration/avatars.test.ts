import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const m=vi.hoisted(()=>({id:null as number|null,files:{mkdir:vi.fn(),writeFile:vi.fn(),unlink:vi.fn()},fetch:vi.fn()}));
vi.mock('next-auth',()=>({getServerSession:async()=>m.id===null?null:{user:{id:m.id}}}));vi.mock('@/app/api/auth/[...nextauth]/route',()=>({authOptions:{}}));
vi.mock('node:fs/promises',()=>({default:m.files}));
import {prisma} from '@/lib/prisma';
import {POST as upload} from '@/app/api/users/[id]/avatar/route';import {POST as refresh} from '@/app/api/users/[id]/avatar/refresh/route';import {POST as migrate} from '@/app/api/users/[id]/avatar/migrate/route';
let actor:number,target:number,peer:number;const png=Buffer.from([137,80,78,71,13,10,26,10]);
const ctx=(id:number|string)=>({params:Promise.resolve({id:String(id)})});
const req=(body:unknown={},bot=false)=>new Request('http://localhost/api/users/me/avatar',{method:'POST',headers:bot?{authorization:'Bearer avatar-integration'}:{},body:body instanceof FormData?body:JSON.stringify(body)});
const form=()=>{const value=new FormData();value.append('file',new Blob([png],{type:'image/png'}),'unsafe.svg');return value;};
beforeAll(async()=>{
 const p=await prisma.permission.upsert({where:{key:'user:manage'},update:{},create:{key:'user:manage'}});
 actor=(await prisma.user.create({data:{username:'Avatar actor',userPermissions:{create:{permissionId:p.id,value:10}}}})).id;
 peer=(await prisma.user.create({data:{username:'Avatar peer',userPermissions:{create:{permissionId:p.id,value:10}}}})).id;
 target=(await prisma.user.create({data:{username:'Avatar target',avatarUrl:'/before.png',accounts:{create:{provider:'discord',providerUserId:'99881234567890123'}}}})).id;
 await prisma.botToken.create({data:{name:'Avatar integration',token:'avatar-integration'}});m.files.unlink.mockResolvedValue(undefined);vi.stubGlobal('fetch',m.fetch);vi.stubEnv('DISCORD_BOT_TOKEN','test-secret');
});
afterAll(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();await prisma.$disconnect()});
test('self upload and bot migration persist safe filenames and redacted atomic audits',async()=>{
 m.id=target;const own=await upload(req(form()),ctx('me'));expect(own.status).toBe(200);const data=(await own.json()).data;expect(data.avatarUrl).toMatch(/\.png$/);
 expect((await prisma.user.findUniqueOrThrow({where:{id:target}})).avatarUrl).toBe(data.avatarUrl);
 expect(await prisma.apiAuditLog.findFirstOrThrow({where:{correlationId:own.headers.get('X-Request-Id')!}})).toMatchObject({targetUserIds:[target],after:{changed:true}});
 await prisma.user.update({where:{id:target},data:{avatarUrl:'data:image/png;base64,'+png.toString('base64')}});
 const bot=await migrate(req({},true),ctx(target));expect(bot.status).toBe(200);expect(await prisma.apiAuditLog.findFirstOrThrow({where:{correlationId:bot.headers.get('X-Request-Id')!}})).toMatchObject({actorType:'bot',targetUserIds:[target]});
});
test('provider refresh checks actual linked account and no-op reads audit only other users',async()=>{
 m.id=actor;m.fetch.mockResolvedValueOnce(Response.json({id:'99881234567890123',avatar:'abcdef'}));const refreshed=await refresh(req({provider:'discord'}),ctx(target));expect(refreshed.status).toBe(200);
 expect((await prisma.user.findUniqueOrThrow({where:{id:target}})).avatarUrl).toContain('/99881234567890123/abcdef.png');
 const other=await migrate(req(),ctx(target));expect((await other.json()).data.changed).toBe(false);expect(await prisma.apiAuditLog.count({where:{correlationId:other.headers.get('X-Request-Id')!,action:'user_data.read'}})).toBe(1);
 m.id=target;const self=await migrate(req(),ctx('me'));expect(await prisma.apiAuditLog.count({where:{correlationId:self.headers.get('X-Request-Id')!}})).toBe(0);
});
test('hierarchy and revoked tokens deny before IO or writes',async()=>{
 m.id=actor;const before=m.files.writeFile.mock.calls.length;expect((await upload(req(form()),ctx(peer))).status).toBe(403);expect(m.files.writeFile.mock.calls.length).toBe(before);
 await prisma.botToken.update({where:{token:'avatar-integration'},data:{isActive:false}});expect((await migrate(req({},true),ctx(target))).status).toBe(401);
});
test('audit failure rolls back database update and removes staged avatar file',async()=>{
 m.id=target;const before=await prisma.user.findUniqueOrThrow({where:{id:target}});const transact=prisma.$transaction.bind(prisma);
 const spy=vi.spyOn(prisma,'$transaction').mockImplementation(((operation:(tx:Prisma.TransactionClient)=>Promise<unknown>,options?:{isolationLevel?:Prisma.TransactionIsolationLevel})=>transact(async tx=>{
  const fail=vi.spyOn(tx.apiAuditLog,'create').mockRejectedValue(new Error('audit unavailable'));try{return await operation(tx)}finally{fail.mockRestore()}
 },options)) as typeof prisma.$transaction);const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{expect((await upload(req(form()),ctx('me'))).status).toBe(500)}finally{spy.mockRestore();log.mockRestore()}
 expect(await prisma.user.findUniqueOrThrow({where:{id:target}})).toEqual(before);expect(m.files.unlink).toHaveBeenCalled();
});

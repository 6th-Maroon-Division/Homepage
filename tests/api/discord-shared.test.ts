import { expect, test, vi } from 'vitest';
const principal={kind:'user' as const,userId:1,permissions:{}};
vi.mock('@/lib/prisma',()=>({prisma:{}}));
vi.mock('@/lib/api/handler',()=>({handleApiRequest:async(request:Request,_permission:unknown,handler:(p:unknown,c:unknown)=>Promise<Response>)=>handler(principal,{principal,correlationId:'shared',method:request.method,path:'/test'})}));
import { anyDiscord, body, discordApi, DiscordError, id, instant, pagination, pageResult } from '@/lib/api/discord/shared';
const req=(path='',value='{}')=>new Request(`http://localhost/test${path}`,{method:'POST',body:value});

test('malformed, oversized and unknown bodies reject before domain writes',async()=>{
  await expect(body(req('','{'),[])).rejects.toMatchObject({status:400});
  await expect(body(req('','{}'),[],1)).rejects.toMatchObject({status:413});
  await expect(body(req('',JSON.stringify({extra:true})),[])).rejects.toMatchObject({status:422});
  expect(await body(req(),[])).toEqual({});
});
test('IDs, timestamps and pagination reject ambiguous input',()=>{
  for(const value of ['0','-1','2147483648','no'])expect(()=>id(value)).toThrow();
  for(const value of [null,'2026-01-01','2026-99-01T00:00:00Z'])expect(()=>instant(value)).toThrow();
  expect(instant('2026-09-20T00:00:00+02:00').toISOString()).toBe('2026-09-19T22:00:00.000Z');
  expect(()=>pagination(req('?limit=0'))).toThrow();
  expect(pageResult([{id:3},{id:2}],1)).toEqual({data:[{id:3}],meta:{limit:1,nextCursor:'3'}});
  expect(()=>anyDiscord({kind:'user',userId:1,permissions:{'discord:view':undefined}})).toThrow();
});
test('API wrapper classifies domain and database conflicts but does not disguise programming failures',async()=>{
  expect((await discordApi(req(),undefined,async()=>{throw new DiscordError(400,'invalid');})).status).toBe(400);
  expect((await discordApi(req(),undefined,async()=>{throw {code:'P2034'};})).status).toBe(409);
  const error=new Error('unexpected');
  await expect(discordApi(req(),undefined,async()=>{throw error;})).rejects.toBe(error);
  const success=await discordApi(req(),undefined,async()=>new Response('ok'));
  expect(success.headers.get('Cache-Control')).toBe('private, no-store');
});

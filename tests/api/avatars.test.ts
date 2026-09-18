import { beforeEach, expect, test, vi } from 'vitest';
const m = vi.hoisted(() => { const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() }); return { session: vi.fn(), fetch: vi.fn(), publish: vi.fn(), fs: { mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() }, db: { user: model(), authAccount: model(), userPermission: model(), botToken: model(), apiAuditLog: model(), $transaction: vi.fn() } }; });
vi.mock('@/lib/prisma', () => ({ prisma: m.db })); vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: m.publish })); vi.mock('node:fs/promises', () => ({ default: m.fs }));
import { POST as upload } from '@/app/api/users/[id]/avatar/route';
import { POST as refresh } from '@/app/api/users/[id]/avatar/refresh/route';
import { POST as migrate } from '@/app/api/users/[id]/avatar/migrate/route';
import { avatarExtension } from '@/lib/api/avatars';
const png = Buffer.from([137,80,78,71,13,10,26,10]);
const ctx = (id='me') => ({ params: Promise.resolve({ id }) });
const request = (body: unknown = {}, token?: string) => new Request('http://localhost/api/users/me/avatar', { method: 'POST', headers: token ? { authorization: token } : {}, body: body instanceof FormData ? body : JSON.stringify(body) });
const form = (bytes: Uint8Array = png, mime='image/png', name='malicious.html') => { const value = new FormData(); value.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name); return value; };
let stored: string | null;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('fetch',m.fetch); vi.stubEnv('STEAM_API_KEY','secret'); vi.stubEnv('DISCORD_BOT_TOKEN','secret'); stored='/old.png';
  m.session.mockResolvedValue({user:{id:4}});m.db.user.findUnique.mockImplementation(async args=>args.select.userPermissions?{userPermissions:[{permission:{key:'user:manage'},value:10}]}:{avatarUrl:stored});
  m.db.userPermission.findMany.mockResolvedValue([]);m.db.botToken.findFirst.mockResolvedValue({id:9});m.db.user.updateMany.mockResolvedValue({count:1});m.db.$transaction.mockImplementation(async cb=>cb(m.db));m.fs.unlink.mockResolvedValue(undefined);
  m.db.authAccount.findFirst.mockResolvedValue({id:1,providerUserId:'123456789'});
});
test('upload derives safe extension from validated bytes, audits IDs only, publishes after commit',async()=>{
  const response=await upload(request(form()),ctx());expect(response.status).toBe(200);expect((await response.json()).data).toMatchObject({changed:true,avatarUrl:expect.stringMatching(/\.png$/)});
  expect(m.fs.writeFile.mock.lastCall![0]).toMatch(/\.png$/);expect(m.db.$transaction.mock.lastCall![1]).toEqual({isolationLevel:'Serializable'});
  expect(m.db.apiAuditLog.create.mock.lastCall![0].data).toMatchObject({targetUserIds:[4],after:{changed:true}});expect(m.publish).toHaveBeenCalled();expect(m.fs.unlink).not.toHaveBeenCalled();
});
test.each([['image/jpeg',Buffer.from([255,216,255]),'jpg'],['image/gif',Buffer.from('GIF87a'),'gif'],['image/gif',Buffer.from('GIF89a'),'gif'],['image/webp',Buffer.from('RIFF0000WEBP'),'webp']])('supports %s signatures',(_mime,bytes,extension)=>expect(avatarExtension(bytes,_mime)).toBe(extension));
test.each([Buffer.alloc(0),Buffer.from('not image'),Buffer.alloc(2097153)])('invalid or oversized content rejected',async bytes=>{expect((await upload(request(form(bytes)),ctx())).status).toBe(422);expect(m.db.user.updateMany).not.toHaveBeenCalled()});
test('rejects spoofed MIME, extra/repeated multipart fields and malformed multipart',async()=>{
 expect((await upload(request(form(png,'image/svg+xml')),ctx())).status).toBe(422);
 const extra=form();extra.append('x','1');expect((await upload(request(extra),ctx())).status).toBe(422);
 const duplicate=form();duplicate.append('file','bad');expect((await upload(request(duplicate),ctx())).status).toBe(422);
 expect((await upload(request(),ctx())).status).toBe(400);
});
test('live auth, strict identifiers and hierarchy enforce each endpoint',async()=>{
 for(const handler of [upload,refresh,migrate]) {
  expect((await handler(request({},'Bearer valid'),ctx())).status).toBe(400);
  expect((await handler(request(),ctx('2147483648'))).status).toBe(400);
 }
 m.db.userPermission.findMany.mockResolvedValue([{permission:{key:'user:manage'},value:10}]);expect((await migrate(request(),ctx('5'))).status).toBe(403);
 m.session.mockResolvedValue(null);expect((await migrate(request(),ctx('4'))).status).toBe(401);
 m.db.botToken.findFirst.mockResolvedValue(null);expect((await migrate(request({},'Bearer bad'),ctx('4'))).status).toBe(401);
});
test('migration validates empty body, audits only other-user no-op reads and converts data URLs',async()=>{
 expect((await migrate(request({legacy:true}),ctx())).status).toBe(422);expect((await migrate(request(),ctx())).status).toBe(200);expect(m.db.apiAuditLog.create).not.toHaveBeenCalled();
 expect((await migrate(request({},'Bearer good'),ctx('4'))).status).toBe(200);expect(m.db.apiAuditLog.create.mock.lastCall![0].data.action).toBe('user_data.read');
 stored='data:image/png;base64,'+png.toString('base64');expect((await migrate(request(),ctx())).status).toBe(200);expect(m.fs.writeFile).toHaveBeenCalled();
 stored='data:image/svg+xml;base64,PHN2Zz4=';expect((await migrate(request(),ctx())).status).toBe(422);
 stored='data:image/png;base64,YQ==';expect((await migrate(request(),ctx())).status).toBe(422);
});
test('failed audit rolls back and removes staged file; conflict also cleans up',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});m.db.apiAuditLog.create.mockRejectedValue(new Error('audit'));
 expect((await upload(request(form()),ctx())).status).toBe(500);expect(m.fs.unlink).toHaveBeenCalledTimes(1);
 m.db.apiAuditLog.create.mockResolvedValue({});m.db.user.updateMany.mockResolvedValue({count:0});expect((await upload(request(form()),ctx())).status).toBe(409);expect(m.fs.unlink).toHaveBeenCalledTimes(2);log.mockRestore();
});
test('Steam refresh validates linked identity, provider response and stale account',async()=>{
 m.fetch.mockResolvedValue(Response.json({response:{players:[{steamid:'123456789',avatarfull:'https://avatars.steamstatic.com/a.jpg'}]}}));
 const result=await refresh(request({provider:'steam'}),ctx());expect(result.status).toBe(200);expect(m.fetch.mock.lastCall![1]).toMatchObject({redirect:'error'});
 m.db.authAccount.findFirst.mockResolvedValueOnce({id:1,providerUserId:'123456789'}).mockResolvedValueOnce(null);
 m.fetch.mockResolvedValue(Response.json({response:{players:[{steamid:'123456789',avatarfull:'https://avatars.steamstatic.com/a.jpg'}]}}));expect((await refresh(request({provider:'steam'}),ctx())).status).toBe(409);
});
test.each([['a_abcdef','.gif?size=256'],['abcdef','.png?size=256'],[null,'/embed/avatars/5.png']])('Discord refresh handles animated/default avatars %s',async(avatar,suffix)=>{
 m.fetch.mockResolvedValue(Response.json({id:'123456789',avatar}));const response=await refresh(request({provider:'discord'}),ctx());expect(response.status).toBe(200);expect((await response.json()).data.avatarUrl).toContain(suffix);
});
test('provider validation errors have canonical responses without secret leaks',async()=>{
 expect((await refresh(request({provider:'other'}),ctx())).status).toBe(422);
 m.db.authAccount.findFirst.mockResolvedValueOnce(null);expect((await refresh(request({provider:'steam'}),ctx())).status).toBe(404);
 vi.stubEnv('STEAM_API_KEY','');expect((await refresh(request({provider:'steam'}),ctx())).status).toBe(503);vi.stubEnv('STEAM_API_KEY','secret');
 m.fetch.mockRejectedValueOnce(new Error('secret'));const failed=await refresh(request({provider:'steam'}),ctx());expect(failed.status).toBe(502);expect(JSON.stringify(await failed.json())).not.toContain('secret');
 m.fetch.mockResolvedValueOnce(new Response('',{status:503}));expect((await refresh(request({provider:'steam'}),ctx())).status).toBe(502);
 m.fetch.mockResolvedValueOnce(new Response('bad'));expect((await refresh(request({provider:'steam'}),ctx())).status).toBe(502);
 m.fetch.mockResolvedValueOnce(Response.json({response:{players:[]}}));expect((await refresh(request({provider:'steam'}),ctx())).status).toBe(404);
 m.fetch.mockResolvedValueOnce(Response.json({id:'wrong'}));expect((await refresh(request({provider:'discord'}),ctx())).status).toBe(502);
 m.fetch.mockResolvedValueOnce(Response.json({response:{players:[{steamid:'123456789',avatarfull:'javascript:bad'}]}}));expect((await refresh(request({provider:'steam'}),ctx())).status).toBe(502);
});

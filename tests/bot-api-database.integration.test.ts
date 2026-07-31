import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.BOT_API_TEST_DATABASE_URL;

test('database bot authentication and shared availability notes', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl!;
  const [{ prisma }, { GET, PUT }] = await Promise.all([
    import('../lib/prisma'),
    import('../app/api/bot/orbats/[id]/availability/[discordId]/route'),
  ]);
  const suffix = `${Date.now()}-${Math.random()}`;
  const user = await prisma.user.create({ data: { username: `bot-api-${suffix}` } });
  const discordId = `${Date.now()}`.padEnd(18, '0').slice(0, 18);
  await prisma.authAccount.create({ data: { userId: user.id, provider: 'discord', providerUserId: discordId } });
  const token = await prisma.botToken.create({ data: { name: `test-${suffix}`, token: `token-${suffix}`, createdById: user.id } });
  const startsAtUtc = new Date(Date.now() + 86_400_000);
  const orbat = await prisma.orbat.create({ data: {
    name: `ORBAT ${suffix}`, createdById: user.id, startsAtUtc,
    endsAtUtc: new Date(startsAtUtc.getTime() + 3_600_000),
  } });
  const route = { params: Promise.resolve({ id: String(orbat.id), discordId }) };

  const environmentOnly = await GET(new Request(`http://localhost/api/bot/orbats/${orbat.id}/availability/${discordId}`, {
    headers: { authorization: 'Bearer environment-token' },
  }) as never, route);
  assert.equal(environmentOnly.status, 401);

  const saved = await PUT(new Request(`http://localhost/api/bot/orbats/${orbat.id}/availability/${discordId}`, {
    method: 'PUT', headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'absent', reason: 'Shared note' }),
  }) as never, route);
  assert.equal(saved.status, 200);
  const databaseNote = await prisma.orbatAttendanceNote.findUnique({ where: { orbatId_userId: { orbatId: orbat.id, userId: user.id } } });
  assert.equal(databaseNote?.status, 'absent');
  assert.equal(databaseNote?.reason, 'Shared note');

  await prisma.botToken.update({ where: { id: token.id }, data: { isActive: false } });
  const revoked = await GET(new Request(`http://localhost/api/bot/orbats/${orbat.id}/availability/${discordId}`, {
    headers: { authorization: `Bearer ${token.token}` },
  }) as never, route);
  assert.equal(revoked.status, 401);

  await prisma.botEvent.deleteMany({ where: { aggregateId: String(orbat.id) } });
  await prisma.orbat.delete({ where: { id: orbat.id } });
  await prisma.botToken.delete({ where: { id: token.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
});

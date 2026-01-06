/* eslint-disable @typescript-eslint/no-unused-vars */
// prisma/seed.ts
import { prisma } from '../lib/prisma';

function daysFromNow(days: number) {
  const now = new Date();
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  // Clear existing data in the right order (avoid FK issues)
  await prisma.signup.deleteMany();
  await prisma.subslot.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.orbat.deleteMany();
  await prisma.authAccount.deleteMany();
  await prisma.user.deleteMany();

  // --- Admin User (YOU) ---
  const admin = await prisma.user.create({
    data: {
      username: 'chilla55',
      isAdmin: true,
      accounts: {
        create: {
          provider: 'discord',
          providerUserId: '894924053276663810',
        },
      },
    },
  });

  const alice = await prisma.user.create({
    data: { username: 'Alice' },
  });

  const bob = await prisma.user.create({
    data: { username: 'Bob' },
  });

  const charlie = await prisma.user.create({
    data: { username: 'Charlie' },
  });

  const diana = await prisma.user.create({
    data: { username: 'Diana' },
  });

  // Common dates
  const pastDate = daysFromNow(-7);   // 7 days ago
  const presentDate = daysFromNow(1); // tomorrow
  const futureDate = daysFromNow(10); // 10 days ahead

  // =============== PAST OPS (same day) ===============

  // --- Operation 1: Past Thunder ---
  const pastOp1 = await prisma.orbat.create({
    data: {
      name: 'Operation Past Thunder',
      description: 'A completed operation from last week.',
      createdById: admin.id,
      eventDate: pastDate,
      startTime: '19:00',
      endTime: '21:30',
    },
  });

  const past1Alpha = await prisma.slot.create({
    data: {
      orbatId: pastOp1.id,
      name: 'Alpha Squad',
      orderIndex: 1,
    },
  });

  const past1Bravo = await prisma.slot.create({
    data: {
      orbatId: pastOp1.id,
      name: 'Bravo Squad',
      orderIndex: 2,
    },
  });

  const past1AlphaLeader = await prisma.subslot.create({
    data: {
      slotId: past1Alpha.id,
      name: 'Squad Leader',
      orderIndex: 1,
      maxSignups: 1,
    },
  });

  const past1AlphaRifle1 = await prisma.subslot.create({
    data: {
      slotId: past1Alpha.id,
      name: 'Rifleman 1',
      orderIndex: 2,
      maxSignups: 1,
    },
  });

  const past1AlphaRifle2 = await prisma.subslot.create({
    data: {
      slotId: past1Alpha.id,
      name: 'Rifleman 2',
      orderIndex: 3,
      maxSignups: 1,
    },
  });

  const past1BravoLeader = await prisma.subslot.create({
    data: {
      slotId: past1Bravo.id,
      name: 'Squad Leader',
      orderIndex: 1,
      maxSignups: 1,
    },
  });

  const past1BravoAutoRifle = await prisma.subslot.create({
    data: {
      slotId: past1Bravo.id,
      name: 'Auto Rifleman',
      orderIndex: 2,
      maxSignups: 1,
    },
  });

  await prisma.signup.createMany({
    data: [
      { subslotId: past1AlphaLeader.id, userId: alice.id },
      { subslotId: past1AlphaRifle1.id, userId: bob.id },
      { subslotId: past1BravoLeader.id, userId: charlie.id },
      // Rifleman 2, Auto Rifleman empty
    ],
  });

  // --- Operation 2: Past Dagger (same past day) ---
  const pastOp2 = await prisma.orbat.create({
    data: {
      name: 'Operation Past Dagger',
      description: 'Another completed op on the same day as Past Thunder.',
      createdById: admin.id,
      eventDate: pastDate, // SAME DATE as Past Thunder
    },
  });

  const past2Alpha = await prisma.slot.create({
    data: {
      orbatId: pastOp2.id,
      name: 'Alpha Squad',
      orderIndex: 1,
    },
  });

  const past2Charlie = await prisma.slot.create({
    data: {
      orbatId: pastOp2.id,
      name: 'Charlie Squad',
      orderIndex: 2,
    },
  });

  const past2AlphaLeader = await prisma.subslot.create({
    data: {
      slotId: past2Alpha.id,
      name: 'Squad Leader',
      orderIndex: 1,
      maxSignups: 1,
    },
  });

  const past2AlphaAR = await prisma.subslot.create({
    data: {
      slotId: past2Alpha.id,
      name: 'Auto Rifleman',
      orderIndex: 2,
      maxSignups: 1,
    },
  });

  const past2CharlieLeader = await prisma.subslot.create({
    data: {
      slotId: past2Charlie.id,
      name: 'Squad Leader',
      orderIndex: 1,
      maxSignups: 1,
    },
  });

  const past2CharlieRifle = await prisma.subslot.create({
    data: {
      slotId: past2Charlie.id,
      name: 'Rifleman',
      orderIndex: 2,
      maxSignups: 1,
    },
  });

  await prisma.signup.createMany({
    data: [
      { subslotId: past2AlphaLeader.id, userId: diana.id },
      { subslotId: past2CharlieLeader.id, userId: alice.id },
      // AR, Rifleman empty
    ],
  });

  // =============== PRESENT OP (single) ===============

  const presentOp = await prisma.orbat.create({
    data: {
      name: 'Operation Present Spear',
      description: 'Live operation scheduled soon.',
      createdById: admin.id,
      eventDate: presentDate,
    },
  });

  const presentAlpha = await prisma.slot.create({
    data: {
      orbatId: presentOp.id,
      name: 'Alpha Squad',
      orderIndex: 1,
    },
  });

  const presentBravo = await prisma.slot.create({
    data: {
      orbatId: presentOp.id,
      name: 'Bravo Squad',
      orderIndex: 2,
    },
  });

  const presentAlphaLeader = await prisma.subslot.create({
    data: {
      slotId: presentAlpha.id,
      name: 'Squad Leader',
      orderIndex: 1,
      maxSignups: 1,
    },
  });

  const presentAlphaMed = await prisma.subslot.create({
    data: {
      slotId: presentAlpha.id,
      name: 'Medic',
      orderIndex: 2,
      maxSignups: 1,
    },
  });

  const presentAlphaRifle = await prisma.subslot.create({
    data: {
      slotId: presentAlpha.id,
      name: 'Rifleman',
      orderIndex: 3,
      maxSignups: 1,
    },
  });

  const presentBravoLeader = await prisma.subslot.create({
    data: {
      slotId: presentBravo.id,
      name: 'Squad Leader',
      orderIndex: 1,
      maxSignups: 1,
    },
  });

  const presentBravoMarksman = await prisma.subslot.create({
    data: {
      slotId: presentBravo.id,
      name: 'Marksman',
      orderIndex: 2,
      maxSignups: 1,
    },
  });

  await prisma.signup.createMany({
    data: [
      { subslotId: presentAlphaLeader.id, userId: alice.id },
      { subslotId: presentBravoLeader.id, userId: bob.id },
      // Medic, Rifleman, Marksman empty
    ],
  });

  // =============== FUTURE OPS (same day) ===============

  // --- Operation 3: Future Storm ---
  const futureOp1 = await prisma.orbat.create({
    data: {
      name: 'Operation Future Storm',
      description: 'Planned operation with multiple squads.',
      createdById: admin.id,
      eventDate: futureDate,
    },
  });

  const future1Alpha = await prisma.slot.create({
    data: {
      orbatId: futureOp1.id,
      name: 'Alpha Squad',
      orderIndex: 1,
    },
  });

  const future1Bravo = await prisma.slot.create({
    data: {
      orbatId: futureOp1.id,
      name: 'Bravo Squad',
      orderIndex: 2,
    },
  });

  const future1Charlie = await prisma.slot.create({
    data: {
      orbatId: futureOp1.id,
      name: 'Charlie Squad',
      orderIndex: 3,
    },
  });

  const future1AlphaLeader = await prisma.subslot.create({
    data: {
      slotId: future1Alpha.id,
      name: 'Squad Leader',
      orderIndex: 1,
      maxSignups: 1,
    },
  });

  const future1AlphaGren = await prisma.subslot.create({
    data: {
      slotId: future1Alpha.id,
      name: 'Grenadier',
      orderIndex: 2,
      maxSignups: 1,
    },
  });

  const future1AlphaRifle = await prisma.subslot.create({
    data: {
      slotId: future1Alpha.id,
      name: 'Rifleman',
      orderIndex: 3,
      maxSignups: 1,
    },
  });

  const future1BravoLeader = await prisma.subslot.create({
    data: {
      slotId: future1Bravo.id,
      name: 'Squad Leader',
      orderIndex: 1,
      maxSignups: 1,
    },
  });

  const future1BravoAR = await prisma.subslot.create({
    data: {
      slotId: future1Bravo.id,
      name: 'Auto Rifleman',
      orderIndex: 2,
      maxSignups: 1,
    },
  });

  const future1CharlieLeader = await prisma.subslot.create({
    data: {
      slotId: future1Charlie.id,
      name: 'Squad Leader',
      orderIndex: 1,
      maxSignups: 1,
    },
  });

  const future1CharlieLAT = await prisma.subslot.create({
    data: {
      slotId: future1Charlie.id,
      name: 'Light AT',
      orderIndex: 2,
      maxSignups: 1,
    },
  });

  await prisma.signup.createMany({
    data: [
      { subslotId: future1AlphaLeader.id, userId: charlie.id },
      { subslotId: future1BravoLeader.id, userId: diana.id },
      { subslotId: future1CharlieLeader.id, userId: alice.id },
      // Grenadier, Rifleman, AR, LAT empty
    ],
  });

  // --- Operation 4: Future Saber (same future day) ---
  const futureOp2 = await prisma.orbat.create({
    data: {
      name: 'Operation Future Saber',
      description: 'Second op on the same future day.',
      createdById: admin.id,
      eventDate: futureDate, // SAME DATE as Future Storm
    },
  });

  const future2Alpha = await prisma.slot.create({
    data: {
      orbatId: futureOp2.id,
      name: 'Alpha Squad',
      orderIndex: 1,
    },
  });

  const future2Delta = await prisma.slot.create({
    data: {
      orbatId: futureOp2.id,
      name: 'Delta Squad',
      orderIndex: 2,
    },
  });

  const future2AlphaLeader = await prisma.subslot.create({
    data: {
      slotId: future2Alpha.id,
      name: 'Squad Leader',
      orderIndex: 1,
      maxSignups: 1,
    },
  });

  const future2AlphaRifle = await prisma.subslot.create({
    data: {
      slotId: future2Alpha.id,
      name: 'Rifleman',
      orderIndex: 2,
      maxSignups: 1,
    },
  });

  const future2DeltaLeader = await prisma.subslot.create({
    data: {
      slotId: future2Delta.id,
      name: 'Squad Leader',
      orderIndex: 1,
      maxSignups: 1,
    },
  });

  const future2DeltaMG = await prisma.subslot.create({
    data: {
      slotId: future2Delta.id,
      name: 'Machinegunner',
      orderIndex: 2,
      maxSignups: 1,
    },
  });

  await prisma.signup.createMany({
    data: [
      { subslotId: future2AlphaLeader.id, userId: bob.id },
      // rest empty for this op
    ],
  });

  console.log('Seed complete with multiple ops on same days, squads, and varied signups.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

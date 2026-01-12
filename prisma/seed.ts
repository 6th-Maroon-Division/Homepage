/* eslint-disable */
// @ts-nocheck
// prisma/seed.prod.ts - Production seed with admin user and operational radio frequencies
import { prisma } from '../lib/prisma';

async function main() {
  // Clear existing data in the right order (avoid FK issues)
  await prisma.signup.deleteMany();
  await prisma.subslot.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.orbat.deleteMany();
  await prisma.radioFrequency.deleteMany();
  await prisma.authAccount.deleteMany();
  await prisma.user.deleteMany();

  // --- Create Admin User ---
  await prisma.user.create({
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

  // --- Create Operational Radio Frequencies ---
  // LR (Long Range) Nets
  await prisma.radioFrequency.create({
    data: {
      frequency: '50.0',
      type: 'LR',
      channel: 'LR Channel 1',
      callsign: 'Command Net',
    },
  });

  await prisma.radioFrequency.create({
    data: {
      frequency: '80.0',
      type: 'LR',
      channel: 'LR Channel 2',
      callsign: 'Armoured Net',
    },
  });

  await prisma.radioFrequency.create({
    data: {
      frequency: '51.0',
      type: 'LR',
      channel: 'LR Channel 3',
      callsign: 'Logistics Net',
    },
  });

  await prisma.radioFrequency.create({
    data: {
      frequency: '60.0',
      type: 'LR',
      channel: 'LR Channel 4',
      callsign: 'Air-to-Air',
    },
  });

  // SR (Short Range) - HQ Section
  await prisma.radioFrequency.create({
    data: {
      frequency: '70.0',
      type: 'SR',
      callsign: 'HQ Section (1-0-0)',
    },
  });

  // SR - 1 Section
  await prisma.radioFrequency.create({
    data: {
      frequency: '71.0',
      type: 'SR',
      isAdditional: true,
      channel: 'SR Channel 1',
      callsign: '1 Section SL (1-1-0)',
    },
  });

  await prisma.radioFrequency.create({
    data: {
      frequency: '71.1',
      type: 'SR',
      channel: 'SR Channel 2',
      callsign: '1 Section FTL (1-1-1)',
    },
  });

  await prisma.radioFrequency.create({
    data: {
      frequency: '71.2',
      type: 'SR',
      channel: 'SR Channel 3',
      callsign: '1 Section FTL (1-1-2)',
    },
  });

  // SR - 2 Section
  await prisma.radioFrequency.create({
    data: {
      frequency: '72.0',
      type: 'SR',
      isAdditional: true,
      channel: 'SR Channel 4',
      callsign: '2 Section SL (1-2-0)',
    },
  });

  await prisma.radioFrequency.create({
    data: {
      frequency: '72.1',
      type: 'SR',
      channel: 'SR Channel 5',
      callsign: '2 Section FTL (1-2-1)',
    },
  });

  await prisma.radioFrequency.create({
    data: {
      frequency: '72.2',
      type: 'SR',
      channel: 'SR Channel 6',
      callsign: '2 Section FTL (1-2-2)',
    },
  });

  // SR - 3 Section
  await prisma.radioFrequency.create({
    data: {
      frequency: '73.0',
      type: 'SR',
      isAdditional: true,
      channel: 'SR Channel 4',
      callsign: '3 Section SL (1-3-0)',
    },
  });

  await prisma.radioFrequency.create({
    data: {
      frequency: '73.1',
      type: 'SR',
      channel: 'SR Channel 5',
      callsign: '3 Section FTL (1-3-1)',
    },
  });

  await prisma.radioFrequency.create({
    data: {
      frequency: '73.2',
      type: 'SR',
      channel: 'SR Channel 6',
      callsign: '3 Section FTL (1-3-2)',
    },
  });

  // Special Nets
  await prisma.radioFrequency.create({
    data: {
      frequency: '90.0',
      type: 'SR',
      isAdditional: true,
      callsign: 'Medic Net',
    },
  });

  console.log('✅ Production seed complete with admin user and operational radio frequencies.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


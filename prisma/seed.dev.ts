/* eslint-disable */
// @ts-nocheck
// prisma/seed.dev.ts - Development seed with test data and radio frequencies
import { prisma } from '../lib/prisma';

function daysFromNow(days: number) {
  const now = new Date();
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  // Clear existing data in the right order (avoid FK issues)
  await prisma.trainingRequest.deleteMany();
  await prisma.userTraining.deleteMany();
  await prisma.training.deleteMany();
  await prisma.signup.deleteMany();
  await prisma.subslot.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.orbat.deleteMany();
  await prisma.orbatTemplate.deleteMany();
  await prisma.radioFrequency.deleteMany();
  await prisma.authAccount.deleteMany();
  await prisma.user.deleteMany();

  // --- Create Radio Frequencies (operation-level, not squad-linked) ---
  const srFreq1 = await prisma.radioFrequency.create({
    data: {
      frequency: '70.0',
      type: 'SR',
      channel: 'SR Channel 1',
      callsign: 'Alpha-1',
    },
  });

  const srFreq2 = await prisma.radioFrequency.create({
    data: {
      frequency: '70.5',
      type: 'SR',
      channel: 'SR Channel 2',
      callsign: 'Bravo-1',
    },
  });

  const lrFreq1 = await prisma.radioFrequency.create({
    data: {
      frequency: '40.0',
      type: 'LR',
      channel: 'LR Channel 1',
      callsign: 'Command',
    },
  });

  const asrFreq = await prisma.radioFrequency.create({
    data: {
      frequency: '72.0',
      type: 'SR',
      isAdditional: true,
      channel: 'ASR Channel 1',
      callsign: 'Support',
    },
  });

  const alrFreq = await prisma.radioFrequency.create({
    data: {
      frequency: '41.0',
      type: 'LR',
      isAdditional: true,
      channel: 'ALR Channel 1',
      callsign: 'Backup-Command',
    },
  });

  // --- Admin User ---
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
      bluforCountry: 'Hungary',
      bluforRelationship: 'Friendly',
      opforCountry: 'Romania',
      opforRelationship: 'Hostile',
      indepCountry: 'NATO',
      indepRelationship: 'Friendly',
      iedThreat: 'High',
      civilianRelationship: 'Friendly',
      rulesOfEngagement: 'PID',
      airspace: 'Contested',
      inGameTimezone: '4:00',
      operationDay: 'Final Day',
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
    ],
  });

  // Link radio frequencies to Past Thunder
  await prisma.orbatRadioFrequency.createMany({
    data: [
      { orbatId: pastOp1.id, radioFrequencyId: srFreq1.id },
      { orbatId: pastOp1.id, radioFrequencyId: lrFreq1.id },
    ],
  });

  // --- Operation 2: Past Dagger ---
  const pastOp2 = await prisma.orbat.create({
    data: {
      name: 'Operation Past Dagger',
      description: 'Another completed op on the same day as Past Thunder.',
      createdById: admin.id,
      eventDate: pastDate,
      bluforCountry: 'Poland',
      bluforRelationship: 'Friendly',
      opforCountry: 'Belarus',
      opforRelationship: 'Hostile',
      indepCountry: 'Ukraine',
      indepRelationship: 'Neutral',
      iedThreat: 'Medium',
      civilianRelationship: 'Neutral',
      rulesOfEngagement: 'Return Fire',
      airspace: 'Friendly',
      inGameTimezone: '3:30',
      operationDay: 'Day 2',
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
    ],
  });

  // Link radio frequencies to Past Dagger
  await prisma.orbatRadioFrequency.createMany({
    data: [
      { orbatId: pastOp2.id, radioFrequencyId: srFreq2.id },
      { orbatId: pastOp2.id, radioFrequencyId: lrFreq1.id },
      { orbatId: pastOp2.id, radioFrequencyId: asrFreq.id },
    ],
  });

  // =============== PRESENT OP ===============

  const presentOp = await prisma.orbat.create({
    data: {
      name: 'Operation Present Spear',
      description: 'Live operation scheduled soon.',
      createdById: admin.id,
      eventDate: presentDate,
      bluforCountry: 'Czech Republic',
      bluforRelationship: 'Friendly',
      opforCountry: 'Russia',
      opforRelationship: 'Hostile',
      indepCountry: 'Slovakia',
      indepRelationship: 'Friendly',
      iedThreat: 'Low',
      civilianRelationship: 'Friendly',
      rulesOfEngagement: 'PID',
      airspace: 'Contested',
      inGameTimezone: '5:00',
      operationDay: 'Day 1',
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
    ],
  });

  // Link radio frequencies to Present Spear
  await prisma.orbatRadioFrequency.createMany({
    data: [
      { orbatId: presentOp.id, radioFrequencyId: srFreq1.id },
      { orbatId: presentOp.id, radioFrequencyId: srFreq2.id },
      { orbatId: presentOp.id, radioFrequencyId: lrFreq1.id },
      { orbatId: presentOp.id, radioFrequencyId: alrFreq.id },
    ],
  });

  // =============== FUTURE OPS ===============

  // --- Operation 3: Future Storm ---
  const futureOp1 = await prisma.orbat.create({
    data: {
      name: 'Operation Future Storm',
      description: 'Planned operation with multiple squads.',
      createdById: admin.id,
      eventDate: futureDate,
      bluforCountry: 'Germany',
      bluforRelationship: 'Friendly',
      opforCountry: 'Syria',
      opforRelationship: 'Hostile',
      indepCountry: 'UN Forces',
      indepRelationship: 'Friendly',
      iedThreat: 'High',
      civilianRelationship: 'Friendly',
      rulesOfEngagement: 'PID',
      airspace: 'Hostile',
      inGameTimezone: '6:00',
      operationDay: 'Day 3',
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
    ],
  });

  // Link radio frequencies to Future Storm
  await prisma.orbatRadioFrequency.createMany({
    data: [
      { orbatId: futureOp1.id, radioFrequencyId: srFreq1.id },
      { orbatId: futureOp1.id, radioFrequencyId: lrFreq1.id },
      { orbatId: futureOp1.id, radioFrequencyId: asrFreq.id },
      { orbatId: futureOp1.id, radioFrequencyId: alrFreq.id },
    ],
  });

  // --- Operation 4: Future Saber ---
  const futureOp2 = await prisma.orbat.create({
    data: {
      name: 'Operation Future Saber',
      description: 'Second op on the same future day.',
      createdById: admin.id,
      eventDate: futureDate,
      bluforCountry: 'United Kingdom',
      bluforRelationship: 'Friendly',
      opforCountry: 'Iran',
      opforRelationship: 'Hostile',
      indepCountry: 'UAE',
      indepRelationship: 'Neutral',
      iedThreat: 'Very High',
      civilianRelationship: 'Hostile',
      rulesOfEngagement: 'Weapons Free',
      airspace: 'Hostile',
      inGameTimezone: '7:00',
      operationDay: 'Final Day',
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
    ],
  });

  // Link radio frequencies to Future Saber
  await prisma.orbatRadioFrequency.createMany({
    data: [
      { orbatId: futureOp2.id, radioFrequencyId: srFreq1.id },
      { orbatId: futureOp2.id, radioFrequencyId: srFreq2.id },
      { orbatId: futureOp2.id, radioFrequencyId: lrFreq1.id },
    ],
  });

  // =============== TEMPLATES ===============

  // --- Standard Squad Template ---
  const standardSquadTemplate = await prisma.orbatTemplate.create({
    data: {
      name: 'Standard Squad',
      description: 'A standard 2-squad template with squad leaders, riflemen, and support roles.',
      category: 'Main Op',
      createdById: admin.id,
      slotsJson: JSON.stringify([
        {
          name: 'Alpha Squad',
          orderIndex: 1,
          subslots: [
            { name: 'Squad Leader', orderIndex: 1, maxSignups: 1 },
            { name: 'Rifleman', orderIndex: 2, maxSignups: 2 },
            { name: 'Medic', orderIndex: 3, maxSignups: 1 },
          ],
        },
        {
          name: 'Bravo Squad',
          orderIndex: 2,
          subslots: [
            { name: 'Squad Leader', orderIndex: 1, maxSignups: 1 },
            { name: 'Auto Rifleman', orderIndex: 2, maxSignups: 1 },
            { name: 'Rifleman', orderIndex: 3, maxSignups: 1 },
          ],
        },
      ]),
      bluforCountry: 'United States',
      bluforRelationship: 'Friendly',
      opforCountry: null,
      opforRelationship: null,
      iedThreat: 'Medium',
      rulesOfEngagement: 'PID',
      inGameTimezone: 'UTC+0',
      operationDay: 'Day 1',
    },
  });

  // --- Light Recon Template ---
  const lightReconTemplate = await prisma.orbatTemplate.create({
    data: {
      name: 'Light Reconnaissance',
      description: 'Small recon team setup with marksmen and scouts.',
      category: 'Side Op',
      createdById: admin.id,
      slotsJson: JSON.stringify([
        {
          name: 'Recon Team',
          orderIndex: 1,
          subslots: [
            { name: 'Team Lead', orderIndex: 1, maxSignups: 1 },
            { name: 'Scout', orderIndex: 2, maxSignups: 1 },
            { name: 'Marksman', orderIndex: 3, maxSignups: 1 },
          ],
        },
      ]),
      bluforCountry: 'United States',
      bluforRelationship: 'Friendly',
      opforCountry: 'Unknown',
      opforRelationship: 'Hostile',
      iedThreat: 'Low',
      civilianRelationship: 'Neutral',
      rulesOfEngagement: 'Return Fire',
      inGameTimezone: 'UTC+0',
      operationDay: 'Day 1',
      startTime: '14:00',
      endTime: '18:00',
    },
  });

  // --- Full Platoon Template ---
  const fullPlatoonTemplate = await prisma.orbatTemplate.create({
    data: {
      name: 'Full Platoon',
      description: 'Complete platoon with 3 squads, command element, and support.',
      category: 'Main Op',
      createdById: admin.id,
      slotsJson: JSON.stringify([
        {
          name: 'Platoon Command',
          orderIndex: 1,
          subslots: [
            { name: 'Platoon Leader', orderIndex: 1, maxSignups: 1 },
            { name: 'Sergeant', orderIndex: 2, maxSignups: 1 },
          ],
        },
        {
          name: 'Alpha Squad',
          orderIndex: 2,
          subslots: [
            { name: 'Squad Leader', orderIndex: 1, maxSignups: 1 },
            { name: 'Rifleman', orderIndex: 2, maxSignups: 2 },
            { name: 'Grenadier', orderIndex: 3, maxSignups: 1 },
          ],
        },
        {
          name: 'Bravo Squad',
          orderIndex: 3,
          subslots: [
            { name: 'Squad Leader', orderIndex: 1, maxSignups: 1 },
            { name: 'Auto Rifleman', orderIndex: 2, maxSignups: 1 },
            { name: 'Rifleman', orderIndex: 3, maxSignups: 1 },
          ],
        },
        {
          name: 'Charlie Squad',
          orderIndex: 4,
          subslots: [
            { name: 'Squad Leader', orderIndex: 1, maxSignups: 1 },
            { name: 'Medic', orderIndex: 2, maxSignups: 1 },
            { name: 'Rifleman', orderIndex: 3, maxSignups: 1 },
          ],
        },
      ]),
      bluforCountry: 'United States',
      bluforRelationship: 'Friendly',
      opforCountry: 'Russia',
      opforRelationship: 'Hostile',
      iedThreat: 'High',
      civilianRelationship: 'Neutral',
      rulesOfEngagement: 'Weapons Free',
      airspace: 'Contested',
      inGameTimezone: 'UTC+2',
      operationDay: 'Day 2',
      startTime: '10:00',
      endTime: '20:00',
    },
  });

  // --- Training System ---
  console.log('Seeding training system...');

  // Clean existing training data to ensure idempotent seeding
  await prisma.trainingRequest.deleteMany({});
  await prisma.userTraining.deleteMany({});
  await prisma.training.deleteMany({});
  await prisma.trainingCategory.deleteMany({});

  // Create training categories
  const combatCategory = await prisma.trainingCategory.create({
    data: { name: 'Combat', orderIndex: 0 },
  });

  const medicalCategory = await prisma.trainingCategory.create({
    data: { name: 'Medical', orderIndex: 1 },
  });

  const aviationCategory = await prisma.trainingCategory.create({
    data: { name: 'Aviation', orderIndex: 2 },
  });

  const leadershipCategory = await prisma.trainingCategory.create({
    data: { name: 'Leadership', orderIndex: 3 },
  });

  const communicationCategory = await prisma.trainingCategory.create({
    data: { name: 'Communication', orderIndex: 4 },
  });

  const technicalCategory = await prisma.trainingCategory.create({
    data: { name: 'Technical', orderIndex: 5 },
  });

  const otherCategory = await prisma.trainingCategory.create({
    data: { name: 'Other', orderIndex: 6 },
  });

  // Create trainings
  const basicCombat = await prisma.training.create({
    data: {
      name: 'Basic Combat Training',
      description: 'Fundamental combat tactics, weapon handling, and squad movements',
      categoryId: combatCategory.id,
      duration: 120,
      isActive: true,
    },
  });

  const advancedCombat = await prisma.training.create({
    data: {
      name: 'Advanced Combat Training',
      description: 'Advanced tactics, CQB techniques, and coordinated assaults',
      categoryId: combatCategory.id,
      duration: 180,
      isActive: true,
    },
  });

  const medicalTraining = await prisma.training.create({
    data: {
      name: 'Combat Medic Certification',
      description: 'Field medical procedures, triage, and casualty evacuation',
      categoryId: medicalCategory.id,
      duration: 150,
      isActive: true,
    },
  });

  const aviationBasic = await prisma.training.create({
    data: {
      name: 'Basic Aviation Training',
      description: 'Helicopter piloting fundamentals and basic flight maneuvers',
      categoryId: aviationCategory.id,
      duration: 240,
      isActive: true,
    },
  });

  const leadershipTraining = await prisma.training.create({
    data: {
      name: 'Squad Leadership Course',
      description: 'Leadership principles, squad management, and tactical decision making',
      categoryId: leadershipCategory.id,
      duration: 180,
      isActive: true,
    },
  });

  const radioComms = await prisma.training.create({
    data: {
      name: 'Radio Communications',
      description: 'Radio procedures, call signs, and tactical communications',
      categoryId: communicationCategory.id,
      duration: 90,
      isActive: true,
    },
  });

  const sniperTraining = await prisma.training.create({
    data: {
      name: 'Sniper School',
      description: 'Long-range marksmanship, camouflage, and reconnaissance',
      categoryId: combatCategory.id,
      duration: 300,
      isActive: true,
    },
  });

  const explosivesTraining = await prisma.training.create({
    data: {
      name: 'Explosives & Demolition',
      description: 'Safe handling and deployment of explosives, mine clearing',
      categoryId: technicalCategory.id,
      duration: 180,
      isActive: false, // Inactive training for testing
    },
  });

  // Assign trainings to users
  await prisma.userTraining.create({
    data: {
      userId: alice.id,
      trainingId: basicCombat.id,
      notes: 'Completed with excellent performance',
      completedAt: new Date('2026-01-01'),
    },
  });

  await prisma.userTraining.create({
    data: {
      userId: alice.id,
      trainingId: medicalTraining.id,
      needsRetraining: true, // Needs retraining
      notes: 'Annual recertification required',
      completedAt: new Date('2026-01-05'),
    },
  });

  await prisma.userTraining.create({
    data: {
      userId: bob.id,
      trainingId: basicCombat.id,
      completedAt: new Date('2026-01-02'),
    },
  });

  await prisma.userTraining.create({
    data: {
      userId: bob.id,
      trainingId: aviationBasic.id,
      completedAt: new Date('2026-01-10'),
      notes: 'Certified for rotary wing operations',
    },
  });

  await prisma.userTraining.create({
    data: {
      userId: charlie.id,
      trainingId: basicCombat.id,
      completedAt: new Date('2025-12-15'),
    },
  });

  await prisma.userTraining.create({
    data: {
      userId: charlie.id,
      trainingId: leadershipTraining.id,
      completedAt: new Date('2026-01-08'),
      notes: 'Shows strong leadership potential',
    },
  });

  // Admin trainings
  await prisma.userTraining.create({
    data: {
      userId: admin.id,
      trainingId: basicCombat.id,
      completedAt: new Date('2025-12-01'),
      notes: 'Training administrator',
    },
  });

  await prisma.userTraining.create({
    data: {
      userId: admin.id,
      trainingId: leadershipTraining.id,
      completedAt: new Date('2025-12-10'),
      notes: 'Leadership role for admin',
    },
  });

  // Hidden training (admin testing)
  await prisma.userTraining.create({
    data: {
      userId: diana.id,
      trainingId: sniperTraining.id,
      isHidden: true, // This won't show up for Diana
      completedAt: new Date('2025-11-20'),
      notes: 'Classified training record',
    },
  });

  // Create training requests
  await prisma.trainingRequest.create({
    data: {
      userId: alice.id,
      trainingId: advancedCombat.id,
      status: 'pending',
      requestMessage: 'I would like to progress to advanced combat training after completing basic.',
      requestedAt: new Date('2026-01-12'),
    },
  });

  await prisma.trainingRequest.create({
    data: {
      userId: bob.id,
      trainingId: leadershipTraining.id,
      status: 'pending',
      requestMessage: 'Interested in taking on squad leader roles in future operations.',
      requestedAt: new Date('2026-01-11'),
    },
  });

  await prisma.trainingRequest.create({
    data: {
      userId: charlie.id,
      trainingId: radioComms.id,
      status: 'approved',
      requestMessage: 'Need radio training for RTO role',
      adminResponse: 'Approved - training scheduled for next week',
      requestedAt: new Date('2026-01-05'),
      updatedAt: new Date('2026-01-06'),
    },
  });

  await prisma.trainingRequest.create({
    data: {
      userId: diana.id,
      trainingId: medicalTraining.id,
      status: 'rejected',
      requestMessage: 'I want to be a medic',
      adminResponse: 'Please complete basic combat training first',
      requestedAt: new Date('2026-01-03'),
      updatedAt: new Date('2026-01-04'),
    },
  });

  console.log('✅ Development seed complete with radio frequencies, operations, squads, signups, templates, and trainings.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/* eslint-disable */
// @ts-nocheck
import { prisma } from '../lib/prisma';
import { seedPermissions, grantAdminPermissions } from './seed-permissions';

function daysFromNow(days: number) {
  const now = new Date();
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  await prisma.squadRoleAuditLog.deleteMany();
  await prisma.permissionAuditLog.deleteMany();
  await prisma.userPermission.deleteMany();
  await prisma.messageRecipient.deleteMany();
  await prisma.message.deleteMany();
  await prisma.attendanceLog.deleteMany();
  await prisma.attendanceSession.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.signup.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.squad.deleteMany();
  await prisma.orbatRadioFrequency.deleteMany();
  await prisma.orbat.deleteMany();
  await prisma.orbatTemplate.deleteMany();
  await prisma.squadRole.deleteMany();
  await prisma.trainingRequest.deleteMany();
  await prisma.userTraining.deleteMany();
  await prisma.trainingTrainingRequirement.deleteMany();
  await prisma.trainingRankRequirement.deleteMany();
  await prisma.rankTransitionRequirement.deleteMany();
  await prisma.promotionProposal.deleteMany();
  await prisma.rankHistory.deleteMany();
  await prisma.userRank.deleteMany();
  await prisma.trainingCategory.deleteMany();
  await prisma.training.deleteMany();
  await prisma.rank.deleteMany();
  await prisma.radioFrequency.deleteMany();
  await prisma.authAccount.deleteMany();
  await prisma.user.deleteMany();

  await seedPermissions();

  const admin = await prisma.user.create({
    data: {
      username: 'chilla55',
      accounts: {
        create: {
          provider: 'discord',
          providerUserId: '894924053276663810',
        },
      },
    },
  });

  await grantAdminPermissions(admin.id);

  const [alice, bob, charlie, diana] = await Promise.all([
    prisma.user.create({ data: { username: 'Alice' } }),
    prisma.user.create({ data: { username: 'Bob' } }),
    prisma.user.create({ data: { username: 'Charlie' } }),
    prisma.user.create({ data: { username: 'Diana' } }),
  ]);

  const [srFreq1, srFreq2, lrFreq1, asrFreq] = await Promise.all([
    prisma.radioFrequency.create({ data: { frequency: '70.0', type: 'SR', channel: 'SR Channel 1', callsign: 'Alpha-1' } }),
    prisma.radioFrequency.create({ data: { frequency: '70.5', type: 'SR', channel: 'SR Channel 2', callsign: 'Bravo-1' } }),
    prisma.radioFrequency.create({ data: { frequency: '40.0', type: 'LR', channel: 'LR Channel 1', callsign: 'Command' } }),
    prisma.radioFrequency.create({ data: { frequency: '72.0', type: 'SR', isAdditional: true, channel: 'ASR Channel 1', callsign: 'Support' } }),
  ]);

  const [combatCategory, leadershipCategory, medicalCategory] = await Promise.all([
    prisma.trainingCategory.create({ data: { name: 'Combat', orderIndex: 1 } }),
    prisma.trainingCategory.create({ data: { name: 'Leadership', orderIndex: 2 } }),
    prisma.trainingCategory.create({ data: { name: 'Medical', orderIndex: 3 } }),
  ]);

  const [basicCombat, leadershipTraining, medicalTraining, sniperTraining] = await Promise.all([
    prisma.training.create({
      data: {
        name: 'Basic Combat Training',
        description: 'Fundamental combat training',
        categoryId: combatCategory.id,
        duration: 120,
        isActive: true,
        requiredForNewPeople: true,
      },
    }),
    prisma.training.create({
      data: {
        name: 'Squad Leadership Course',
        description: 'Leadership and planning',
        categoryId: leadershipCategory.id,
        duration: 180,
        isActive: true,
      },
    }),
    prisma.training.create({
      data: {
        name: 'Combat Medic Certification',
        description: 'Medical procedures and triage',
        categoryId: medicalCategory.id,
        duration: 150,
        isActive: true,
      },
    }),
    prisma.training.create({
      data: {
        name: 'Sniper School',
        description: 'Long-range marksmanship',
        categoryId: combatCategory.id,
        duration: 300,
        isActive: true,
      },
    }),
  ]);

  await prisma.userTraining.createMany({
    data: [
      { userId: alice.id, trainingId: basicCombat.id },
      { userId: bob.id, trainingId: basicCombat.id },
      { userId: charlie.id, trainingId: basicCombat.id },
      { userId: diana.id, trainingId: basicCombat.id },
      { userId: diana.id, trainingId: leadershipTraining.id },
      { userId: diana.id, trainingId: medicalTraining.id },
    ],
    skipDuplicates: true,
  });

  await prisma.rank.createMany({
    data: [
      { name: 'Recruit', abbreviation: 'Rct', orderIndex: 1, attendanceRequiredSinceLastRank: 5, autoRankupEnabled: true },
      { name: 'Private', abbreviation: 'Pvt', orderIndex: 2, attendanceRequiredSinceLastRank: 10, autoRankupEnabled: true },
      { name: 'Lance Corporal', abbreviation: 'LCpl', orderIndex: 3, attendanceRequiredSinceLastRank: 10, autoRankupEnabled: false },
      { name: 'Corporal', abbreviation: 'Cpl', orderIndex: 4, attendanceRequiredSinceLastRank: 20, autoRankupEnabled: false },
      { name: 'Sergeant', abbreviation: 'Sgt', orderIndex: 5, attendanceRequiredSinceLastRank: 25, autoRankupEnabled: false },
      { name: 'Major', abbreviation: 'Maj', orderIndex: 10, attendanceRequiredSinceLastRank: null, autoRankupEnabled: false },
    ],
    skipDuplicates: true,
  });

  const ranks = await prisma.rank.findMany();
  const rankByAbbr = Object.fromEntries(ranks.map((rank) => [rank.abbreviation, rank]));

  await prisma.userRank.createMany({
    data: [
      { userId: admin.id, currentRankId: rankByAbbr['Maj'].id, attendanceSinceLastRank: 0, retired: false, interviewDone: true },
      { userId: alice.id, currentRankId: rankByAbbr['Pvt'].id, attendanceSinceLastRank: 8, retired: false, interviewDone: true },
      { userId: bob.id, currentRankId: rankByAbbr['LCpl'].id, attendanceSinceLastRank: 12, retired: false, interviewDone: true },
      { userId: charlie.id, currentRankId: rankByAbbr['Cpl'].id, attendanceSinceLastRank: 20, retired: false, interviewDone: true },
      { userId: diana.id, currentRankId: rankByAbbr['Sgt'].id, attendanceSinceLastRank: 25, retired: false, interviewDone: true },
    ],
    skipDuplicates: true,
  });

  const squadRoles = await Promise.all([
    prisma.squadRole.create({
      data: {
        name: 'Squad Leader',
        category: 'Leadership',
        tags: 'squad,leadership',
        requiredTrainingIds: [leadershipTraining.id],
        requiredRankIds: [rankByAbbr['LCpl'].id],
      },
    }),
    prisma.squadRole.create({ data: { name: 'Rifleman', category: 'Infantry', tags: 'rifle,infantry' } }),
    prisma.squadRole.create({
      data: {
        name: 'Medic',
        category: 'Support',
        tags: 'medical,support',
        requiredTrainingIds: [medicalTraining.id],
      },
    }),
    prisma.squadRole.create({
      data: {
        name: 'Marksman',
        category: 'Infantry',
        tags: 'precision,infantry',
        requiredTrainingIds: [sniperTraining.id],
      },
    }),
  ]);

  const squadRoleByName = Object.fromEntries(squadRoles.map((role) => [role.name, role]));

  const futureOrbat = await prisma.orbat.create({
    data: {
      name: 'Operation Iron Talon',
      description: 'Live fire exercise with two squads',
      createdById: admin.id,
      eventDate: daysFromNow(2),
      startTime: '19:00',
      endTime: '21:00',
      bluforCountry: 'NATO',
      bluforRelationship: 'Friendly',
      opforCountry: 'CSAT',
      opforRelationship: 'Hostile',
      indepCountry: 'AAF',
      indepRelationship: 'Neutral',
      iedThreat: 'Medium',
      civilianRelationship: 'Neutral',
      rulesOfEngagement: 'PID',
      airspace: 'Contested',
      inGameTimezone: '12:00',
      operationDay: 'Day 1',
    },
  });

  const [alphaSquad, bravoSquad] = await Promise.all([
    prisma.squad.create({ data: { orbatId: futureOrbat.id, name: 'Alpha Squad', orderIndex: 1 } }),
    prisma.squad.create({ data: { orbatId: futureOrbat.id, name: 'Bravo Squad', orderIndex: 2 } }),
  ]);

  const [alphaLeader, alphaRifleman, alphaMedic, bravoLeader, bravoMarksman] = await Promise.all([
    prisma.slot.create({ data: { orbatId: futureOrbat.id, squadId: alphaSquad.id, squadRoleId: squadRoleByName['Squad Leader'].id, orderIndex: 1, maxSignups: 1 } }),
    prisma.slot.create({ data: { orbatId: futureOrbat.id, squadId: alphaSquad.id, squadRoleId: squadRoleByName['Rifleman'].id, orderIndex: 2, maxSignups: 2 } }),
    prisma.slot.create({ data: { orbatId: futureOrbat.id, squadId: alphaSquad.id, squadRoleId: squadRoleByName['Medic'].id, orderIndex: 3, maxSignups: 1 } }),
    prisma.slot.create({ data: { orbatId: futureOrbat.id, squadId: bravoSquad.id, squadRoleId: squadRoleByName['Squad Leader'].id, orderIndex: 1, maxSignups: 1 } }),
    prisma.slot.create({ data: { orbatId: futureOrbat.id, squadId: bravoSquad.id, squadRoleId: squadRoleByName['Marksman'].id, orderIndex: 2, maxSignups: 1 } }),
  ]);

  await prisma.signup.createMany({
    data: [
      { slotId: alphaLeader.id, userId: diana.id },
      { slotId: alphaRifleman.id, userId: alice.id },
      { slotId: alphaMedic.id, userId: bob.id },
      { slotId: bravoLeader.id, userId: charlie.id },
    ],
    skipDuplicates: true,
  });

  await prisma.orbatRadioFrequency.createMany({
    data: [
      { orbatId: futureOrbat.id, radioFrequencyId: srFreq1.id },
      { orbatId: futureOrbat.id, radioFrequencyId: srFreq2.id },
      { orbatId: futureOrbat.id, radioFrequencyId: lrFreq1.id },
      { orbatId: futureOrbat.id, radioFrequencyId: asrFreq.id },
    ],
    skipDuplicates: true,
  });

  await prisma.orbatTemplate.create({
    data: {
      name: 'Standard Two Squad',
      description: 'Two squads with common roles',
      category: 'Combat',
      tagsJson: 'combat,standard',
      slotsJson: [
        {
          name: 'Alpha Squad',
          orderIndex: 1,
          slots: [
            { squadRoleId: squadRoleByName['Squad Leader'].id, orderIndex: 1, maxSignups: 1 },
            { squadRoleId: squadRoleByName['Rifleman'].id, orderIndex: 2, maxSignups: 2 },
            { squadRoleId: squadRoleByName['Medic'].id, orderIndex: 3, maxSignups: 1 },
          ],
        },
        {
          name: 'Bravo Squad',
          orderIndex: 2,
          slots: [
            { squadRoleId: squadRoleByName['Squad Leader'].id, orderIndex: 1, maxSignups: 1 },
            { squadRoleId: squadRoleByName['Marksman'].id, orderIndex: 2, maxSignups: 1 },
          ],
        },
      ],
      frequencyIds: [srFreq1.id, lrFreq1.id],
      createdById: admin.id,
      isActive: true,
    },
  });

  const allUsers = [admin, alice, bob, charlie, diana];
  const message = await prisma.message.create({
    data: {
      title: 'Welcome to ORBAT Platform',
      body: 'A new ORBAT structure is now active: Orbat → Squad → Slot.',
      type: 'general',
      createdById: admin.id,
    },
  });

  await prisma.messageRecipient.createMany({
    data: allUsers.map((user) => ({
      messageId: message.id,
      userId: user.id,
      audienceType: 'all',
      isRead: user.id === admin.id,
      readAt: user.id === admin.id ? new Date() : null,
      channel: 'web',
    })),
    skipDuplicates: true,
  });

  console.log('✅ Development seed complete with SquadRole/Squad/Slot schema.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

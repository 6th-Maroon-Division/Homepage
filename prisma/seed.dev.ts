/* eslint-disable */
// @ts-nocheck
import { prisma } from '../lib/prisma';
import { seedPermissions, grantAdminPermissions } from './seed-permissions';

function daysFromNow(days: number) {
  const now = new Date();
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDateToYyyyMmDd(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function main() {
  await prisma.botToken.deleteMany();
  await prisma.leaveOfAbsence.deleteMany();
  await prisma.legacyAttendanceData.deleteMany();
  await prisma.legacyUserData.deleteMany();
  await prisma.orbatAttendanceNote.deleteMany();
  await prisma.attendanceEvent.deleteMany();
  await prisma.squadRoleAuditLog.deleteMany();
  await prisma.permissionAuditLog.deleteMany();
  await prisma.userPermission.deleteMany();
  await prisma.trainingRequestReadState.deleteMany();
  await prisma.trainingRequestSubscription.deleteMany();
  await prisma.trainingRequestMessage.deleteMany();
  await prisma.userTrainingStatusHistory.deleteMany();
  await prisma.trainingSessionAttendee.deleteMany();
  await prisma.trainingSession.deleteMany();
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

  const [alice, bob, charlie, diana, ethan, farah] = await Promise.all([
    prisma.user.create({ data: { username: 'Alice' } }),
    prisma.user.create({ data: { username: 'Bob' } }),
    prisma.user.create({ data: { username: 'Charlie' } }),
    prisma.user.create({ data: { username: 'Diana' } }),
    prisma.user.create({ data: { username: 'Ethan' } }),
    prisma.user.create({ data: { username: 'Farah' } }),
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

  const seededTrainingCompletionAt = new Date();

  await prisma.userTraining.createMany({
    data: [
      {
        userId: alice.id,
        trainingId: basicCombat.id,
        trainerId: admin.id,
        status: 'qualified',
        needsRetraining: false,
        trainingSessionCompletedAt: seededTrainingCompletionAt,
        notes: 'Qualified on rifle drills',
      },
      {
        userId: bob.id,
        trainingId: basicCombat.id,
        trainerId: admin.id,
        status: 'qualified',
        needsRetraining: false,
        trainingSessionCompletedAt: seededTrainingCompletionAt,
      },
      {
        userId: charlie.id,
        trainingId: basicCombat.id,
        trainerId: admin.id,
        status: 'qualified',
        needsRetraining: false,
        trainingSessionCompletedAt: seededTrainingCompletionAt,
      },
      {
        userId: diana.id,
        trainingId: basicCombat.id,
        trainerId: admin.id,
        status: 'qualified',
        needsRetraining: false,
        trainingSessionCompletedAt: seededTrainingCompletionAt,
      },
      {
        userId: diana.id,
        trainingId: leadershipTraining.id,
        trainerId: admin.id,
        status: 'qualified',
        needsRetraining: false,
        trainingSessionCompletedAt: seededTrainingCompletionAt,
      },
      {
        userId: diana.id,
        trainingId: medicalTraining.id,
        trainerId: admin.id,
        status: 'qualified',
        needsRetraining: false,
        trainingSessionCompletedAt: seededTrainingCompletionAt,
      },
      {
        userId: ethan.id,
        trainingId: basicCombat.id,
        trainerId: diana.id,
        status: 'qualified',
        needsRetraining: false,
        trainingSessionCompletedAt: seededTrainingCompletionAt,
      },
      {
        userId: ethan.id,
        trainingId: sniperTraining.id,
        trainerId: diana.id,
        status: 'qualified',
        needsRetraining: false,
        trainingSessionCompletedAt: seededTrainingCompletionAt,
      },
      {
        userId: farah.id,
        trainingId: basicCombat.id,
        trainerId: diana.id,
        status: 'failed',
        needsRetraining: true,
        failedAt: seededTrainingCompletionAt,
      },
      {
        userId: farah.id,
        trainingId: medicalTraining.id,
        trainerId: admin.id,
        status: 'approved',
        needsRetraining: false,
      },
      {
        userId: bob.id,
        trainingId: medicalTraining.id,
        trainerId: admin.id,
        status: 'qualified',
        needsRetraining: false,
        trainingSessionCompletedAt: seededTrainingCompletionAt,
      },
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

  await prisma.trainingRankRequirement.createMany({
    data: [
      { trainingId: leadershipTraining.id, minimumRankId: rankByAbbr['LCpl'].id },
      { trainingId: sniperTraining.id, minimumRankId: rankByAbbr['Pvt'].id },
    ],
    skipDuplicates: true,
  });

  await prisma.trainingTrainingRequirement.createMany({
    data: [
      { trainingId: leadershipTraining.id, requiredTrainingId: basicCombat.id },
      { trainingId: medicalTraining.id, requiredTrainingId: basicCombat.id },
      { trainingId: sniperTraining.id, requiredTrainingId: basicCombat.id },
    ],
    skipDuplicates: true,
  });

  await Promise.all([
    prisma.rankTransitionRequirement.create({
      data: {
        targetRankId: rankByAbbr['LCpl'].id,
        requiredTrainings: {
          connect: [{ id: leadershipTraining.id }],
        },
      },
    }),
    prisma.rankTransitionRequirement.create({
      data: {
        targetRankId: rankByAbbr['Cpl'].id,
        requiredTrainings: {
          connect: [{ id: leadershipTraining.id }, { id: basicCombat.id }],
        },
      },
    }),
  ]);

  await prisma.userRank.createMany({
    data: [
      { userId: admin.id, currentRankId: rankByAbbr['Maj'].id, attendanceSinceLastRank: 0, retired: false, interviewDone: true },
      { userId: alice.id, currentRankId: rankByAbbr['Pvt'].id, attendanceSinceLastRank: 8, retired: false, interviewDone: true },
      { userId: bob.id, currentRankId: rankByAbbr['LCpl'].id, attendanceSinceLastRank: 12, retired: false, interviewDone: true },
      { userId: charlie.id, currentRankId: rankByAbbr['Cpl'].id, attendanceSinceLastRank: 20, retired: false, interviewDone: true },
      { userId: diana.id, currentRankId: rankByAbbr['Sgt'].id, attendanceSinceLastRank: 25, retired: false, interviewDone: true },
      { userId: ethan.id, currentRankId: rankByAbbr['Pvt'].id, attendanceSinceLastRank: 6, retired: false, interviewDone: false },
      { userId: farah.id, currentRankId: rankByAbbr['Rct'].id, attendanceSinceLastRank: 2, retired: false, interviewDone: false },
    ],
    skipDuplicates: true,
  });

  await prisma.rankHistory.createMany({
    data: [
      {
        userId: alice.id,
        previousRankName: 'Recruit',
        newRankName: 'Private',
        attendanceTotalAtChange: 8,
        attendanceDeltaSinceLastRank: 8,
        triggeredBy: 'manual',
        triggeredByUserId: admin.id,
        outcome: 'approved',
        note: 'Promoted after completing BCT',
      },
      {
        userId: bob.id,
        previousRankName: 'Private',
        newRankName: 'Lance Corporal',
        attendanceTotalAtChange: 12,
        attendanceDeltaSinceLastRank: 12,
        triggeredBy: 'manual',
        triggeredByUserId: admin.id,
        outcome: 'approved',
      },
    ],
    skipDuplicates: true,
  });

  await prisma.promotionProposal.createMany({
    data: [
      {
        userId: charlie.id,
        currentRankId: rankByAbbr['Cpl'].id,
        nextRankId: rankByAbbr['Sgt'].id,
        attendanceTotalAtProposal: 24,
        attendanceDeltaSinceLastRank: 4,
        status: 'pending',
      },
      {
        userId: ethan.id,
        currentRankId: rankByAbbr['Pvt'].id,
        nextRankId: rankByAbbr['LCpl'].id,
        attendanceTotalAtProposal: 9,
        attendanceDeltaSinceLastRank: 3,
        status: 'approved',
      },
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
      { slotId: bravoMarksman.id, userId: admin.id },
      { slotId: alphaRifleman.id, userId: ethan.id },
    ],
    skipDuplicates: true,
  });

  const completedOrbat = await prisma.orbat.create({
    data: {
      name: 'Operation Silent Dagger',
      description: 'Completed operation with seeded attendance and raw bot events',
      createdById: admin.id,
      eventDate: daysFromNow(-1),
      startTime: '19:00',
      endTime: '21:00',
      bluforCountry: 'NATO',
      bluforRelationship: 'Friendly',
      opforCountry: 'CSAT',
      opforRelationship: 'Hostile',
      indepCountry: 'AAF',
      indepRelationship: 'Neutral',
      iedThreat: 'Low',
      civilianRelationship: 'Neutral',
      rulesOfEngagement: 'PID',
      airspace: 'Limited',
      inGameTimezone: '11:00',
      operationDay: 'Day 4',
    },
  });

  const [completedCommandSquad, completedSupportSquad] = await Promise.all([
    prisma.squad.create({ data: { orbatId: completedOrbat.id, name: 'Command Squad', orderIndex: 1 } }),
    prisma.squad.create({ data: { orbatId: completedOrbat.id, name: 'Support Squad', orderIndex: 2 } }),
  ]);

  const [
    completedLeaderSlot,
    completedRiflemanSlot,
    completedMedicSlot,
    completedMarksmanSlot,
    completedReserveSlot,
    completedSupportLeadSlot,
    completedSupportRifleSlot,
  ] = await Promise.all([
    prisma.slot.create({ data: { orbatId: completedOrbat.id, squadId: completedCommandSquad.id, squadRoleId: squadRoleByName['Squad Leader'].id, orderIndex: 1, maxSignups: 1 } }),
    prisma.slot.create({ data: { orbatId: completedOrbat.id, squadId: completedCommandSquad.id, squadRoleId: squadRoleByName['Rifleman'].id, orderIndex: 2, maxSignups: 1 } }),
    prisma.slot.create({ data: { orbatId: completedOrbat.id, squadId: completedCommandSquad.id, squadRoleId: squadRoleByName['Medic'].id, orderIndex: 3, maxSignups: 1 } }),
    prisma.slot.create({ data: { orbatId: completedOrbat.id, squadId: completedCommandSquad.id, squadRoleId: squadRoleByName['Marksman'].id, orderIndex: 4, maxSignups: 1 } }),
    prisma.slot.create({ data: { orbatId: completedOrbat.id, squadId: completedCommandSquad.id, squadRoleId: squadRoleByName['Rifleman'].id, orderIndex: 5, maxSignups: 1 } }),
    prisma.slot.create({ data: { orbatId: completedOrbat.id, squadId: completedSupportSquad.id, squadRoleId: squadRoleByName['Squad Leader'].id, orderIndex: 1, maxSignups: 1 } }),
    prisma.slot.create({ data: { orbatId: completedOrbat.id, squadId: completedSupportSquad.id, squadRoleId: squadRoleByName['Rifleman'].id, orderIndex: 2, maxSignups: 1 } }),
  ]);

  const completedSignups = await Promise.all([
    prisma.signup.create({ data: { slotId: completedLeaderSlot.id, userId: admin.id } }),
    prisma.signup.create({ data: { slotId: completedRiflemanSlot.id, userId: alice.id } }),
    prisma.signup.create({ data: { slotId: completedMedicSlot.id, userId: bob.id } }),
    prisma.signup.create({ data: { slotId: completedMarksmanSlot.id, userId: charlie.id } }),
    prisma.signup.create({ data: { slotId: completedReserveSlot.id, userId: diana.id } }),
    prisma.signup.create({ data: { slotId: completedSupportLeadSlot.id, userId: ethan.id } }),
    prisma.signup.create({ data: { slotId: completedSupportRifleSlot.id, userId: farah.id } }),
  ]);

  const completedOrbatDate = completedOrbat.eventDate ?? daysFromNow(-1);
  const attendancePlans = [
    {
      signup: completedSignups[0],
      user: admin,
      status: 'present',
      minutesLate: 8,
      minutesGoneEarly: 3,
      totalMinutesMissed: 11,
      totalMinutesPresent: 109,
      startMinuteOffset: 8,
      endMinuteOffset: 3,
      note: 'Arrived slightly late but maintained command presence.',
    },
    {
      signup: completedSignups[1],
      user: alice,
      status: 'present',
      minutesLate: 0,
      minutesGoneEarly: 0,
      totalMinutesMissed: 0,
      totalMinutesPresent: 120,
      startMinuteOffset: 0,
      endMinuteOffset: 0,
      note: 'Full attendance, no issues.',
    },
    {
      signup: completedSignups[2],
      user: bob,
      status: 'late',
      minutesLate: 28,
      minutesGoneEarly: 0,
      totalMinutesMissed: 28,
      totalMinutesPresent: 92,
      startMinuteOffset: 28,
      endMinuteOffset: 0,
      note: 'Late due to logistics delay.',
    },
    {
      signup: completedSignups[3],
      user: charlie,
      status: 'gone_early',
      minutesLate: 0,
      minutesGoneEarly: 25,
      totalMinutesMissed: 25,
      totalMinutesPresent: 95,
      startMinuteOffset: 0,
      endMinuteOffset: 25,
      note: 'Exited early for an urgent admin task.',
    },
    {
      signup: completedSignups[4],
      user: diana,
      status: 'partial',
      minutesLate: 30,
      minutesGoneEarly: 35,
      totalMinutesMissed: 65,
      totalMinutesPresent: 55,
      startMinuteOffset: 30,
      endMinuteOffset: 35,
      note: 'Missed start and extracted early during opfor pressure.',
    },
    {
      signup: completedSignups[5],
      user: ethan,
      status: 'absent',
      minutesLate: 120,
      minutesGoneEarly: 0,
      totalMinutesMissed: 120,
      totalMinutesPresent: 0,
      note: 'Marked absent by command.',
    },
    {
      signup: completedSignups[6],
      user: farah,
      status: 'no_show',
      minutesLate: 120,
      minutesGoneEarly: 0,
      totalMinutesMissed: 120,
      totalMinutesPresent: 0,
      note: 'No join event captured during operation window.',
    },
  ] as const;

  const attendanceStartBase = new Date(`${formatDateToYyyyMmDd(completedOrbatDate)}T19:00:00.000Z`);
  const attendanceEndBase = new Date(`${formatDateToYyyyMmDd(completedOrbatDate)}T21:00:00.000Z`);

  for (const plan of attendancePlans) {
    const attendance = await prisma.attendance.create({
      data: {
        signupId: plan.signup.id,
        orbatId: completedOrbat.id,
        userId: plan.user.id,
        status: plan.status,
        minutesLate: plan.minutesLate,
        minutesGoneEarly: plan.minutesGoneEarly,
        totalMinutesMissed: plan.totalMinutesMissed,
        totalMinutesPresent: plan.totalMinutesPresent,
        notes: plan.note,
      },
    });

    if (plan.totalMinutesPresent > 0 && typeof plan.startMinuteOffset === 'number' && typeof plan.endMinuteOffset === 'number') {
      const checkIn = new Date(attendanceStartBase.getTime() + plan.startMinuteOffset * 60 * 1000);
      const checkOut = new Date(attendanceEndBase.getTime() - plan.endMinuteOffset * 60 * 1000);

      await prisma.attendanceSession.create({
        data: {
          attendanceId: attendance.id,
          userId: plan.user.id,
          checkedInAt: checkIn,
          checkedOutAt: checkOut,
          durationMinutes: plan.totalMinutesPresent,
          sessionDate: completedOrbatDate,
        },
      });

      await prisma.attendanceEvent.createMany({
        data: [
          {
            userId: plan.user.id,
            steamId: `7656119800000${plan.user.id.toString().padStart(4, '0')}`,
            discordId: `dev-discord-${plan.user.id}`,
            isJoin: true,
            eventTime: checkIn,
            processed: true,
          },
          {
            userId: plan.user.id,
            steamId: `7656119800000${plan.user.id.toString().padStart(4, '0')}`,
            discordId: `dev-discord-${plan.user.id}`,
            isJoin: false,
            eventTime: checkOut,
            processed: true,
          },
        ],
      });
    } else {
      await prisma.attendanceEvent.createMany({
        data: [
          {
            userId: plan.user.id,
            steamId: `7656119800000${plan.user.id.toString().padStart(4, '0')}`,
            discordId: `dev-discord-${plan.user.id}`,
            isJoin: true,
            eventTime: new Date(attendanceStartBase.getTime() - 20 * 60 * 1000),
            processed: false,
          },
          {
            userId: plan.user.id,
            steamId: `7656119800000${plan.user.id.toString().padStart(4, '0')}`,
            discordId: `dev-discord-${plan.user.id}`,
            isJoin: false,
            eventTime: new Date(attendanceEndBase.getTime() + 15 * 60 * 1000),
            processed: false,
          },
        ],
      });
    }

    await prisma.attendanceLog.create({
      data: {
        attendanceId: attendance.id,
        action: 'created',
        source: 'automated_system',
        changedById: admin.id,
        newValue: {
          status: plan.status,
          minutesLate: plan.minutesLate,
          minutesGoneEarly: plan.minutesGoneEarly,
          totalMinutesPresent: plan.totalMinutesPresent,
        },
      },
    });
  }

  await prisma.attendanceEvent.createMany({
    data: [
      {
        steamId: '76561198000009999',
        discordId: 'pending-user-1',
        isJoin: true,
        eventTime: new Date(attendanceStartBase.getTime() + 4 * 60 * 1000),
        processed: false,
      },
      {
        steamId: '76561198000008888',
        discordId: 'pending-user-2',
        isJoin: false,
        eventTime: new Date(attendanceEndBase.getTime() - 10 * 60 * 1000),
        processed: false,
      },
    ],
  });

  await prisma.orbatAttendanceNote.createMany({
    data: [
      { orbatId: futureOrbat.id, userId: admin.id, status: 'unsure', reason: 'Monitoring command net prior to final confirmation' },
      { orbatId: futureOrbat.id, userId: alice.id, status: 'late_unsure', reason: 'Expected 10 minutes late due to work shift', lateMinutes: 10 },
      { orbatId: futureOrbat.id, userId: farah.id, status: 'absent', reason: 'LOA overlap with operation date' },
    ],
    skipDuplicates: true,
  });

  await prisma.orbatRadioFrequency.createMany({
    data: [
      { orbatId: futureOrbat.id, radioFrequencyId: srFreq1.id },
      { orbatId: futureOrbat.id, radioFrequencyId: srFreq2.id },
      { orbatId: futureOrbat.id, radioFrequencyId: lrFreq1.id },
      { orbatId: futureOrbat.id, radioFrequencyId: asrFreq.id },
      { orbatId: completedOrbat.id, radioFrequencyId: srFreq1.id },
      { orbatId: completedOrbat.id, radioFrequencyId: lrFreq1.id },
    ],
    skipDuplicates: true,
  });

  await prisma.trainingRequest.createMany({
    data: [
      {
        userId: alice.id,
        trainingId: sniperTraining.id,
        status: 'pending',
        requestMessage: 'Requesting sniper qualification to support recon element.',
      },
      {
        userId: farah.id,
        trainingId: medicalTraining.id,
        status: 'approved',
        requestMessage: 'Want to support as backup medic.',
        adminResponse: 'Approved. Schedule next training cycle.',
        handledByAdminId: admin.id,
      },
      {
        userId: ethan.id,
        trainingId: leadershipTraining.id,
        status: 'rejected',
        requestMessage: 'Applying for leadership early.',
        adminResponse: 'Need more attendance and one more completed operation.',
        handledByAdminId: admin.id,
      },
      {
        userId: bob.id,
        trainingId: medicalTraining.id,
        status: 'qualified',
        requestMessage: 'Completed practical exam last week.',
        adminResponse: 'Recorded as qualified.',
        handledByAdminId: admin.id,
      },
    ],
    skipDuplicates: true,
  });

  await prisma.leaveOfAbsence.createMany({
    data: [
      {
        userId: farah.id,
        startDate: daysFromNow(-2),
        returnDate: daysFromNow(4),
        reason: 'Travel and limited game access.',
      },
      {
        userId: bob.id,
        startDate: daysFromNow(-15),
        returnDate: daysFromNow(-10),
        cancelledAt: daysFromNow(-12),
        reason: 'Cancelled LOA after returning early.',
      },
    ],
  });

  const editPermission = await prisma.permission.findUnique({ where: { key: 'orbat:edit' } });
  if (editPermission) {
    await prisma.permissionAuditLog.create({
      data: {
        actorId: admin.id,
        targetUserId: ethan.id,
        permissionId: editPermission.id,
        action: 'GRANT',
        oldValue: null,
        newValue: 25,
        reason: 'Dev seed: simulate delegated ORBAT editor role.',
        metadata: {
          source: 'seed.dev.ts',
        },
      },
    });
  }

  await prisma.botToken.createMany({
    data: [
      {
        name: 'Main Dev Bot',
        token: `dev-bot-token-main-${Date.now()}`,
        isActive: true,
        createdById: admin.id,
      },
      {
        name: 'Backup Dev Bot',
        token: `dev-bot-token-backup-${Date.now()}`,
        isActive: false,
        createdById: admin.id,
      },
    ],
    skipDuplicates: true,
  });

  await prisma.legacyUserData.createMany({
    data: [
      {
        legacyId: 'LEG-1001',
        discordUsername: 'AliceLegacy',
        rankName: 'Private',
        dateJoined: '2024-01-12',
        tigSinceLastPromo: 8,
        totalTig: 20,
        oldData: 3,
        mappedUserId: alice.id,
        isMapped: true,
        isApplied: true,
      },
      {
        legacyId: 'LEG-1002',
        discordUsername: 'FarahLegacy',
        rankName: 'Recruit',
        dateJoined: '2025-08-01',
        tigSinceLastPromo: 2,
        totalTig: 2,
        oldData: 0,
        mappedUserId: farah.id,
        isMapped: true,
        isApplied: false,
      },
    ],
    skipDuplicates: true,
  });

  await prisma.legacyAttendanceData.createMany({
    data: [
      {
        legacyName: 'AliceLegacy',
        legacyUserId: 'LEG-1001',
        legacyStatus: 'P',
        legacyNotes: 'Imported from old roster export',
        legacyEventDate: completedOrbatDate,
        mappedUserId: alice.id,
        isMapped: true,
      },
      {
        legacyName: 'UnknownLegacy',
        legacyUserId: 'LEG-1999',
        legacyStatus: 'NO',
        legacyNotes: 'No mapping found yet',
        legacyEventDate: completedOrbatDate,
        isMapped: false,
      },
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

  const allUsers = [admin, alice, bob, charlie, diana, ethan, farah];
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

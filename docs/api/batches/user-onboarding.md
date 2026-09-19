# User onboarding queue

Canonical `GET /users/onboarding` under /api replaces GET/admin/users/unranked. Requires global user:manage and live user:manage target hierarchy; bots superadmin. Queue retains users without a current rank OR with an unfinished interview OR missing any required-for-new-people training. Ranked, fully trained users remain visible until their interview is marked complete. SQL visibility and all filters precede pagination.

Only querylimit/cursor and optional stricttrue|false interviewDone,retired,requiredTrainingsCompleted. Defaultlimit50cap100, ascending userID exclusivecursor, actual lookaheadnextCursor/string-or-null. Missing userRank counts interviewDonefalse/retiredfalse. Omitted boolean means all. Old page/sort/interview/bct strings reject400; duplicate/unknown/invalid queries400.

Required training completion means qualified, or finished only when the training does not require ORBAT qualification. Relational predicates replace loading every user into application memory. An empty required-training set is complete (corrects prior false UI marker). DTO dataarray `{id,username,userRank:{interviewDone,retired}|null,attendanceTotal,requiredTrainingsCompleted}`. No email/avatar/account records. Attendance uses shared present-main-operation plus legacy counts, correcting the old count of every attendance status/operation. Returned user IDs other than sessionactor audited user_data.read/resourceuser_onboarding without snapshots. Bots allreturned, no lookahead; self-only/empty no audit. Auditfailure500 withholds personaldata.

UserManagementClient fetches all cursor pages viaapiList, then locallysorts username for presentation and uses the new boolean field. Existing bulk rank/status mutation flows unchanged. No schema changes.

Tests14 focused unit cases pass;4 real Prisma cases cover ranked-but-incomplete queue inclusion, actual qualification/finished semantics, SQL hierarchy before pagination, no privatefields, main+legacyattendance, self/bot audits, required-audit failure and livegrants/tokenrevocation. Required fixture training flags reset afterfile so other families are unaffected.

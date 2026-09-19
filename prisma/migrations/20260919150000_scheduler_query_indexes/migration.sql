CREATE INDEX "AttendanceEvent_userId_eventTime_id_idx" ON "AttendanceEvent"("userId", "eventTime", "id");
CREATE INDEX "BotEvent_type_aggregateId_idx" ON "BotEvent"("type", "aggregateId");
CREATE INDEX "SchedulerJob_completedAt_dueAt_key_idx" ON "SchedulerJob"("completedAt", "dueAt", "key");

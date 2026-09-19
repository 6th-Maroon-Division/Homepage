CREATE INDEX "TrainingSession_status_startsAt_id_idx" ON "TrainingSession"("status", "startsAt", "id");
CREATE INDEX "TrainingSessionAttendee_reminder24hSentAt_status_sessionId_id_idx" ON "TrainingSessionAttendee"("reminder24hSentAt", "status", "sessionId", "id");
CREATE INDEX "TrainingSessionAttendee_sessionId_id_idx" ON "TrainingSessionAttendee"("sessionId", "id");

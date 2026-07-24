-- The preceding migration committed the new enum values. Everything below is
-- atomic: if a preservation assertion fails, PostgreSQL rolls the whole change
-- back instead of leaving a partially upgraded training system.
BEGIN;

-- Stabilize the legacy request set while it is snapshotted and migrated.
LOCK TABLE "TrainingRequest" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "_pending_training_request_snapshot" AS
SELECT
    "id",
    "userId",
    "trainingId",
    "status",
    "requestMessage",
    "requestedAt",
    "updatedAt"
FROM "TrainingRequest"
WHERE "status" = 'pending';

CREATE TYPE "UserTrainingStatus" AS ENUM (
    'approved',
    'in_training',
    'finished',
    'needs_qualify',
    'qualified',
    'failed'
);

CREATE TYPE "TrainingSessionStatus" AS ENUM (
    'proposed',
    'scheduled',
    'in_progress',
    'completed',
    'cancelled'
);

CREATE TYPE "TrainingSessionAttendeeStatus" AS ENUM (
    'scheduled',
    'attended',
    'completed',
    'absent',
    'cancelled'
);

CREATE TYPE "TrainingRequestMessageSenderRole" AS ENUM (
    'USER',
    'STAFF',
    'SYSTEM'
);

ALTER TABLE "Training"
    ADD COLUMN "requiresTrainingSession" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "requiresOrbatQualification" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "orbatQualificationNotes" TEXT;

ALTER TABLE "UserTraining"
    ADD COLUMN "status" "UserTrainingStatus" NOT NULL DEFAULT 'qualified',
    ADD COLUMN "trainingSessionCompletedAt" TIMESTAMP(3),
    ADD COLUMN "orbatQualifiedAt" TIMESTAMP(3),
    ADD COLUMN "failedAt" TIMESTAMP(3),
    ADD COLUMN "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "TrainingRequest"
    ADD COLUMN "assignedTrainerId" INTEGER;

-- Every pre-migration UserTraining row represented an entitlement. Preserve that entitlement
-- as qualified unless the legacy row explicitly required retraining, which remains blocked.
UPDATE "UserTraining"
SET
    "status" = CASE
        WHEN "needsRetraining" THEN 'failed'::"UserTrainingStatus"
        ELSE 'qualified'::"UserTrainingStatus"
    END,
    "trainingSessionCompletedAt" = "completedAt",
    "orbatQualifiedAt" = CASE WHEN "needsRetraining" THEN NULL ELSE "completedAt" END,
    "failedAt" = CASE WHEN "needsRetraining" THEN "completedAt" ELSE NULL END,
    "statusUpdatedAt" = GREATEST("assignedAt", "completedAt");

-- Keep the legacy boolean compatible during a rolling deployment while the
-- enhanced application treats status as the source of truth.
CREATE FUNCTION "sync_user_training_legacy_retraining"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."needsRetraining" THEN
            NEW."status" := 'failed';
        ELSE
            NEW."needsRetraining" := NEW."status" = 'failed';
        END IF;
    ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
        NEW."needsRetraining" := NEW."status" = 'failed';
    ELSIF NEW."needsRetraining" IS DISTINCT FROM OLD."needsRetraining" THEN
        NEW."status" := CASE
            WHEN NEW."needsRetraining" THEN 'failed'::"UserTrainingStatus"
            ELSE 'qualified'::"UserTrainingStatus"
        END;
        NEW."statusUpdatedAt" := CURRENT_TIMESTAMP;
        NEW."failedAt" := CASE WHEN NEW."needsRetraining" THEN CURRENT_TIMESTAMP ELSE NULL END;
        NEW."orbatQualifiedAt" := CASE
            WHEN NEW."needsRetraining" THEN NULL
            ELSE COALESCE(NEW."orbatQualifiedAt", CURRENT_TIMESTAMP)
        END;
    END IF;

    IF NEW."status" = 'qualified' THEN
        NEW."trainingSessionCompletedAt" := COALESCE(
            NEW."trainingSessionCompletedAt",
            NEW."completedAt"
        );
        NEW."orbatQualifiedAt" := COALESCE(
            NEW."orbatQualifiedAt",
            NEW."completedAt",
            CURRENT_TIMESTAMP
        );
        NEW."failedAt" := NULL;
    ELSIF NEW."status" IN ('finished', 'needs_qualify') THEN
        NEW."trainingSessionCompletedAt" := COALESCE(
            NEW."trainingSessionCompletedAt",
            NEW."completedAt",
            CURRENT_TIMESTAMP
        );
        NEW."orbatQualifiedAt" := NULL;
        NEW."failedAt" := NULL;
    ELSIF NEW."status" = 'failed' THEN
        NEW."orbatQualifiedAt" := NULL;
        NEW."failedAt" := COALESCE(NEW."failedAt", CURRENT_TIMESTAMP);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "UserTraining_legacy_retraining_sync"
BEFORE INSERT OR UPDATE OF "status", "needsRetraining"
ON "UserTraining"
FOR EACH ROW
EXECUTE FUNCTION "sync_user_training_legacy_retraining"();

ALTER TABLE "UserTraining"
    ADD CONSTRAINT "UserTraining_status_retraining_check"
    CHECK ("needsRetraining" = ("status" = 'failed'::"UserTrainingStatus"));

-- The old approval/completion endpoint granted a UserTraining immediately. Repair any legacy
-- rows inserted outside that endpoint before translating those requests to the new final state.
INSERT INTO "UserTraining" (
    "userId",
    "trainerId",
    "trainingId",
    "completedAt",
    "needsRetraining",
    "isHidden",
    "notes",
    "assignedAt",
    "status",
    "trainingSessionCompletedAt",
    "orbatQualifiedAt",
    "failedAt",
    "statusUpdatedAt"
)
SELECT DISTINCT ON (request."userId", request."trainingId")
    request."userId",
    request."handledByAdminId",
    request."trainingId",
    request."updatedAt",
    false,
    false,
    COALESCE(request."adminResponse", 'Migrated from an approved legacy training request'),
    request."requestedAt",
    'qualified'::"UserTrainingStatus",
    request."updatedAt",
    request."updatedAt",
    NULL,
    request."updatedAt"
FROM "TrainingRequest" AS request
WHERE request."status" IN ('approved', 'completed')
ORDER BY
    request."userId",
    request."trainingId",
    request."updatedAt" DESC,
    request."id" DESC
ON CONFLICT ("userId", "trainingId") DO UPDATE
SET
    "trainerId" = COALESCE("UserTraining"."trainerId", EXCLUDED."trainerId"),
    "status" = CASE
        WHEN "UserTraining"."needsRetraining" THEN 'failed'::"UserTrainingStatus"
        ELSE 'qualified'::"UserTrainingStatus"
    END,
    "trainingSessionCompletedAt" = COALESCE(
        "UserTraining"."trainingSessionCompletedAt",
        EXCLUDED."trainingSessionCompletedAt"
    ),
    "orbatQualifiedAt" = CASE
        WHEN "UserTraining"."needsRetraining" THEN NULL
        ELSE COALESCE("UserTraining"."orbatQualifiedAt", "UserTraining"."completedAt")
    END,
    "failedAt" = CASE
        WHEN "UserTraining"."needsRetraining" THEN COALESCE("UserTraining"."failedAt", "UserTraining"."completedAt")
        ELSE NULL
    END,
    "statusUpdatedAt" = GREATEST("UserTraining"."statusUpdatedAt", EXCLUDED."statusUpdatedAt");

UPDATE "TrainingRequest" AS request
SET "assignedTrainerId" = COALESCE(user_training."trainerId", request."handledByAdminId")
FROM "UserTraining" AS user_training
WHERE request."userId" = user_training."userId"
  AND request."trainingId" = user_training."trainingId"
  AND request."status" IN ('approved', 'completed');

-- Legacy approved/completed meant the user had already been granted the training. Preserve a
-- legacy retraining block as failed; otherwise retain the granted entitlement as qualified.
-- Pending rows are intentionally not touched: they remain the first workflow step.
UPDATE "TrainingRequest" AS request
SET "status" = CASE
    WHEN user_training."needsRetraining" THEN 'failed'::"TrainingRequestStatus"
    ELSE 'qualified'::"TrainingRequestStatus"
END
FROM "UserTraining" AS user_training
WHERE request."userId" = user_training."userId"
  AND request."trainingId" = user_training."trainingId"
  AND request."status" IN ('approved', 'completed');

CREATE TABLE "TrainingSession" (
    "id" SERIAL NOT NULL,
    "trainingId" INTEGER NOT NULL,
    "trainerId" INTEGER,
    "createdById" INTEGER,
    "startsAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "status" "TrainingSessionStatus" NOT NULL DEFAULT 'proposed',
    "specialInstructions" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrainingSession_durationMinutes_check" CHECK (
        "durationMinutes" IS NULL OR "durationMinutes" > 0
    )
);

CREATE TABLE "TrainingSessionAttendee" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "trainingRequestId" INTEGER,
    "status" "TrainingSessionAttendeeStatus" NOT NULL DEFAULT 'scheduled',
    "attendedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reminder24hSentAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSessionAttendee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingRequestMessage" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "senderId" INTEGER,
    "senderRole" "TrainingRequestMessageSenderRole" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "TrainingRequestMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrainingRequestMessage_body_check" CHECK (length(btrim("body")) > 0)
);

CREATE TABLE "TrainingRequestReadState" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "lastReadMessageId" INTEGER,
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingRequestReadState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingRequestSubscription" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "websiteEnabled" BOOLEAN NOT NULL DEFAULT false,
    "discordEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingRequestSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserTrainingStatusHistory" (
    "id" SERIAL NOT NULL,
    "userTrainingId" INTEGER NOT NULL,
    "fromStatus" "UserTrainingStatus",
    "toStatus" "UserTrainingStatus" NOT NULL,
    "changedById" INTEGER,
    "trainingSessionId" INTEGER,
    "orbatId" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTrainingStatusHistory_pkey" PRIMARY KEY ("id")
);

-- Preserve each existing request's original user-authored message as the first chat message.
INSERT INTO "TrainingRequestMessage" (
    "requestId",
    "senderId",
    "senderRole",
    "body",
    "createdAt"
)
SELECT
    request."id",
    request."userId",
    'USER'::"TrainingRequestMessageSenderRole",
    request."requestMessage",
    request."requestedAt"
FROM "TrainingRequest" AS request
WHERE NULLIF(btrim(request."requestMessage"), '') IS NOT NULL;

-- Preserve the legacy staff response in the same durable conversation. The
-- API redacts STAFF sender identity from the requester until scheduling.
INSERT INTO "TrainingRequestMessage" (
    "requestId",
    "senderId",
    "senderRole",
    "body",
    "createdAt"
)
SELECT
    request."id",
    request."handledByAdminId",
    'STAFF'::"TrainingRequestMessageSenderRole",
    request."adminResponse",
    request."updatedAt"
FROM "TrainingRequest" AS request
WHERE NULLIF(btrim(request."adminResponse"), '') IS NOT NULL;

-- Seed one auditable baseline status event for every legacy or repaired UserTraining row.
INSERT INTO "UserTrainingStatusHistory" (
    "userTrainingId",
    "fromStatus",
    "toStatus",
    "changedById",
    "notes",
    "createdAt"
)
SELECT
    user_training."id",
    NULL,
    user_training."status",
    user_training."trainerId",
    'Initial status migrated from the legacy training system',
    user_training."statusUpdatedAt"
FROM "UserTraining" AS user_training;

CREATE INDEX "UserTraining_status_idx" ON "UserTraining"("status");

CREATE INDEX "TrainingRequest_assignedTrainerId_idx"
    ON "TrainingRequest"("assignedTrainerId");

CREATE INDEX "TrainingSession_trainingId_idx" ON "TrainingSession"("trainingId");
CREATE INDEX "TrainingSession_trainerId_idx" ON "TrainingSession"("trainerId");
CREATE INDEX "TrainingSession_createdById_idx" ON "TrainingSession"("createdById");
CREATE INDEX "TrainingSession_startsAt_idx" ON "TrainingSession"("startsAt");
CREATE INDEX "TrainingSession_status_idx" ON "TrainingSession"("status");

CREATE UNIQUE INDEX "TrainingSessionAttendee_trainingRequestId_key"
    ON "TrainingSessionAttendee"("trainingRequestId");
CREATE UNIQUE INDEX "TrainingSessionAttendee_sessionId_userId_key"
    ON "TrainingSessionAttendee"("sessionId", "userId");
CREATE INDEX "TrainingSessionAttendee_sessionId_idx" ON "TrainingSessionAttendee"("sessionId");
CREATE INDEX "TrainingSessionAttendee_userId_idx" ON "TrainingSessionAttendee"("userId");
CREATE INDEX "TrainingSessionAttendee_status_idx" ON "TrainingSessionAttendee"("status");

CREATE INDEX "TrainingRequestMessage_requestId_createdAt_idx"
    ON "TrainingRequestMessage"("requestId", "createdAt");
CREATE INDEX "TrainingRequestMessage_senderId_idx" ON "TrainingRequestMessage"("senderId");

CREATE UNIQUE INDEX "TrainingRequestReadState_requestId_userId_key"
    ON "TrainingRequestReadState"("requestId", "userId");
CREATE INDEX "TrainingRequestReadState_userId_idx" ON "TrainingRequestReadState"("userId");
CREATE INDEX "TrainingRequestReadState_lastReadMessageId_idx"
    ON "TrainingRequestReadState"("lastReadMessageId");

CREATE UNIQUE INDEX "TrainingRequestSubscription_requestId_userId_key"
    ON "TrainingRequestSubscription"("requestId", "userId");
CREATE INDEX "TrainingRequestSubscription_userId_idx"
    ON "TrainingRequestSubscription"("userId");

CREATE INDEX "UserTrainingStatusHistory_userTrainingId_createdAt_idx"
    ON "UserTrainingStatusHistory"("userTrainingId", "createdAt");
CREATE INDEX "UserTrainingStatusHistory_changedById_idx"
    ON "UserTrainingStatusHistory"("changedById");
CREATE INDEX "UserTrainingStatusHistory_trainingSessionId_idx"
    ON "UserTrainingStatusHistory"("trainingSessionId");
CREATE INDEX "UserTrainingStatusHistory_orbatId_idx"
    ON "UserTrainingStatusHistory"("orbatId");
CREATE INDEX "UserTrainingStatusHistory_toStatus_idx"
    ON "UserTrainingStatusHistory"("toStatus");

ALTER TABLE "TrainingRequest"
    ADD CONSTRAINT "TrainingRequest_assignedTrainerId_fkey"
    FOREIGN KEY ("assignedTrainerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Requests and their chat are audit records. Prevent parent deletion from
-- silently cascading the conversation away.
ALTER TABLE "TrainingRequest"
    DROP CONSTRAINT "TrainingRequest_userId_fkey",
    ADD CONSTRAINT "TrainingRequest_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    DROP CONSTRAINT "TrainingRequest_trainingId_fkey",
    ADD CONSTRAINT "TrainingRequest_trainingId_fkey"
        FOREIGN KEY ("trainingId") REFERENCES "Training"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingSession"
    ADD CONSTRAINT "TrainingSession_trainingId_fkey"
    FOREIGN KEY ("trainingId") REFERENCES "Training"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingSession"
    ADD CONSTRAINT "TrainingSession_trainerId_fkey"
    FOREIGN KEY ("trainerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingSession"
    ADD CONSTRAINT "TrainingSession_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrainingSessionAttendee"
    ADD CONSTRAINT "TrainingSessionAttendee_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionAttendee"
    ADD CONSTRAINT "TrainingSessionAttendee_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionAttendee"
    ADD CONSTRAINT "TrainingSessionAttendee_trainingRequestId_fkey"
    FOREIGN KEY ("trainingRequestId") REFERENCES "TrainingRequest"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrainingRequestMessage"
    ADD CONSTRAINT "TrainingRequestMessage_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "TrainingRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingRequestMessage"
    ADD CONSTRAINT "TrainingRequestMessage_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrainingRequestReadState"
    ADD CONSTRAINT "TrainingRequestReadState_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "TrainingRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingRequestReadState"
    ADD CONSTRAINT "TrainingRequestReadState_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingRequestReadState"
    ADD CONSTRAINT "TrainingRequestReadState_lastReadMessageId_fkey"
    FOREIGN KEY ("lastReadMessageId") REFERENCES "TrainingRequestMessage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrainingRequestSubscription"
    ADD CONSTRAINT "TrainingRequestSubscription_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "TrainingRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingRequestSubscription"
    ADD CONSTRAINT "TrainingRequestSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing request owners keep the pre-enhancement behavior of receiving
-- website scheduling messages, while gaining an explicit saved preference
-- they can change (and optionally extend to Discord) in the new chat UI.
INSERT INTO "TrainingRequestSubscription" (
    "requestId", "userId", "websiteEnabled", "discordEnabled", "updatedAt"
)
SELECT
    request."id", request."userId", true, false, CURRENT_TIMESTAMP
FROM "TrainingRequest" AS request
ON CONFLICT ("requestId", "userId") DO NOTHING;

ALTER TABLE "UserTrainingStatusHistory"
    ADD CONSTRAINT "UserTrainingStatusHistory_userTrainingId_fkey"
    FOREIGN KEY ("userTrainingId") REFERENCES "UserTraining"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTrainingStatusHistory"
    ADD CONSTRAINT "UserTrainingStatusHistory_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserTrainingStatusHistory"
    ADD CONSTRAINT "UserTrainingStatusHistory_trainingSessionId_fkey"
    FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserTrainingStatusHistory"
    ADD CONSTRAINT "UserTrainingStatusHistory_orbatId_fkey"
    FOREIGN KEY ("orbatId") REFERENCES "Orbat"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep cross-linked records internally consistent even if a future caller
-- bypasses the API validation.
CREATE FUNCTION "enforce_training_read_state_message"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "TrainingRequestReadState" AS current_read_state
        WHERE current_read_state."id" = NEW."id"
          AND current_read_state."lastReadMessageId" IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM "TrainingRequestMessage" AS message
              WHERE message."id" = current_read_state."lastReadMessageId"
                AND message."requestId" = current_read_state."requestId"
          )
    ) THEN
        RAISE EXCEPTION 'last-read message must belong to the same training request'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "TrainingRequestReadState_message_request_check"
AFTER INSERT OR UPDATE
ON "TrainingRequestReadState"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_training_read_state_message"();

CREATE FUNCTION "enforce_training_message_read_states"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "TrainingRequestMessage" AS current_message
        JOIN "TrainingRequestReadState" AS read_state
          ON read_state."lastReadMessageId" = current_message."id"
        WHERE current_message."id" = NEW."id"
          AND read_state."requestId" <> current_message."requestId"
    ) THEN
        RAISE EXCEPTION 'message must match every referencing read-state request'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "TrainingRequestMessage_read_state_request_check"
AFTER INSERT OR UPDATE
ON "TrainingRequestMessage"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_training_message_read_states"();

CREATE FUNCTION "enforce_training_attendee_request"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "TrainingSessionAttendee" AS current_attendee
        WHERE current_attendee."id" = NEW."id"
          AND current_attendee."trainingRequestId" IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM "TrainingRequest" AS request
              JOIN "TrainingSession" AS session
                ON session."id" = current_attendee."sessionId"
              WHERE request."id" = current_attendee."trainingRequestId"
                AND request."userId" = current_attendee."userId"
                AND request."trainingId" = session."trainingId"
          )
    ) THEN
        RAISE EXCEPTION 'session attendee must match the request user and training'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "TrainingSessionAttendee_request_match_check"
AFTER INSERT OR UPDATE
ON "TrainingSessionAttendee"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_training_attendee_request"();

CREATE FUNCTION "enforce_training_request_attendees"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "TrainingRequest" AS current_request
        JOIN "TrainingSessionAttendee" AS attendee
          ON attendee."trainingRequestId" = current_request."id"
        JOIN "TrainingSession" AS session ON session."id" = attendee."sessionId"
        WHERE current_request."id" = NEW."id"
          AND (
              attendee."userId" <> current_request."userId"
              OR session."trainingId" <> current_request."trainingId"
          )
    ) THEN
        RAISE EXCEPTION 'training request must match every linked session attendee'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "TrainingRequest_attendee_match_check"
AFTER INSERT OR UPDATE
ON "TrainingRequest"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_training_request_attendees"();

CREATE FUNCTION "enforce_training_session_attendees"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "TrainingSession" AS current_session
        JOIN "TrainingSessionAttendee" AS attendee
          ON attendee."sessionId" = current_session."id"
        JOIN "TrainingRequest" AS request
          ON request."id" = attendee."trainingRequestId"
        WHERE current_session."id" = NEW."id"
          AND (
              attendee."userId" <> request."userId"
              OR current_session."trainingId" <> request."trainingId"
          )
    ) THEN
        RAISE EXCEPTION 'training session must match every linked attendee request'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "TrainingSession_attendee_match_check"
AFTER INSERT OR UPDATE
ON "TrainingSession"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_training_session_attendees"();

-- Short-overlap compatibility bridge: an old write already queued on the
-- migration lock may resume immediately after it is released. This protects
-- that narrow race, but deployments must still quiesce old readers during the
-- enum cutover. Dual-write legacy request/admin text into durable chat.
CREATE FUNCTION "sync_training_request_legacy_chat"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    request_message_time TIMESTAMP(3);
BEGIN
    request_message_time := CASE
        WHEN TG_OP = 'INSERT' THEN NEW."requestedAt"
        ELSE NEW."updatedAt"
    END;

    IF NULLIF(btrim(NEW."requestMessage"), '') IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW."requestMessage" IS DISTINCT FROM OLD."requestMessage")
       AND NOT EXISTS (
           SELECT 1
           FROM "TrainingRequestMessage" AS message
           WHERE message."requestId" = NEW."id"
             AND message."senderId" = NEW."userId"
             AND message."senderRole" = 'USER'
             AND message."body" = NEW."requestMessage"
             AND message."createdAt" = request_message_time
       )
    THEN
        INSERT INTO "TrainingRequestMessage" (
            "requestId", "senderId", "senderRole", "body", "createdAt"
        ) VALUES (
            NEW."id", NEW."userId", 'USER', NEW."requestMessage", request_message_time
        );
    END IF;

    IF NULLIF(btrim(NEW."adminResponse"), '') IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW."adminResponse" IS DISTINCT FROM OLD."adminResponse")
       AND NOT EXISTS (
           SELECT 1
           FROM "TrainingRequestMessage" AS message
           WHERE message."requestId" = NEW."id"
             AND message."senderId" IS NOT DISTINCT FROM NEW."handledByAdminId"
             AND message."senderRole" = 'STAFF'
             AND message."body" = NEW."adminResponse"
             AND message."createdAt" = NEW."updatedAt"
       )
    THEN
        INSERT INTO "TrainingRequestMessage" (
            "requestId", "senderId", "senderRole", "body", "createdAt"
        ) VALUES (
            NEW."id", NEW."handledByAdminId", 'STAFF', NEW."adminResponse", NEW."updatedAt"
        );
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "TrainingRequest_legacy_chat_sync"
AFTER INSERT OR UPDATE OF "requestMessage", "adminResponse"
ON "TrainingRequest"
FOR EACH ROW
EXECUTE FUNCTION "sync_training_request_legacy_chat"();

-- Old approval code granted UserTraining in the same transaction. At commit,
-- derive the request state from that credential; new code writes `approved`
-- to both records and is therefore a no-op here.
CREATE FUNCTION "reconcile_legacy_training_request_status"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    current_request_status "TrainingRequestStatus";
    credential_status "UserTrainingStatus";
BEGIN
    SELECT request."status"
    INTO current_request_status
    FROM "TrainingRequest" AS request
    WHERE request."id" = NEW."id";

    IF current_request_status NOT IN ('approved', 'completed') THEN
        RETURN NEW;
    END IF;

    SELECT user_training."status"
    INTO credential_status
    FROM "UserTraining" AS user_training
    JOIN "TrainingRequest" AS request
      ON request."userId" = user_training."userId"
     AND request."trainingId" = user_training."trainingId"
    WHERE request."id" = NEW."id";

    IF credential_status IS NOT NULL
       AND current_request_status::text <> credential_status::text
    THEN
        UPDATE "TrainingRequest"
        SET "status" = (credential_status::text)::"TrainingRequestStatus"
        WHERE "id" = NEW."id"
          AND "status" = current_request_status;
    END IF;

    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "TrainingRequest_legacy_status_reconcile"
AFTER INSERT OR UPDATE
ON "TrainingRequest"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "reconcile_legacy_training_request_status"();

-- Migration invariant: every non-empty legacy request message, including every pending
-- request, must now exist as a user-authored first chat message with its original timestamp.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "_pending_training_request_snapshot" AS before
        FULL JOIN (
            SELECT * FROM "TrainingRequest" WHERE "status" = 'pending'
        ) AS after ON after."id" = before."id"
        WHERE before."id" IS NULL
           OR after."id" IS NULL
           OR after."status" <> 'pending'
           OR after."userId" <> before."userId"
           OR after."trainingId" <> before."trainingId"
           OR after."requestMessage" IS DISTINCT FROM before."requestMessage"
           OR after."requestedAt" <> before."requestedAt"
           OR after."updatedAt" <> before."updatedAt"
    ) THEN
        RAISE EXCEPTION 'Training workflow migration changed an existing pending request';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "TrainingRequest" AS request
        WHERE NULLIF(btrim(request."requestMessage"), '') IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM "TrainingRequestMessage" AS message
              WHERE message."requestId" = request."id"
                AND message."senderId" = request."userId"
                AND message."senderRole" = 'USER'
                AND message."body" = request."requestMessage"
                AND message."createdAt" = request."requestedAt"
          )
    ) THEN
        RAISE EXCEPTION 'Training workflow migration did not preserve every legacy request message';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "TrainingRequest" AS request
        WHERE NULLIF(btrim(request."adminResponse"), '') IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM "TrainingRequestMessage" AS message
              WHERE message."requestId" = request."id"
                AND message."senderId" IS NOT DISTINCT FROM request."handledByAdminId"
                AND message."senderRole" = 'STAFF'
                AND message."body" = request."adminResponse"
                AND message."createdAt" = request."updatedAt"
          )
    ) THEN
        RAISE EXCEPTION 'Training workflow migration did not preserve every legacy staff response';
    END IF;
END $$;

DROP TABLE "_pending_training_request_snapshot";

COMMIT;

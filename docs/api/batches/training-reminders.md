# Training reminders

`POST /api/training-reminders` replaces `/api/bot/training-reminders`. It accepts exactly `{}` and no query parameters. Authenticated users require positive `training:approve_request` or `training:mark`; active bot tokens retain superadmin access. Invalid explicit credentials never fall back to a session.

Returns `{data:{scanned,delivered,discordDelivered,windowEndsAt},meta:{}}`; the cutoff is a UTC-Z timestamp exactly 24 hours after this run starts. Scans scheduled/attended attendees with no prior reminder claim, on scheduled sessions starting after now and at or before the cutoff. Cancelled, past, distant, and already-reminded records are excluded. Repeat successful calls do not resend prior reminders.

All claims, anonymous web inbox messages, durable outbox events, and per-attendee audits share one Serializable transaction (60-second timeout). A failure rolls back the whole batch, including earlier recipients, so a retry cannot leave claims without messages. One `training.reminder_due` event is emitted per session in a successful run, using the general session URL rather than one attendee's private request URL. A later newly-added attendee can trigger a later session reminder event.

Each `training_reminder.delivered` audit has resource `training_reminder`, resourceId attendee ID, targetUserIds containing the recipient, before/after claim timestamps and session/notification IDs. Message text, trainer names, Discord credentials, and other personal content are not recorded. The response contains counts only, so no separate read audit is needed.

After commit, inbox events and opted-in Discord DMs are best-effort. Existing request subscriptions control Discord opt-in. Their failure does not undo or misreport persisted web delivery; `discordDelivered` counts only successful DMs. Discord delivery is not independently retried after a successful web claim, matching the previous delivery policy.

Errors: 400 query/malformed JSON; 401 invalid credentials; 403 missing staff permission; 422 nonempty or nonobject body; 409 concurrent database changes (retry); 500 database/audit failure with no committed batch.

Tests: 13 unit cases in `tests/api/training-reminders.test.ts`; three Prisma cases in `tests/api-integration/training-reminders.test.ts` cover real filtering/idempotency, second-audit rollback, message/outbox atomicity, bot/session rights and postcommit failures.

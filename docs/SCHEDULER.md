# Background scheduler

Run the worker separately from the website, using the same release and database:

```sh
npx prisma migrate deploy
npm run prisma:generate
NODE_ENV=production npm run scheduler
```

Use a second terminal in development (`npm run scheduler`). In production, supervise the worker with systemd or a separate container using the same application image and `npm run scheduler` as its command. Include the TypeScript source, generated Prisma client and `tsconfig.json` in the worker image; a Next.js standalone-only image is insufficient. `tsx`, `@next/env` and the database client’s `dotenv` loader are runtime dependencies. No HTTP/bot token is required by the worker.

The worker loads Next.js `.env*` files from the working directory before importing the database client. Set `NODE_ENV=production` in production. Environment-provided values take precedence. It discovers jobs immediately and every 30 seconds, executing up to 100 jobs per tick. `SIGTERM`/`SIGINT` stops new work and lets the active job finish; allow at least 70 seconds for graceful shutdown.

`npm run scheduler -- --once` discovers and processes up to 100 due jobs, then exits. It **executes real work**, not a dry run, and exits nonzero on failure. `--help` does not connect to the database.

| Job | Schedule |
| --- | --- |
| Attendance finalization | Main operations only (`isMainOp=true`, `isSideOp=false`), current resolved end time + 4 hours |
| Automatic promotions | 00:00, 06:00, 12:00, 18:00 UTC, and immediately following attendance finalization |
| Training reminders | Check every 5 minutes for the existing within-24-hours reminder window |

End-time edits move unfinished attendance jobs earlier or later. Execution locks and re-reads the operation, so a stale discovered deadline cannot finalize it early. Operations without a complete schedule are skipped. The existing schedule resolver handles UTC fields and legacy overnight time fields. Completed attendance job records are permanent finalization receipts: later end-time edits and raw-event arrivals do not cause automatic recompilation. There is no automatic demotion. Explicit administrator attendance edits/imports/compilation remain administrator-controlled corrections; review their rank consequences separately.

On the **first startup**, `SchedulerState.activatedAt` records the rollout boundary. Operations with deadlines already before that boundary are excluded from automatic discovery, avoiding a historical attendance rewrite. Deadlines after activation are caught up following downtime. Periodic jobs catch up the current UTC slot rather than replaying every missed interval. Restarting does not reset activation or completed jobs. Do not delete the activation row or attendance completion receipts during normal maintenance.

Discovery reads operation schedules and their attendance-job states in batches of 100, inserts unseen eligible jobs in batches, and updates only pending deadlines that actually changed. Completed and unchanged jobs incur no per-operation writes.

Scheduled reminders process at most 100 attendees per transaction, retaining the unfinished job until a shorter batch completes. Sent markers, inbox messages, audit records, and bot events commit together; retries leave prior committed batches intact. Batches reuse the existing bot event for the same session version. The explicit reminder API retains its existing full-pass behavior.

Attendance compilation queries only signed-up members’ events in the existing time window and groups events and notes by user once. `totalEventsProcessed` counts those matching events, excluding unrelated or unlinked events. Queue selection and pruning use an index on completion time, due time, and job key; attendance and reminder-event lookups have matching composite indexes.

Completed promotion and reminder jobs are retained for 30 days, then removed in batches of at most 500 per tick. Unfinished jobs and attendance-finalization receipts are never pruned.

Jobs, retries and completion live in `SchedulerJob`. A PostgreSQL transaction-held lock on the scheduler state row lets only one worker execute a job at a time. It is released automatically on commit, rollback or a lost database connection; no expiring lease can allow a second worker to execute an active job. Domain writes, audit records, bot events, dependent jobs and job completion commit atomically. After a failed transaction, recovery reacquires the same scheduler lock without skipping a current owner, re-reads the job, and leaves a newer completed attempt untouched. Failed work retries after 30 seconds, exponentially increasing to one hour. Each job has a 60-second transaction timeout. Monitor `lastError`, `attempts`, `nextAttemptAt`, overdue unfinished jobs, and worker JSON logs. Promotion passes enqueue at most 100 candidates per transaction in user-ID order, persisting the cursor atomically with each page and releasing the scheduler lock between pages. A restarted or retried pass resumes after its last committed page. Candidate ranks are captured when their page is read. Promotion passes enqueue individual user jobs, so one failed user does not roll back other users or require a roster-sized transaction. Each user job captures the starting rank and skips if another action already changed it.

The website Auto Rankup button and worker use the same eligibility and promotion implementation. Website requests preserve live permissions and per-user transactions; scheduler jobs use a trusted internal context audited as `actorType=scheduler`, without inventing a human or bot token. Failed scheduled user promotions roll back completely before retrying. The button displays API errors, partial failures and an explicit no-eligible-users result.

## Bot delivery

The worker writes to the existing durable event feed; it does not require a live Discord bot connection:

- `user.rank_changed`, aggregate `rank`: existing promotion event, including rank history ID, user ID, linked Discord ID, old/new rank IDs and automatic source.
- `attendance.finalized`, aggregate `orbat`: `{ orbatId, status: "finalized", startsAt, endsAt, version }`. `version` is the UTC finalization timestamp; start/end are the finalized attendance window.
- `training.reminder_due`, aggregate `training`: existing reminder event. Scheduled reminders create website inbox notifications and outbox events; the bot owns Discord delivery.

Consume `/api/events?aggregate=rank`, `aggregate=orbat` and `aggregate=training`, each with a separately persisted cursor. Deduplicate by event ID and persist a cursor only after successful processing. Existing outbox retention is **30 days**, so catch-up is limited to retained events. The bot must add handling for the new `attendance.finalized` event; its implementation is outside this repository.

Website SSE invalidation is process-local. Worker-generated changes persist immediately but do not push invalidations to the separate website process; refresh the page to see them. Durable bot event polling/SSE reads the database and is unaffected.

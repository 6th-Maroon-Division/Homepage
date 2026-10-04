# Bot acceptance checklist

Mark each item with the test name/result and whether it used a fake adapter or real Discord. Website tests supplied in this packet demonstrate contract behavior, not completion of the bot.

## Build and configuration

- Clean restore/build/test succeeds on .NET 10; dependency/toolchain versions are pinned.
- Local settings contain only the permitted bootstrap exceptions; public links use web configuration.
- Unsupported schema and missing Discord permissions produce structured diagnostics, not partially applied configuration.
- Heartbeats distinguish saved/applied revision and inventory observation time.
- Cached configuration expiry pauses the specified mutations; one outage alert and one recovery alert reach the local recipient.

## Recovery and claims

- JSON and SSE consumers persist five independent resume cursors and recover after restart.
- Commands retain request identity/generation; leases renew during retry delays.
- Crash before/after a Discord effect or acknowledgement reconciles without duplicate pings, welcomes, bulk changes, or extended punishment.
- Revoked authorization, cancelled claims and superseded generations stop execution.
- Operation report retries reuse event IDs; changed contents do not reuse the same ID.

## Roles and members

- Welcome triggers on join, including returning members and failed role assignment.
- Join retries preserve partial success and stop after three attempts; staff retry is explicit.
- Pending/running join assignments are cancelled by a honeypot ban.
- Reaction removal, single-choice replacement, role hierarchy and dangerous-role rejection behave as specified.
- Removed entries leave roles intact; explicit bulk removal only affects reviewed members.
- Website name/rank changes, Discord member edits, moderator edits, cleared nicknames and unlink/delete events reconcile without loops or privilege escalation.
- Unlinked users get an actionable linking response.

## Announcements and interactions

- No publication without an explicit command; default and per-ORBAT channel behavior are respected.
- Real returned message IDs are acknowledged and reused after restart.
- Signup and removal change the website image occupancy and automatic Discord rendering without repeating mentions.
- Late render receipts cause repair; missing messages require explicit no-ping repost.
- Controls reflect cutoff/feature state; full slots and unmet prerequisites cannot be bypassed.
- Signup/change/cancel use stable interaction keys and website ownership checks; absence notes obey exactly the website's validation and timing.
- Public output excludes personal availability reasons and moderation evidence.
- Preference-controlled notifications require both a chosen type and delivery method; defaults send none of those types.

## Moderation and evidence

- Exempt/member/default/unclassified/no-role users receive the configured classification.
- Timeouts last at least the configured >=24 hours from actual execution.
- Early release remains effective after delayed retries and process restarts.
- Only the last 30 minutes are cleaned; evidence bytes are accepted before each deletion.
- Oversized/inaccessible evidence causes visible failure and leaves uncaptured source messages undeleted.
- Temporary evidence does not become an uncontrolled second retention store.
- Cleanup progress can finish after release without changing punishment status.

## Reviewed bulk execution

- Preview has no role side effects and contains a fixed, deduplicated paginated membership set.
- Execution cannot begin before staff confirmation of the exact sealed revision.
- Expiry, configuration changes and revoked permissions reject stale work.
- Newly banned members and completed outcomes are excluded before each execution page.
- Every reviewed member receives an applied/skipped/failed receipt; partial failure is never reported as complete success.
- Retry requires a fresh reviewed preview.

## Handover

- Operator docs explain required Discord intents/permissions, website deployment dependencies, persistent state, health reporting and restart recovery.
- Credentials and real evidence never appear in examples, fixtures, diagnostics or logs.
- Unit/contract results and test-guild results are reported separately.
- Mod presets and full ORBAT cancellation are clearly marked deferred.

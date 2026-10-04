# Discord website administration and bot integration

The website owns bot configuration, linked-member data, moderation cases/evidence,
and durable commands. The .NET 10 Discord executor is developed in a separate
repository; website endpoints do not themselves connect to Discord or confirm a
Discord action succeeded.

All paths below are relative to `/api`. Use the existing session authentication
for staff UI requests and `Authorization: Bearer <website API key>` for the bot.
The key is an active database bot token, not the Discord token. Current database
bot tokens have superadmin authority: treat them as privileged service credentials
and never expose them to Discord interactions or browsers. Responses use the
canonical `{ data, meta }` success and `{ error }` failure envelopes.

## Existing domain API mapping

These are current canonical resources, not endpoints from the deprecated bot docs.

| Capability | Resource | Integration rule |
|---|---|---|
| Public operation and layout data | `GET /orbats/{id}/full` | Canonical full data; prefer the restricted Discord render snapshot for public announcement updates. |
| Public slot occupancy | `GET /orbats/{id}/available-slots` | Aggregate counts/capacity, ascending cursor pagination. |
| Member-specific eligible slots | `GET /orbats/{id}/eligibility?userId={numericId}` | Includes `allowed`, `reasons`, and `currentSignup`; fetch fresh before presenting choices. |
| Create signup | `POST /signups` with `{userId, slotId}` | Numeric website IDs; the bot binds the user to the invoking Discord account. |
| Change slot | `PATCH /signups/{id}` with `{slotId}` | Retains signup identity. Never send `overrideRequirements` for member interactions. |
| Cancel signup | `DELETE /signups/{id}` | Resolve and verify ownership before invoking privileged service API. |
| Member signups | `GET /users/{id}/signups` | Find the current signup for the operation; paginate all relevant records. |
| Operation roster | `GET /orbats/{id}/signups` | Paginated minimal display-user/slot data. |
| Availability | `GET/PATCH/DELETE /orbats/{id}/availability/{userId}` | PATCH requires `status`: `absent`, `unsure`, or `late_unsure`; reason <=500 characters; nonnegative integer minute estimates; `late_unsure` needs at least one estimate. |
| Rank role mappings | `GET /ranks/discord-roles?guildId={snowflake}&activeOnly=true` | Existing mapping resource; `rank:edit` controls staff access. |
| Update rank mapping | `PATCH/DELETE /ranks/{id}/discord-role?guildId={snowflake}` | See existing rank API contract for guild and mapping fields. |
| Durable domain changes | `GET /events?aggregate=orbat&cursor=0&limit=50` | Separate cursors for `orbat`, `rank`, `training`, `discord`, and `member`; save `meta.resumeCursor`, not merely `nextCursor`. |

Signup mutations support actor-scoped `Idempotency-Key` receipts for 24 hours.
Reusing a key with a different request fails. Fresh transactional checks enforce
capacity, one signup per operation, absence, schedule, and training/rank requirements.
Side-operation rules intentionally differ according to the website domain rules.
Availability changes do not implicitly cancel signups: use the canonical semantics.

The canonical staff APIs permit administrative exceptions (for example, managing
past-operation availability). Discord member interactions must instead use the
implemented adapters below, which reuse canonical services with the linked
member's identity and no staff grants. The bot must bind the path Discord ID to
the actual interaction author; do not trust an arbitrary ID embedded in a button.

| Member operation | Bot-only adapter |
|---|---|
| Linked users and minimal rank/name data | `GET /discord/members?discordId={snowflake}` (filter optional) |
| Eligible slots | `GET /discord/members/{discordId}/orbats/{id}/eligibility` |
| Create, move, cancel own signup | `POST/PATCH/DELETE /discord/members/{discordId}/orbats/{id}/signup` |
| Read, update, clear own availability | `GET/PATCH/DELETE /discord/members/{discordId}/orbats/{id}/availability` |
| Accept nickname base-name change | `PATCH /discord/members/{discordId}/name` |

Signup POST accepts `{slotId}`; PATCH accepts `{signupId,slotId}`; DELETE accepts
`{signupId}`. The stable signup ID permits receipt replay after cancellation and
is verified against the linked member and operation. All signup
mutations require a stable interaction `Idempotency-Key`. They enforce closed
signup deadlines and prerequisites without administrative bypass. Availability
uses the same fields described above without staff timing exceptions. Missing
account linking returns an actionable 404. Disabled web feature switches reject
interactions even if an old Discord component still exists.

Member lookup returns `id` (authentication-account cursor ID) separately from
`userId` (website user ID), plus `discordId`, `username`, `nameRevision`, and
`userRank`. Name PATCH accepts `{nameRevision,username,actorDiscordId?}`. It uses website name
validation, enabled synchronization/exemptions and optimistic revision checking.
Moderator attribution is optional. First linking and clearing a nickname use the
website name; these are executor behaviors, not requests to save an empty name.

The durable event feed supports JSON polling or `Accept: text/event-stream` with
`Last-Event-ID`; the latter must agree with a supplied cursor. Existing domain
feeds are invalidation signals: fetch the latest authoritative records before
rendering. They are not the command acknowledgement channel. Browser-oriented
resource SSE routes are not a substitute for the durable feed.

## Configuration boundary

Only the platform API URL/key, Discord API bootstrap credentials, and local outage
alert recipient are external bot settings. Guild/channel/role identifiers, feature
switches, message templates, timing, retry schedules and retention belong in the
web configuration. Rank role mappings reuse the website's existing rank resources.

See [the feature specification](../../discord/feature-specification.md) and
[configuration ownership](../../discord/web-configuration-and-integration.md)
for product rules. The API fragment accompanying this file describes current
website operations; it does not imply the separate bot executor is implemented.

## Website configuration and execution protocol

- `GET /discord/config`: effective settings, schema version, revision, applied
  revision and last heartbeat. Any Discord capability allows access; evidence
  policy appears only with evidence-view or evidence-retention permission.
- `PUT /discord/config`: `{revision, settings}` replaces the full behavioral
  snapshot with optimistic concurrency, requiring `discord:configure`.
- `PATCH /discord/retention`: `{revision, retention:{mode,days}}` requires
  `discord:evidence_retention`; mode is `days` (at least seven) or `indefinite`
  with `days:null`.
- `POST /discord/heartbeat`: bot-only report with configured `guildId`,
  `appliedRevision`, `botVersion`, `health` and optional role/channel metadata.
  Configuration status distinguishes saved from applied.
- `GET /discord/commands`: cursor-paginated authorized action history, newest
  first, without execution payloads or claim tokens. Announcement history also
  requires `orbat:edit`.
- `POST /discord/commands`: queues `menu.publish` (`payload:{menuId}`),
  `welcome.test` or `sync.all` (empty payloads). Requires `discord:configure`.
  Include a stable `requestKey` for submission deduplication.
- `POST /discord/commands/{id}/retry`: `{}`; requires `discord:retry` and the
  original action permissions. Only failed actions are eligible; an announcement
  superseded by a newer noncancelled action cannot be retried.
- `POST /discord/commands/claim`: bot-only `{}`; returns an oldest available
  action with a five-minute lease, claim token and generation, or null.
- `POST /discord/commands/{id}/complete`: bot-only acknowledgement containing
  `claimToken`, `generation`, `success`, `result` and optional `errorCode`.
  Announcement success requires actual `messageId` and expected `channelId`.
  `menu.publish` success also requires both IDs, with the channel matching the
  current menu configuration. A removed menu or changed channel conflicts.
  Successful publication persists a menu/channel reference; older commands cannot
  replace newer references, and references in previous channels remain available.
  Repeated terminal acknowledgements must match success, full result and error
  code; differing results are conflicts.

`GET /discord/config/history` requires `discord:configure` and returns immutable
behavioral revisions newest first (cursor/limit). Retention is not included in
these historical settings. Writes save history and a durable
`discord.configuration.changed` event in the same transaction.

Heartbeat accepts `metadataObservedAt` with metadata, plus `diagnostics`:
`{configRevision,supportedSchemaVersions,pendingCount,failedCount,issues,permissions}`.
Issues contain bounded `code`, `severity`, optional config `field` and `resourceId`;
permissions contain `capability` and `granted`. No free-text error contents belong
in diagnostics. Config responses expose `updatedAt`, `metadataObservedAt`,
`diagnostics` and `diagnosticsReportedAt`. Older inventory cannot overwrite newer
observations. Fresh inventory validates role/channel IDs and manageability during
configuration writes; stale inventory permits editing without treating it as
current proof of Discord access.

Configuration uses one Discord guild per deployment. Changing a saved guild ID
requires a separate migration/deployment, rather than silently moving existing
messages, cases and commands to another guild. IDs remain snowflake strings;
website entity IDs are positive Int32 numbers. Collection paging defaults to 30,
maximum 100, unless the existing domain contract specifies otherwise.

Claim expiry is delivery recovery, not permission to repeat a possibly completed
Discord side effect. Reconcile before executing reclaimed work. A manual retry
advances its generation. A late acknowledgement cannot complete a superseded
claim. Commands are authorized again at claim time if their requester is a website
user. `POST /discord/commands/{id}/lease` renews a live claim for another five minutes
using `{claimToken,generation}`. Renew while waiting through long retry delays.
The bot implements the configured transient retry delays within its durable
executor and reports exhaustion; the website does not sleep through Discord
retry delays in an HTTP handler.

## Reconciliation indexes and operation reports

`GET /discord/announcements` is bot-only and returns ascending announcement-ID
pages of `{id,orbatId,channelId,mention,missionText,messageId,updatedAt}`. Pending
records have `messageId:null`. This lets a restarted bot discover persisted
announcements without enumerating every ORBAT.

`GET /discord/menu-messages` requires `discord:configure` or superadmin and returns
ascending record-ID pages of `{id,menuId,channelId,messageId,lastCommandId,updatedAt}`.
References survive removing a configured menu and moving it to another channel;
removing a menu still does not revoke member roles. Both collections use `cursor`
and `limit`, with `meta.nextCursor` identifying the next page. They are snapshots,
not change feeds: restart from the first page during each reconciliation sweep
to observe updates to existing records.

`POST /discord/operations` is bot-only terminal outcome reporting for
`join.roles`, `welcome`, `menu.roles`, `rank.sync`, and `nickname.sync`. Required
fields are `{eventId,guildId,configRevision,kind,status,attempts,occurredAt}`;
optional context is `{memberId,channelId,roleId,menuId,errorCode}`. Status is
`succeeded`, `failed`, `cancelled`, or `skipped`. Failed reports require a bounded
`errorCode`; other statuses forbid it. Report only identifiers and codes, never
message/evidence content or free-text errors. Requests are limited to 4096 bytes.
Attempts range from one to three for join roles and one to six otherwise.
The guild must match configuration and the positive revision must not be newer
than the website revision; delayed reports from older revisions remain useful.
Occurrence time may be at most 60 seconds ahead of website time.

The globally unique `eventId` gives immutable replay semantics: a new report
returns 201, an identical replay returns 200, and changed content returns 409.
`GET /discord/operations` requires `discord:view` or `discord:configure` and
supports exact `kind` and `status` filters plus descending ID cursor pagination.
Rows include the submitted context (missing optional fields become null), `id`,
and `createdAt`. Reports record executor outcomes; posting one does not queue
retries or independently verify that Discord applied the action.

## Moderation and evidence

`GET /discord/cases` is available with moderation-view, timeout-release, or
evidence-view permission. It exposes case summaries without evidence content.
The bot posts `{triggerId,guildId,memberId,roleIds,configRevision,occurredAt}` to
`POST /discord/cases`; the website validates current configuration and returns
the classification and timeout expiry, retaining the configuration snapshot. It does not apply the punishment itself.
`GET /discord/cases/{id}` returns a restricted case summary. The executor reports `applied`/`failed` and cleanup counts plus up to 500 per-message outcomes via
`PATCH /discord/cases/{id}`. Confirmed timeouts require `appliedAt` and
`timeoutUntil`, enforcing at least the configured hours (minimum 24) from actual
execution rather than the earlier trigger time. Cleanup-only PATCH bodies omit `status` and punishment timestamps, allowing cleanup reports after early release without changing the punishment or release state. `POST /discord/cases/{id}/release` queues an early
release with a stable `requestKey`; only acknowledgement confirms release. An optional nonblank `reason` (up to 500 characters) is retained with the command.
Cleanup-only PATCH requests remain valid after release and cannot alter the
punishment state. Omit `status`, `appliedAt`, and `timeoutUntil` for these reports.
An empty PATCH is invalid, and punishment timestamps require `status`.

`POST /discord/evidence` uploads immutable message content and actual attachment
bytes (`name`, `contentType`, `dataBase64`), not Discord URLs. A capture must belong
to the case member and the 30-minute window ending at the trigger. Supported
limits are ten attachments and 8 MiB decoded files per evidence item, within a
12,000,000-byte request. Larger captures must produce visible capture failures;
the executor must not delete source content whose evidence was not preserved.
Duplicate case/message uploads are idempotent only when their stored content
matches. Deleted evidence cannot be revived through upload.

`GET /discord/evidence?state=active|deleted&caseId={id}` requires evidence-view and
returns content plus files only in authorized, audited, private/no-store
responses. `PATCH /discord/evidence/{id}` takes `{version,action}` with `delete`,
`restore`, or `indefinite`. It requires evidence-view plus the matching action
permission. The seven-day recovery clock cannot be reset by deleting again.
Indefinite evidence still permits manual deletion. Restore preserves indefinite
retention; finite restoration receives at least another seven active days so it
cannot immediately expire again. The latter is the selected implementation
default for the previously open restoration-deadline detail.

Evidence maintenance runs from the website scheduler. Each bounded transaction
soft-deletes up to 100 expired active items and purges content/files from up to
100 items whose recovery window ended. The case and audit metadata remain.
Content and file bytes are stored and purged in the same database transaction;
optimistic versions and serializable isolation protect concurrent restoration.
Deploy and run the website scheduler as well as the web process for expiry and
purge to occur. Expired recovery cannot be restored even if maintenance is late.

## Deployment and verification

Deploy the Prisma migrations before serving the corresponding endpoints:

- `20260920000000_add_discord_permissions` adds the default-zero permission catalog entries without changing existing grants.
- `20260920010000_discord_web_admin` adds configuration, durable commands, announcement references, moderation/evidence storage, and the name revision used for concurrent synchronization.
- `20261004000000_discord_operations` adds immutable executor outcome reports.
- `20261004010000_discord_role_menu_messages` adds durable menu publication references.

Use the normal deployment migration command (`npx prisma migrate deploy`) and
regenerate the Prisma client as part of the build. No migration has been applied
to the project database during implementation. Run `npm run scheduler` alongside
the web process so evidence expiry/recovery/purge runs automatically. Deploy the
separate Discord bot later; until it connects, saved revisions and queued
commands remain visibly unapplied.

Browser tests cover configuration persistence, denied access, evidence-only
access, early timeout release queuing, and ORBAT announcement preview/publication,
including a real generated roster image. Isolated Prisma integration tests cover
revision conflicts, command receipts, evidence capture/recovery/purge, retention
changes, name synchronization, and member signup/availability constraints.

## Reconciliation, reporting, and recovery

`GET /discord/announcements` gives the bot an ascending cursor inventory of
persisted announcement references, including queued records with null message IDs.
It never creates announcements. `GET /discord/announcements/{orbatId}/render`
returns a sanitized current roster, controls, colors, mission text, existing image
URL, a SHA256 `contentRevision`, and current delivery state. Automatic updates
must use the returned empty `allowedMentions`, preserving text without repeating
pings. Fetch the live image immediately before editing: the URL is a cache-busted
live render, not an immutable artifact.

After a remote edit, POST `{channelId,messageId,contentRevision,outcome:'updated'}`
to that render endpoint. Stale content returns 409 and clears the delivered
revision to force reconciliation; wrong targets conflict without changing state.
Missing Discord messages use `outcome:'missing'`. Recovery then requires staff
`action:'repost'` with `mention:'none'` on the existing announcement endpoint.
Automatic updates cannot repost; refresh/re-ping cannot bypass missing state.
Read snapshots only after explicit pending announcement commands have finished.
Repeated receipts preserve their original confirmation timestamps.

`GET /discord/menu-messages` returns ascending cursor-paginated published menu
references with `menuId`, `channelId`, `messageId`, `lastCommandId`, and `updatedAt`.
It requires `discord:configure`. Successful `menu.publish` acknowledgement requires
the actual message and configured channel; references survive deleting the menu
configuration. Older command completions cannot replace a newer reference.

`POST /discord/operations` records immutable terminal bot outcomes for `join.roles`,
`welcome`, `menu.roles`, `rank.sync`, and `nickname.sync`. Use a stable `eventId`,
configured guild, known config revision, occurrence time, attempts and optional
member/channel/role/menu identity. Failure requires a bounded `errorCode`, not
private message text. Exact replay returns 200, new reports 201, changed reuse 409.
`GET /discord/operations` requires view or configure permission and supports
kind/status filters and descending pagination. Reports alone do not perform work.

`POST /discord/operations/{id}/retry` with `{requestKey}` queues `join.retry` for
a failed member join-role assignment, requiring both `discord:retry` and
`discord:configure`. It rechecks current defaults and rejects honeypot-banned
members or duplicate pending work. Creating a honeypot ban atomically cancels pending/running `join.retry` commands and invalidates their leases. The executor checks again immediately before
acting; reporting or claiming a retry never overrides a ban.

The durable event feed now supports `aggregate=discord` and `aggregate=member`.
Member invalidations cover Discord linking/registration, name updates from either
side, deletion, and merge/moved or discarded Discord identities. Payloads contain
`userId`, `discordUserId`, and optional `nameRevision`; config events contain
`revision`. Refetch authoritative state rather than replaying stale values. The
feed carries no names, configuration snapshots, reasons or evidence contents.
Profile/OAuth/merge mutations and their events commit in the same transaction.

## Reviewed bulk roles

Website admins with `discord:configure` may POST `/discord/bulk-roles` with a
stable `requestKey` and `action:'apply_defaults'`, or `action:'remove_menu_role'`
plus `roleId`. Removal requires current or historical menu membership; protected
rank, membership, exemption, recruiter and default roles cannot be revoked.
The website queues `bulk.preview`, returning a revision-bound 15-minute plan.
These actions cannot be requested or confirmed with a bot token.

The bot resolves the command's `bulkRequestKey` via the collection's `requestKey`
filter. Upload sequential POST `/discord/bulk-roles/{id}/snapshot` pages containing
`claimToken`, `generation`, `page`, unique `memberIds`, and `final`. Each page holds
at most 100 members; the maximum is 100 pages/10,000 unique members. The final page
seals the preview and completes the preview command. Staff inspect
`GET /discord/bulk-roles/{id}?page=0` and POST `/confirm` with the reviewed `version`
and a new stable `requestKey`. Only a complete nonempty, current preview queues
`bulk.execute`.

Before each page, the bot POSTs `/targets` with `claimToken`, `generation`, and
`page`. The server revalidates the administrator, configuration and expiry and
excludes every honeypot ban case, regardless of status, and already reported work. Recheck actual Discord state, privileged role permissions, and hierarchy before
each mutation; the reported inventory does not contain role permission bits. POST `/outcomes` with exactly one `{memberId,status,errorCode?}`
for every reviewed member; status is `applied`, `skipped`, or `failed` (only failures
carry `errorCode`). Successful command completion requires every page reported
without failures. Retries require a fresh reviewed preview, never generic command
retry. A preview neither modifies roles nor silently expands its reviewed scope.

## Additional deployment migrations

Apply the October additions through normal `prisma migrate deploy` before using
these APIs: `20261004000000_discord_operations`,
`20261004010000_discord_role_menu_messages`,
`20261004020000_discord_diagnostics_history`,
`20261004030000_discord_announcement_rendering`, and
`20261004040000_discord_bulk_roles`. These changes do not deploy the separate bot.
Discord gateway handling, actual effects, local durable work, outage DMs,
reaction handling, and operational retry scheduling remain executor responsibilities.
Mod presets and full ORBAT cancellation remain deferred.

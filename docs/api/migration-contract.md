# API migration contract

This is the agreed target for the website and future Discord bot. Migration is incremental: the existing API does not yet satisfy this contract everywhere. The [generated inventory](./inventory.md) records current handlers, static caller evidence, test references, and OpenAPI gaps. A missing caller is not proof of an unused endpoint.

## Shared contract

- Use one canonical business operation for website and bot callers. Accept a valid current user session or active database bot bearer token. Reject missing, invalid, inactive, revoked, and legacy environment credentials. User authorization checks current permissions, ownership, and hierarchy. Bot tokens act as superadmin by explicit product decision; no token scopes are introduced.
- Use consistent resource and field names, JSON bodies, positive numeric database IDs, string Discord IDs, and PATCH for partial updates. Reject unknown payload fields. Distinguish malformed input (400), missing authentication (401), forbidden actions (403), missing resources (404), conflicts (409), and payload validation failures (422).
- Return `{ data, meta }` on success and `{ error: { code, message, details, correlationId } }` on failure. Do not expose internal errors or credentials. List pagination uses `limit`, `cursor`, and `meta.nextCursor`. Login callbacks, SSE, and file responses keep their required transport formats.
- Serialize timestamps as ISO 8601 UTC ending in `Z`. Timestamp inputs require `Z` or an explicit offset, which is normalized to UTC; reject ambiguous local timestamps. Use UTC in filters, calculations, audit events, and operational logs. Date-only values remain `YYYY-MM-DD`. Preserve named timezones for recurring calendar schedules and daylight-saving rules. The website converts local input to UTC and converts UTC to the viewer’s timezone for display.

## Audit policy

Log creates, updates, deletes, permission changes, token management, and denied API requests. Log reads of another user’s data, including bulk reads and all bot reads of user data. Do not log self-reads or general-information reads. Record actor kind and user/token ID, target user IDs/resources, action, timestamp, outcome, and request correlation ID. A future initiating Discord user is separate context, never a replacement for the authenticated bot identity.

Record relevant before/after mutation values with secrets and sensitive content removed. Do not capture tokens, credentials, sensitive message content, or returned personal data in read events. Save successful mutation records in the same database transaction as the mutation; failures roll both back. Denied requests remain security events. Restrict audit viewing to superadmin sessions and active bot tokens; provide no API to edit/delete audit records. The initial retention target is 365 days; enforce it through operational maintenance rather than an endpoint mutation.

## First migration batch

| Canonical endpoint | Methods | Replacement / permissions |
|---|---|---|
| `/api/bot-tokens` | GET, POST | Replaces `/api/admin/bot-tokens`; superadmin |
| `/api/bot-tokens/{id}` | GET, PATCH, DELETE | Replaces `/api/admin/bot-tokens/{id}` and its PUT; superadmin |
| `/api/users/{id}/notification-preferences` | GET, PATCH | Replaces the static `/api/users/me/notification-preferences` handler and `/api/bot/users/discord/{discordId}/notification-preferences`; self, hierarchy-aware `user:edit`, or superadmin |
| `/api/audit-logs` | GET | New audit browsing; superadmin; cursor pagination and UTC `from`/`to` filters |

The preference route accepts `me` as a session-only alias: the website URL can remain `/api/users/me/notification-preferences` while using the shared dynamic handler. Bots resolve a Discord ID to the numeric platform user ID before accessing preferences. Preference responses contain only the eight boolean settings, so the response data can be submitted as a PATCH payload. GET returns defaults for a missing row without creating one: all settings are false except `dmEnabled`, which is true, matching the existing database defaults. Notification categories remain opt-in. Mutations occur through PATCH. Token listing uses `limit` (default 50, capped at 100) and an ascending ID cursor with `meta.limit` and `meta.nextCursor`; the website loads all pages and sorts names for display. Token secrets are returned only when created. Token list/detail reads audit creator metadata when it belongs to another user, including bot reads. Legacy routes are removed together with caller migrations; there are no existing external consumers requiring a compatibility period.

## Second migration batch: catalog resources

This batch migrates radio frequencies, subslot definitions, and training categories to the shared handler. It retains their resource URLs and replaces training-category PUT with PATCH. Website consumers migrate with the handlers.

| Endpoint | Methods | User permissions |
|---|---|---|
| `/api/radio-frequencies` | GET, POST | GET: authenticated; POST: `orbat:edit` |
| `/api/radio-frequencies/{id}` | PATCH, DELETE | PATCH: `orbat:edit`; DELETE: `orbat:delete` |
| `/api/subslot-definitions` | GET, POST | GET: existing subslot/template/ORBAT read rules; POST: `subslot:create` |
| `/api/subslot-definitions/{id}` | PATCH, DELETE | PATCH: `subslot:edit`; DELETE: `subslot:delete` |
| `/api/training-categories` | GET, POST | GET: authenticated; POST: `training:create` |
| `/api/training-categories/{id}` | PATCH, DELETE | PATCH: `training:edit`; DELETE: `training:delete` |

Active bot tokens retain superadmin access. Collection GETs use ascending ID cursor pagination, default 50 and maximum 100, with `meta.limit` and a lookahead-backed `meta.nextCursor`. Website consumers fetch all pages and apply domain-specific display ordering. General catalog reads do not create audit records; mutations and denied requests do. Successful mutation audits share the database transaction. Unknown payload fields are rejected. Subslot definitions use plural prerequisite arrays only; singular legacy input/output aliases are removed. Linked ORBAT slots prevent role deletion with 409. Category PATCH supports either a regular partial update or an exclusive `swapWithCategoryId` operation; swaps audit both affected categories. Category deletion detaches linked trainings in the same transaction. Radio deletion removes related ORBAT frequency assignments. Refer to OpenAPI for each resource’s exact payload and permission contract.

## Third migration batch: Discord rank mappings

Consolidate website administration and bot rank-role lookup into shared business routes. All methods require `rank:edit` for users or an active superadmin bot token.

| Canonical endpoint | Methods | Replaces |
|---|---|---|
| `/api/ranks/discord-roles` | GET | `/api/admin/ranks/discord-roles` and `/api/bot/ranks/discord-roles` |
| `/api/ranks/{id}/discord-role` | PATCH, DELETE | `/api/admin/ranks/{rankId}/discord-role`, including its PUT method |

Every request requires a string Discord `guildId` query parameter. GET supports `activeOnly=true` or `false` (default false), ascending-ID cursor pagination, and the shared `{ data, meta }` envelope. Mapping records include numeric mapping/rank IDs, string guild/Discord-role IDs, activity state, UTC timestamps, and rank metadata. PATCH accepts partial `discordRoleId`/`isActive` fields; creating a mapping requires `discordRoleId`. The guild ID is supplied only in the query, not duplicated in the body. Mutations and audit records commit together. These rank-configuration reads contain no user data and do not require read auditing.

## Fourth migration batch: leave of absence

| Canonical endpoint | Methods | Replaces |
|---|---|---|
| `/api/users/{id}/leave-of-absences` | GET, POST | `/api/loa` |
| `/api/leave-of-absences/{id}` | PATCH | `/api/loa/{id}` |

Users can manage their own leave records; accessing another user requires hierarchy-aware `user:edit` or superadmin. Active bot tokens retain superadmin access. The collection accepts `me` only for a user session. GET returns descending-ID cursor pages, default 50/cap 100. Reads of another user’s leave, including bot reads, are audited without copying returned personal data. Self-reads are not audited.

POST requires `startDate` and accepts nullable `returnDate` and `reason`. Dates must include a timezone and are normalized to UTC; a return date cannot precede the start. PATCH accepts a nonempty partial payload of `returnDate`, `reason`, and/or `cancel`; the start date is immutable. `cancel: true` records the current UTC cancellation time, while false clears it. Reasons are trimmed, with empty strings becoming null, and their contents are redacted in audit snapshots. Mutations and their audit records commit together. There is no delete operation; cancellation preserves the leave record.

The website labels leave date inputs as UTC dates, displays leave dates in UTC, and converts selected dates to explicit midnight-UTC timestamps before API requests. “Mark back” records the current UTC instant, bounded to the leave start if necessary, rather than truncating the return time to midnight. Date-only strings are not accepted as timestamp payloads. Responses preserve the leave DTO’s existing fields with UTC `Z` timestamps; the old unwrapped response format and routes are removed together with website caller migration.

## Fifth migration batch: rank catalog

| Canonical endpoint | Methods | User permissions |
|---|---|---|
| `/api/ranks` | GET, POST | GET: authenticated; POST: `rank:create` |
| `/api/ranks/{id}` | PATCH, DELETE | PATCH: `rank:edit`; DELETE: `rank:delete` |
| `/api/ranks/reorder` | PATCH | `rank:edit` |

Active bot tokens retain superadmin access. PATCH replaces PUT for updates and reordering. Rank listing uses ascending-ID cursor pages (default 50, capped at 100); clients collect the pages and apply rank order for display. General catalog reads are not audited. Responses include the stored rank fields, numeric IDs, and UTC timestamps.

Creation requires trimmed nonempty `name`/`abbreviation` and nonnegative Int32 `orderIndex`. Optional fields are nullable nonnegative Int32 `attendanceRequiredSinceLastRank` and boolean `autoRankupEnabled`. Partial updates preserve omitted values and reject empty or unknown payload fields. Assigned users prevent rank deletion with 409; missing ranks return 404. Deletion returns `data: null`. Its audit snapshot also records affected Discord mappings, detached training requirements, and deleted transition requirements.

Reordering accepts `{ ranks: [{ id, orderIndex }] }` with a nonempty array, unique positive Int32 IDs, and nonnegative Int32 order values. All referenced ranks must exist before changes commit. The mutation and per-rank audit records are atomic; missing IDs return 404 without partial changes. The response is `data: null`.

## Sixth migration batch: training user lookup

`GET /api/training-users` replaces the separate `/api/training-staff` lookup with a strict `staffOnly=true|false` filter (default false). Both user sessions and active bot tokens use the shared endpoint. Users require a positive `training:approve_request` or `training:mark` grant, or superadmin; bot tokens retain superadmin access. The same positive permission rules determine training staff eligibility.

The endpoint returns ascending-ID cursor pages, default 50/cap 100, containing only `id`, nullable `username`, nullable `avatarUrl`, and boolean `isTrainer`. The website loads all pages and sorts names for display. `staffOnly=true` returns staff candidates; false returns all user candidates with their staff flag. Invalid filter values return 400.

Audit only other users included in the returned page: exclude the session user and pagination lookahead rows; for bots, include every returned user. Empty and self-only results produce no read audit. Audit records contain target IDs and request context, without returned personal-data snapshots. This batch introduces no mutation operations.

## Seventh migration batch: training requirements

`GET` and `PATCH /api/trainings/{id}/requirements` become the shared configuration resource. They replace the former requirements POST/DELETE and separate prerequisite-add/remove routes. GET accepts any authenticated session or active bot token; PATCH requires `training:edit`. Clearing a minimum rank with `minimumRankId: null` retains the existing superadmin-only rule; active bot tokens qualify.

The strict nonempty PATCH body accepts nullable positive Int32 `minimumRankId` and/or `requiredTrainingIds`, an array of unique positive Int32 IDs. Omitted fields remain unchanged. A provided prerequisite array replaces the complete set, with `[]` clearing it. The website fetches the current requirements before replacing a prerequisite set and applies the PATCH response directly to its requirements state. This also fixes stale minimum-rank/prerequisite displays after changes; refreshing the broader training list did not update that state.

Both methods return `{ minimumRankId, requiredTrainingIds, minimumRank, requiredTrainings }` inside the standard envelope. The rank is a full rank DTO or null; prerequisite summaries contain `id`, `name`, and nullable `category: { name }`. Prerequisite arrays are sorted by ID. This is one configured resource, so it has no pagination.

Missing referenced resources return 404, self-references return 422, and dependency cycles return 409. Cycle validation follows the proposed prerequisite edges to reject a path back to the updated training. Changes and an ID-only `training_requirements.updated` audit snapshot commit within a serializable transaction; concurrency conflicts return 409 so callers can refresh and retry. General configuration reads are not audited.

## Eighth migration batch: training catalog

| Canonical endpoint | Methods | User permissions |
|---|---|---|
| `/api/trainings` | GET, POST | GET: authenticated; POST: `training:create` |
| `/api/trainings/{id}` | GET, PATCH, DELETE | GET: authenticated; PATCH: `training:edit`; DELETE: `training:delete` |

Active bot tokens retain superadmin access. PATCH replaces PUT. `GET /api/trainings?activeOnly=true` replaces `/api/trainings/available`; `activeOnly` is a strict boolean string defaulting to false. An optional positive Int32 `categoryId` filters the collection. Results use ascending-ID cursor pages, default 50/cap 100.

List, detail, create, and update share the training’s scalar catalog fields and `counts: { userTrainings, trainingRequests }`, replacing `_count`. Timestamps are UTC. Detail no longer embeds personal user-training or request records; their dedicated existing APIs remain separate and are not migrated by this batch. Catalog reads require authentication and do not produce read audits.

Creation requires a trimmed nonempty name. Strict editable fields are `name`, nullable trimmed `description`/`orbatQualificationNotes`, nullable integer `duration` (1–1440 minutes), nullable positive Int32 `categoryId`, and boolean `isActive`/`requiresTrainingSession`/`requiresOrbatQualification`. `requiredForNewPeople` is read-only. Empty strings for nullable text become null; PATCH preserves omitted values and rejects empty payloads. Missing category references return 404. Training names need not be unique.

Mutations and audit records commit together, with description and qualification-note contents redacted in audit snapshots. Existing sessions or requests prevent deletion with 409. Existing cascades of assigned user-training records remain, with affected IDs and target user IDs captured in the same audit transaction and no personal notes copied. Successful deletion returns `data: null`; missing trainings return 404.

## Ninth migration batch: rank training requirements

`GET` and `PATCH /api/ranks/{id}/requirements` replace rank-transition GET/POST and per-training DELETE routes. Both methods require current `rank:edit` permission or an active superadmin bot token. The configuration DTO is `{ requiredTrainingIds, requiredTrainings }`, with ID-sorted prerequisite summaries containing `id`, `name`, and nullable `category: { name }`. This single resource is not paginated.

GET returns 404 for a missing rank; an existing rank with no requirements returns empty arrays without inserting a row. PATCH requires exactly `{ requiredTrainingIds: [...] }`, with unique positive Int32 IDs. The supplied array replaces the complete set, and `[]` clears it. Missing references return 404, invalid payloads 422, and malformed path IDs 400.

Replacement and an ID-only `rank_requirements.updated` audit record commit in one serializable transaction. Conflicts return 409 for refresh/retry. General configuration reads are not audited. No website API callers were found for the replaced routes, but internal promotion eligibility still reads the existing requirement table; this migration does not remove that feature or its data.

## Verification and remaining rollout

Every endpoint and supported method must have tests, even once overall coverage reaches its target. Cover both authentication modes, invalid/inactive/revoked tokens, allowed/forbidden actions, ownership/hierarchy, payloads, response contracts, pagination, database mutations/rollback, audit actors/redaction, and UTC offset/daylight-saving/date boundaries. Use unit tests with Prisma test doubles plus isolated Prisma-managed local PGlite integration tests through Prisma Client. Do not use raw SQL queries or access the development database. Integration tests check actual relational behavior and transaction rollback in the local emulator; they do not establish production PostgreSQL deployment, concurrency, or performance guarantees.

The target is an enforced minimum of 80% lines, branches, functions, and statements across API handlers and supporting services, progressing toward 100%. Publish CI reports and gate merges on tests and coverage. A threshold applied only to migrated modules is an interim batch guard, not repository-wide completion. Endpoint tests and actual coverage reports must establish readiness; inventory test references alone do not.

For each remaining resource family, review caller evidence and duplicates, choose canonical operations, migrate handler/service and website consumers together, and update OpenAPI and tests. Preserve distinct operations; avoid deleting routes solely because static search found no caller. Follow-up batches include user administration, ORBATs/signups/availability, attendance, ranks/promotions, training, messaging, templates, and realtime/auth transport review. Build the Discord bot after the shared contracts are ready.

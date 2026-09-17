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

## Verification and remaining rollout

Every endpoint and supported method must have tests, even once overall coverage reaches its target. Cover both authentication modes, invalid/inactive/revoked tokens, allowed/forbidden actions, ownership/hierarchy, payloads, response contracts, pagination, database mutations/rollback, audit actors/redaction, and UTC offset/daylight-saving/date boundaries. Use unit tests with Prisma test doubles plus isolated Prisma-managed local PGlite integration tests through Prisma Client. Do not use raw SQL queries or access the development database. Integration tests check actual relational behavior and transaction rollback in the local emulator; they do not establish production PostgreSQL deployment, concurrency, or performance guarantees.

The target is an enforced minimum of 80% lines, branches, functions, and statements across API handlers and supporting services, progressing toward 100%. Publish CI reports and gate merges on tests and coverage. A threshold applied only to migrated modules is an interim batch guard, not repository-wide completion. Endpoint tests and actual coverage reports must establish readiness; inventory test references alone do not.

For each remaining resource family, review caller evidence and duplicates, choose canonical operations, migrate handler/service and website consumers together, and update OpenAPI and tests. Preserve distinct operations; avoid deleting routes solely because static search found no caller. Follow-up batches include user administration, ORBATs/signups/availability, attendance, ranks/promotions, training, messaging, templates, leave, and realtime/auth transport review. Build the Discord bot after the shared contracts are ready.

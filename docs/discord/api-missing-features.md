# Discord Bot API Gaps and Contracts

## 1. Purpose

This document tracks the web-platform API surface required by the Discord bot. It separates current routes from planned contracts and prevents the bot design from treating proposed endpoints as implemented.

The companion [Discord bot design](./discord-bot-design.md) defines user experience and bot behavior. This document is authoritative for API readiness.

Statuses:

- **Available**: implemented in the current repository
- **Partial**: useful route exists but does not meet the complete bot contract
- **Planned**: contract is proposed but not implemented
- **Decision required**: product or domain behavior must be settled first

All paths below are relative to `/api`.

## 2. Authentication standard

Current `/bot/*` routes authenticate with:

```http
Authorization: Bearer <BOT_API_TOKEN>
```

The implementation accepts a legacy environment token and database-backed bot tokens. New bot endpoints must use the shared bot-token validator. Documentation and clients must not use the previously proposed `X-BOT-API-TOKEN` header.

Bot tokens may only be administered by users with `system:super_admin`. New endpoints must define whether they require only a valid bot token or a future token scope.

## 3. Current endpoint inventory

| Method and path | Status | Current use | Known limitation |
|---|---|---|---|
| `GET /bot/users` | Available | Bulk user reconciliation | Confirm pagination before production-scale use |
| `GET /bot/users/discord/{discordId}` | Available | Resolve linked user | Response contract needs OpenAPI coverage |
| `GET /bot/users/steam/{steamId}` | Available | Resolve linked user | Not required for normal Discord actions |
| `GET /bot/orbats` | Available | Upcoming/past ORBAT polling | Only `includePast` and `limit`; no date range or cursor |
| `GET /bot/orbats/{id}` | Partial | ORBAT, slots, embedded signups | Does not expose rank/training requirements |
| `POST /bot/signups` | Partial | Create signup | No bot update/cancel route or idempotency key |
| `POST /bot/attendance` | Available | Check-in/check-out submission | Not an availability-note endpoint |
| `POST /bot/attendance/compile` | Available | Compile an ORBAT | Contract must guarantee idempotency |
| `POST /bot/attendance/backfill` | Available | Administrative recovery | Define whether the Discord bot should call it |
| `POST /bot/events` | Available | Attendance event ingestion | Not a replacement for availability notes |
| `GET /bot/promotions/pending` | Available | Manual approval queue | Polling only; define pagination/cursor |
| `POST /bot/promotions/{id}/approve` | Available | Approve proposal | Needs concurrency/error contract and actor audit data |
| `POST /bot/promotions/{id}/decline` | Available | Decline proposal | Platform already resets attendance baseline |
| `GET /bot/promotions/auto` | Partial | Recent automatic rank history | Does not cover all manual changes or provide a durable cursor |
| `GET /bot/training-reminders` | Available | Training reminder polling | General preference and event contracts still missing |
| `GET /orbats/events` | Available | Public ORBAT SSE | In-process delivery limitations must be assessed for deployment |
| `GET /ranks/promotions/events` | Partial | Promotion queue SSE | Uses web-session authorization and only emits queue updates |

The following routes referenced in older bot documentation do not currently exist:

- `GET /bot/orbats/{id}/signups`
- `GET /bot/users/discord/{discordId}/signups`
- `GET /bot/ranks/discord-roles`
- bot notification-preference routes
- bot availability-note routes
- a bot-authenticated applied-rank event stream

Signup data can currently be read from `GET /bot/orbats/{id}`, but that is not a substitute for mutation routes or user-specific eligibility.

## 4. Priority summary

| Priority | Contract | Status | Blocks |
|---|---|---|---|
| P0 | Signup availability plus update/cancel | Planned | Complete interactive signup |
| P0 | Availability-note get/upsert/delete | Decision required / Planned | Attendance buttons and single source of truth |
| P0 | Rank-role mapping management and bot read | Planned | Safe Discord role sync |
| P0 | Notification preference get/update | Planned | Cross-platform notification settings |
| P0 | Applied-rank event feed | Planned | Reliable near-real-time nickname/role sync |
| P1 | ORBAT date filtering | Planned | Efficient compile and Monday reconciliation |
| P1 | Bot-authenticated event replay/cursor | Planned | Downtime recovery |
| P1 | Training events | Planned | Scheduled/updated/cancelled notifications |
| P1 | API schema and error standardization | Partial | Robust bot client |
| P2 | User rank-history lookup | Planned | Diagnostics and historical views |
| P2 | Training announcement metadata | Deferred | Reply redirection, if retained |

## 5. P0 contract: available slots

### Proposed endpoint

```http
GET /bot/orbats/{orbatId}/available-slots?discordUserId={discordId}
Authorization: Bearer <token>
```

Example response:

```json
{
  "orbatId": 123,
  "userId": 42,
  "currentSignup": {
    "signupId": 901,
    "slotId": 55
  },
  "slots": [
    {
      "slotId": 55,
      "slotName": "Rifleman",
      "squadId": 8,
      "squadName": "1st Squad",
      "capacity": 2,
      "signupCount": 1,
      "available": true,
      "eligible": true,
      "reasons": []
    }
  ]
}
```

Requirements:

- Use the same training, rank, cutoff, absence, and capacity logic as the signup mutation.
- Return stable machine-readable reason codes and optional display text.
- Do not expose other members' private account identifiers.
- Display eligibility is advisory; the mutation revalidates atomically.

Suggested reason codes include `slot_full`, `signup_closed`, `already_signed_up`, `marked_absent`, `rank_required`, and `training_required`.

## 6. P0 contract: signup mutations

### Existing create endpoint

```http
POST /bot/signups
Authorization: Bearer <token>
Idempotency-Key: <discord-interaction-id>
Content-Type: application/json

{
  "discordUserId": "123456789012345678",
  "orbatId": 123,
  "slotId": 55
}
```

The current implementation already revalidates the ORBAT, cutoff, absence note, capacity, training, rank, and duplicate signup inside platform logic. Add explicit idempotency-key support and document its response schema.

### Proposed change endpoint

```http
PUT /bot/signups/{signupId}

{
  "discordUserId": "123456789012345678",
  "slotId": 56
}
```

### Proposed cancellation endpoint

```http
DELETE /bot/signups/{signupId}

{
  "discordUserId": "123456789012345678"
}
```

Mutation requirements:

- Verify the Discord user owns the signup.
- Revalidate target-slot requirements and capacity in a serializable transaction.
- Make changing slots atomic; never delete the old signup before the new slot is secured.
- Return `409` for mutable state conflicts and include a stable error code.
- Publish an ORBAT/signup-changed event after commit.

## 7. P0 contract: availability notes

### Domain decision required

The existing `OrbatAttendanceNote` model supports `absent`, `unsure`, and `late_unsure`, plus `lateMinutes` and `leaveEarlyMinutes`. Before implementing the bot endpoint, decide:

1. If a signed-up member marks `absent`, should the platform atomically cancel the signup, reject the note, or allow both?
2. May a non-signed-up member record a note?
3. Are late and leave-early estimates optional, and what are their valid ranges?
4. At what cutoff can notes no longer be edited?
5. Who may view the reason text?

Do not expand the note enum to include compiled outcomes such as `present` or `no_show`.

### Proposed endpoints

```http
GET /bot/orbats/{orbatId}/availability/{discordUserId}
PUT /bot/orbats/{orbatId}/availability/{discordUserId}
DELETE /bot/orbats/{orbatId}/availability/{discordUserId}
```

Example update body:

```json
{
  "status": "late_unsure",
  "reason": "Work may run late",
  "lateMinutes": 30,
  "leaveEarlyMinutes": null
}
```

Requirements:

- Resolve the Discord ID to a platform user.
- Enforce the domain decisions above transactionally.
- Return the resulting signup and note state.
- Write the existing platform audit history where applicable.
- Publish an ORBAT availability-changed event after commit.

## 8. P0 contract: notification preferences

Notification preferences belong to the web platform. Do not use bot SQLite as the permanent store.

### Proposed data model

```prisma
model UserNotificationPreference {
  id                     Int      @id @default(autoincrement())
  userId                 Int      @unique
  user                   User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  orbatAnnouncements     Boolean  @default(false)
  trainingScheduled      Boolean  @default(false)
  trainingUpdated        Boolean  @default(false)
  trainingCancelled      Boolean  @default(false)
  trainingReminders      Boolean  @default(false)
  promotionAnnouncements Boolean  @default(false)
  dmEnabled              Boolean  @default(true)
  channelMentionsEnabled Boolean  @default(false)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
}
```

Do not duplicate `discordUserId` in this model; Discord identity is already represented by linked authentication accounts. Resolve it through the user relation.

### Proposed endpoints

```http
GET /bot/users/discord/{discordId}/notification-preferences
PATCH /bot/users/discord/{discordId}/notification-preferences
```

`PATCH` accepts only the fields being changed and returns the complete resulting preferences. Website settings must read and write the same row.

Open product decision: confirm whether defaults are opt-in or opt-out. The bot design currently specifies opt-out pending an explicit decision.

## 9. P0 contract: Discord rank-role mappings

### Proposed data model

```prisma
model RankDiscordRole {
  id            Int      @id @default(autoincrement())
  rankId        Int
  rank          Rank     @relation(fields: [rankId], references: [id], onDelete: Cascade)
  guildId       String
  discordRoleId String
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([rankId, guildId])
  @@index([guildId, isActive])
}
```

Snowflakes remain strings.

### Proposed administration endpoints

```http
GET    /admin/ranks/discord-roles?guildId={guildId}
PUT    /admin/ranks/{rankId}/discord-role
DELETE /admin/ranks/{rankId}/discord-role?guildId={guildId}
```

Administration requires an appropriate rank-configuration permission. The UI should validate snowflake format but cannot prove Discord role existence without Discord access.

### Proposed bot endpoint

```http
GET /bot/ranks/discord-roles?guildId={guildId}
```

Example response:

```json
{
  "guildId": "111111111111111111",
  "version": "2026-07-29T10:00:00.000Z",
  "mappings": [
    {
      "rankId": 2,
      "rankName": "Private",
      "rankAbbreviation": "Pvt",
      "discordRoleId": "222222222222222222"
    }
  ]
}
```

The bot caches successful results. An empty result and an API failure must be distinguishable so an outage cannot cause destructive role removal.

## 10. P0 contract: applied-rank events

The current promotion SSE route is web-session authenticated and emits only `promotions.updated`. It is not sufficient for bot reconciliation.

### Proposed stream

```http
GET /bot/events/ranks
Authorization: Bearer <token>
Accept: text/event-stream
Last-Event-ID: <optional-cursor>
```

Event example:

```json
{
  "id": "rank-1842",
  "type": "user.rank_changed",
  "occurredAt": "2026-07-29T12:00:00.000Z",
  "payload": {
    "rankHistoryId": 1842,
    "userId": 42,
    "discordUserId": "123456789012345678",
    "oldRankId": 1,
    "newRankId": 2,
    "changeType": "promotion",
    "source": "manual_approval"
  }
}
```

Requirements:

- Emit after the rank transaction commits.
- Cover auto promotions, approved proposals, demotions, direct assignments, and corrections.
- Use a durable event/outbox store. An in-memory event hub cannot replay downtime.
- Support `Last-Event-ID` or provide a cursor-based recent-events endpoint.
- Retain events for a documented interval.
- Do not require a web user session.

Fallback polling should query rank changes by durable cursor, not infer manual approvals from disappearance from the pending queue.

## 11. P1 contract: ORBAT filtering and events

### Date filtering

Extend the existing endpoint:

```http
GET /bot/orbats?startAt={isoInstant}&endBefore={isoInstant}&limit=100&cursor={cursor}
```

Use half-open time ranges. Filtering should use the effective normalized ORBAT schedule, including legacy `eventDate` data where necessary.

This supports Monday reconciliation and previous-day attendance compilation without fetching an arbitrary `limit=100` history.

### Event durability

The public `/orbats/events` SSE stream currently provides live events. Before relying on it operationally, confirm that events propagate across the production hosting topology. An in-process publisher/subscriber will not work reliably across multiple web instances or restarts.

Target event types:

- `orbat.created`
- `orbat.updated`
- `orbat.cancelled`
- `orbat.deleted`
- `orbat.signup_changed`
- `orbat.availability_changed`

Events should include an ORBAT content version so the bot can decide whether to edit an existing announcement.

## 12. P1 contract: training events

The existing training-reminders route supports polling but does not provide the complete lifecycle needed for notification preferences.

Proposed bot-authenticated event types:

- `training.scheduled`
- `training.updated`
- `training.cancelled`
- `training.reminder_due`

Payloads must include training ID, display title, normalized timestamps, website URL, and content version. Delivery recipients are selected using platform notification preferences; event payloads should not contain a large recipient list.

Training-request-specific subscriptions remain separate from general training notification preferences.

## 13. P1 contract: errors, pagination, and idempotency

New and existing bot endpoints should converge on a shared error envelope:

```json
{
  "error": {
    "code": "slot_full",
    "message": "The selected slot is full.",
    "details": {
      "slotId": 55
    },
    "correlationId": "01J..."
  }
}
```

Recommended status semantics:

- `400`: malformed request
- `401`: invalid or revoked bot token
- `403`: authenticated token lacks required capability
- `404`: referenced entity or linked user not found
- `409`: valid request conflicts with current mutable state
- `422`: well-formed input fails domain validation where `409` is not appropriate
- `429`: rate limited, with `Retry-After`
- `5xx`: transient or internal platform error

List endpoints must document maximum page size and use stable cursor pagination. Mutation endpoints triggered by Discord interactions should accept `Idempotency-Key` and retain results long enough for Discord retry windows.

## 14. P1 contract: attendance compilation

`POST /bot/attendance/compile` exists. Confirm and document:

- exact request and response schemas
- whether repeated calls are idempotent
- behavior when the ORBAT has already been compiled
- whether changed attendance events cause recompilation
- concurrency behavior
- stable error codes
- audit-log behavior

If compilation is idempotent, repeat calls should return the current compilation result rather than duplicate attendance or rank effects.

The bot should use ORBAT date filtering to identify candidates. The platform may later expose `POST /bot/attendance/compile-due` to own scheduling entirely, but that is not required for the first release.

## 15. P2 and deferred contracts

### Bot rank-history access

Add only if operator diagnostics or user-visible history requires it:

```http
GET /bot/users/{userId}/rank-history?limit=50&cursor={cursor}
```

The applied-rank event and current-user endpoints are sufficient for routine synchronization.

### Training announcement metadata

Do not add web-platform message metadata solely to support Discord reply forwarding until the product decisions in the bot design are settled. The bot can store its own Discord announcement message reference because that is operational Discord state.

### Webhooks

Webhooks are deferred. SSE plus durable replay and reconciliation is sufficient for a single externally hosted bot and does not require exposing an inbound bot HTTP server. Revisit if external consumers or delivery latency requirements change.

### Guild restrictions on bot tokens

Guild-scoped token restrictions are not required for the initial single-production-guild deployment. The rank-role mapping endpoint still requires `guildId` to prevent ambiguous mappings and support the separate development database/guild.

## 16. Removed or superseded proposals

The following older proposals are intentionally superseded:

- `X-BOT-API-TOKEN`: use `Authorization: Bearer`.
- Permanent SQLite notification preferences: use platform storage.
- Rank-role mappings in bot configuration: use platform mappings.
- Treating `present` and `no_show` as user-entered availability notes: those are compiled outcomes.
- Inferring approved manual promotions by polling the pending queue: use applied-rank events or rank-history cursor polling.
- Requiring both webhooks and SSE for the same event: use SSE with durable replay and polling reconciliation.
- Adding Discord IDs redundantly to preference records: resolve linked identities through existing authentication accounts.

## 17. Implementation sequence

1. Settle the absent-with-existing-signup and availability cutoff decisions.
2. Add common error envelopes and document current bot endpoint schemas.
3. Implement available-slot and signup update/cancel contracts.
4. Implement availability-note endpoints.
5. Implement notification preferences and website settings.
6. Implement rank-role mapping persistence, admin UI/API, and bot read API.
7. Implement durable applied-rank events and replay.
8. Add ORBAT date filtering and durable ORBAT event delivery.
9. Add training lifecycle events.
10. Add integration tests covering authentication, idempotency, concurrency, and retries.

## 18. Definition of API readiness

The platform API is ready for the initial bot when:

- Every endpoint used by the bot is present in OpenAPI with examples.
- Bot authentication examples match implementation.
- Signup create/change/cancel is atomic and idempotent.
- Available-slot responses reuse authoritative eligibility logic.
- Availability notes are platform-owned and their signup interaction is decided.
- Notification settings round-trip through the website and bot API.
- Rank-role mappings are guild-specific and safely distinguish empty data from failure.
- Applied-rank events are bot-authenticated, durable, and replayable.
- Attendance compilation is documented as safely repeatable or provides an equivalent deduplication contract.
- Integration tests cover duplicate interactions, concurrent signup claims, expired tokens, missing Discord links, and replayed events.

---

Document version: 2.0

Last updated: 2026-07-29

# 6MD Discord Bot Design

## 1. Document purpose

This document is the implementation specification for the 6MD Discord bot. It defines product behavior, system ownership, Discord interactions, background processing, failure handling, security, and deployment.

API availability and required web-platform changes are tracked separately in [API gaps and contracts](./api-missing-features.md). That document is authoritative for whether an endpoint exists today.

### Goals

The bot integrates one Discord guild with the 6MD Management Platform and provides:

- ORBAT announcements with website links and interactive signup
- Signup creation, change, and cancellation against the website database
- Operation availability notes such as absent, unsure, late, and leaving early
- Attendance compilation scheduling
- Training and ORBAT notification preferences
- Administrator approval of non-automatic promotions
- Promotion announcements
- Discord nickname and rank-role reconciliation

### Non-goals

- The bot does not change a Discord account username. It only changes the member's guild nickname.
- The bot is not the source of truth for users, ranks, signups, attendance, notification preferences, or rank-role mappings.
- The bot does not independently decide promotion eligibility.
- The bot does not infer final attendance outcomes from availability buttons. The web platform compiles attendance.

## 2. Architecture decisions

### 2.1 Sources of truth

| Data | Authoritative owner | Bot storage |
|---|---|---|
| Users, linked Discord IDs, ranks | Web platform | Read-through cache only |
| ORBATs, slots, signups | Web platform | Message references and cache only |
| Attendance notes and compiled attendance | Web platform | None |
| Notification preferences | Web platform | Cache only |
| Rank-to-Discord-role mappings | Web platform | One-hour cache |
| Discord message IDs and interaction state | Bot | Durable SQLite database |
| Event cursor and processed event IDs | Bot | Durable SQLite database |

SQLite is operational bot state, not an alternative business-data store. A temporary workaround that stores business data in SQLite must be explicitly approved and recorded in the API gap tracker.

### 2.2 Event delivery

The target event model is:

- A bot-authenticated SSE stream is the primary near-real-time delivery mechanism.
- Scheduled polling is the recovery and reconciliation mechanism.
- Event handlers are idempotent and persist their last processed event ID.
- The design does not require webhooks. Webhooks may be reconsidered if the bot later runs behind a stable public HTTPS endpoint.

SSE is delivery-at-least-once, not exactly-once. Every event must have a stable ID, type, occurrence time, and payload. Reprocessing the same event must be safe.

### 2.3 Consistency model

Discord changes cannot participate in a database transaction with the web platform. “Immediate” or “near-real-time” means that the bot attempts the Discord update as soon as it receives the applied event. It does not mean atomic or guaranteed synchronous completion.

The web-platform change remains authoritative if Discord is unavailable. Failed Discord changes enter a retry queue and are corrected by periodic reconciliation.

### 2.4 Discord interaction model

Slash commands and message components are the primary interface. Prefix commands may be retained temporarily for compatibility, but new functionality should use application commands because they provide typed parameters, discovery, and native ephemeral responses.

## 3. System overview

```text
Discord member
    |
    v
Discord application commands, buttons, and modals
    |
    v
6MD bot
    |-- interaction handlers
    |-- API client
    |-- SSE consumers
    |-- scheduled reconciliation
    |-- SQLite operational state
    |
    v
6MD Management Platform API and database
```

### Suggested bot project structure

```text
6MD.DiscordBot/
|-- Commands/
|-- Components/
|-- Configuration/
|-- Events/
|-- Jobs/
|-- Models/
|-- Persistence/
|-- Services/
|-- Program.cs
`-- 6MD.DiscordBot.csproj
```

Recommended services include `PlatformApiClient`, `OrbatAnnouncementService`, `SignupService`, `AttendanceService`, `PromotionService`, `NotificationService`, `DiscordUserSyncService`, and `ReconciliationService`.

## 4. Configuration

Secrets must be supplied through environment variables or a deployment secret store. Snowflake IDs may be supplied through normal configuration.

```json
{
  "Discord": {
    "GuildId": "<guild-id>",
    "AdminRoleId": "<admin-role-id>",
    "AdminChannelId": "<admin-channel-id>",
    "AnnouncementChannelId": "<announcement-channel-id>",
    "TrainingChannelId": "<training-channel-id>"
  },
  "Platform": {
    "ApiBaseUrl": "https://orbat.6md.net/api",
    "WebsiteBaseUrl": "https://orbat.6md.net",
    "TimeoutSeconds": 30
  },
  "Jobs": {
    "AttendanceCompileTimeUtc": "01:00:00",
    "ReconciliationIntervalMinutes": 60,
    "PromotionFallbackPollMinutes": 5,
    "OrbatFallbackPollMinutes": 60
  },
  "Features": {
    "NicknameSync": true,
    "RankRoleSync": true,
    "TrainingNotifications": true,
    "PromotionAnnouncements": true
  }
}
```

Required secret environment variables:

- `DISCORD_TOKEN`
- `BOT_API_TOKEN`

Optional environment variables may override non-secret settings, but the implementation must document its exact configuration precedence.

## 5. Authentication and authorization

### Platform API authentication

Bot endpoints use:

```http
Authorization: Bearer <BOT_API_TOKEN>
```

Bot tokens are created and revoked in the web application by a user with `system:super_admin`. The bot must not log the token or include it in user-facing error messages.

On `401`, the bot must stop retrying the individual request, mark platform authentication unhealthy, and alert operators. On `403`, it must log the endpoint and missing permission context without exposing secrets.

### Discord authorization

Authorization is checked at interaction time, not only through channel visibility:

- Promotion approval requires the configured admin role.
- Bulk synchronization and diagnostic commands require the admin role.
- User actions use the invoking Discord user ID and may only modify that linked user.
- Component custom IDs must not be trusted as authorization. The handler revalidates the actor and current platform state.

## 6. User identity

Every user-facing action resolves the caller through their Discord snowflake using `GET /bot/users/discord/{discordId}`.

If no linked platform user exists, the bot returns an ephemeral message with a website account-linking URL. It must not create shadow users.

Discord snowflakes are serialized as strings in API JSON and configuration to avoid numeric precision loss.

## 7. ORBAT announcements

### Triggering rules

An ORBAT is announced when either condition is met:

1. A new eligible ORBAT is created for the current operation week.
2. The Monday reconciliation job finds an eligible ORBAT that has not been announced.

The operation week is Monday 00:00 through Sunday 23:59:59 UTC unless the platform later defines a different unit timezone. The announcement target and eligibility rules must be based on normalized platform timestamps.

### Delivery behavior

An announcement contains:

- ORBAT name and description
- Start and end time in Discord timestamp format
- Current signup count or summarized availability
- A link button to `{WebsiteBaseUrl}/orbats/{orbatId}`
- A `Sign up` button
- An optional `Availability` button

The bot stores `(guildId, orbatId, discordMessageId, announcedAt, contentVersion)` with a unique constraint on `(guildId, orbatId)`. Event and scheduler paths call the same idempotent announce operation.

If a relevant ORBAT changes, the bot edits the existing announcement where possible. Deleted or cancelled ORBAT behavior must be carried by the event contract; the bot disables interaction components and marks the announcement cancelled.

## 8. Signup flow

### Interactive flow

1. The member selects `Sign up` on an ORBAT announcement or runs `/signup`.
2. The bot resolves the linked platform user.
3. The bot requests user-specific available slots from the platform.
4. The bot returns an ephemeral select menu. Select menus are preferred over one button per slot because Discord component rows have limited capacity.
5. The member selects a slot.
6. The bot calls the authoritative signup mutation.
7. The bot returns confirmation and refreshes the public announcement asynchronously.

If the member already has a signup, the ephemeral response shows the current slot and offers `Change slot` and `Cancel signup` actions.

### Server-side guarantees

The API, not the bot, is responsible for atomically enforcing:

- one signup per user per ORBAT
- slot capacity
- ORBAT signup cutoff
- absence-note restrictions
- training and rank prerequisites
- slot membership in the requested ORBAT

The bot may display eligibility information, but it must handle a later `409` because state can change between display and mutation.

### Interaction retries

Discord can deliver duplicate interactions and users can double-click. Signup mutations should accept an idempotency key derived from the Discord interaction ID. Until supported, the bot serializes active signup mutations per `(orbatId, userId)` and treats an API response describing the already-desired state as success.

## 9. Availability and attendance

### Availability notes

User-selected availability is distinct from compiled attendance. Supported input states are:

- `absent`
- `unsure`
- `late_unsure`, optionally with expected late minutes
- `late_unsure`, optionally with expected leave-early minutes

The current platform data model uses one note plus `lateMinutes` and `leaveEarlyMinutes`. The Discord UI should therefore offer:

- `Absent`
- `Unsure`
- `Late / leave early`, followed by a modal for minute estimates
- `Clear note`

“Present” and “no show” are compiled outcomes and are not user availability buttons.

When a user marks themselves absent while signed up, the platform contract must define whether the signup is automatically cancelled or the request is rejected pending explicit cancellation. The bot must not guess. This decision is tracked as an API blocker.

### Attendance compilation

At 01:00 UTC, the bot requests compilation for ORBATs whose effective end time falls in the previous UTC day interval:

```text
[previous day 00:00:00 UTC, current day 00:00:00 UTC)
```

Compilation must be idempotent. The bot records each attempted ORBAT and result, retries transient failures, and runs a startup catch-up for uncompiled eligible ORBATs within a configurable lookback period.

The bot does not manufacture check-in/check-out times from availability notes.

## 10. Notification preferences and delivery

Notification preferences are stored in the web platform and can be changed from Discord or the website.

Initial preference types:

- ORBAT announcements
- Training scheduled, updated, and cancelled
- Training reminders
- Promotion announcements

Delivery settings include DM enabled and channel mention enabled. Defaults are opt-out unless product owners explicitly choose opt-in and record the privacy rationale.

If a DM fails because the user blocks DMs, the bot records the delivery failure and provides guidance the next time that user changes settings. It must not silently switch to a public mention unless the user enabled channel mentions.

The `/notifications` command displays current preferences and updates them through bot-authenticated platform endpoints.

## 11. Training announcements and responses

Training announcements use a consistent embed and include an `Open training chat` link or button.

Reply redirection is not the preferred interaction because forwarding user-authored content creates privacy and moderation ambiguity. If product owners require it, the final behavior must define:

- whether the original reply is deleted
- whether author identity, attachments, embeds, and mentions are preserved
- how users are informed before forwarding
- retention and moderation behavior

Until those decisions are made, the bot should direct users to the configured training channel instead of copying messages.

## 12. Promotions

### Manual promotion approval

The bot polls or consumes a pending-promotion event and posts one message per proposal in the admin-only channel. The message includes the user, current rank, proposed rank, attendance evidence, and `Approve` and `Decline` buttons.

On interaction the bot:

1. Verifies the actor has the configured admin role.
2. Fetches or submits against current proposal state.
3. Calls `POST /bot/promotions/{id}/approve` or `POST /bot/promotions/{id}/decline`.
4. Disables the buttons and records the actor, decision, and timestamp in the Discord message.

The platform performs the promotion transaction. On decline, it resets `attendanceSinceLastRank` to current attendance. The bot does not increment or reset counters itself.

Concurrent decisions must be safe: an already-resolved proposal returns a conflict or its current state, which the bot displays rather than overwriting.

### Applied promotions

An applied-promotion event covers automatic promotions, approved proposals, demotions, and administrative rank corrections. The bot uses the same reconciliation path for all rank changes.

Promotion announcements are deduplicated by rank-history or event ID. Announcement failure does not roll back the platform promotion.

## 13. Nickname and rank-role reconciliation

### Nickname format

The default format is:

```text
[RankAbbreviation] WebsiteUsername
```

The bot truncates safely to Discord's nickname limit. Empty abbreviations, retired users, and exempt administrators require explicit platform metadata or configuration; they must not be inferred from role names.

### Role update algorithm

1. Fetch the platform user and current rank.
2. Load active rank-role mappings for the configured guild.
3. Validate that the desired Discord role exists and is below the bot's highest role.
4. Add the desired role if absent.
5. Remove other mapped rank roles only after the desired role is confirmed.
6. Update the nickname.
7. Persist success or enqueue retry for failed steps.

If no desired mapping exists, the bot leaves existing roles unchanged and alerts operators. It must never remove all rank roles merely because the mapping API is unavailable or stale.

### Reconciliation triggers

- Applied-rank event: immediate attempt
- Guild member join: reconcile that member
- Hourly job: reconcile all linked active members
- `/admin sync-user`: reconcile one member
- `/admin sync-all`: enqueue a rate-limited bulk reconciliation

Discord hierarchy errors, missing permissions, absent guild members, and deleted roles are reported separately. A user absent from the guild is not an error requiring retries.

## 14. Commands and components

| Interaction | Audience | Purpose |
|---|---|---|
| `/orbats` | Members | List upcoming ORBATs |
| `/signup` | Members | Create, change, or cancel own signup |
| `/availability` | Members | Set or clear own availability note |
| `/notifications` | Members | View and change notification preferences |
| `/whois` | Members | Show non-sensitive linked-user information |
| `/admin sync-user` | Admins | Reconcile one Discord member |
| `/admin sync-all` | Admins | Enqueue full guild reconciliation |
| Promotion buttons | Admins | Approve or decline a proposal |
| ORBAT signup component | Members | Open ephemeral slot selection |

All user-facing failures receive a concise ephemeral explanation and correlation ID. Detailed exceptions are logged only for operators.

## 15. Bot persistence

Suggested SQLite entities:

- `DiscordMessageReference`: guild, platform entity type/ID, Discord channel/message IDs, content version
- `ProcessedEvent`: event source, event ID, processed time, result
- `EventCursor`: stream name and last event ID
- `PendingDiscordAction`: action type, target, attempt count, next attempt time, last error
- `JobExecution`: job name, logical interval, start/end time, outcome
- `InteractionReceipt`: Discord interaction ID and final result for deduplication

Apply uniqueness constraints for natural idempotency keys. Define retention jobs for processed events, interaction receipts, and successful executions. Failed actions remain until resolved or manually dismissed.

## 16. Failure handling and observability

### Retry policy

- Retry network failures, `408`, `429`, and most `5xx` responses with exponential backoff and jitter.
- Honor `Retry-After`.
- Do not automatically retry validation failures or authorization failures.
- Bound retries and move exhausted Discord operations to the durable retry queue.
- Use a circuit breaker when the platform API is persistently unavailable.

### Health and metrics

Expose or log enough information to monitor:

- Discord gateway connection state
- Platform API authentication and latency
- SSE connection and last event time
- Pending and failed Discord actions
- Scheduler last success time
- Announcement, signup, attendance compile, and synchronization outcomes
- Discord and platform rate-limit events

Use structured logs with correlation IDs. Never log bot tokens, full authorization headers, or unnecessary message content.

## 17. Discord permissions and intents

Required bot permissions:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Nicknames
- Manage Roles
- Use Application Commands

Optional permissions depend on final features:

- Manage Messages, only if reply redirection deletes messages
- Attach Files, if generated or forwarded attachments are required
- Use External Emojis, only if announcement designs use them

Required gateway intents:

- Guilds
- GuildMembers

GuildMessages and MessageContent are only required if reply-based training forwarding or legacy prefix commands remain. Avoid privileged MessageContent intent when components and slash commands cover the product behavior.

The bot's highest Discord role must be above every managed rank role and below roles it should never modify.

## 18. Security and privacy

- Validate all Discord IDs, guild IDs, ORBAT IDs, and proposal IDs server-side.
- Escape or disable unwanted mentions in platform-provided text.
- Restrict the bot to the configured guild.
- Minimize user data returned by bot APIs.
- Do not forward private message content without explicit product approval and user notice.
- Rotate Discord and platform tokens through deployment secrets.
- Record administrative promotion decisions in the platform audit log and identify the Discord actor.
- Rate-limit user-triggered mutations and admin bulk operations.

## 19. Deployment and operations

Target runtime: C# on .NET 10 using Discord.NET.

The production bot runs as one active instance. Running multiple instances requires distributed interaction deduplication, job leadership, and event cursors; SQLite alone is not sufficient for active-active deployment.

The process must:

- use graceful shutdown cancellation tokens
- close SSE and Discord connections cleanly
- finish or persist in-flight operations
- apply SQLite migrations before accepting interactions
- register guild-scoped commands in development and production-scoped commands according to the release process
- run under systemd or a container restart policy

Development uses a separate Discord guild, platform database, bot token, and Discord application token.

## 20. Acceptance criteria

The first production release is ready when:

- Duplicate events and interactions do not create duplicate announcements or signups.
- Signup create/change/cancel operations use the website database and handle conflicts.
- Availability notes round-trip through the platform API.
- Attendance compilation catches up safely after downtime.
- Notification preferences are visible and editable from both Discord and the website.
- Manual promotion buttons are authorization checked and concurrency safe.
- Every applied rank change is eventually reflected in nickname and rank role or produces an actionable operator alert.
- Missing role mappings never cause destructive role removal.
- Authentication, rate limits, retries, and health signals are covered by integration tests.

## 21. Delivery phases

### Phase 1: platform contracts

Implement and document the blocking endpoints and event contracts identified in the API gap tracker.

### Phase 2: core Discord experience

Deliver ORBAT announcements, signup management, availability notes, notification settings, and manual promotion approval.

### Phase 3: reconciliation and operations

Deliver applied-rank events, nickname/role reconciliation, catch-up jobs, durable retries, metrics, and operator commands.

### Phase 4: optional enhancements

Evaluate training reply forwarding, richer notification routing, and multi-instance deployment only after the core system is stable.

---

Document version: 2.0

Last updated: 2026-07-29

# Discord bot web configuration and integration

Status: target integration contract with an implementation mapping below. Website support does not imply the separate Discord executor has been implemented.
Updated: 2026-10-04

Read alongside the [feature specification](./feature-specification.md). This document replaces local-configuration assumptions in the deprecated bot documentation.

## 1. Repository and data boundaries

| Website repository | Separate bot repository |
|---|---|
| Configuration database, validation, admin UI, and configuration history | Fetch, validate compatibility, and apply configuration |
| Users, linked identities, ranks, ORBATs, signups, and availability rules | Discord interactions and API client |
| Rank-role mappings and shared accepted base names | Apply Discord roles/nicknames and observe changes |
| Announcement requests and authoritative image rendering | Publish/edit messages and report message references |
| Moderation cases, restricted evidence and attachment storage, retention | Detect triggers, capture evidence, punish, clean up, report outcomes |
| Authorized administrative commands and audit history | Execute commands and report confirmed results |
| Integration contracts and website contract tests | Consumer compatibility tests and Discord adapters |

The bot uses authenticated website APIs only, never shared database credentials or direct database access. Its own durable operational storage may contain event cursors, message references, configuration snapshots, queued work, interaction receipts, and temporary evidence awaiting upload. These are recovery state, not competing business records.

The bot is planned to target **.NET 10**. The Discord library, repository name, hosting, and operational storage technology remain undecided. Maintain the product specification and integration contract here; the bot repository should link to an agreed contract version and document its own build/deployment steps without independently redefining product rules.

## 2. Only external bot configuration

Proposed deployment variable names:

| Variable | Purpose |
|---|---|
| `PLATFORM_API_URL` | Website API connection/bootstrap URL |
| `PLATFORM_API_KEY` | Credential used to authenticate to that API |
| `DISCORD_BOT_TOKEN` | Discord API credential |
| `DISCORD_OUTAGE_ALERT_USER_ID` | Discord user to DM about website/configuration outages; stored locally alongside credentials so recipient lookup works offline |
| Discord application/client identity or secret, if required by the chosen connection model | Discord API bootstrap only; derive identity from Discord when possible |

These are the only exceptions to website-managed bot configuration. This is not permission to add arbitrary Discord behavioral settings to environment variables.

Do **not** add local/environment overrides for guild ID, channels, role IDs, nickname format, website display links, feature switches, templates, schedules, timeouts, retries, logging behavior, retention, colors, or notification settings other than the explicit local outage-alert recipient above. There is no parallel `appsettings.json`, `.env`, or command-line hierarchy for those settings. The bootstrap API URL does not substitute for the web-configured canonical website URL used in messages.

Build artifacts, storage volumes, and process supervision remain deployment mechanics; they must not become alternate sources of feature policy. The first authenticated configuration fetch may use minimal compiled transport defaults because remote settings are not yet available. Those defaults are not operator-configurable feature settings; effective runtime transport settings come from the website after bootstrap.

Credentials must not be returned in configuration responses, logged, or exposed in message previews. Website-side storage infrastructure stays part of website deployment, not an additional bot-local secret requirement.

## 3. Web configuration catalog

These are proposed field groups rather than a finalized JSON schema. Existing website entities must be referenced, not copied into a second independently editable store.

| Group | Website-managed values |
|---|---|
| Connection context | Guild ID, canonical website/link URLs, feature enablement, operator display name |
| Join roles | Default role IDs, three attempts (immediate, +10 seconds, then +30 seconds by default), retry delays, failure destination; changes affect future joins unless explicitly applied to existing members |
| Welcome | Enablement, channel, template, recruiter role, lobby/rules channels, guidebook URL, welcome-on-every-join default including returning members |
| Reaction menus | Category title/description/channel, ordered emoji-label-role entries, multiple/single-choice mode, publish state, message reference; retain roles when deleting entries unless explicit reviewed removal is requested |
| Announcements | Default channel, allowed mention targets, editable template, image style/occupancy colors, update batching interval |
| Per-ORBAT announcement | ORBAT reference, custom text, destination, mention selection, published message reference and status |
| Signup and availability | Feature visibility and presentation; domain validation remains in existing website services |
| Honeypot | Enablement/channel, established-member role IDs (initial setup: Regulars, Retired, Friend of Group, Joint-operations), exempt roles/accounts, timeout duration, staff log destination |
| Cleanup | 30-minute pre-trigger window, execution/retry settings, progress/failure reporting |
| Evidence | Retention mode/days, per-item indefinite retention, manual/automatic soft deletion and 7-day recovery, restricted access policy, maintenance schedule |
| Rank/name sync | Existing rank-role mappings, managed prefix format, sync/reconciliation schedule, exclusions if supported; website name wins at linking and cleared nicknames restore the formatted website name |
| Operations | Polling/heartbeat intervals, retry/backoff limits, request timeouts, reconciliation settings, configurable logging level |

Product constraints are validated in the website and defended by the bot:

- Timeout duration is at least 24 hours and within Discord's supported range.
- Cleanup looks back 30 minutes from the trigger; this agreed policy is not freely editable to a different duration without a product change.
- Join-role assignment stops after three failed attempts; ordinary configurable retry policies must not bypass this limit.
- Finite evidence retention is at least 7 days. Indefinite retention has an explicit mode and no expiry.
- Membership is determined only by the web-configured role IDs, never hard-coded role names. Without a membership role or exemption, a honeypot trigger results in a ban, including unclassified-role accounts.
- Reaction-menu roles cannot count as membership roles. Flag conflicting default/member/exempt mappings instead of relying on accidental evaluation order.
- Store Discord identifiers as strings. Validate guild membership of channels/roles using bot-reported metadata before publishing applicable settings.
- Do not equate saving a role ID with proving the bot can manage that role.

### Retention representation

Example proposed values:

```json
{ "mode": "days", "days": 7 }
```

```json
{ "mode": "indefinite", "days": null }
```

Do not overload zero days to mean forever. Retention increases extend existing active evidence where applicable; selecting indefinite mode removes its expiry. Reductions affect only newly captured evidence. Switching from indefinite to finite does not give previously indefinite evidence a new expiry. Deleted or purged content cannot be recovered by increasing retention.

### Manual and automatic deletion, restoration, and per-item indefinite retention

- Authorized admins can mark an individual active evidence item **Keep indefinitely**, regardless of the global default. Persist that choice separately so later global changes cannot clear it.
- Manual **Delete** and automatic retention expiry both move evidence to a restricted recovery view for exactly 7 elapsed days from deletion; content and attachments remain recoverable until that deadline. Display the recovery deadline in UTC and the user's local time.
- A manual deletion may override indefinite retention only through an explicit action that clearly identifies the indefinite mark. Ordinary expiry never deletes indefinitely retained evidence. This is a recoverable deletion, not an immediate purge.
- **Restore** before the deadline returns the item and its attachments to active storage. Preserve its previous indefinite mark. For finite evidence whose old expiry has passed or is imminent, the implemented restoration default is at least 7 further days before automatic expiry; show the resulting deadline to the admin.
- **Keep indefinitely** on a deleted item requires restoration first, preventing a hidden permanent trash item.
- Repeated delete requests must not reset the recovery clock. No manual bypass of the 7-day recovery window is provided. At/after the deadline restoration is unavailable, and the maintenance worker can permanently purge content and attachment copies.
- Normal retention pruning must skip recoverable items until their recovery deadline. Global policy changes do not shorten or extend the explicit deletion recovery window.
- Audit actor (admin or automation), time, item identity, and lifecycle changes without copying deleted evidence content into the audit. Keep case/punishment/audit metadata independently from evidence payloads.
- Restoration, indefinite marking, and pruning must be concurrency-safe so a successful restore cannot race with attachment deletion. Purge retries must report partial failures without claiming complete deletion.

The seven-day recovery rule applies equally to manual deletion and automatic expiry. Automatic expiry marks evidence deleted; it must not immediately purge content or attachments. For example, evidence with a 7-day active retention period enters recovery when the expiry worker soft-deletes it, then remains recoverable for a further 7 elapsed days. The final purge is the end of that recovery lifecycle and does not create another recovery window.

## 4. Configuration publication and bootstrap

Proposed lifecycle:

1. Provision the bot with only the bootstrap values in section 2.
2. Authenticate to the website and identify the integration through its credential/registration record. The website determines the configuration and guild; do not require a local guild ID to fetch it.
3. Fetch a complete validated snapshot with `schemaVersion`, monotonically increasing `revision`, `updatedAt`, guild context, and effective settings.
4. Fetch/report Discord channel and role metadata so setup can be completed in the web UI.
5. Validate supported schema/features and apply a complete revision atomically. Report applied revision or a structured validation failure.
6. Use a configuration-change event to trigger a fresh fetch; polling repairs missed events.

The UI distinguishes **saved**, **waiting for bot**, **applied**, and **failed**, with the last acknowledged revision/time. Concurrent admin edits use expected revision checks so one editor cannot unknowingly overwrite another.

### Configuration freshness and outage alerts

- Fetch at startup, on configuration-change notification, and every 60 seconds as a fallback by default. A successful authenticated verification resets freshness even when the revision is unchanged.
- Use the last verified configuration for up to 15 minutes without website contact by default. Polling and freshness limits are web-configured.
- Without an initial valid snapshot, perform no behavioral actions. After freshness expires, pause new automated bans, timeouts, role assignments/removals, and nickname changes. Report degraded status; preserve pending work.
- Website-dependent signup and availability requests fail clearly while the API is unreachable; do not queue them to submit unexpectedly later.
- On recovery, fetch current configuration and state before resuming. Recheck roles, exemptions, revoked commands, and released timeouts. Never replay obsolete punishments or reset cleanup windows.
- DM `DISCORD_OUTAGE_ALERT_USER_ID` when website/configuration contact fails, including startup authentication/configuration failure. This recipient is a deliberate local-configuration exception. The alert path must not depend on a successful website fetch.
- Alert once per outage, notify when stale-configuration actions are paused, and send a recovery notice. Deduplicate alerts across retries/restarts. Include outage start, last successful verification, and affected capabilities; exclude credentials and evidence content.
- If Discord is also unavailable or the DM cannot be delivered, record the delivery failure locally and retry when possible using bounded delivery attempts. Do not claim the user was notified until delivery succeeds. Coalesce obsolete alerts into an incident summary after recovery.
- The initial alert and deduplication behavior has a compiled bootstrap fallback when no web configuration has ever been loaded. This does not create additional locally configurable behavior settings.

Changes must not apply halfway through a moderation decision. Record the revision used for each case. Before action retries, check whether work was cancelled or superseded, especially timeout releases and banned-member role assignments.

## 5. Required integration capabilities

**The table below describes the target contract.** See [the current website API mapping](../api/batches/discord-admin.md) and its OpenAPI fragment for concrete implemented routes and limitations. Do not copy endpoints from `api-missing-features.md`; that file is deprecated. Reuse current canonical website resources wherever they already meet the contract.

| Capability | Required contract |
|---|---|
| Configuration read/write | Complete effective snapshot, schema/revision, conflict detection, admin authorization/audit |
| Configuration acknowledgement | Bot identity/version, applied revision, validation errors, UTC timestamp |
| Discord metadata reporting | Guild/channel/role IDs and names, relevant permissions/hierarchy, observation timestamp |
| Heartbeat/status | Last contact, connectivity, configuration freshness, pending/failed work, compatibility state |
| Linked-user lookup | Discord ID to numeric website user ID and minimal display/rank data |
| Signup availability/mutations | Existing website rules, eligible slots/reasons, create/change/cancel, atomic checks |
| Availability notes | Existing get/update/clear operations with identical website semantics |
| Announcement requests | Authorized explicit publish/refresh/re-ping actions and idempotent execution state |
| Announcement rendering | Current operation data and occupancy-aware image with content revision |
| Message-reference reporting | Guild/channel/message IDs, ORBAT/menu association, rendered revision, last outcome |
| Rank mapping/read | Existing authoritative rank data and complete applicable mapping set |
| Name changes | Shared validation, expected name revision, source/actor context, resulting accepted name |
| Moderation cases | Trigger identity, role/configuration snapshot, decision, punishment expiry and outcomes |
| Evidence lifecycle | Restricted content/attachment upload/read, retention/expiry metadata, per-item indefinite mark, authorized soft delete/restore, recovery deadline and audit |
| Cleanup reporting | Fixed window, per-message capture/deletion results, inaccessible-message gaps |
| Admin timeout release | Authorized queued command, original punishment reference, cancellation of stale retries, confirmed result |
| Durable events/commands | Replay/cursor, stable IDs, deduplication, ordering/version semantics, execution acknowledgements |

Keep the current mapping tied to routes/services/tests and distinguish implemented website support from behavior still requiring the bot executor. New exact API paths and payloads belong in current OpenAPI once selected. Use current shared API authentication, response, pagination, error, and audit conventions; do not introduce a parallel legacy `/bot/*` business API by default.

### Current website implementation and executor boundary

Implemented website support includes configuration/revision acknowledgement,
metadata/heartbeat reporting, durable leased commands, linked-member adapters,
explicit announcement publication, rank/name data, moderation cases, and evidence
lifecycle handling. Reconciliation now has paginated announcement and published
menu-message indexes. Successful menu publication records durable message IDs,
including references retained after menu removal or channel changes. Immutable
operation reports record join-role, welcome, reaction-role, rank, and nickname
outcomes with bounded codes and idempotent event IDs. Cleanup-only case reporting
can continue after early release without changing the punishment.

The website now also implements durable configuration/member events, reviewed
bulk-role previews and execution receipts, announcement content revisions and
missing-message recovery, historical configurations, structured compatibility/
permission diagnostics, case-detail retrieval, optional timeout release reasons,
and explicit join-role retry commands. See the [API mapping](../api/batches/discord-admin.md)
for current payloads, authentication and all October migrations.

The separate .NET 10 executor remains responsible for live Discord permission and
hierarchy checks, gateway ingestion, durable local execution/reconciliation,
actual message/role/nickname/moderation actions, and end-to-end validation.

## 6. Events and execution semantics

Implemented durable event aggregates are `orbat`, `rank`, `training`, `discord`, and `member`; the [API mapping](../api/batches/discord-admin.md) documents wire names and payloads. Their semantics include:

- Configuration changed.
- Announcement publish/refresh/re-ping requested.
- ORBAT details, signups, availability, or signup availability changed.
- Linked account, accepted base name, or rank changed.
- Timeout release requested and moderation case updated.
- Future: ORBAT cancelled, mod preset published/changed.

`GET /api/events` implements JSON polling and durable SSE replay, with independent cursors per aggregate. A separate inbound bot HTTP server is not required. The executor still needs persistent cursor storage, deduplication, and reconciliation in its deployment.

Events/commands carry stable IDs, aggregate identity, occurrence time, and relevant revision. Business mutations and events must not diverge on transaction failure. Consumers persist progress and deduplicate. Treat delivery as at-least-once; do not claim exactly-once Discord side effects.

Publish requests, moderation actions, releases, and signup interactions require idempotency and acknowledgement semantics. If a Discord request times out after possibly succeeding, reconcile before blindly repeating it. A retry must not send another ping, extend a timeout, or undo an early release. Prioritize current authoritative state over replaying stale mutations.

Use numeric website IDs, string Discord IDs, and UTC instants. Include correlation IDs in failures and distinguish validation, authorization, conflict, missing-resource, rate-limit, and transient errors. Honor Discord/platform requested waits even when longer than the configured delay; reschedule rather than retry too early. General work uses a separate web-configured backoff policy from the three-attempt join-role policy. Permission errors require correction and must not be blindly retried.

### General retry defaults

Transient failures use six attempts total, with these waits after successive failures:

| Attempt | Wait |
|---|---|
| 1 | Immediate |
| 2 | 5 seconds |
| 3 | 15 seconds |
| 4 | 1 minute |
| 5 | 5 minutes |
| 6 | 15 minutes |

These defaults and bounded jitter are web-configured. Apply nonnegative jitter without shortening a server-requested wait. This policy is separate from the three-attempt join-role policy.

Validation and permission failures stop immediately and expose the needed correction. Authentication failures pause affected work until authentication is restored; do not consume repeated mutation attempts against invalid credentials. Exhausted work remains failed and visible with explicit manual retry. Reconcile uncertain side effects before retrying; coalesce announcement updates to the latest revision. Reconciliation must not silently reset an exhausted punishment's retry budget or reverse a timeout release.

## 7. Access, evidence, and Discord feasibility

The following keys are registered in `lib/permissions.ts`, with default **0** and maximum **255**. A missing grant or value 0 denies access; a positive value grants the specific capability. The existing shared server authorization (`hasApiPermission` / `checkPermission`) gives `system:super_admin > 0` an override, including when an individual Discord grant is 0. Do not use legacy raw permission lookups as the complete authorization check.

| Key | Capability |
|---|---|
| `discord:view` | View Discord bot status and operational activity |
| `discord:configure` | Manage Discord bot configuration, role menus, and synchronization settings |
| `discord:announce` | Publish, refresh, and re-ping Discord ORBAT announcements |
| `discord:retry` | Retry failed Discord operations subject to their original action permissions |
| `discord:moderation_view` | View Discord moderation cases and punishment history without evidence content |
| `discord:timeout_release` | Release Discord member timeouts early |
| `discord:evidence_view` | View Discord moderation evidence, attachments, and recoverable evidence |
| `discord:evidence_delete` | Soft-delete Discord moderation evidence including indefinitely retained items |
| `discord:evidence_restore` | Restore Discord moderation evidence during its recovery window |
| `discord:evidence_retention` | Manage Discord evidence retention policy and per-item indefinite retention |

Keys are independent; `discord:configure` does not implicitly grant evidence access, retention changes, or timeout release. Routes returning evidence content or attachments require `discord:evidence_view`; mutation routes also require the matching mutation permission. Keep moderation summaries and general bot logs free of evidence payloads. Shared configuration writes must enforce `discord:evidence_retention` separately for retention fields. Viewing the general dashboard must not become an extra required grant for otherwise authorized action-specific screens.

Announcing requires `discord:announce` and the applicable ORBAT administration authorization. Retrying requires `discord:retry` plus the original action's authorization, with current state rechecked; it must not bypass a revoked grant or restart a released timeout. Timeout-release endpoints require `discord:timeout_release`; evidence mutations require their action key plus evidence-view access. Existing permission delegation remains controlled by `user:manage_permissions` and its hierarchy rules; Discord keys cannot grant themselves.

These keys and the catalog migration are implemented. Discord administration endpoints and UI enforce this matrix; the API mapping documents their per-action requirements. Existing rank mapping routes retain their current `rank:edit` authorization until deliberately integrated; adding these keys does not silently change existing routes. Deploy the permission catalog migration (or the existing catalog seed) to populate the database-backed permission editor. The migration creates no user grants; superadmins use the override without per-key grants. Linked-member actions must be tied to the invoking Discord account; never trust a component's embedded user ID as authorization.

The bot needs only the Discord capabilities required by enabled features, but the final installation permissions/intents require a current Discord documentation review. Specifically verify reaction events, nickname/member changes, message content/history for honeypot evidence, role hierarchy, timeouts, bans, attachment capture, and message deletion. Do not promise complete cleanup/evidence coverage without that review and integration tests.

Evidence is stored through the website, including attachments. The bot may use a bounded durable upload queue while the website is unavailable; protect it and delete acknowledged local copies according to the recovery policy. Central retention governs persistent evidence. Staff Discord log messages should reference the restricted case, avoiding a second untracked copy of sensitive evidence with different retention.

When moderator attribution cannot be established reliably, store it as unknown with the observed source. Do not delay applying a valid nickname correction indefinitely to infer an actor.

### Reaction-role removal semantics

When a member removes a reaction, remove the mapped role regardless of whether it was originally granted by the bot or staff. Do not add an independent-grant exception. Restrict menus to approved self-service roles. Deleting a menu entry is different: preserve member roles by default and require an explicit reviewed bulk-removal action to revoke them. In single-choice mode, replacement removes only the previous role in that category.

## 8. Delivery sequence

1. Audit current canonical APIs against section 5; select and version missing contracts.
2. Implement website configuration, admin permissions/audit, revision acknowledgement, and metadata/status reporting.
3. Scaffold the separate bot repository with bootstrap credentials, API client, configuration loading, and durable execution state.
4. Deliver join roles, welcomes, and reaction menus with admin previews and failure reporting.
5. Extend the existing ORBAT image with occupancy; implement explicit announcements and live updates.
6. Deliver Discord signups and availability using verified website domain operations.
7. Deliver rank synchronization and two-way names, including moderator changes and replay protection.
8. Deliver moderation cases, evidence storage/retention, honeypot punishment, cleanup, and early release together. Do not enable destructive cleanup without evidence handling.
9. Verify restart/offline behavior, permissions failures, duplicate events, concurrent updates, and user-visible status across both repositories.
10. Plan mod presets and full ORBAT cancellation separately.

This sequence is an implementation proposal, not a claim that these steps are complete. The [feature acceptance criteria](./feature-specification.md#10-acceptance-criteria) define expected outcomes.

## 9. Website implementation status

The website now provides durable configuration/member invalidations, saved revision history and structured bot diagnostics; persisted role-menu references; terminal operation reporting and guarded join-role retries; reviewed, paginated bulk default-role application/menu-role removal; announcement inventory/render revision receipts and explicit missing-message repost; and independent cleanup reporting after timeout release. See the current API mapping for authorization, payloads, bounds, and migration requirements.

These APIs are website support, not confirmation that the separate bot executor exists. Discord event ingestion, reaction changes, join/welcome execution, image upload/message editing, interactive member flows, nickname echo suppression, moderation/cleanup execution, local persistence and outage alerting still require the .NET bot and end-to-end validation. Mod presets and full ORBAT cancellation remain deferred.

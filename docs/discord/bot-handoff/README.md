# 6MD Discord bot implementation handoff

This packet is the implementation input for a separate .NET 10 Discord bot repository. The website owns configuration and business rules; the bot performs Discord actions through the website API. The website implementation exists in the working tree on `feat/discord-web-admin`. It is not proof that those changes, migrations, or endpoints are deployed.

Give the implementing AI the entire ZIP and the contents of `AI_STARTER_PROMPT.md`. Start with the current specification and implemented API contract, not assumptions from older bot plans.

## Read in this order

1. `AI_STARTER_PROMPT.md` — task, boundaries, implementation sequence, and completion requirements.
2. `docs/discord/feature-specification.md` — confirmed behavior and deferred features.
3. `docs/discord/web-configuration-and-integration.md` — ownership, safety rules, permissions, and offline behavior.
4. `docs/api/batches/discord-admin.md` — executable website protocol and endpoint mapping.
5. `docs/api/batches/events.md` — durable JSON polling and SSE semantics.
6. `openapi.yaml` — complete website contract, including canonical member, rank, training, and notification endpoints. The Discord and event JSON fragments are also included.
7. `ACCEPTANCE_CHECKLIST.md` — required implementation and recovery scenarios.
8. `website-reference/` — implementation and test examples for resolving contract details. This is reference material, not code to move into the bot.

The ZIP preserves canonical `docs/` paths so documentation links resolve. The handoff source files live under `docs/discord/bot-handoff/` in the website repository; the packaging step places them at the ZIP root. `MANIFEST.json` records the snapshot date, branch, base commit, source paths and file hashes. The base commit alone does not include the uncommitted website implementation.

## Authoritative boundaries

- Build a separate repository targeting .NET 10. Do not rewrite the Next.js website or share its database.
- All behavioral settings come from the web configuration, including guild, channels, roles, templates, feature switches, retry timings, timeouts, and retention.
- Local bot configuration has only the website API URL/key, Discord credentials/connection identity, and the outage-alert recipient. `bootstrap.env.example` contains placeholders only. Its API URL is the base including `/api`; append contract paths exactly once.
- A bot API key currently has website superadmin authority. Never expose it to Discord interaction users, message content, diagnostics, or logs.
- Bind member interactions to the actual Discord interaction author and use `/discord/members/{discordId}/...` adapters. Their server-side checks preserve website signup and absence rules.
- Sending an explicit mission announcement is distinct from personal notification preferences. Never let a user preference create a server-wide announcement or permission to ping.
- The approved scope excludes mod presets and full ORBAT cancellation. Do not implement them based on deprecated documentation.

## Suggested architecture

These are implementation suggestions, not additional product requirements: a .NET Worker Service using the Generic Host; typed website API client; a Discord library adapter; separate domain coordinators for roles, announcements, members, moderation, and bulk actions; and a durable local execution store. Select the Discord library and storage implementation after checking current official documentation and .NET 10 compatibility. Record the decision and pin versions.

The local store is for recovery only: event cursors, verified configuration cache, claims/generations, interaction receipts, Discord message references, pending evidence uploads, and uncertain Discord side effects. The website remains authoritative for membership data, configuration, accepted names, and evidence retention. Do not add bot-local policy settings under the guise of storage or deployment options.

## Deployment handover

Before integration against a live website, verify that the corresponding website branch has been deployed, its migrations applied, the Prisma client generated, and the website scheduler is running. Migration instructions are in the API mapping. The packet includes migrations as website reference; the bot must never run them or connect directly to PostgreSQL.

Develop with a fake website transport and fake Discord adapter first. Use a test guild for real integration and explicit test accounts/messages for moderation exercises. A successful HTTP queue request means pending work, not a completed Discord action. Report actual test results and any unverified Discord behavior separately.

No production credentials, environment files, user records, moderation evidence, generated Prisma clients, or deprecated design documents are included.

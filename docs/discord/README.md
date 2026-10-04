# Discord bot documentation

Updated: 2026-10-04

This directory documents the proposed 6MD Discord bot, planned for .NET 10 and developed and deployed in a separate repository from the website. The specification records the product decisions agreed during the September 2026 planning session; it describes the complete target feature set. Website implementation status and current API contracts are tracked separately from the unbuilt Discord executor.

- [Feature specification](./feature-specification.md): agreed behavior, moderation rules, acceptance criteria, and deferred work.
- [Web configuration and integration](./web-configuration-and-integration.md): configuration ownership, repository boundaries, integration requirements, implementation mapping, and delivery sequence.

All bot behavior is configured through the website. The external exceptions are the website API URL/key, Discord API credentials/connection identity, and one Discord user ID for outage alerts. The alert recipient is configured locally so it remains available when the website cannot be reached.

## Website integration

[Current website API mapping](../api/batches/discord-admin.md) identifies canonical domain endpoints and the separate Discord administration resources. Its accompanying OpenAPI fragment documents the implemented wire contract. The separate .NET 10 bot still needs to execute and acknowledge Discord actions; a queued website command is not confirmation that Discord changed.

## Deprecated documents

[discord-bot-design.md](./discord-bot-design.md) and [api-missing-features.md](./api-missing-features.md) are historical documents. Do not use them to determine current product scope, API readiness, endpoint names, deployment language, or configuration behavior. They are retained for history only.

Before implementation, verify current routes, OpenAPI, domain services, and tests in the website repository. Neither the deprecated inventory nor the new proposed integration requirements establish API availability.

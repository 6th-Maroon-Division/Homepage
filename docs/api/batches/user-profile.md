# User profiles

GET/PATCH/DELETE /api/users/{id} share user-session and bot authentication. GET/PATCH allow self or hierarchy-aware user:manage; DELETE requires user:manage, prohibits self deletion, and preserves users with training history or restrictive references. Bot tokens remain superadmin; me alias is session-only. All query parameters rejected. Bad path/query/JSON400, payload422, credentials401, permissions403, missing404, linked records/duplicates/concurrent changes409.

DTO: id, username, email, avatarUrl, UTC createdAt, providers (provider names only). PATCH accepts nonempty partial username (trimmed1..50), email(validaddress|null), avatarUrl(HTTP(S) or same-origin path|null). Data/protocol-relative/backslash paths are rejected; emptyavatar clears. Shared self/admin update; no supplied actor IDs.

Reads of other-user profiles audit IDs without snapshots. Mutations and redacted audits share a Serializable transaction; listener failures after commit do not invalidate success. DELETE protects training audit references, relies on Prisma foreign keys for durable creator references, and audits targetID without copying sensitive data.

Removed legacy /user/update POST, /user/auth-providers GET and obsolete /users/{id}/admin410. Current-user discovery is removed with the signup UI batch (uses NextAuth session identity); logged-in avatar/provider views use /users/me. Admin training-assignment refresh now refreshes server data instead of replacing the full user row with an incompatible profile DTO.

25 unit tests and4 Prisma integration tests cover auth/hierarchy, field validation, privacy, profile updates, durable references, and audit failure rollback.

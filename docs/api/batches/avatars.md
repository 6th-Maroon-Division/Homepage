# User avatars

Canonical POST `/api/users/{id}/avatar` (one multipart file), `/avatar/refresh` (`{provider:'steam'|'discord'}`), and `/avatar/migrate` (`{}`) replace three session-only `/api/user/avatar/*` routes. Self access uses `me`; staff needs user:manage and target hierarchy; bots use explicit numeric users. Every route rejects query keys, validates live credentials and returns `{data:{avatarUrl,changed},meta:{}}` or the shared error envelope.

Uploads/migrations accept JPEG, PNG, GIF and WebP up to 2 MiB with matching MIME/signature. Extensions come from validated type, never the supplied filename. Provider refresh resolves a server-stored linked identity, uses a bounded request to the provider, checks response identity and never logs credentials. Discord default-avatar selection uses the snowflake formula. Provider links and target permissions are rechecked at commit.

Avatar writes use a Serializable transaction containing the audit, with optimistic comparison to prevent overwriting a concurrent profile change. New file cleanup follows rejected/failed database writes. Successful mutation audits retain target IDs and change metadata only; no image bytes, URLs, external IDs or provider secrets. No-op migration reads are audited only when returning another user's avatar. Realtime profile events follow commit.

The settings UI uses the shared API client and canonical fields. Unit tests cover authentication/hierarchy, validation, all three operations, provider failures, signatures, cleanup and audit privacy. Isolated Prisma integration tests exercise actual user/account updates, bot identity, revocation and rollback; filesystem/provider transport are mocked to keep tests independent of external services.

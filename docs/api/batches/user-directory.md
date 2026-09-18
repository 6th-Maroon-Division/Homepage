# User directory

GET /api/users is the canonical session/bot directory and Discord/Steam resolver. Requires live user:manage (bots superadmin); target hierarchy filters before pagination, self included. Filters: activeOnly, hasDiscord, hasSteam (strict boolean, false adds no constraint), exact string discordId and steamId; unknown/repeated keys400. Users without rank records count as active. Ascending ID range cursor, default50/cap100 and actual lookahead. Missing or inaccessible lookups return an empty page.

DTO contains id, username, email, avatarUrl, createdAt UTC, isRetired, currentRank{id,name,abbreviation}|null, discordId and steamId strings|null. No raw auth-account records, permission records, or other internal fields. Only returned other-user IDs audited; no snapshots, self, empty, or lookahead audits. Required audit failures500.

Removed /api/bot/users, /api/bot/users/discord/{discordId}, /api/bot/users/steam/{steamId}. Attendance and legacy-data user selectors now load every canonical page. Other user-specific routes remain separate batches.

14 unit tests and two Prisma integration tests exercise credentials, pagination, target visibility, filters and audit privacy.

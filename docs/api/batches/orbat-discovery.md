# Operation discovery and management

Public GET `/api/orbats` now serves bot discovery as well as the website selector: strict optional includePast boolean (default true), zoned startAt inclusive and endBefore exclusive, alongside limit/cursor. includePast=false defaults to UTC midnight today; explicit startAt takes precedence. Operations without a timestamp use their UTC eventDate. Minimal id/name pages retain descending IDs and real lookahead. Public full details remain `/api/orbats/{id}/full`; authenticated account lookups use `/api/users` rather than embedding authentication accounts in operation data.

Protected GET `/api/orbats/management` replaces `/api/admin/orbats/list`, accepts live sessions or bot tokens and requires any orbat:create/edit/delete grant. Strict limit/cursor, default50/cap100. Explicit DTO contains operation metadata, UTC dates, nullable minimal creator, squad/slot/signup counts; participant identities are not loaded. Other returned creator IDs are audited without snapshots, excluding self/lookahead. The admin UI gathers pages using apiList.

Remove duplicate bot GET `/api/bot/orbats` and `/api/bot/orbats/{id}`. Bots compose the same public list/full/available-slots and protected user-directory/eligibility endpoints as the website. No old response formats remain on these routes.

Validation: 25 focused management/public-list unit cases; two isolated Prisma tests exercise creator read audits, nullable bot creator, UTC ranges and legacy date fallback. Existing bot-created ORBAT integration now reads the canonical management envelope.

# Inbox messaging

POST `/api/messages` replaces `/messaging/send`. Superadmin sessions and bots send strict `{title,body,type?,actionUrl?,audience}` with audience `{type:'all'|'admin'}` or `{type:'users',userIds:[...]}`. Numeric unique user IDs (maximum1000), trimmed title1–200/body1–10000, supported message type, safe HTTP(S)/same-origin action URL. Recipients resolve inside the transaction; missing users abort the entire delivery. Returns `{id,createdAt,recipientCount}` in the shared envelope with status201. Creator is nullable for bots.

GET `/api/users/{id}/messages` replaces `/messaging/inbox`: owner or superadmin, live session/bot, session-only me alias. Strict type/unread/limit/cursor filters, descending recipient-ID pages default50/cap100 with true lookahead. meta contains unreadCount across the entire inbox. Explicit message DTO retains needed title/body/type/action URL, minimal creator and UTC timestamps, excluding recipient metadata/channel/audience internals. Reads audit returned other-user inbox/creator IDs; own data without other creators is not audited.

PATCH `/api/users/{id}/messages` and `/api/users/{id}/messages/{recipientId}` replace read-all/single-read PUTs. Both require `{isRead:true}`, reject query keys and enforce inbox ownership even for guessed recipient IDs. Return `{updatedCount}`; actual changes and target-ID audit commit together. Repeated no-op requests do not add mutation audits.

All mutations use Serializable transactions and publish inbox notifications only after commit. Audit records exclude message text, title, action URL and account details. The inbox client gathers canonical cursor pages and reads unreadCount from meta; the administrator send form uses the shared client. Inbox SSE is migrated in the following realtime batch.

36 unit cases cover all methods, strict inputs, safe URLs, authentication, pagination, privacy, rollback failure behavior and delivery audiences. Five isolated Prisma integration cases validate persisted recipient graphs, actual ownership checks, bot identity/revocation, read state and transaction rollback.

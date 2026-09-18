# Promotion decisions

Canonical routes:

- `POST /api/ranks/promotions/[id]/approve`: JSON `{}`.
- `POST /api/ranks/promotions/[id]/decline`: JSON `{declineReason?: string|null}`; text trims and empty becomes null.

Both return `{data:null,meta:{}}`. No query parameters. Positive Int32 path IDs. Invalid path/query/JSON400, invalid payload422, missing proposal/user-rank/rank404, denied403, handled/stale/concurrent changes409. Shared session or active Bearer bot auth; explicit invalid Bearer never falls back. Global `rank:manage_promotions` required including self; live target hierarchy checked inside Serializable transaction. Bots remain superadmin and history/audit attributes them to token rather than supplied actor IDs.

Approval recomputes current main-operation attendance including legacy attendance, promotes to proposal next rank, resets baseline and UTC promotion timestamp. Decline retains rank/timestamp, resets attendance baseline, records declined history and trimmed reason. Both preserve other rank-state flags and update proposal attendance snapshot. Stale current-rank proposals are rejected to prevent changing a rank based on obsolete proposals. Repeated decisions409 without duplicate history.

Proposal claim, rank update, history, approval bot outbox `user.rank_changed`, inbox message and recipient, and audit commit together. Approval outbox source remains `manual_approval`. Declines do not emit rank-changed outbox because no rank changed. Audits `promotion_proposal.approved` / `.declined`, resource `promotion_proposal`, target user ID; explicit metadata and ISO timestamps only, declineReason redacted. Realtime notifications run after commit and listener failures cannot reverse a committed success.

Deleted duplicates:

- `/api/bot/promotions/[id]/approve`
- `/api/bot/promotions/[id]/decline`
- `/api/ranks/bot/promotions` (legacy POST approval)
- `/api/ranks/bot/promotions/[id]/decline`

Website pending-promotions client uses shared `apiRequest`, sends strict bodies, and consumes canonical errors. No schema changes.

Tests: `tests/api/promotion-decisions.test.ts` (20 unit cases), `tests/api-integration/promotion-decisions.test.ts` (9 real Prisma cases), including live hierarchy/token revocation, actual attendance, actor attribution, stale/repeated decisions, privacy, and rollback at history/outbox/message/audit stages. Unit file passed; integration execution coordinated centrally.

Proposal creation, automatic execution, automatic history reads, and rank migration remain separate follow-up batches.

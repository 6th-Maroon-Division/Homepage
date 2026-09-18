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

## Proposal creation

`POST /api/ranks/promotions/propose` accepts exact `{userId: positiveInt32}`; no query parameters. Both session and active bot authenticate with global `rank:manage_promotions` and live target hierarchy. Body invalid422, malformedJSON/query400, missinguser404, ineligible/stale/concurrent409.

The minimal response is `{data:{userId,outcome,proposalId,rankId},meta:{}}`, where `outcome` is `proposed` (201), `already_pending` (200), or `promoted` (200), and `proposalId` is nullable for immediate promotion. No rank-history or personal eligibility snapshot is returned. Ineligible409 includes only the existing stable eligibility reason code; viewing another user's eligibility result is audited without snapshots.

Eligibility now accepts an optional Prisma transaction client while retaining its existing default and rules. All eligibility, permission, pending-proposal and attendance checks run inside the mutation's Serializable transaction. Manual lanes create a proposal and superadmin inbox notifications plus `promotion_proposal.created` audit atomically. Existing matching pending proposals are reused without duplicate messages or mutations; other-user reads are audited. Automatic lanes promote immediately with current attendance baseline, UTC timestamp, approved history, `user.rank_changed` outbox source `automatic`, user inbox and `user_rank.promoted` audit. An existing pending proposal is closed with an additional `promotion_proposal.approved` audit. Postcommit listener failure retains success. Bot history retains `triggeredBy:auto` to identify the automatic lane; the API audit carries token actor identity.

No website caller used the proposal endpoint; canonical URL remains. No schema changes. `tests/api/promotion-proposals.test.ts` has19 passing unit cases and `tests/api-integration/promotion-proposals.test.ts` has7 real Prisma cases covering eligibility/training requirements, manual deduplication, automatic pending closure, rights, and transaction rollback. TypeScript and targeted diff checks pass; integration coordinated centrally.

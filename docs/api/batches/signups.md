# Signup, eligibility and availability consolidation

Canonical endpoints:

- `POST /signups` accepts `{slotId,userId?}`; session users default to `me`, bots must supply numeric user IDs. Returns the minimal signup DTO and `meta.warnings`.
- `PATCH /signups/{id}` accepts `{slotId,overrideRequirements?}` and requires `orbat:edit` plus live target hierarchy. Explicit override bypasses only rank/training and returns warnings. Slot moves retain signup/attendance IDs and cannot cross operations.
- `DELETE /signups/{id}` allows self or live `orbat:edit` hierarchy and returns null. Staff can remove past-operation signups.
- `GET /orbats/{id}/signups` requires `orbat:edit` or `attendance:view`, returns minimal display users and operation/slot information.
- `GET /users/{id}/signups` accepts the session-only `me` alias, permits self or live `orbat:edit` hierarchy, and returns both past and upcoming records.
- Public `GET /orbats/{id}/available-slots` contains only aggregate counts and catalog fields.
- `GET /orbats/{id}/eligibility?userId=me` provides combined rank/training, temporary qualification, absence, schedule and capacity checks for an authorized target. Bots specify numeric user IDs.
- `GET/PATCH/DELETE /orbats/{id}/availability/{userId}` consolidates attendance-note and bot availability mutations. PATCH upserts a note with required status, nullable trimmed reason and numeric minute estimates. Reasons have a 500-character limit. `late_unsure` requires an estimate; other statuses clear estimates. GET returns null without creating a row. Staff can manage past operations.

Collections use default 50/max100 cursor pagination with actual lookahead. Signup lists descend by ID; slot collections ascend. Unknown/repeated query arguments fail 400. Bodies use numeric positive Int32 IDs, strict known fields, and standard envelopes; legacy Discord/Steam identifiers and automatic slot selection are replaced by explicit user and slot IDs. Website callers use the shared API client, refresh the public ORBAT after mutation, and derive current user ID from the existing NextAuth session rather than a separate current-user endpoint.

Signup mutations validate every live business rule inside a Serializable Prisma transaction, including capacity and one signup per user per operation. Main operations enforce all selected rank and training requirements; side operations waive those requirements only. Absence and closed schedules still block signup/move. All mutations atomically write the outbox and audit. Optional `Idempotency-Key` receipts are actor-scoped, expire after 24 hours, and commit in the same transaction; replays recheck live target authorization. Realtime failure after commit does not turn success into a 500.

Mutation audits identify the affected user and include only IDs/state, with reasons redacted. Signup deletion records cascading attendance/session/log identifiers. Read audits cover returned other users for operation lists, or the explicit target for user lists, eligibility and availability even when empty. Public aggregate reads do not write user audits. Audit failures fail closed.

Removed routes are listed in `signups.openapi.json`, including both bot signup forms, bot availability and Discord-user lookup variants, legacy subslot signup, signup move, attendance-note forms, and `/user/current`. Public `/orbats/{id}/full` remains unchanged.

Tests: `tests/api/signups.test.ts` covers all methods/auth, strict validation, reference/business checks, overrides, idempotency, pagination and audit failures. `tests/api-integration/signups.test.ts` covers real Prisma persistence/cascades, concurrent capacity and duplicate-operation attempts, hierarchy, main/side-operation requirements, temporary qualifications, receipt replay, paging/privacy and rollback. The older optional database bot smoke test now imports canonical availability.

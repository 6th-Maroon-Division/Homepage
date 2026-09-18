# Credentials and ORBAT qualification consolidation

Credentials now use shared session/bot authentication, strict payloads, UTC timestamp serialization and transactional audit. Active bots remain superadmin and use nullable trainer/history attribution. Training staff means positive `training:approve_request` or `training:mark`; all mutations also apply the relevant live target hierarchy.

| Endpoint | Contract |
| --- | --- |
| GET `/api/user-trainings` | Descending ID cursor pages, default 50/max 100; optional numeric `userId`, `trainingId`, workflow `status`. Session-only `userId=me`. Staff sees all; members see only their own nonhidden credentials. |
| POST `/api/user-trainings` | Strict required numeric user/training IDs, optional status (default qualified), nullable trimmed notes up to 4000, boolean isHidden; returns credential, 201. Duplicate assignment conflicts. |
| PATCH `/api/user-trainings` | `{updates:[{userId,trainingId,status:'needs_qualify',notes?,isHidden?}]}`, 1–100 unique user/training pairs. Atomic upserts, transition validation, response array in input order. |
| PATCH `/api/user-trainings/{id}` | Nonempty partial status/notes/isHidden plus optional numeric/null trainingSessionId/orbatId provenance. Replaces PUT. Derived `needsRetraining` is no longer writable. |
| DELETE `/api/user-trainings/{id}` | Removes credential and cascading history, returning null. Audit includes deleted history IDs. |
| GET `/api/orbats/{id}/qualifications` | Staff-only contextual view, descending credential ID pages grouped by training. `total` counts the page; merge groups across pages. Side operations return 409. |

The credential DTO retains scalar state, minimal user/trainer display, training, history, and relatedRequestId. Member reads hide history actors and hide trainer while the workflow has not reached finished/qualification states. Read audits include only returned other-user identities, excluding lookahead records and self; no credential notes/history text enters audit snapshots. Mutation audits and notifications use the same transaction as credential history and related-request updates. Realtime delivery follows commit.

Optional session provenance must identify attendance for the same user/training. An ORBAT decision additionally requires a non-side operation, relevant signup, a pending `needs_qualify` credential, and a qualified/failed outcome. This closes the previous contextual decision gap where no relevant signup was required. Decision notes remain visible through the same history/system-message workflow. Existing workflow configuration checks and transition rules remain in force. Partial metadata updates preserve omitted fields.

Qualification assignment now uses canonical signup POST/PATCH with optional numeric `qualificationTrainingId`. This enables narrowly scoped training-staff authority, with target hierarchy, an existing `needs_qualify` credential, and an exact target-role requirement. Side operations and requirement overrides are rejected. Capacity, absence, operation cutoff, rank, other training requirements, cross-operation movement and duplicate-signup guards still apply. Idempotency replay revalidates live authority and qualifying state. Contextual candidates include `existingSignupId` so the UI can move an existing unrelated signup safely.

Removed duplicates: `/api/users/{id}/trainings` → filtered credential collection; `/api/user-trainings/bulk-status` → collection PATCH; qualification PUT → credential PATCH with orbatId; qualification `/assign` → canonical signup POST/PATCH. Website lists gather all pages; bulk UI validates the 100-record limit. No schema migration is needed.

Validation includes 100 credential/signup unit tests and seven new Prisma/PGlite integration cases covering workflow/history/notification synchronization, hidden data and pagination, atomic bulk rollback, live hierarchy, bot attribution/revocation, qualification provenance, canonical signup restrictions and audit rollback. Integration tests use an isolated Prisma database with no raw SQL or developer database access.

# Rank System Implementation Checklist

**Status**: Brainstorm Complete  
**Last Updated**: January 19, 2026  

This checklist breaks down the rank system implementation into actionable tasks across frontend, backend, database, and bot layers.

---

## Phase 1: Schema & Database

### Prisma Schema Updates

- [ ] Add `Rank` model with fields: id, name, abbreviation, orderIndex, attendanceRequiredSinceLastRank, autoRankupEnabled
- [ ] Add `UserRank` model with fields: userId, currentRankId, lastRankedUpAt, attendanceSinceLastRank, retired, interviewDone
- [ ] Add `RankHistory` model with fields: userId, previousRankName, newRankName, attendanceTotalAtChange, attendanceDeltaSinceLastRank, triggeredBy, triggeredByUserId, triggeredByDiscordId, outcome, declineReason, note
- [ ] Add `RankTransitionRequirement` model (linking Rank → required Trainings)
- [ ] Add `TrainingTrainingRequirement` model (self-join for training prerequisites)
- [ ] Update `User` model: add `userRank` relation
- [ ] Update `Training` model: add `requiredForNewPeople` boolean, add relations for prerequisites and rank transitions
- [ ] Update `Orbat` model: add `isMainOp` boolean
- [ ] Add `PromotionProposal` model with fields: userId, currentRankId, nextRankId, attendance snapshot, status, createdAt, updatedAt
- [ ] Add database indexes on frequently queried fields (userId, currentRankId, createdAt, status)
- [ ] Add unique constraints where needed (Rank name/abbr, UserRank userId, PromotionProposal userId+nextRankId)

### Migration & Seed

- [ ] Update `seed.dev.ts`: Create sample ranks (Rct, Pvt, LCpl, Cpl, Sgt, SSgt, WO1, WO2, 2Lt, Maj, Cdt)
- [ ] Update `seed.dev.ts`: Create sample trainings (BCT with `requiredForNewPeople = true`)
- [ ] Update `seed.dev.ts`: Create sample users with ranks for testing
- [ ] Test schema generation: `npm run prisma:generate`

---

## Phase 2: Core Backend APIs

### Eligibility Engine (`lib/rank-eligibility.ts`)

- [ ] Create function `computeAttendanceDelta(userId: number): Promise<number>` — count present attendances on main ops since lastRankedUpAt
- [ ] Create function `checkRankupEligibility(userId: number): Promise<EligibilityResult>` — evaluate all gating conditions
- [ ] Create enum/type `EligibilityReason` with codes (eligible_auto, eligible_manual, ineligible_*)
- [ ] Implement checks: retired, interview, attendance, training prerequisites, rank transition trainings
- [ ] Return structured result: { eligible, reason, currentRank, nextRank, attendanceCounts, proposalId }

### Rank Management API (`app/api/ranks/`)

- [ ] `GET /ranks` — list all ranks ordered by orderIndex
- [ ] `POST /ranks` — create rank (validate name/abbr unique)
- [ ] `PUT /ranks/[id]` — update rank settings
- [ ] `DELETE /ranks/[id]` — delete rank (check no users assigned)
- [ ] `PUT /ranks/reorder` — bulk update orderIndex
- [ ] Add admin auth checks to all endpoints

### User Rank API (`app/api/users/[id]/rank/`)

- [ ] `GET /users/[id]/rank` — current rank, attendanceSinceLastRank, interview/retired flags
- [ ] `POST /users/[id]/rank/assign` — manually assign rank to unranked user (admin only)
- [ ] `POST /users/[id]/rank/demote` — manually demote user (admin only)
- [ ] `POST /users/[id]/retired/toggle` — toggle retired flag (admin only); prompt for starting rank on unretire
- [ ] `POST /users/[id]/interview/toggle` — toggle interview flag (admin only)
- [ ] `GET /users/[id]/rank-history` — paginated list of RankHistory for this user

### Rankup API (`app/api/ranks/promotions/`)

- [ ] `GET /promotions/pending` — list all pending PromotionProposals (for web UI and bot)
- [ ] `POST /promotions/propose` — check eligibility, create proposal if manual rank needed
- [ ] `POST /promotions/[id]/approve` — apply rankup (admin or bot)
- [ ] `POST /promotions/[id]/decline` — decline rankup (admin or bot); block re-proposal until next attendance threshold
- [ ] On rankup apply: update UserRank, log RankHistory, trigger notifications
- [ ] On rankup decline: keep proposal history, mark proposal status, delete from active proposals

### Training Rank Requirements API (`app/api/trainings/[id]/requirements/`)

- [ ] `POST /trainings/[id]/requirements/rank` — set minimum rank for training
- [ ] `DELETE /trainings/[id]/requirements/rank` — remove rank requirement
- [ ] `GET /trainings/[id]/requirements` — list rank + training prerequisites
- [ ] `POST /trainings/[id]/prerequisites` — add training prerequisite (with cycle detection)
- [ ] `DELETE /trainings/[id]/prerequisites/[prerequisiteId]` — remove prerequisite

### Admin Only: Unranked Users API (`app/api/admin/users/unranked`)

- [ ] `GET /admin/users/unranked?filter=interview,bct,retired` — list unranked users with filters
- [ ] Support pagination, sorting
- [ ] `POST /admin/users/bulk-rank-assign` — bulk assign rank to multiple users
- [ ] `POST /admin/users/bulk-interview-toggle` — bulk toggle interview flag
- [ ] `POST /admin/users/bulk-retire-toggle` — bulk toggle retired flag

---

## Phase 3: Rankup Automation

### Auto Rankup Logic

- [ ] Create scheduled task / API trigger `POST /api/ranks/auto-rankup`
- [ ] For each user with auto rankup eligible: apply rankup, log history
- [ ] Called by: cron/scheduler (future) or manually by admin or bot on demand

### Bot Endpoints (`app/api/ranks/promotions/` for bot auth)

- [ ] `POST /ranks/promotions/propose` — check eligibility and create manual proposal
- [ ] `POST /ranks/promotions/approve` — approve proposal (bot auth, record discordActorId)
- [ ] `POST /ranks/promotions/decline` — decline proposal (bot auth, record discordActorId)
- [ ] `GET /ranks/promotions/pending` — return all pending proposals for bot to batch display
- [ ] Add Bearer token validation (secret from env var)

### Bot Notifications

- [ ] Design bot message payload structure for auto rankups (name, old rank, new rank, attendance counts)
- [ ] Send manual rankup notifications to Discord admin channel (#admin-promotions) with approve/decline options
- [ ] Implement approve/decline button logic (inline if supported; else separate messages per action — deferred)
- [ ] Document bot webhook signatures and idempotency keys

---

## Phase 4: Admin Web UI

### Rank Configuration Page (`app/admin/ranks/page.tsx`)

- [ ] Display list of ranks: abbr, name, order, attendance required, auto enabled
- [ ] Add button: create new rank (form: name, abbr, order, attendance, auto toggle)
- [ ] Edit button per rank (modal or inline form)
- [ ] Delete button (with confirmation; check no users)
- [ ] Reorder ranks (drag-and-drop or manual orderIndex input)
- [ ] For each rank, expandable section to manage transition requirements (add/remove required trainings)

### Unranked/Cadet Users List (`app/admin/users/unranked/page.tsx`)

- [ ] Columns: checkbox, username, rank (None/Cadet/etc), interview (Y/N), BCT (Y/N), retired (Y/N), attendance total, attendance delta, actions
- [ ] Filters: interview (not done / done / all), BCT (not done / done / all), retired (active / retired / all)
- [ ] Bulk actions: select rows → assign rank, toggle interview, toggle retired/unretire
- [ ] Per-row actions: assign rank, view history
- [ ] Load filters from URL params (allow bookmarking filtered views)

### Pending Promotions Page (`app/admin/promotions/page.tsx`)

- [ ] List pending proposals: username, current rank, next rank, attendance total, delta, created at
- [ ] Approve/decline buttons per row (fetch latest eligibility to confirm)
- [ ] Bulk approve (select rows, batch approve)
- [ ] On approve/decline: update proposal, log history, remove from list
- [ ] Real-time refresh (polling or WebSocket)

### User Rank History View (`app/user/profile/rank-history/page.tsx` and `/app/admin/users/[id]/rank-history/page.tsx`)

- [ ] User view: Full timeline of user's rank changes with attendance counts
- [ ] Admin view: Full audit trail with attendance counts, trigger source, actor
- [ ] Pagination if many entries
- [ ] Link to rank history details (full audit trail)

### Rank Migration Wizard (`app/admin/ranks/migrate/page.tsx`)

- [ ] Step 1: Confirmation (backup, review current ranks)
- [ ] Step 2: Strategy selection (recalculate / grandfather / map)
- [ ] Step 3: Mapping (if old rank names changed, old → new mapping UI)
- [ ] Step 4: Preview impact (X users demoted, Y promoted, Z unchanged)
- [ ] Step 5: Apply and confirm
- [ ] Log all changes with `triggeredBy = "system_migration"`

---

## Phase 5: Training Prerequisites & Gating

### Training Prerequisite Validation (`lib/training-gating.ts`)

- [ ] Create function `getTrainingRequirements(trainingId: number)` → { minimumRank?, requiredTrainings[] }
- [ ] Create function `canRequestTraining(userId: number, trainingId: number)` → boolean
- [ ] Create function `getUnmetRequirements(userId: number, trainingId: number)` → { missingRank?, missingTrainings[] }

### Training Request Constraints

- [ ] Update `/api/training-requests` POST endpoint: block request if user doesn't meet requirements
- [ ] Return error with unmet requirements list
- [ ] Training visibility: show all trainings but disable/warn on unmet requirements

### Training List UI Update (`app/trainings/page.tsx`)

- [ ] Display training requirements inline (rank badge + prerequisite trainings)
- [ ] Show "Locked: Rank Cpl+ required" if user doesn't meet rank requirement
- [ ] Show "Locked: Requires Leadership 1" if training prerequisite not met
- [ ] Disable request button if unmet; show hover tooltip explaining why

---

## Phase 6: Legacy Data Import

### Legacy Import API (`app/api/admin/import/legacy-attendance`)

- [ ] `POST /import/legacy-attendance` — parse CSV, create LegacyAttendanceData entries
- [ ] Validate rank names; map to current rank structure or mark unmappable
- [ ] `GET /import/legacy-attendance` — list unmapped legacy records (pagination, filters)
- [ ] `POST /import/legacy-attendance/map` — bulk map legacy records to current users
  - Support by Discord username matching or manual selection
  - Update LegacyAttendanceData.mappedUserId, isMapped = true
- [ ] `POST /import/legacy-attendance/apply` — for each mapped record:
  - Create/update UserRank with rank from legacy data
  - Set attendanceSinceLastRank from legacy TIG field
  - Set lastRankedUpAt from legacy date fields
  - Create initial RankHistory entry with `triggeredBy = "import"`

### Legacy Import UI (`app/admin/import/page.tsx`)

- [ ] Upload CSV form
- [ ] Preview parsed records (table view)
- [ ] User mapping interface (legacy name → current user selector)
- [ ] Bulk map by Discord username (optional auto-matching)
- [ ] Preview impact: "Will create UserRank for X users"
- [ ] Apply button (confirm before applying)

---

## Phase 7: Notifications

### Web UI Notifications

- [ ] On admin login: fetch pending proposals count
- [ ] Toast notification: "You have N pending promotions" (clickable link)
- [ ] Notification persists on every login until proposals cleared
- [ ] On rankup applied: notification "User X promoted to Rank Y"

### Discord Notifications

- [ ] Send auto rankup announcements: "🎉 Congratulations [Abbr] Name! You are now [New Rank]! (20 attendances)"
- [ ] Send manual rankup proposals to admin channel (#admin-promotions) with approve/decline buttons/options
- [ ] Rankup approved: announce to server
- [ ] Rankup declined: log (no user notification for now)

---

## Testing

### Unit Tests

- [ ] Test `checkRankupEligibility` with various scenarios (eligible_auto, eligible_manual, all ineligible codes)
- [ ] Test `computeAttendanceDelta` (count only present + isMainOp)
- [ ] Test training prerequisite validation (missing rank, missing trainings, both)
- [ ] Test circular dependency detection in training prerequisites

### Integration Tests

- [ ] Test rankup flow: auto and manual
- [ ] Test proposal creation and approval/decline
- [ ] Test unretire flow
- [ ] Test demotion flow
- [ ] Test legacy import + rank initialization

### UI Tests

- [ ] Test rank configuration page (CRUD, reorder)
- [ ] Test unranked list filters and bulk actions
- [ ] Test pending promotions page (approve/decline)
- [ ] Test user rank history view
- [ ] Test migration wizard (preview, apply)

---

## Performance & Optimization

- [ ] Index Attendance table on userId + status + orbat.isMainOp for fast delta computation
- [ ] Cache `attendanceSinceLastRank` but allow re-computation on demand
- [ ] Consider materialized view for frequently accessed rank stats
- [ ] Profile rankup eligibility checks (N+1 query prevention)
- [ ] Add query logging to detect slow operations

---

## Security & Validation

- [ ] All admin endpoints require admin auth
- [ ] Bot endpoints require Bearer token (environment variable)
- [ ] Validate rank name/abbr unique before insert
- [ ] Prevent circular training prerequisites (algorithm)
- [ ] Validate attendance counts are non-negative
- [ ] Audit all rankup changes (immutable RankHistory)
- [ ] Sanitize CSV upload (file size, content validation)

---

## Deployment Notes

- [ ] Run migration in staging first to validate schema
- [ ] Seed sample ranks for testing
- [ ] Deploy admin UI pages in feature flag (if applicable)
- [ ] Coordinate with project lead on rollout timing
- [ ] Plan bot deployment (separate from web API)
- [ ] Document env vars: bot secret, database connection
- [ ] Test end-to-end: web → API → bot → announcement

---

## Future Work

- [ ] Implement rank decay system (deferred; NOT approved for implementation — removed from schema)
- [ ] Add permissions-based rankup overrides
- [ ] Build statistics dashboard (rankup trends, retention)
- [ ] Add per-user rank timeline visualization
- [ ] Support multiple rank structures (currently single structure)
- [ ] Add training trees/flowcharts UI
- [ ] Implement bot inline buttons (if Discord API supports)
- [ ] Add rank structure versioning (for historical analysis)

---

**Status**: Ready for Phase 1 kickoff  
**Next Step**: Begin Prisma schema updates and migrations

# Rank System - Detailed Implementation Roadmap

**Status**: Ready for Implementation  
**Last Updated**: January 20, 2026  

This document breaks down the rank system implementation into granular phases with clear dependencies. Foundational features (like admin notification infrastructure) are separated into early phases.

---

## Phase 0: Foundation & Infrastructure (Week 1)

### Unified Messaging & Notifications (single API)

**Purpose**: Provide one unified system and API for both notifications (admin/user alerts) and messaging/broadcasts (to all, ranks, or individuals). This powers orbats, trainings, rankups, and general announcements.

**Unified Data Models**:
- [ ] `Message` model: `id`, `title`, `body`, `type` (`orbat`, `training`, `rankup`, `general`, `alert`), `actionUrl`, `createdByUserId?`, `createdAt`
- [ ] `MessageRecipient` model: `id`, `messageId`, `userId`, `audienceType` (`user`, `rank`, `all`, `admin`), `audienceValue?` (e.g., rankId), `isRead`, `readAt`, `deliveredAt`, `channel` (`web`, later `discord`), `metadata` (Json)

**Unified API Endpoints**:
- [ ] `POST /api/messaging/send` — send alert/broadcast; supports `audience: all | rankIds[] | userIds[] | admin`
- [ ] `GET /api/messaging/inbox` — list items for current user/admin (filters: `type`, `unread`)
- [ ] `PUT /api/messaging/[id]/read` — mark as read for current user/admin
- [ ] `PUT /api/messaging/read-all` — bulk mark read
- [ ] (Optional) `DELETE /api/messaging/[id]` — dismiss item for current user/admin

**Web UI Components**:
- [ ] `UnifiedInbox` (dropdown/modal shared for users and admins)
- [ ] `UnifiedToast` (shows unread count on login; click-through to inbox)
- [ ] Admin layout header: badge showing unread count

**Delivery Rules**:
- Web delivery now; future Discord delivery supported via `channel` field without API changes
- Use the same unified API for admin notifications and user broadcasts

**Seeding**:
- [ ] Create sample items for orbat, training, rankup, and admin alerts

**Deliverables**:
- Single, unified API and UI for notifications and messaging
- Broadcast to all users, per-rank audiences, per-user, and admin-only

**Dependencies**: None

---

## Phase 1: Core Schema & Data Models (Week 1-2)

### 1.1: Prisma Schema Updates

**Tasks**:
- [ ] Add `Rank` model (id, name, abbreviation, orderIndex, attendanceRequiredSinceLastRank, autoRankupEnabled)
- [ ] Add `UserRank` model (userId, currentRankId, lastRankedUpAt, attendanceSinceLastRank, retired, interviewDone)
- [ ] Add `RankHistory` model (userId, previousRankName, newRankName, attendanceTotalAtChange, attendanceDeltaSinceLastRank, triggeredBy, triggeredByUserId, triggeredByDiscordId, outcome, declineReason, note)
- [ ] Add `RankTransitionRequirement` model (targetRankId, requiredTrainingIds[])
- [ ] Add `TrainingTrainingRequirement` model (trainingId, requiredTrainingId)
- [ ] Update `User` model: add `userRank` relation
- [ ] Update `Training` model: add `requiredForNewPeople` boolean, add relations for prerequisites and rank transitions
- [ ] Update `Orbat` model: add `isMainOp` boolean
- [ ] Add `PromotionProposal` model (userId, currentRankId, nextRankId, attendanceSnapshot, status, createdAt, updatedAt)
- [ ] Add database indexes on frequently queried fields
- [ ] Add unique constraints (Rank name/abbr, UserRank userId, PromotionProposal userId+nextRankId)

### 1.2: Migration & Seed

**Tasks**:
- [ ] Run `npm run prisma:migrate` (migration name: "add_rank_system")
- [ ] Update `seed.dev.ts`: Create sample ranks (Rct, Pvt, LCpl, Cpl, Sgt, SSgt, WO1, WO2, 2Lt, Maj, Cdt)
- [ ] Update `seed.dev.ts`: Create BCT training with `requiredForNewPeople = true`
- [ ] Update `seed.dev.ts`: Assign ranks to sample users for testing
- [ ] Test schema generation: `npm run prisma:generate`
- [ ] Verify migrations work on clean database

**Deliverables**:
- Database schema complete and migrated
- Sample data seeded for development testing

**Dependencies**: Phase 0 (notification + messaging foundation for later use)

---

## Phase 2: Rank Management APIs & Admin UI (Week 2-3)

### 2.1: Basic Rank CRUD APIs

**Tasks**:
- [ ] `GET /api/ranks` — list all ranks ordered by orderIndex
- [ ] `POST /api/ranks` — create rank (validate name/abbr unique, admin only)
- [ ] `PUT /api/ranks/[id]` — update rank settings
- [ ] `DELETE /api/ranks/[id]` — delete rank (check no users assigned)
- [ ] `PUT /api/ranks/reorder` — bulk update orderIndex
- [ ] Add admin auth checks to all endpoints

### 2.2: Rank Configuration UI

**Path**: `/app/admin/ranks/page.tsx`

**Tasks**:
- [ ] Display list of ranks: abbr, name, order, attendance required, auto enabled
- [ ] Add button: create new rank (modal form)
- [ ] Edit button per rank (inline or modal form)
- [ ] Delete button (with confirmation; check no users assigned)
- [ ] Reorder ranks (drag-and-drop or manual orderIndex input)
- [ ] For each rank, expandable section to manage transition requirements (Phase 5)

### 2.3: User Rank Assignment APIs

**Tasks**:
- [ ] `GET /api/users/[id]/rank` — get current rank, attendanceSinceLastRank, interview/retired flags
- [ ] `POST /api/users/[id]/rank/assign` — manually assign rank to unranked user (admin only)
- [ ] `POST /api/users/[id]/rank/demote` — manually demote user (admin only)
- [ ] `POST /api/users/[id]/retired/toggle` — toggle retired flag (admin only)
- [ ] `POST /api/users/[id]/interview/toggle` — toggle interview flag (admin only)
- [ ] On rank assignment/demotion: create RankHistory entry

**Deliverables**:
- Admins can create, edit, reorder ranks in web UI
- Admins can manually assign ranks to users
- Basic rank management foundation in place

**Dependencies**: Phase 1 (schema + seed data)

---

## Phase 3: Eligibility Engine & Attendance Tracking (Week 3-4)

### 3.1: Eligibility Logic (`lib/rank-eligibility.ts`)

**Tasks**:
- [ ] Create function `getCurrentAttendance(userId: number): Promise<number>` — count present attendances on main ops
- [ ] Create function `checkRankupEligibility(userId: number): Promise<EligibilityResult>` — evaluate all gating conditions
- [ ] Create enum/type `EligibilityReason` with codes (eligible_auto, eligible_manual, ineligible_*)
- [ ] Implement checks:
  - Retired check
  - Interview check
  - Attendance delta: `currentAttendance - attendanceSinceLastRank >= rankRequirement`
  - Training prerequisites (rank transition requirements)
- [ ] Return structured result: `{ eligible, reason, currentRank, nextRank, attendanceCounts, proposalId }`

### 3.2: Rankup Proposal APIs

**Tasks**:
- [ ] `GET /api/ranks/promotions/pending` — list all pending PromotionProposals (admin use)
- [ ] `POST /api/ranks/promotions/propose` — check eligibility, create proposal if manual rank needed
- [ ] `POST /api/ranks/promotions/[id]/approve` — apply rankup (admin or bot)
  - Update UserRank: `currentRankId`, `lastRankedUpAt = now()`, `attendanceSinceLastRank = currentAttendance`
  - Log RankHistory
  - Trigger alert/message (create via Phase 0 unified messaging API)
- [ ] `POST /api/ranks/promotions/[id]/decline` — decline rankup (admin or bot)
  - Update UserRank: `attendanceSinceLastRank = currentAttendance` (reset baseline)
  - Log RankHistory with outcome = "declined"
  - Mark proposal status = "declined"

**Deliverables**:
- Eligibility engine working and testable
- Proposal creation and approval/decline flows functional
- Notifications sent to admin inbox on manual rankup proposals

**Dependencies**: Phase 0 (unified messaging API), Phase 2 (rank APIs)

---

## Phase 4: Unranked User Management UI (Week 4)

### 4.1: Unranked Users List API

**Tasks**:
- [ ] `GET /api/admin/users/unranked?filter=interview,bct,retired` — list unranked users with filters
- [ ] Support pagination, sorting
- [ ] `POST /api/admin/users/bulk-rank-assign` — bulk assign rank to multiple users
- [ ] `POST /api/admin/users/bulk-interview-toggle` — bulk toggle interview flag
- [ ] `POST /api/admin/users/bulk-retire-toggle` — bulk toggle retired flag

### 4.2: Unranked Users UI

**Path**: `/app/admin/users/unranked/page.tsx`

**Tasks**:
- [ ] Columns: checkbox, username, rank (None/Cadet/etc), interview (Y/N), BCT (Y/N), retired (Y/N), attendance total, actions
- [ ] Filters: interview (not done / done / all), BCT (not done / done / all), retired (active / retired / all)
- [ ] Bulk actions: select rows → assign rank, toggle interview, toggle retired/unretire
- [ ] Per-row actions: assign rank (dropdown), unretire (if retired, prompt for starting rank + BCT requirement), view history
- [ ] Load filters from URL params (allow bookmarking filtered views)

**Deliverables**:
- Admins can efficiently manage unranked/Cadet users
- Bulk operations for interview, BCT, retirement flags
- Assign ranks to new users from dedicated UI

**Dependencies**: Phase 2 (user rank APIs), Phase 3 (eligibility logic)

---

## Phase 5: Pending Promotions UI (Week 4-5)

### 5.1: Pending Promotions Page

**Path**: `/app/admin/promotions/page.tsx`

**Tasks**:
- [ ] List all pending PromotionProposals
- [ ] Columns: username, current rank, next rank, attendance (total/delta), created at, actions
- [ ] Approve/Decline buttons per row
- [ ] Bulk approve (select rows, approve all)
- [ ] On approve/decline: call Phase 3 APIs, remove from list
- [ ] Real-time refresh (polling or WebSocket)

### 5.2: Admin Messaging Integration

**Tasks**:
- [ ] On manual rankup proposal creation: send alert via Phase 0 unified messaging API
  - Title: "New Rankup Proposal"
  - Message: "User X is eligible for Rank Y"
  - ActionUrl: `/admin/promotions`
- [ ] On admin login: toast notification shows "You have N pending promotions" (clickable to promotions page)
- [ ] Notification persists on every login until proposals cleared

**Deliverables**:
- Admins can approve/decline pending rankups in web UI
- Admins notified on login of pending promotions
- Unified messaging integrated with rank proposals

**Dependencies**: Phase 0 (unified messaging foundation), Phase 3 (proposal APIs)

---

## Phase 6: Training Prerequisites & Gating (Week 5-6)

### 6.1: Training Rank Requirements

**Tasks**:
- [ ] `POST /api/trainings/[id]/requirements/rank` — set minimum rank for training
- [ ] `DELETE /api/trainings/[id]/requirements/rank` — remove rank requirement
- [ ] `GET /api/trainings/[id]/requirements` — list rank + training prerequisites

### 6.2: Training Prerequisites (Self-Join)

**Tasks**:
- [ ] `POST /api/trainings/[id]/prerequisites` — add training prerequisite (with cycle detection)
- [ ] `DELETE /api/trainings/[id]/prerequisites/[prerequisiteId]` — remove prerequisite
- [ ] Implement cycle detection algorithm (DFS/BFS on training graph)

### 6.3: Rank Transition Requirements

**Tasks**:
- [ ] `GET /api/ranks/[id]/transitions` — get required trainings for this rank
- [ ] `POST /api/ranks/[id]/transitions` — add required training
- [ ] `DELETE /api/ranks/[id]/transitions/[trainingId]` — remove required training
- [ ] Integrate with eligibility engine (Phase 3): check RankTransitionRequirement on rankup evaluation

### 6.4: Training Gating Logic (`lib/training-gating.ts`)

**Tasks**:
- [ ] Create function `getTrainingRequirements(trainingId: number)` → { minimumRank?, requiredTrainings[] }
- [ ] Create function `canRequestTraining(userId: number, trainingId: number)` → boolean
- [ ] Create function `getUnmetRequirements(userId: number, trainingId: number)` → { missingRank?, missingTrainings[] }
- [ ] Update `/api/training-requests` POST endpoint: block request if user doesn't meet requirements

### 6.5: Training List UI Update (`app/trainings/page.tsx`)

**Tasks**:
- [ ] Display training requirements inline (rank badge + prerequisite trainings)
- [ ] Show "Locked: Rank Cpl+ required" if user doesn't meet rank requirement
- [ ] Show "Locked: Requires Leadership 1" if training prerequisite not met
- [ ] Disable request button if unmet; show hover tooltip explaining why

**Deliverables**:
- Trainings can have rank and training prerequisites
- Rank transitions can require specific trainings (e.g., BCT for Cadet→Recruit)
- Users see unmet requirements but cannot request locked trainings
- Circular dependency prevention enforced

**Dependencies**: Phase 3 (eligibility engine), Phase 2 (rank APIs)

---

## Phase 7: Auto Rankup & Bot Integration (Week 6-7)

### 7.1: Auto Rankup Logic

**Tasks**:
- [ ] Create scheduled task / API trigger `POST /api/ranks/auto-rankup`
- [ ] For each user with auto rankup eligible: apply rankup, log history
- [ ] Called by: cron/scheduler (future) or manually by admin or bot on demand
- [ ] Send auto rankup announcements via unified messaging API

### 7.2: Bot Endpoints (`app/api/ranks/promotions/` for bot auth)

**Tasks**:
- [ ] `POST /ranks/promotions/propose` — check eligibility and create manual proposal
- [ ] `POST /ranks/promotions/approve` — approve proposal (bot auth, record discordActorId)
- [ ] `POST /ranks/promotions/decline` — decline proposal (bot auth, record discordActorId)
- [ ] `GET /ranks/promotions/pending` — return all pending proposals for bot to batch display
- [ ] Add Bearer token validation (secret from env var)

### 7.3: Bot Notifications

**Tasks**:
- [ ] Design bot message payload structure for auto rankups (name, old rank, new rank, attendance counts)
- [ ] Send manual rankup notifications to Discord admin channel (#admin-promotions) with approve/decline options
- [ ] Implement approve/decline button logic (inline if supported; else separate messages per action — deferred)

**Deliverables**:
- Auto rankup system functional (manual trigger for v1; scheduled for v2)
- Bot can query eligibility, approve/decline rankups
- Bot sends announcements for auto rankups and proposal notifications for manual rankups

**Dependencies**: Phase 3 (eligibility engine + proposal APIs), Phase 5 (pending promotions UI)

---

## Phase 8: User-Facing Features (Week 7-8)

### 8.1: User Rank Display

**Tasks**:
- [ ] Update ORBAT slot display: prefix usernames with rank abbreviation (e.g., `[Cpl] Username`)
- [ ] Add rank badge to user profile
- [ ] Display current rank, attendance since last rank, next rank requirement on user profile

### 8.2: User Rank History View

**Path**: `/app/user/profile/rank-history/page.tsx`

**Tasks**:
- [ ] `GET /api/users/[id]/rank-history` — paginated list of RankHistory for this user
- [ ] Full timeline of user's rank changes with attendance counts
- [ ] Display: Previous Rank → New Rank, Date, Trigger (admin/bot/auto)
- [ ] Pagination if many entries

**Deliverables**:
- Users see their current rank and progression status
- Users can view their full rankup history
- Rank prefixes displayed in ORBATs

**Dependencies**: Phase 2 (rank APIs), Phase 3 (eligibility engine)

---

## Phase 9: Legacy Data Import (Week 8-9)

### 9.1: Legacy Import API

**Path**: `/app/api/admin/import/legacy-attendance`

**Tasks**:
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

### 9.2: Legacy Import UI

**Path**: `/app/admin/import/page.tsx`

**Tasks**:
- [ ] Upload CSV form
- [ ] Preview parsed records (table view)
- [ ] User mapping interface (legacy name → current user selector)
- [ ] Bulk map by Discord username (optional auto-matching)
- [ ] Preview impact: "Will create UserRank for X users"
- [ ] Apply button (confirm before applying)

**Deliverables**:
- Admins can import legacy rank data from CSV
- Legacy users mapped to current system users
- Ranks initialized with historical attendance counts

**Dependencies**: Phase 2 (user rank APIs), Phase 3 (eligibility engine)

---

## Phase 10: Rank System Migration UI (Week 9-10)

### 10.1: Migration Wizard Backend

**Tasks**:
- [ ] `POST /api/ranks/migrate/preview` — preview migration impact (which users affected)
  - Strategy: recalculate, grandfather, or map
  - Return counts: demoted, promoted, unchanged
- [ ] `POST /api/ranks/migrate/apply` — apply migration strategy
  - Log all changes with `triggeredBy = "system_migration"`

### 10.2: Migration Wizard UI

**Path**: `/app/admin/ranks/migrate/page.tsx`

**Tasks**:
- [ ] Step 1: Confirmation (backup, review current ranks)
- [ ] Step 2: Strategy selection (recalculate / grandfather / map)
- [ ] Step 3: Mapping (if old rank names changed, old → new mapping UI)
- [ ] Step 4: Preview impact (X users demoted, Y promoted, Z unchanged)
- [ ] Step 5: Apply and confirm

**Deliverables**:
- Admins can migrate rank structures (rename ranks, adjust thresholds)
- Three strategies supported: recalculate, grandfather, map with optional per-user overrides
- Preview impact before applying changes

**Dependencies**: Phase 2 (rank APIs), Phase 3 (eligibility engine)

---

## Phase 11: Testing & Polish (Week 10-11)

### 11.1: Unit Tests

**Tasks**:
- [ ] Test `checkRankupEligibility` with various scenarios (eligible_auto, eligible_manual, all ineligible codes)
- [ ] Test attendance delta computation (count only present + isMainOp)
- [ ] Test training prerequisite validation (missing rank, missing trainings, both)
- [ ] Test circular dependency detection in training prerequisites

### 11.2: Integration Tests

**Tasks**:
- [ ] Test rankup flow: auto and manual
- [ ] Test proposal creation and approval/decline
- [ ] Test unretire flow
- [ ] Test demotion flow
- [ ] Test legacy import + rank initialization

### 11.3: UI Tests

**Tasks**:
- [ ] Test rank configuration page (CRUD, reorder)
- [ ] Test unranked list filters and bulk actions
- [ ] Test pending promotions page (approve/decline)
- [ ] Test user rank history view
- [ ] Test migration wizard (preview, apply)

**Deliverables**:
- Comprehensive test coverage for rank system
- All major flows verified end-to-end
- UI interactions tested and validated

**Dependencies**: All previous phases

---

## Summary: Phase Dependencies

```
Phase 0 (Foundation)
  ↓
Phase 1 (Schema) → Phase 2 (Rank Management) → Phase 3 (Eligibility)
                                                   ↓
                    Phase 4 (Unranked Users) ←───┘
                                                   ↓
                    Phase 5 (Pending Promotions) ←┘
                                                   ↓
                    Phase 6 (Training Gating) ←───┤
                                                   ↓
                    Phase 7 (Auto Rankup + Bot) ←─┤
                                                   ↓
                    Phase 8 (User Features) ←─────┤
                                                   ↓
                    Phase 9 (Legacy Import) ←─────┤
                                                   ↓
                    Phase 10 (Migration UI) ←─────┘
                                                   ↓
                    Phase 11 (Testing & Polish)
```

---

## Timeline Estimate

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 0: Foundation | 3-4 days | Week 1 |
| Phase 1: Schema | 3-4 days | Week 1-2 |
| Phase 2: Rank Management | 5-6 days | Week 2-3 |
| Phase 3: Eligibility | 5-6 days | Week 3-4 |
| Phase 4: Unranked Users | 3-4 days | Week 4 |
| Phase 5: Pending Promotions | 3-4 days | Week 4-5 |
| Phase 6: Training Gating | 5-6 days | Week 5-6 |
| Phase 7: Auto Rankup + Bot | 5-6 days | Week 6-7 |
| Phase 8: User Features | 4-5 days | Week 7-8 |
| Phase 9: Legacy Import | 4-5 days | Week 8-9 |
| Phase 10: Migration UI | 4-5 days | Week 9-10 |
| Phase 11: Testing | 4-5 days | Week 10-11 |

**Total**: ~10-11 weeks (can be parallelized with multiple developers)

---

**Status**: Roadmap Complete  
**Next Step**: Begin Phase 0 (Foundation & Infrastructure)

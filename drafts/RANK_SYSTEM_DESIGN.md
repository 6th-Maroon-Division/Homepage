# Rank System Design - ORBAT Web

**Status**: Brainstorm Complete - Ready for Implementation  
**Last Updated**: January 19, 2026  
**Owner**: Community Project Lead + Development Team

---

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Data Model](#data-model)
4. [Eligibility & Rankup Engine](#eligibility--rankup-engine)
5. [Rankup Flows](#rankup-flows)
6. [Admin Interfaces](#admin-interfaces)
7. [Bot Integration](#bot-integration)
8. [Legacy Data Import](#legacy-data-import)
9. [Rank Migration & System Changes](#rank-migration--system-changes)
10. [API Contracts](#api-contracts)
11. [Implementation Notes](#implementation-notes)

---

## Overview

The rank system manages user progression through a dynamic, admin-configurable rank hierarchy. Key features:

- **Single, dynamic rank structure** per system instance (no multi-template support).
- **Attendance-based progression** with per-rank attendance thresholds (e.g., 20 attendances required for Cpl → Sgt).
- **Training gating** for rank transitions (e.g., BCT required before Cadet → Recruit) and training prerequisites.
- **Auto vs manual rankup** per rank (auto ranks apply immediately + announce; manual ranks require admin approval).
- **Retired users** can attend events but cannot progress ranks or request trainings.
- **Discord bot integration** for automated rankups, manual approvals, and server announcements.
- **Audit trail** with full history of rank changes, attendance counts, and approval actors.

---

## Core Concepts

### Rank Hierarchy

- **Single ordered structure**: Ranks have an `orderIndex` defining progression order (Rct → Pvt → LCpl → Cpl → Sgt → SSgt → WO1 → WO2 → 2Lt → Maj, plus Cadet for interview stage).
- **Abbreviations & full names**: Each rank stores both (e.g., "Cpl" vs "Corporal") for UI display and training requirement descriptions.

### User Rank Status

- **Current rank**: User's active rank (stored in `UserRank.currentRankId`).
- **Retired flag**: When true, user can attend orbats and be logged but cannot progress ranks or request trainings. Unretiring is treated as a rankup (user is re-ranked at chosen starting rank).
- **Interview flag**: Boolean indicating interview completion; required to progress past Cadet rank.
- **Attendance counter**: `attendanceSinceLastRank` (cached integer) tracks attendance since last rankup. Computed from Attendance logs (status = present, orbat.isMainOp = true) since `lastRankedUpAt`.

### Rankup Process

1. **Eligibility check**: Attendance delta, interview status, BCT completion (if Cadet→Recruit), retired status, training prerequisites for next rank.
2. **Proposal creation** (manual ranks only): Create promotion proposal (no expiry; persists until approved/declined).
3. **Admin action** (manual ranks): Approve/decline via Discord bot or web UI.
4. **Apply rankup**: Log RankHistory, reset `attendanceSinceLastRank` to 0, update `lastRankedUpAt`.
5. **Announce**: Publish to Discord and web UI notifications.

### Attendance Counting

- **Scope**: Only attendances with status = `present` on ORBATs marked `isMainOp = true`.
- **Storage**: `attendanceSinceLastRank` stores the **total attendance count at time of last rankup** (a snapshot baseline).
- **Eligibility formula**: `currentAttendance - attendanceSinceLastRank >= rankRequirement`
- **Declined proposal**: Reset baseline: `attendanceSinceLastRank = currentAttendance` (no special logic needed; user simply needs to accumulate the requirement from this new baseline).
- **Retired exclusion**: Attendance logged while user is retired does NOT count toward progression. On unretire, treat as rankup with no attendance carryover.

---

## Data Model

### New Models

#### Rank

```prisma
model Rank {
  id                            Int       @id @default(autoincrement())
  name                          String    @unique           // "Corporal"
  abbreviation                  String    @unique           // "Cpl"
  orderIndex                    Int                         // 0, 1, 2, ... (for ordering)
  
  // Rankup requirements
  attendanceRequiredSinceLastRank Int?                      // null = no auto progression (manual only)
  autoRankupEnabled             Boolean   @default(false)   // If true, auto rankup when attendance met
  

  // Relations
  userRanks                     UserRank[]
  trainingRequirementsMin       TrainingRankRequirement[]   // Trainings requiring this rank as minimum
  transitionRequirementsTarget  RankTransitionRequirement[] // Trainings required to enter this rank
  rankHistory                   RankHistory[]
  
  createdAt                     DateTime  @default(now())
  updatedAt                     DateTime  @updatedAt
}
```

#### UserRank

```prisma
model UserRank {
  id                       Int       @id @default(autoincrement())
  user                     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId                   Int       @unique
  
  currentRank              Rank?     @relation(fields: [currentRankId], references: [id], onDelete: SetNull)
  currentRankId            Int?                           // null = unranked (no rank assigned)
  
  lastRankedUpAt           DateTime  @default(now())     // Timestamp of last rankup; used for history and audit
  attendanceSinceLastRank  Int       @default(0)        // Snapshot of total attendance count at time of last rankup; baseline for eligibility
  
  retired                  Boolean   @default(false)    // If true, can attend but cannot progress or request trainings
  interviewDone            Boolean   @default(false)    // Interview completion flag
  
  createdAt                DateTime  @default(now())
  updatedAt                DateTime  @updatedAt
  
  @@index([userId])
  @@index([currentRankId])
}
```

#### RankHistory

```prisma
model RankHistory {
  id                           Int       @id @default(autoincrement())
  
  user                         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId                       Int
  
  previousRankName             String?                        // Rank name before change (null if unranked → ranked)
  newRankName                  String                         // Rank name after change
  
  // Attendance snapshot at time of rankup
  attendanceTotalAtChange      Int                            // Total attendances counted
  attendanceDeltaSinceLastRank Int                            // Attendances since previous rank
  
  // Trigger source
  triggeredBy                  String    @db.VarChar(20)     // "admin", "bot", "auto"
  triggeredByUserId            Int?                           // Admin user ID (if admin triggered)
  triggeredByDiscordId         String?                        // Discord user ID (if bot triggered)
  
  // Outcome
  outcome                      String?   @db.VarChar(20)     // "approved", "declined", null for auto/direct
  declineReason                String?                        // Optional reason for decline
  
  note                         String?                        // Admin-provided note
  
  createdAt                    DateTime  @default(now())
  
  @@index([userId])
  @@index([createdAt])
  @@index([triggeredBy])
}
```

#### RankTransitionRequirement

```prisma
model RankTransitionRequirement {
  id                  Int       @id @default(autoincrement())
  
  targetRank          Rank      @relation(fields: [targetRankId], references: [id], onDelete: Cascade)
  targetRankId        Int                                    // Rank being entered
  
  requiredTrainings   Training[] @relation("RankTransitionRequirement")
  
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  
  @@unique([targetRankId])
  @@index([targetRankId])
}
```

#### TrainingRankRequirement (Updated)

```prisma
model TrainingRankRequirement {
  id            Int       @id @default(autoincrement())
  training      Training  @relation(fields: [trainingId], references: [id], onDelete: Cascade)
  trainingId    Int
  minimumRank   Rank?     @relation(fields: [minimumRankId], references: [id], onDelete: SetNull)
  minimumRankId Int?                                    // null = no rank requirement
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  @@unique([trainingId])
  @@index([trainingId])
  @@index([minimumRankId])
}
```

#### TrainingTrainingRequirement (New - Self-join)

```prisma
model TrainingTrainingRequirement {
  id                   Int       @id @default(autoincrement())
  
  training             Training  @relation("RequiresTutorial", fields: [trainingId], references: [id], onDelete: Cascade)
  trainingId           Int
  
  requiredTraining     Training  @relation("RequiredBy", fields: [requiredTrainingId], references: [id], onDelete: Cascade)
  requiredTrainingId   Int
  
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  
  @@unique([trainingId, requiredTrainingId])
  @@index([trainingId])
  @@index([requiredTrainingId])
}
```

#### Training (Updated)

```prisma
model Training {
  id                   Int                @id @default(autoincrement())
  name                 String
  description          String?
  category             TrainingCategory?  @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  categoryId           Int?
  duration             Int?               // Duration in minutes
  
  // New fields
  requiredForNewPeople Boolean            @default(false) // Flag for mandatory trainings (e.g., BCT)
  
  isActive             Boolean            @default(true)
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt
  
  userTrainings        UserTraining[]
  trainingRequests     TrainingRequest[]
  
  // Relations for prerequisites
  rankRequirement      TrainingRankRequirement?
  requiresTrainings    TrainingTrainingRequirement[] @relation("RequiresTutorial")
  requiredByTrainings  TrainingTrainingRequirement[] @relation("RequiredBy")
  
  // For rank transition requirements
  rankTransitions      RankTransitionRequirement[] @relation("RankTransitionRequirement")
}
```

#### Orbat (Updated)

```prisma
model Orbat {
  // ... existing fields ...
  isMainOp             Boolean   @default(false) // Admin-set flag; only counted for rank attendance
}
```

#### User (Updated)

```prisma
model User {
  // ... existing fields ...
  userRank             UserRank?
  rankHistory          RankHistory[]
}
```

#### PromotionProposal (New)

```prisma
model PromotionProposal {
  id                   Int       @id @default(autoincrement())
  
  user                 User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId               Int
  
  currentRankId        Int                                      // Rank before proposal
  nextRankId           Int                                      // Rank being proposed
  
  attendanceTotalAtProposal      Int                           // Attendance count when proposal created
  attendanceDeltaSinceLastRank   Int                           // Delta at proposal time
  
  status               String    @db.VarChar(20)              // "pending", "approved", "declined"
  
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  
  @@unique([userId, nextRankId])  // One proposal per user→nextRank
  @@index([userId])
  @@index([status])
}
```

---

## Eligibility & Rankup Engine

### Eligibility Computation

When evaluating if a user can rankup to the next rank:

1. **Retired check**: If `userRank.retired = true`, return `ineligible_retired`.
2. **Interview check**: If next rank > Cadet and `userRank.interviewDone = false`, return `ineligible_missing_interview`.
3. **Attendance check**: 
   - Compute delta = `currentTotalAttendance - userRank.attendanceSinceLastRank`
   - If delta < nextRank.attendanceRequiredSinceLastRank, return `ineligible_attendance_shortfall` with counts.
4. **Training prerequisites** (rank transition):
   - If RankTransitionRequirement exists for nextRank, check if user has completed all required trainings.
   - If any missing, return `ineligible_rank_transition_training` with list of required trainings.
5. **Training prerequisites** (training):
   - For trainings the user wants to request, check if they meet minimumRankId.
   - Training visibility: show all trainings but block requests if unmet.

### Reason Codes

- `eligible_auto`: Can auto rankup (autoRankupEnabled = true).
- `eligible_manual`: Can rankup but requires manual approval (autoRankupEnabled = false).
- `ineligible_retired`: User is retired.
- `ineligible_missing_interview`: Interview not completed.
- `ineligible_missing_training`: Required training not completed.
- `ineligible_attendance_shortfall`: Not enough attendance; include counts.
- `ineligible_rank_transition_training`: Rank transition training requirement not met.

---

## Rankup Flows

### Declined Proposals

**Decision** (Project Lead): When a proposal is declined, the user cannot rankup again until they accumulate the attendance requirement for the *next* rank.
- Example: If user is declined for Cpl→Sgt at 20 attendances (Sgt requirement), they must reach 40 attendances (Sgt requirement × 2 or higher threshold) before eligible again.
- This naturally spaces out proposals and prevents spam.

### Admin Notifications

**Decision** (Project Lead): Admins are notified via both Discord and web UI:
- **Discord**: Send to specific admin channel (e.g., #admin-promotions) with approve/decline options.
- **Web UI**: Toast notification on login showing pending count.

### Rank Decay System

**Decision** (Project Lead): Do NOT implement rank decay. Removed from schema.

### Auto Rankup Flow

1. **Check eligibility** → `eligible_auto`.
2. **Apply rankup**:
   - Update UserRank: `currentRankId = nextRankId`, `lastRankedUpAt = now()`, `attendanceSinceLastRank = 0`.
   - Log RankHistory: previousRankName, newRankName, attendance totals, `triggeredBy = "auto"`.
3. **Announce**:
   - Send Discord announcement (via bot) with user name, previous rank, new rank, attendance counts.
   - Push web UI notification (when user logged in).

### Manual Rankup Flow

1. **Check eligibility** → `eligible_manual`.
2. **Create promotion proposal**:
   - Insert PromotionProposal: userId, currentRankId, nextRankId, attendance snapshot, status = "pending".
   - If proposal already exists for this user→nextRank, return existing proposal.
3. **Notify admins**:
   - Send Discord bot message (inline button or separate) with approve/decline options, user name, current rank, next rank, attendance counts.
   - Push web notification: pending rankup count toast.
4. **Admin decision**:
   - Web UI: Approve/decline via dedicated pending promotions view.
   - Bot: Approve/decline via button click.
5. **Apply (if approved)**:
   - Update UserRank & log RankHistory as above; `triggeredBy = "bot"` or `"admin"`, record triggeredByUserId/triggeredByDiscordId.
   - Send Discord announcement.
6. **Decline**:
   - Mark PromotionProposal status = "declined", optionally store reason.
   - Delete proposal from bot/web views.
   - Reset baseline: Update UserRank `attendanceSinceLastRank = currentAttendance` (user must accumulate rankRequirement from this new baseline).

### Unretire Flow

1. **Trigger**: Admin toggles `userRank.retired = false`.
2. **Prompt**: Admin is asked for:
   - Starting rank (what rank to assign).
   - Whether to require BCT again (optional; default no).
3. **Apply as rankup**:
   - Update UserRank: `currentRankId = startingRankId`, `lastRankedUpAt = now()`, `attendanceSinceLastRank = 0`, `retired = false`.
   - Log RankHistory: `previousRankName = null` (or "Retired"), `newRankName = startingRankName`, `triggeredBy = "admin"`, record admin ID.
4. **Attendance**: Attendance logged while retired is NOT included; `attendanceSinceLastRank` starts fresh from unretire date.

### Demotion Flow (Manual Admin Action)

1. **Trigger**: Admin manually demotes user to a lower rank.
2. **Apply**:
   - Update UserRank: `currentRankId = lowerRankId`, `lastRankedUpAt = now()`.
   - Recompute `attendanceSinceLastRank` from RankHistory or reset to 0.
   - Log RankHistory: `previousRankName = oldRank`, `newRankName = lowerRank`, `triggeredBy = "admin"`, reason optional.

---

## Admin Interfaces

### 1. Rank Configuration Page

**Path**: `/app/admin/ranks/page.tsx`

**Features**:
- List all ranks with columns: Abbr, Full Name, Order, Attendance Required, Auto Rankup Enabled.
- Add/edit/delete ranks.
- Reorder via drag-and-drop or index field.
- Set per-rank settings: name, abbreviation, attendance threshold, auto rankup toggle.
- For each rank, manage transition requirements: add/remove required trainings for entering that rank.

**Validation**:
- Rank names unique; abbreviations unique.
- No circular dependencies in training prerequisites.
- Cannot delete rank if users currently hold it (or soft-delete with archival).

### 2. Unranked/Cadet User List

**Path**: `/app/admin/users/unranked/page.tsx`

**Columns**:
- Checkbox (bulk select).
- Username.
- Rank (None/Cadet/other).
- Interview (Yes/No).
- BCT (Yes/No).
- Retired (Yes/No).
- Attendance Total.
- Actions (Assign Rank, View History).

**Filters**:
- Interview: "Not Done" / "Done" / "All".
- BCT: "Not Done" / "Done" / "All".
- Retired: "Active" / "Retired" / "All".

**Bulk Actions**:
- Select rows via checkboxes; "Select All" checkbox for page.
- Bulk assign rank: choose target rank, apply to all selected.
- Bulk set interview flag: on/off.
- Bulk mark as retired/unretire.

**Actions** (per-row or modal):
- Assign rank: dropdown of available ranks.
- Unretire: if retired, show button; opens prompt for starting rank + BCT requirement.
- View history: show RankHistory for this user.

### 3. Pending Promotions Page

**Path**: `/app/admin/promotions/page.tsx`

**Features**:
- List all pending PromotionProposals.
- Columns: Username, Current Rank, Next Rank, Attendance (total/delta), Created At, Actions.
- Approve/Decline buttons per row.
- Bulk approve (select rows, approve all).

**On Web Login**:
- Toast notification: "You have N pending promotions" (clickable to navigate to page).
- Notification persists on every login until proposals cleared.

### 4. User Rank History Page

**Path**: `/app/user/profile/rank-history/page.tsx` (user-visible) and `/app/admin/users/[id]/rank-history/page.tsx` (admin-only)

**Features** (User View):
- Full timeline of this user's rank changes with attendance counts.
- Display: Previous Rank → New Rank, Date, Trigger (admin/bot/auto).

**Features** (Admin View):
- Full audit trail: Previous Rank → New Rank, Attendance counts, Trigger, Actor, Timestamp.
- Pagination if many entries.

### 5. Rank System Migration UI

**Path**: `/app/admin/ranks/migrate/page.tsx`

**Workflow**:
1. **Backup**: Ask to confirm current rank structure saved/backed up.
2. **Strategy Selection**:
   - Option A: **Recalculate** — Re-evaluate all users against new thresholds; users may be demoted/promoted.
   - Option B: **Grandfather** — Keep existing ranks; apply new thresholds only to future rankups.
   - Option C: **Map Ranks** — If rank names changed, prompt for old→new rank mapping; optionally allow per-user overrides.
3. **Preview**:
   - Show impact: "X users will be demoted, Y promoted, Z unchanged."
   - Allow review before applying.
4. **Apply & Log**:
   - Execute strategy; log all changes in RankHistory with `triggeredBy = "system_migration"`, store strategy name.

---

## Bot Integration

### Discord Bot Endpoints

**All endpoints authenticated via Bearer token (Discord bot secret) or HMAC signature (TBD).**

#### 1. `POST /api/ranks/promotions/propose`

**Purpose**: Bot calls this to check if a user is eligible to rankup and create a proposal.

**Request**:
```json
{
  "userId": 5,
  "discordActorId": "123456789"  // Optional; who triggered this check (admin Discord ID)
}
```

**Response**:
```json
{
  "eligible": "eligible_auto" | "eligible_manual" | "ineligible_*",
  "reason": "string (optional details)",
  "currentRank": {
    "id": 1,
    "name": "Recruit",
    "abbreviation": "Rct",
    "orderIndex": 0
  },
  "nextRank": {
    "id": 2,
    "name": "Private",
    "abbreviation": "Pvt",
    "orderIndex": 1,
    "attendanceRequiredSinceLastRank": 10
  },
  "attendanceCounts": {
    "total": 15,
    "delta": 15,
    "required": 10
  },
  "proposalId": "uuid"  // For manual ranks; null for auto
}
```

#### 2. `POST /api/ranks/promotions/approve`

**Purpose**: Admin approves a manual rankup via Discord bot.

**Request**:
```json
{
  "proposalId": "uuid",
  "discordActorId": "123456789"  // Admin's Discord ID
}
```

**Response**:
```json
{
  "success": true,
  "rankHistory": {
    "previousRank": "Private",
    "newRank": "Lance Corporal",
    "attendanceCounts": { "total": 20, "delta": 10 },
    "timestamp": "2026-01-19T14:30:00Z"
  }
}
```

#### 3. `POST /api/ranks/promotions/decline`

**Purpose**: Admin declines a manual rankup.

**Request**:
```json
{
  "proposalId": "uuid",
  "discordActorId": "123456789",
  "reason": "optional reason string"
}
```

**Response**:
```json
{
  "success": true,
  "proposalDeleted": true
}
```

#### 4. `GET /api/ranks/promotions/pending`

**Purpose**: Bot retrieves all pending proposals (for batch announcements/reminders).

**Response**:
```json
{
  "pending": [
    {
      "proposalId": "uuid",
      "userId": 5,
      "userName": "Stas",
      "currentRank": "Private",
      "nextRank": "Lance Corporal",
      "attendanceCounts": { "total": 20, "delta": 10 },
      "createdAt": "2026-01-19T12:00:00Z"
    }
  ]
}
```

### Bot Behavior

- **Auto Rankup**: Server applies immediately; bot sends announcement message (single or per-user, TBD in implementation).
  - Message: "🎉 Congratulations [Pvt] Stas! You have been promoted to Lance Corporal! (20 attendances)"
- **Manual Rankup**:
  - Proposal created; bot sends notification to admin channel or DM.
  - Message includes approve/decline inline buttons (if supported; else separate messages per action).
  - Single message per proposal; deleted after decision.
- **Declined Proposals**: Removed from bot message; no re-proposal until next attendance threshold.

---

## Legacy Data Import

### Import Process

1. **Upload CSV**: Admin uploads legacy attendance CSV (fields: ID, NAME, Rank, Date Joined, TIG Since Last Promo, TOTAL TIG, Old Data).
2. **Parse & Validate**: Extract records; validate rank names against current system.
3. **Create LegacyAttendanceData entries**:
   - For each row: insert into LegacyAttendanceData table with legacyName, legacyRank, legacyDateJoined, legacyTIGSinceLastPromo, legacyTotalTIG, isMapped = false.
4. **Map to Users**:
   - Admin selects users from current system; map legacy records to them.
   - For each mapping: update LegacyAttendanceData.mappedUserId, isMapped = true.
   - Optionally bulk-map by Discord username matching.
5. **Initialize Ranks**:
   - For each mapped user: determine starting rank from legacy rank (e.g., "Cpl" → rank ID for Corporal).
   - Set UserRank: currentRankId, attendanceSinceLastRank (from TIG Since Last Promo), lastRankedUpAt (from Date Joined), interview/retired flags as needed.
   - Create initial RankHistory entry: triggeredBy = "import", store legacy rank name.

### Rank Mapping (Legacy → Current)

```
Legacy Rank → Current Rank
Rct           → Recruit
Pvt           → Private
LCpl          → Lance Corporal
Cpl           → Corporal
Sgt           → Sergeant
SSgt          → Staff Sergeant
WO1           → Warrant Officer 1
WO2           → Warrant Officer 2
2Lt           → Second Lieutenant
Maj           → Major
Cdt           → Cadet
```

**Admin can override mappings** during import if current rank structure differs.

---

## Rank Migration & System Changes

### Scenario: Renaming Ranks

**Example**: Change "Lance Corporal" → "Junior Corporal".

1. **Backup**: Admin initiates migration.
2. **Rename**: Edit Rank name; abbreviation remains same (or update both).
3. **Apply**: No user rank changes needed; RankHistory still shows old name (immutable).
4. **Verify**: No side effects; trainings referring to rank ID still work.

### Scenario: Changing Attendance Thresholds

**Example**: Cpl rank now requires 15 attendances instead of 10.

1. **Backup**: Confirm.
2. **Strategy selection**:
   - Recalculate: Re-evaluate all users; anyone with 10-14 attendances stays Cpl; demote if no longer eligible.
   - Grandfather: Keep current ranks; only future users apply new rule.
   - Map: No rank name change, so skip mapping step.
3. **Apply**: Update Rank.attendanceRequiredSinceLastRank; run migration.

### Scenario: Restructuring Rank Order

**Example**: Insert "Specialist" between Sgt and SSgt.

1. **Strategy**: Usually Grandfather (existing ranks unchanged).
2. **Add Rank**: Insert new Rank with orderIndex = 4.5 (or reorder all).
3. **Transition Requirements**: Optionally set trainings required to reach Specialist.
4. **Future Rankups**: New users see the updated order.

---

## API Contracts

### Web UI Endpoints (Admin)

#### Rank Management

- `GET /api/ranks` — List all ranks.
- `POST /api/ranks` — Create rank.
- `PUT /api/ranks/[id]` — Update rank (name, abbr, attendance, auto, decay).
- `DELETE /api/ranks/[id]` — Delete rank (if no users assigned).
- `PUT /api/ranks/reorder` — Bulk reorder ranks via orderIndex.

#### Rank Transitions

- `GET /api/ranks/[id]/transitions` — Get required trainings for this rank.
- `POST /api/ranks/[id]/transitions` — Add required training.
- `DELETE /api/ranks/[id]/transitions/[trainingId]` — Remove required training.

#### User Rank Management

- `GET /api/users/unranked` — List unranked/Cadet users with filters.
- `POST /api/users/[id]/rank/assign` — Assign rank to user.
- `POST /api/users/[id]/rank/demote` — Demote user.
- `POST /api/users/[id]/retired/toggle` — Toggle retired flag (unretire prompts for starting rank).
- `POST /api/users/[id]/interview/toggle` — Toggle interview flag.
- `GET /api/users/[id]/rank-history` — Get user's rankup history.

#### Promotions

- `GET /api/ranks/promotions/pending` — List pending manual rankups.
- `POST /api/ranks/promotions/[id]/approve` — Approve (from web UI).
- `POST /api/ranks/promotions/[id]/decline` — Decline (from web UI).

#### Migration

- `POST /api/ranks/migrate/preview` — Preview migration impact (which users affected).
- `POST /api/ranks/migrate/apply` — Apply migration strategy.

#### Training

- `POST /api/trainings/[id]/rank-requirement` — Set minimum rank for training.
- `DELETE /api/trainings/[id]/rank-requirement` — Remove rank requirement.
- `POST /api/trainings/[id]/prerequisites` — Add training prerequisite (with cycle detection).
- `DELETE /api/trainings/[id]/prerequisites/[prerequisiteId]` — Remove prerequisite.

#### Legacy Import

- `POST /api/import/legacy-attendance` — Upload CSV.
- `GET /api/import/legacy-attendance` — List unmapped legacy records.
- `POST /api/import/legacy-attendance/map` — Bulk map records to users.
- `POST /api/import/legacy-attendance/apply` — Initialize ranks from mapped data.

### Bot Endpoints

- `POST /api/ranks/promotions/propose` — Propose rankup; create manual proposal if needed.
- `POST /api/ranks/promotions/approve` — Approve manual rankup.
- `POST /api/ranks/promotions/decline` — Decline manual rankup.
- `GET /api/ranks/promotions/pending` — Batch retrieve pending proposals.

---

## Implementation Notes

### Database Considerations

- **Indexes**: Add indexes on frequently queried fields (userId, currentRankId, createdAt, status).
- **Constraints**: Unique constraints on Rank (name, abbr), UserRank (userId), TrainingTrainingRequirement (trainingId, requiredTrainingId).
- **Cascade deletes**: Rank deletion should cascade to UserRank, RankHistory, PromotionProposal (with safeguards).

### Caching & Performance

- **Attendance delta**: Compute on-demand as `currentAttendance - attendanceSinceLastRank` (O(1) after single attendance count query).
- **`attendanceSinceLastRank` field**: Snapshot baseline; never changes except on rankup or decline. No recomputation needed.
- **Training prerequisites**: Cache in memory or use database query with memoization to avoid N+1 queries.

### Validation & Error Handling

- **Circular training prerequisites**: Detect and prevent before inserting TrainingTrainingRequirement.
- **Rank transition gating**: When evaluating rankup, fetch RankTransitionRequirement and check user has all required trainings.
- **Proposal uniqueness**: Enforce at database level (unique constraint on userId + nextRankId) and application level.

### Audit & Compliance

- **RankHistory immutability**: All rankup events logged; cannot be edited (soft-delete only if needed).
- **Admin actions**: Log triggeredByUserId for manual changes; display admin name in UI.
- **Bot actions**: Log triggeredByDiscordId; link to admin user if account is linked.

### Future Enhancements

- **Rank decay system**: Implement rank decay after configurable days (deferred; not approved for implementation).
- **Permissions system**: Override rankup blocks (e.g., allow manual promotion even if BCT missing) via future permission model.
- **Bot inline buttons**: Inline buttons vs separate messages (deferred to implementation phase).
- **Training trees & flowcharts**: Visualize training prerequisites in web UI.
- **Statistics dashboard**: Rankup trends, average time to each rank, retention metrics.
- **Per-user timeline view**: Show rank progression over time (Cadet → Recruit → Pvt → ...).
- **Rank export/import**: Support multiple rank structures (future; currently single static structure).

---

## Implementation Roadmap

1. **Phase 1: Schema & Core APIs**
   - Add Rank, UserRank, RankHistory, RankTransitionRequirement models.
   - Implement eligibility engine.
   - Build rank management APIs (CRUD).
   - User rank assignment APIs.

2. **Phase 2: Rankup Flows**
   - Implement auto rankup logic (scheduled or on-demand).
   - Implement manual rankup proposals.
   - Bot integration (propose/approve/decline endpoints).

3. **Phase 3: Admin UI**
   - Rank configuration page.
   - Unranked/Cadet user list.
   - Pending promotions page.
   - Rank history per user.

4. **Phase 4: Training Gating**
   - Add training rank requirements.
   - Implement training prerequisites (with cycle detection).
   - Update training request logic to check requirements.

5. **Phase 5: Legacy Import**
   - Build CSV import workflow.
   - Legacy data mapping UI.
   - Rank initialization from legacy data.

6. **Phase 6: Migration UI & Bot Messaging**
   - Rank system migration wizard.
   - Bot notifications (auto announce, manual approval messages).
   - Web UI notifications (toast on login, pending count).

7. **Phase 7: Advanced Features (Future)**
   - Decay system implementation.
   - Permissions-based overrides.
   - Reporting & statistics dashboard.

---

**Document Version**: 1.0  
**Status**: Ready for Implementation  
**Next Step**: Proceed with Phase 1 (Schema & Core APIs)

# Rank System Documentation

## Overview

The rank system manages user progression through military ranks based on attendance, training completion, and manual review. It includes automatic rankups, manual promotion proposals, training prerequisites, and legacy data import capabilities.

## Core Components

### 1. Rank Management (`/app/admin/ranks`)

**Features:**
- Create, update, delete, and reorder ranks
- Set attendance requirements for each rank
- Enable/disable auto-rankup per rank
- View user distribution across ranks

**Key Fields:**
- `name`: Full rank name (e.g., "Corporal")
- `abbreviation`: Short form (e.g., "Cpl")
- `orderIndex`: Hierarchy order (higher = higher rank)
- `attendanceRequiredSinceLastRank`: Attendance needed to be eligible
- `autoRankupEnabled`: Whether this rank allows automatic promotion

### 2. User Ranks (`UserRank` model)

**Purpose:** Tracks each user's current rank and progression

**Key Fields:**
- `currentRankId`: User's current rank
- `attendanceSinceLastRank`: Attendance count since last promotion
- `lastRankedUpAt`: Date of last rank change
- `retired`: Whether user is retired (prevents rankups)
- `interviewDone`: Interview completion flag for manual review ranks

### 3. Rank Eligibility System

**Eligibility Check:** `lib/rank-eligibility.ts`

Returns one of these codes:
- `eligible_auto`: User meets all requirements for automatic promotion
- `eligible_manual`: User needs manual review (interview, training, etc.)
- `ineligible_no_rank`: User has no rank assigned
- `ineligible_attendance`: Insufficient attendance for next rank
- `ineligible_retired`: User is retired
- `ineligible_interview`: Interview not completed
- `ineligible_training`: Missing required training
- `ineligible_max_rank`: Already at highest rank

### 4. Promotion Proposals

**Purpose:** Manual rankup workflow for ranks requiring review

**States:**
- `pending`: Awaiting admin approval
- `approved`: Approved and applied
- `declined`: Rejected with reason

**Admin Actions:**
- Bulk approve selected proposals
- Individual approve/decline with notes
- Auto-rankup button for eligible users

### 5. Training Prerequisites & Gating

**Features:**
- Set minimum rank requirement for trainings
- Define prerequisite trainings (e.g., Leadership 1 requires BCT)
- Circular dependency detection
- Visual lock indicators for users

**Gating Functions:** `lib/training-gating.ts`
- `getTrainingRequirements(trainingId)`: Fetch all requirements
- `canRequestTraining(userId, trainingId)`: Check eligibility
- `getUnmetRequirements(userId, trainingId)`: Get missing prerequisites

### 6. Rank History

**Purpose:** Audit log of all rank changes

**Records:**
- Previous and new rank names
- Attendance at time of change
- Who triggered the change (admin, bot, auto, import)
- Outcome (approved/declined) and reason
- Timestamps

### 7. Legacy Data Import

**Workflow:**
1. Upload CSV with legacy user data (rank, attendance, join date)
2. Preview parsed records
3. Map legacy users to current system users (auto-match by Discord username)
4. Apply to create UserRank and RankHistory entries

**CSV Format:**
```
ID,NAME,Rank,Date Joined,TIG Since Last Promo,TOTAL TIG,Old Data
001,Username,Cpl,01/01/2025,15,0,20
```

### 8. Rank System Migration

**Purpose:** Restructure ranks or recalculate user ranks

**Strategies:**
- **Recalculate**: Recompute all ranks based on current attendance
- **Grandfather**: Keep existing ranks (no changes)
- **Map**: Map old rank names to new ranks for restructuring

**Workflow:**
1. Review backup warning
2. Select strategy
3. Configure mappings (for 'map' strategy)
4. Preview impact (promotions/demotions count)
5. Apply migration with full history logging

## API Endpoints

### Rank Management
- `GET /api/ranks` - List all ranks
- `POST /api/ranks` - Create rank
- `PUT /api/ranks/[id]` - Update rank
- `DELETE /api/ranks/[id]` - Delete rank
- `PUT /api/ranks/reorder` - Update rank order

### Eligibility & Proposals
- `POST /api/ranks/check-eligibility` - Check user eligibility
- `GET /api/ranks/proposals` - List pending proposals
- `POST /api/ranks/proposals` - Create proposal
- `POST /api/ranks/proposals/[id]/approve` - Approve proposal
- `POST /api/ranks/proposals/[id]/decline` - Decline proposal

### Auto Rankup
- `POST /api/ranks/auto-rankup` - Process automatic rankups (admin only)

### Bot Integration
- `GET /api/ranks/bot/promotions` - List pending proposals for bot
- `POST /api/ranks/bot/promotions/[id]/approve` - Bot approve
- `POST /api/ranks/bot/promotions/[id]/decline` - Bot decline

### Training Prerequisites
- `GET /api/trainings/[id]/requirements` - Get training requirements
- `POST /api/trainings/[id]/requirements` - Set rank requirement
- `POST /api/trainings/[id]/prerequisites` - Add prerequisite training
- `DELETE /api/trainings/[id]/prerequisites/[prerequisiteId]` - Remove prerequisite

### Rank Transitions
- `GET /api/ranks/[id]/transitions` - Get required trainings for rank
- `POST /api/ranks/[id]/transitions` - Add training requirement
- `DELETE /api/ranks/[id]/transitions/[trainingId]` - Remove requirement

### User Features
- `GET /api/users/[id]/rank` - Get user's current rank
- `GET /api/users/[id]/rank-history` - Get rank history (paginated)

### Legacy Import
- `POST /api/admin/import/legacy-user-data` - Upload CSV
- `GET /api/admin/import/legacy-user-data` - List records
- `POST /api/admin/import/legacy-user-data/map` - Map users
- `POST /api/admin/import/legacy-user-data/apply` - Apply data

### Migration
- `POST /api/ranks/migrate/preview` - Preview migration
- `POST /api/ranks/migrate/apply` - Apply migration

## Database Schema

### Core Models
- `Rank`: Rank definitions
- `UserRank`: User's current rank state
- `RankHistory`: Audit log of changes
- `PromotionProposal`: Pending manual rankups

### Relationship Models
- `TrainingRankRequirement`: Minimum rank for training
- `TrainingTrainingRequirement`: Training prerequisites
- `RankTransitionRequirement`: Required trainings for rank

### Import Models
- `LegacyUserData`: Imported legacy rank data
- `LegacyAttendanceData`: Imported legacy attendance records

## User-Facing Features

### Rank Display
- ORBAT slots show rank abbreviation: `[Cpl] Username`
- User profile shows current rank badge
- Attendance counter since last rank
- Link to full rank history

### Rank History Page
- Timeline of all rank changes
- Shows promotions and demotions
- Displays trigger source (admin, bot, auto, import)
- Includes attendance and outcome details
- Paginated view (20 per page)

### Training Gating
- Locked trainings show requirements
- Visual indicators for missing prerequisites
- Rank badges show minimum rank needed
- Request button disabled if ineligible

## Admin Features

### Pending Promotions (`/admin/promotions`)
- View all pending promotion proposals
- Bulk approve selected proposals
- Individual approve/decline with reasons
- Auto rankup button for eligible users
- Real-time polling (30s intervals)
- Toast notification on admin login

### Rank Management (`/admin/ranks`)
- CRUD operations for ranks
- Drag-and-drop reordering
- User count per rank
- Attendance requirement configuration
- Auto-rankup toggle per rank

### Unranked Users (`/admin/ranks/unranked`)
- List users without ranks
- Bulk assign default rank
- Individual rank assignment
- Filter and search capabilities

### Training Management
- Set minimum rank for each training
- Add/remove prerequisite trainings
- View current requirements
- Circular dependency prevention

### Legacy Import (`/admin/import`)
- 4-step wizard: Upload → Preview → Map → Apply
- CSV parsing and validation
- Auto-mapping by Discord username
- Manual user mapping interface
- Preview impact before applying

### Migration Wizard (`/admin/ranks/migrate`)
- 5-step wizard with backup warnings
- Three migration strategies
- Detailed preview with user-level changes
- Rollback instructions
- Full audit trail

## Security

### Authentication
- All admin endpoints require `isAdmin = true`
- Bot endpoints use Bearer token authentication (`BOT_API_TOKEN` env var)
- User endpoints check session ownership

### Authorization Checks
- Admin-only operations gated by session check
- Bot endpoints validate token before processing
- User data endpoints check ownership or admin status

### Data Integrity
- Cascade deletes prevent orphaned records
- Transactions ensure atomic operations
- Unique constraints prevent duplicates
- Foreign key relationships enforced

## Performance Considerations

### Indexes
- All foreign keys indexed
- User lookups indexed (userId, currentRankId)
- History queries indexed (createdAt, triggeredBy)
- Legacy data indexed (discordUsername, isMapped)

### Query Optimization
- Includes used to prevent N+1 queries
- Pagination on large lists (20-50 items per page)
- Select only needed fields in relations
- Batch operations where possible

### Caching Opportunities
- Rank list (changes infrequently)
- Training requirements (static between updates)
- User rank for display (with revalidation)

## Future Enhancements

### Testing (Phase 11)
- Unit tests for eligibility logic
- Integration tests for rankup flows
- UI tests for admin workflows

### Discord Bot Integration
- Automatic announcement of rankups
- Discord role synchronization
- Admin approval via Discord reactions

### Analytics Dashboard
- Rank progression charts
- Average time per rank
- Training completion rates
- Promotion approval rates

### Notifications
- User notifications for rank changes
- Admin notifications for new proposals
- Training completion reminders

## Troubleshooting

### User not eligible for rankup
1. Check attendance count vs requirement
2. Verify training requirements met
3. Check retired status
4. Verify interview completion (if required)

### Training request fails
1. Check rank requirement
2. Verify prerequisite trainings completed
3. Check for needsRetraining flag

### Legacy import issues
1. Validate CSV format matches expected headers
2. Check rank names match current system
3. Verify Discord usernames match exactly
4. Review mapping before applying

### Migration errors
1. Always backup database first
2. Test with 'grandfather' strategy first
3. Preview before applying
4. Check rank history for audit trail

## Support

For questions or issues:
- Check rank history for audit trail
- Review error messages in browser console
- Check server logs for detailed errors
- Verify database migration status

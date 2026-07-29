# API Missing Features for Discord Bot Integration

## Overview

This document identifies the features missing from the 6MD Management Platform API that are required for full Discord bot integration as specified in the design requirements. These gaps need to be addressed either through API additions or workarounds in the bot implementation.

**IMPORTANT: All `/bot/*` API endpoints require a bot token for authentication. Bot tokens can ONLY be created by users with the `system:super_admin` permission. This ensures that only authorized administrators can create and manage bot integrations.**

**Note:** Additional requirements were provided after initial analysis:
1. Admins should approve non-auto promotions in admin-only channel; if declined, reset attendance counter to current attendance (implemented via existing decline endpoints)
2. Signup button that shows a private message with slot selection buttons
3. Attendance status buttons (absent, late, goes early, unsure)
4. Training notification settings (already partially exists via TrainingRequestSubscription)
5. Discord role synchronization - assign new rank role and disable old rank role when promotion is applied (both auto and manual)
6. Nickname should update synchronously when promotion is applied (both auto and manual)
7. ORBAT announcements must include a direct link to the ORBAT on the website
8. Prevent double signups - Discord and website signups share the same backend via `/bot/signups` endpoint
9. Rank-to-Discord-role mapping should be managed in the web application, not in bot configuration

---

## Critical Missing Features

### 1. Notification Preferences System

**Requirement:** Users should be able to subscribe to receive Discord notifications for training and ORBAT announcements.

**Current State:**
- No API endpoints exist for managing user notification preferences
- No database model for storing notification preferences
- The only notification-related model is `TrainingRequestSubscription` which is specific to training requests

**Missing API Endpoints:**
```
POST /bot/users/{discordId}/notifications/subscribe
POST /bot/users/{discordId}/notifications/unsubscribe
GET /bot/users/{discordId}/notifications/preferences
PUT /bot/users/{discordId}/notifications/preferences
```

**Proposed Solution:**
1. Add a `UserNotificationPreference` model to the database:
```prisma
model UserNotificationPreference {
  id          Int      @id @default(autoincrement())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId      Int
  discordUserId String? // For direct Discord ID lookup
  
  // Notification types
  orbatAnnouncements     Boolean @default(false)
  trainingAnnouncements   Boolean @default(false)
  promotionAnnouncements  Boolean @default(false)
  trainingReminders       Boolean @default(false)
  
  // Delivery preferences
  dmEnabled             Boolean @default(true)
  channelMentions        Boolean @default(false)
  
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  
  @@unique([userId])
  @@index([discordUserId])
}
```

2. Add API endpoints for managing preferences:
- `GET /bot/notifications/preferences/{discordId}` - Get user notification preferences
- `POST /bot/notifications/preferences/{discordId}` - Set user notification preferences

**Workaround:** The bot can maintain its own database of notification preferences (SQLite or similar) and sync with user data from the API.

**Impact:** Medium - Users cannot control notification preferences without this feature. Bot will need to maintain separate state.

---

### 2. Real-time Event Webhooks

**Requirement:** The bot needs to be notified when new ORBATs are created to announce them immediately (not just on Monday schedule).

**Current State:**
- SSE (Server-Sent Events) streams are available at:
  - `/orbats/events` - Global ORBAT SSE stream
  - `/orbats/{id}/events` - ORBAT-specific SSE stream
  - `/admin/catalog/events` - Admin catalog SSE stream
  - `/admin/users/events` - Admin users SSE stream
- These are pull-based (bot must maintain connection)
- No push-based webhooks exist

**Problem:**
- SSE connections require the bot to maintain persistent HTTP connections
- This is less reliable than webhooks for a Discord bot
- Bot would need to handle connection drops, reconnects, and message processing

**Missing Feature:**
- Webhook endpoints that the API can call when specific events occur

**Proposed Solution:**
1. Add webhook configuration to the database:
```prisma
model BotWebhook {
  id          Int      @id @default(autoincrement())
  name        String
  url         String   // Bot's webhook URL
  events      String[] // Event types to subscribe to
  secret      String?  // Optional webhook secret
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  lastCalled  DateTime?
}
```

2. Add API endpoints:
- `POST /admin/bot-webhooks` - Register a webhook
- `DELETE /admin/bot-webhooks/{id}` - Remove a webhook
- `GET /admin/bot-webhooks` - List webhooks

3. Trigger webhooks on events:
- ORBAT created/updated/deleted
- Training scheduled/updated
- Promotion approved/declined
- User rank changed

**Workaround:** The bot can use SSE streams but must:
1. Maintain persistent connections to `/orbats/events`
2. Parse event stream for ORBAT creation events
3. Handle connection retries and failures

**Impact:** Medium - Adds complexity to bot implementation. SSE is viable but less ideal than webhooks.

---

### 3. User Nickname Synchronization Data

**Requirement:** Update Discord server nickname with rank prefix and website username. The bot needs to know the user's current rank and username from the website.

**Current State:**
- `GET /bot/users/discord/{discordId}` - Returns user data including current rank ✅
- `GET /bot/users` - Returns all users with ranks ✅
- User model includes `username` and `userRank.currentRank` ✅

**Problem:**
- No endpoint to get users by rank (for bulk operations)
- No SSE stream for user rank changes
- Bot must poll for rank changes or use SSE user events

**Missing API Endpoints:**
```
GET /bot/users/by-rank/{rankId}  // Get users with specific rank
GET /bot/users/events           // SSE stream for user changes (including rank)
```

**Proposed Solution:**
1. Add SSE stream for user changes:
```typescript
// In lib/realtime/user-events.ts
// Add user.rank_changed event type
export type UserEventType =
  | 'user.created'
  | 'user.updated'
  | 'user.rank_changed'  // NEW
  | 'user.retired';
```

2. Trigger this event when ranks are assigned or changed

**Workaround:** The bot can:
1. Periodically poll `/bot/users` for all active users
2. Cache user rank information
3. Update Discord nicknames on a schedule (hourly)
4. Also update when user joins the server

**Impact:** Low - Workaround is feasible with polling, though not real-time.

---

### 4. Training Announcement Response Redirection

**Requirement:** Allow users to answer to training announcements, with responses redirected to the training chat.

**Current State:**
- Training chat events exist: `/lib/realtime/training-chat-events.ts`
- Training request subscriptions exist
- No API support for redirecting responses

**Problem:**
- This is primarily a Discord-side feature
- No API endpoint needed for the redirection itself
- However, there's no way for the bot to know which messages are training announcements

**Missing Feature:**
- Metadata in training announcements to identify them as such
- OR: Endpoint to mark a message as a training announcement

**Proposed Solution:**
1. Add a message type or metadata field to identify training announcements:
```prisma
model Message {
  // ... existing fields ...
  isTrainingAnnouncement Boolean @default(false)  // NEW
  trainingRequestId    Int?    // NEW: Link to training request if applicable
}
```

2. Add endpoint for bot to get training announcements:
```
GET /bot/training-announcements  // Get recent training announcements
```

**Workaround:** The bot can:
1. Use a specific message format or embed for training announcements
2. Track which messages it sent as training announcements
3. Use message IDs or custom identifiers in the embed footer
4. Store announcement metadata in its own database

**Impact:** Low - Workaround is straightforward to implement.

---

### 5. Weekly ORBAT Query

**Requirement:** Get ORBATs for the current week to announce on Monday.

**Current State:**
- `GET /bot/orbats` - Returns ORBATs with `includePast` and `limit` parameters
- `GET /orbats/calendar?start={date}&end={date}` - Returns calendar feed
- No direct "current week" query

**Problem:**
- Bot must calculate week boundaries and filter ORBATs itself
- Calendar endpoint accepts date range but returns ical format, not JSON

**Missing API Endpoint:**
```
GET /bot/orbats/week/{year}/{weekNumber}  // Get ORBATs for specific week
GET /bot/orbats/current-week          // Get ORBATs for current week
```

**Proposed Solution:**
1. Add week-based filtering to `/bot/orbats`:
```typescript
// Add query parameters
const week = searchParams.get('week');  // ISO week number
const year = searchParams.get('year');  // Year
```

2. Or add a dedicated endpoint:
```
GET /bot/orbats/week?year={year}&week={weekNumber}
```

**Workaround:** The bot can:
1. Use `/bot/orbats?includePast=false` to get upcoming ORBATs
2. Filter by date range in code
3. Calculate week boundaries (Monday-Sunday) and filter locally

**Impact:** Low - Workaround is simple date filtering.

---

### 6. Compile Attendance for Previous Day

**Requirement:** Run compile attendance at 1am UTC from the previous day.

**Current State:**
- `POST /bot/attendance/compile` - Compiles attendance for a specific ORBAT ✅
- Requires `orbatId` parameter ✅
- Bot must know which ORBATs were on the previous day

**Problem:**
- No endpoint to get ORBATs by date range
- Bot must first query for ORBATs, then compile each one

**Missing API Endpoint:**
```
GET /bot/orbats/by-date?start={date}&end={date}  // Get ORBATs in date range
```

**Proposed Solution:**
1. Add date filtering to `/bot/orbats`:
```typescript
const startDate = searchParams.get('startDate');
const endDate = searchParams.get('endDate');
```

2. Or add a dedicated endpoint for date-based queries

**Workaround:** The bot can:
1. Use `/bot/orbats?includePast=true&limit=100` to get all ORBATs
2. Filter by date in code
3. Identify which ORBATs occurred on the previous day
4. Call compile for each relevant ORBAT

**Impact:** Low - Workaround requires fetching all ORBATs but is feasible.

---

### 7. User Rank History for Promotions

**Requirement:** Announce promotions to users.

**Current State:**
- `GET /bot/promotions/auto` - Get recent auto-promotions ✅
- `GET /bot/promotions/pending` - Get pending promotions ✅
- `POST /bot/promotions/{id}/approve` - Approve promotion ✅
- `POST /bot/promotions/{id}/decline` - Decline promotion ✅
- `GET /users/{id}/rank-history` - Get user rank history (requires auth) ❌

**Problem:**
- Rank history endpoint requires authentication (bearer token)
- Bot uses API key authentication, not user session
- No bot-specific endpoint for rank history

**Missing API Endpoint:**
```
GET /bot/users/{id}/rank-history  // Get user rank history (bot auth)
```

**Proposed Solution:**
1. Add bot-specific endpoint for rank history:
```typescript
// In app/api/bot/users/[id]/rank-history/route.ts
// Similar to existing rank history but with API key auth
```

2. Or modify the security on the existing endpoint to allow API key auth:
```yaml
# In openapi.yaml
/users/{id}/rank-history:
  get:
    security:
      - bearerAuth: []
      - apiKey: []    # ADD this
```

**Workaround:** The bot can:
1. Use `/bot/users/{discordId}` to get current rank
2. Use `/bot/promotions/auto` to get recent promotions
3. Track promotion history in its own database
4. But cannot get full rank history without authentication workaround

**Impact:** Medium - Bot cannot easily access full rank history for users.

---

### 8. Promotion Attendance Counter on Decline

**Requirement:** When a non-auto promotion is declined by admin, reset the attendance counter baseline to current attendance (user must accumulate full requirement from this new baseline).

**Current State:**
- `POST /bot/promotions/{id}/decline` - Decline promotion ✅
- `POST /api/ranks/promotions/{id}/decline` - Admin decline promotion ✅
- `POST /api/ranks/bot/promotions/{id}/decline` - Bot decline promotion ✅
- **Attendance counter reset IS IMPLEMENTED** via existing decline endpoints ✅

**Status:** **RESOLVED - Using existing implementation**

The website already handles resetting the attendance counter when a promotion is declined. The admin decline endpoint sets `attendanceSinceLastRank: currentAttendance`, establishing a new baseline. The bot decline endpoint calls the decline logic which triggers this reset.

**Implementation Notes:**
- When a promotion is declined, the user's `attendanceSinceLastRank` is set to their current total attendance
- This means the user must accumulate the full rank requirement from this new baseline
- The bot simply needs to call the decline endpoint; the website handles the counter reset

**Bot Implementation:**
```csharp
// In PromotionApprovalScheduler
else if (action == "decline")
{
    // Call the decline endpoint - website resets attendance counter to current attendance
    await _apiClient.DeclinePromotionAsync(promotionId);
    
    await interaction.UpdateAsync(msg => msg.Embed = new EmbedBuilder()
        .WithTitle("DECLINED")
        .WithDescription("Promotion has been declined. Attendance counter has been reset to current attendance.")
        .WithColor(Color.Red)
        .Build()
        msg.Components = new ComponentBuilder().Build());
}
```

**Impact:** None - Feature works with existing implementation

---

### 9. Interactive Signup Buttons

**Requirement:** Users should have a button that shows "signup" when pressed, it gives the user a message that only they can see in the channel with more buttons to signup for each slot they are allowed to signup for.

**Current State:**
- Discord bot would need to create interactive messages with buttons
- API has `/bot/signups` for signing up ✅
- No API endpoint to get available slots for a user (considering training requirements, rank requirements, etc.)

**Problem:**
- Need to validate which slots a user can signup for based on:
  - Training requirements (already handled by API in signup endpoint)
  - Rank requirements (already handled by API in signup endpoint)
  - Available capacity
  - User's current signups
- Discord.NET supports buttons (Component framework)

**Missing API Endpoints:**
```
GET /bot/orbats/{orbatId}/available-slots/{userId}  // Get slots user can signup for
GET /bot/orbats/{orbatId}/available-slots          // Get all available slots with requirements
```

**Proposed Solution:**
1. Add endpoint to get available slots with requirement info:
```yaml
/bot/orbats/{orbatId}/signups/available:
  get:
    tags:
      - Bot
      - Signups
    summary: Get available slots for user with requirement info
    security:
      - apiKey: []
    parameters:
      - name: orbatId
        in: path
        required: true
        schema:
          type: integer
      - name: discordUserId
        in: query
        required: false
        schema:
          type: string
    responses:
      "200":
        description: Available slots with requirement info
        content:
          application/json:
            schema:
              type: object
              properties:
                orbatId:
                  type: integer
                slots:
                  type: array
                  items:
                    type: object
                    properties:
                      slotId:
                        type: integer
                      slotName:
                        type: string
                      squadName:
                        type: string
                      available:
                        type: boolean
                      requirements:
                        type: object
                        properties:
                          requiredTrainings:
                            type: array
                            items:
                              type: object
                              properties:
                                id:
                                  type: integer
                                name:
                                  type: string
                                userHas:
                                  type: boolean
                          requiredRanks:
                            type: array
                            items:
                              type: object
                              properties:
                                id:
                                  type: integer
                                name:
                                  type: string
                                userHas:
                                  type: boolean
```

**Workaround:** The bot can:
1. Get all slots for an ORBAT via `/bot/orbats/{id}`
2. Get user info via `/bot/users/discord/{discordId}`
3. Get user trainings via `/users/{id}/trainings` (but requires bearer auth, not bot auth)
4. Filter slots client-side based on available data
5. Create buttons for eligible slots

**Impact:** Medium - Requires client-side filtering which may be error-prone.

---

### 10. Attendance Status Selection

**Requirement:** User should be able to note if they are absent, late, goes early, or if they are unsure if they attend.

**Current State:**
- `POST /orbats/{id}/attendance` - Set ORBAT attendance (requires bearer auth) ❌
- `POST /bot/events` - Record attendance event (check-in/check-out) ✅
- No endpoint for user to set their own attendance status

**Problem:**
- The attendance endpoint requires user authentication (bearer token)
- Bot uses API key authentication
- No bot-specific endpoint for setting attendance status
- Need to distinguish between:
  - `absent` - User won't attend
  - `late` - User will be late
  - `gone_early` - User will leave early
  - `unsure` - User is unsure if they can attend

**Missing API Endpoints:**
```
POST /bot/orbats/{orbatId}/attendance  // Set attendance status for user
GET /bot/orbats/{orbatId}/attendance/{discordUserId}  // Get user's attendance status
```

**Proposed Solution:**
1. Add bot-specific attendance status endpoint:
```yaml
/bot/orbats/{orbatId}/attendance:
  post:
    tags:
      - Bot
      - Attendance
    summary: Set attendance status for a user
    security:
      - apiKey: []
    parameters:
      - name: orbatId
        in: path
        required: true
        schema:
          type: integer
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required:
              - discordUserId
              - status
            properties:
              discordUserId:
                type: string
              steamId:
                type: string
              status:
                type: string
                enum:
                  - present
                  - absent
                  - late
                  - gone_early
                  - unsure
                  - no_show
              notes:
                type: string
    responses:
      "200":
        description: Attendance status set
```

2. This should create or update an `OrbatAttendanceNote` record with the appropriate status:
```prisma
model OrbatAttendanceNote {
  // ... existing fields ...
  // status field already exists with types: absent, unsure, late_unsure
  // Need to add: late, gone_early, or expand the enum
}
```

**Workaround:** The bot can:
1. Use the existing `/bot/events` endpoint to record check-in/check-out
2. For absence notes, use the existing `/orbats/{id}/attendance-notes` endpoint (but requires bearer auth)
3. Create a bot-specific wrapper that handles authentication

**Impact:** High - This is a critical feature for user interaction.

---

### 11. Discord Role Synchronization for Ranks

**Requirement:** When a user is promoted (both auto and manual promotions), the bot should assign the corresponding Discord role for the new rank and remove/disable the old rank role. The nickname should update synchronously when the promotion is applied.

**Current State:**
- No API endpoint to notify bot of promotion events in real-time
- Bot must poll for promotions or use SSE streams
- `GET /bot/promotions/auto` - Get auto-promotions ✅
- `GET /bot/promotions/pending` - Get pending promotions ✅
- Promotion approve/decline endpoints exist ✅

**Problem:**
- No real-time notification when promotions are applied (auto or manual)
- Bot needs to know when to update Discord roles and nicknames
- No SSE stream for promotion events (only for promotion queue updates)

**Missing Features:**
1. SSE stream or webhook for promotion applied events
2. Endpoint to get recent promotions with full user details

**Proposed Solution:**
1. Add SSE stream for promotion events (for both auto and manual promotions):
```typescript
// In lib/realtime/promotion-events.ts - EXTEND
// Add new event type
export type PromotionEventType =
  | 'promotions.updated'  // Existing
  | 'promotion.applied';  // NEW - when promotion is actually applied (auto or manual)

// Add event publishing when promotion is applied
// This should be called in:
// - The auto-promotion logic (when auto-rankup runs)
// - The promotion approve endpoint (when admin approves)
export function publishPromotionAppliedEvent(userId: number, oldRankId: number, newRankId: number) {
  const event = {
    id: nextEventId(PROMOTIONS_CHANNEL),
    type: 'promotion.applied' as const,
    userId,
    oldRankId,
    newRankId,
    occurredAt: new Date().toISOString(),
  };
  publishToChannel(PROMOTIONS_CHANNEL, PROMOTIONS_SCOPE, event);
  return event;
}
```

2. Bot subscribes to this stream and updates Discord immediately for both auto and manual promotions:
```csharp
// Bot subscribes to SSE stream at /ranks/promotions/events
// When promotion.applied event is received, bot:
// 1. Updates user nickname with new rank
// 2. Assigns new Discord role
// 3. Removes old Discord role
// Works for BOTH auto and manual promotions
```

**Workaround:**
1. Bot periodically polls `/bot/promotions/auto?days=1` for recent auto-promotions
2. Bot also polls `/bot/promotions/pending` and tracks which have been approved (manual promotions)
3. On each poll, bot checks for both auto and manual promotions and updates Discord roles/nicknames
4. This adds latency (up to poll interval) but works for both promotion types

**Configuration Needed (Bot-side):**
```json
{
  "Discord": {
    "RankRoles": {
      "1": "123456789012345678",  // Private role ID
      "2": "234567890123456789",  // PFC role ID
      // Map website rank IDs to Discord role IDs
    }
  }
}
```

**Bot Implementation:**
```csharp
// UserSyncService.cs
public async Task HandlePromotionAppliedAsync(int userId, int oldRankId, int newRankId)
{
    // Get Discord user ID from database mapping
    var discordUserId = await _dbContext.UserDiscordMappings
        .Where(m => m.WebUserId == userId)
        .Select(m => m.DiscordUserId)
        .FirstOrDefaultAsync();
    
    if (discordUserId > 0)
    {
        await SyncUserAfterPromotionAsync(discordUserId, oldRankId, newRankId);
    }
}

private async Task SyncUserAfterPromotionAsync(ulong discordUserId, int oldRankId, int newRankId)
{
    var guild = await _discordClient.GetGuildAsync(_guildId);
    var member = await guild.GetUserAsync(discordUserId);
    
    if (member != null)
    {
        var webUser = await _apiClient.GetUserByDiscordId(discordUserId.ToString());
        if (webUser?.CurrentRank != null)
        {
            // Update nickname
            var nickname = $"[{webUser.CurrentRank.Abbreviation}] {webUser.Username}";
            await member.ModifyAsync(m => m.Nickname = nickname);
            
            // Remove old role
            if (_rankRoleMappings.TryGetValue(oldRankId, out var oldRoleId))
            {
                var oldRole = guild.GetRole(oldRoleId);
                if (oldRole != null)
                {
                    await member.RemoveRoleAsync(oldRole);
                }
            }
            
            // Add new role
            if (_rankRoleMappings.TryGetValue(newRankId, out var newRoleId))
            {
                var newRole = guild.GetRole(newRoleId);
                if (newRole != null)
                {
                    await member.AddRoleAsync(newRole);
                }
            }
        }
    }
}
```

**Impact:** Medium - Without real-time notifications, there's a delay in Discord role/nickname updates

---

### 12. Training Notification Settings

**Requirement:** The training system should have notification settings where users can turn on/off Discord notifications for general training announcements (not just for specific training requests).

**Current State:**
- `TrainingRequestSubscription` model exists with `discordEnabled` and `websiteEnabled` fields ✅
- `POST /training-requests/{id}/subscription` - Update subscription ✅
- `GET /training-requests/{id}/subscription` - Get subscription ✅
- **However:** These are tied to specific training REQUESTS, not general training notifications

**Problem:**
- These endpoints are for training REQUEST subscriptions, not general training notifications
- Need a way for users to control general training announcements (not just request-specific)

**Missing API Endpoints:**
```
GET /bot/users/{discordId}/training-notifications  // Get training notification settings
PUT /bot/users/{discordId}/training-notifications  // Set training notification settings
```

**Proposed Solution:**
1. Extend the `UserNotificationPreference` model (from #1) to include training notifications:
```prisma
model UserNotificationPreference {
  // ... existing fields ...
  trainingNotifications Boolean @default(false)
  // OR more granular:
  trainingScheduled Boolean @default(false)
  trainingUpdated Boolean @default(false)
  trainingCancelled Boolean @default(false)
}
```

2. Or add endpoints to the existing TrainingRequestSubscription model to handle general training notifications:
```yaml
/bot/users/{discordId}/training-notifications:
  get:
    tags:
      - Bot
      - Training
    summary: Get user training notification preferences
    security:
      - apiKey: []
    parameters:
      - name: discordId
        in: path
        required: true
        schema:
          type: string
    responses:
      "200":
        description: Training notification preferences
  put:
    tags:
      - Bot
      - Training
    summary: Set user training notification preferences
    security:
      - apiKey: []
    parameters:
      - name: discordId
        in: path
        required: true
        schema:
          type: string
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            properties:
              enabled:
                type: boolean
              types:
                type: array
                items:
                  type: string
                  enum:
                    - scheduled
                    - updated
                    - cancelled
    responses:
      "200":
        description: Preferences updated
```

**Workaround:** The bot can:
1. Use the existing TrainingRequestSubscription for request-specific notifications
2. Maintain its own database for general training notification preferences
3. Combine both approaches

**Impact:** Low - TrainingRequestSubscription partially covers this, workaround is feasible.

---

### 13. Discord Rank Role Mapping API

**Requirement:** Bot needs to fetch Discord role IDs for ranks from the web application instead of maintaining the mapping in bot configuration.

**Current State:**
- Rank-to-Discord-role mapping is currently documented to be in bot configuration
- No API endpoint exists to fetch these mappings
- Bot would need to maintain its own configuration

**Missing API Endpoint:**
```
GET /bot/ranks/discord-roles  // Get all rank-to-Discord-role mappings
```

**Proposed Solution:**
1. Add database model to store Discord role IDs for ranks:
```prisma
model RankDiscordRole {
  id        Int     @id @default(autoincrement())
  rankId    Int
  rank      Rank    @relation(fields: [rankId], references: [id], onDelete: Cascade)
  discordRoleId String  // Discord role ID (snowflake)
  guildId   String  // Discord guild/server ID
  isActive  Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@unique([rankId, guildId])
  @@index([guildId])
}
```

2. Add admin endpoint to manage mappings:
```
POST /admin/ranks/discord-roles  - Create/update rank-role mapping
GET /admin/ranks/discord-roles   - List all mappings
DELETE /admin/ranks/discord-roles/{id} - Remove mapping
```

3. Add bot endpoint for bot to fetch mappings:
```
GET /bot/ranks/discord-roles  - Get rank-to-Discord-role mappings (bot auth)
```

**Bot Implementation:**
```csharp
// Bot fetches mappings from API and caches them
var roleMappings = await _apiClient.GetDiscordRankRoleMappingsAsync();
// Returns: Dictionary<rankId, discordRoleId>
```

**Impact:** Medium - Without this endpoint, bot must maintain separate configuration

**Priority:** High

---

## Summary Table

| # | Feature | Current Status | Workaround | Impact | Priority |
|---|---------|---------------|------------|--------|----------|
| 1 | Notification Preferences | ⚠️ Partial | Use TrainingRequestSubscription + bot DB | Medium | High |
| 2 | Real-time Event Webhooks | ⚠️ SSE only | Use SSE streams | Medium | High |
| 3 | User Nickname Sync Data | ⚠️ Partial | Poll user data | Low | Medium |
| 4 | Training Announcement Redirection | ❌ Missing | Bot tracks messages | Low | Medium |
| 5 | Weekly ORBAT Query | ⚠️ Indirect | Filter in bot | Low | Low |
| 6 | Attendance by Date Query | ⚠️ Indirect | Filter in bot | Low | Low |
| 7 | Bot Rank History Access | ❌ Missing | Limited history | Medium | Medium |
| 8 | Promotion Attendance Counter | ✅ Implemented | None needed | None | N/A |
| 9 | Interactive Signup Buttons | ❌ Missing | Bot implements UI | Low | Medium |
| 10 | Attendance Status Selection | ❌ Missing | Bot DB | Medium | High |
| 11 | Discord Role Synchronization | ⚠️ Partial | Poll for promotions | Medium | High |
| 12 | Training Notification Settings | ⚠️ Partial | TrainingRequestSubscription + bot DB | Low | Medium |
| 13 | Discord Rank Role Mapping API | ❌ Missing | Bot maintains config | Medium | High |

---

## Recommended Implementation Priority

### Phase 1: High Priority (Required for Basic Functionality)
1. **Notification Preferences** - Without this, users cannot control notifications
2. **Real-time Event Webhooks** - Critical for immediate ORBAT announcements
3. **Interactive Signup Buttons** - Core user interaction feature
4. **Attendance Status Selection** - Core user interaction feature
5. **Discord Rank Role Mapping API** - Required for Discord role synchronization
6. **Discord Role Synchronization** - Required for proper rank display in Discord (depends on #5)

### Phase 2: Medium Priority (Improves Functionality)
7. **Bot Rank History Access** - Needed for proper promotion announcements
8. **User Nickname Sync SSE** - For real-time nickname updates
9. **Training Notification Settings** - User preference control
10. **Weekly ORBAT Query** - Optimization for announcements

### Phase 3: Low Priority (Nice to Have)
11. **Training Announcement Metadata** - Improves UX for training responses
12. **Attendance by Date Query** - Optimization

### Resolved (Already Implemented)
- **Promotion Attendance Counter** - ✅ Implemented on website side (resets counter to current attendance on decline)

---

## Implementation Notes

### For API Developers

When implementing these missing features:

1. **Follow existing patterns:**
   - Use the same authentication scheme (API key for bot endpoints)
   - All `/bot/*` endpoints require a bot token created by `system:super_admin`
   - Use consistent response formats
   - Follow the existing error handling patterns
   - Use the same database models and relations

2. **Security considerations:**
   - Bot endpoints should use `X-BOT-API-TOKEN` header authentication
   - Bot tokens can ONLY be created by users with `system:super_admin` permission
   - Sensitive data should be protected
   - Rate limiting may be needed for public endpoints

3. **Documentation:**
   - Update the OpenAPI spec with new endpoints
   - Add examples for bot developers
   - Document webhook formats if implemented

### For Bot Developers

When working around missing features:

1. **Maintain your own state:**
   - Use SQLite or similar for bot-specific data
   - Cache API responses to minimize calls
   - Sync with API data periodically

2. **Use available SSE streams:**
   - Connect to `/orbats/events` for ORBAT changes
   - Connect to `/users/events` for user changes (if available)
   - Handle connection drops gracefully

3. **Poll strategically:**
   - Poll for user data on user join/leave
   - Poll for ORBAT data on schedule
   - Use caching to avoid excessive API calls

4. **Handle errors gracefully:**
   - Retry transient failures
   - Log errors for debugging
   - Provide user feedback when appropriate

---

## Open Questions

1. **Should the API push to bots or should bots pull?**
   - **Decision:** Hybrid solution
   - Use **push** (webhooks) for event-based notifications like ORBAT created, promotion applied
   - Use **pull** (SSE/polling) for time-based queries like "is there an ORBAT this week"
   - Recommendation: Support both (SSE for real-time events, webhooks for immediate push notifications, polling for scheduled queries)

2. **Should notification preferences be stored in the API or bot?**
   - **Decision:** Preferences are stored in the API
   - This ensures consistency across multiple bots and allows users to manage preferences from the website
   - Recommendation: API storage with bot endpoints to access them

3. **Should bot tokens be restricted to specific servers?**
   - **Decision:** NOT NEEDED
   - Since there's only ever going to be 1 production server, and the dev server runs on a different database, guild ID restrictions are not necessary
   - Recommendation: Skip this feature - not needed for current use case

---

## Appendix A: Proposed Database Changes

```prisma
// 1. Notification Preferences
model UserNotificationPreference {
  id            Int      @id @default(autoincrement())
  userId        Int
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  discordUserId String?  @unique
  
  orbatAnnouncements     Boolean @default(false)
  trainingAnnouncements   Boolean @default(false)
  promotionAnnouncements  Boolean @default(false)
  trainingReminders       Boolean @default(false)
  
  dmEnabled      Boolean @default(true)
  mentionEnabled Boolean @default(false)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@unique([userId])
  @@index([discordUserId])
}

// 2. Bot Webhooks
model BotWebhook {
  id          Int      @id @default(autoincrement())
  name        String
  url         String
  events      String[] // e.g., ["orbat.created", "promotion.approved"]
  secret      String?
  isActive    Boolean  @default(true)
  createdBy   User?    @relation(fields: [createdById], references: [id])
  createdById Int?
  createdAt   DateTime @default(now())
  lastCalled  DateTime?
  callCount   Int      @default(0)
  lastError   String?
  
  @@index([isActive])
  @@index([createdById])
}

// 3. Add to BotToken for server restrictions
model BotToken {
  // ... existing fields ...
  allowedGuildIds String[] @default([])  // Discord guild IDs
}

// 4. Add to Message for training announcements
model Message {
  // ... existing fields ...
  isTrainingAnnouncement Boolean @default(false)
  trainingRequestId    Int?
}

// 5. Add user rank change to User model or separate model
model UserRankHistory {
  // ... existing model ...
  // Ensure bot can access it via API key auth
}

// 6. Add RankDiscordRole model for Discord role synchronization
model RankDiscordRole {
  id        Int     @id @default(autoincrement())
  rankId    Int
  rank      Rank    @relation(fields: [rankId], references: [id], onDelete: Cascade)
  discordRoleId String  // Discord role ID (snowflake)
  guildId   String  // Discord guild/server ID
  isActive  Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@unique([rankId, guildId])
  @@index([guildId])
}
```

## Appendix B: Proposed API Endpoints

```yaml
# Notification Preferences
/bot/notifications/preferences/{discordId}:
  get:
    tags:
      - Bot
      - Notifications
    summary: Get user notification preferences
    security:
      - apiKey: []  # Requires bot token created by system:super_admin
    parameters:
      - name: discordId
        in: path
        required: true
        schema:
          type: string
    responses:
      "200":
        description: User notification preferences
  post:
    tags:
      - Bot
      - Notifications
    summary: Set user notification preferences
    security:
      - apiKey: []
    parameters:
      - name: discordId
        in: path
        required: true
        schema:
          type: string
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            properties:
              orbatAnnouncements:
                type: boolean
              trainingAnnouncements:
                type: boolean
              promotionAnnouncements:
                type: boolean
              dmEnabled:
                type: boolean
    responses:
      "200":
        description: Preferences updated

# Bot Webhooks
/admin/bot-webhooks:
  get:
    tags:
      - Admin
      - Bot
    summary: List bot webhooks
    security:
      - bearerAuth:
          - system:super_admin
    responses:
      "200":
        description: List of webhooks
  post:
    tags:
      - Admin
      - Bot
    summary: Create bot webhook
    security:
      - bearerAuth:
          - system:super_admin
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required:
              - name
              - url
            properties:
              name:
                type: string
              url:
                type: string
                format: uri
              events:
                type: array
                items:
                  type: string
              secret:
                type: string
    responses:
      "201":
        description: Webhook created

/admin/bot-webhooks/{id}:
  delete:
    tags:
      - Admin
      - Bot
    summary: Delete bot webhook
    security:
      - bearerAuth:
          - system:super_admin
    responses:
      "200":
        description: Webhook deleted

# ORBAT by Date
/bot/orbats/by-date:
  get:
    tags:
      - Bot
      - ORBATs
    summary: Get ORBATs by date range
    security:
      - apiKey: []
    parameters:
      - name: start
        in: query
        schema:
          type: string
          format: date
      - name: end
        in: query
        schema:
          type: string
          format: date
    responses:
      "200":
        description: ORBATs in date range

# Weekly ORBATs
/bot/orbats/week:
  get:
    tags:
      - Bot
      - ORBATs
    summary: Get ORBATs for a specific week
    security:
      - apiKey: []
    parameters:
      - name: year
        in: query
        schema:
          type: integer
      - name: week
        in: query
        schema:
          type: integer
    responses:
      "200":
        description: ORBATs for the week

# Bot User Rank History
/bot/users/{id}/rank-history:
  get:
    tags:
      - Bot
      - Users
      - Ranks
    summary: Get user rank history
    security:
      - apiKey: []
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: integer
    responses:
      "200":
        description: User rank history

# Discord Rank Role Mappings
/bot/ranks/discord-roles:
  get:
    tags:
      - Bot
      - Ranks
    summary: Get all rank-to-Discord-role mappings
    security:
      - apiKey: []
    responses:
      "200":
        description: Dictionary of rankId to discordRoleId mappings
        content:
          application/json:
            schema:
              type: object
              additionalProperties:
                type: string
                format: snowflake
                description: Discord role ID

---

*Document Version: 1.3*
*Last Updated: 2026-07-29*
*Author: 6MD Development Team*

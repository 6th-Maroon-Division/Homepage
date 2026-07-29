# 6MD Discord Bot Design Document

## Overview

This document describes the design for a C# .NET 10 Discord bot that integrates with the 6MD Management Platform API to provide automated announcements, user management, and attendance tracking for the 6th Maroon Division Discord server.

### Purpose

The bot serves as the primary integration point between the Discord server and the web application, providing:
- Automated ORBAT announcements
- User signup management for operation slots
- Attendance compilation
- Training and promotion notifications
- Discord nickname synchronization with web ranks and usernames

### Target Environment

- **Language**: C# .NET 10
- **Platform**: External application (not part of the web app)
- **Deployment**: Single production server + test server for development
- **Discord Library**: Discord.NET (recommended)

### Clarification
As per user specification: "another information the updating of the username should be done in discord" - this means the bot should update the Discord server **nickname** (display name within the server), not the Discord username (which users control themselves).

**Additional Requirements:**
1. Admins should approve non-auto promotions in an admin-only channel; if declined, reset attendance counter to current attendance (using existing implementation)
2. Interactive signup button that shows a private message with slot selection buttons
3. Attendance status buttons (absent, late, goes early, unsure)
4. Training notification settings (toggle Discord notifications)
5. Discord role synchronization - when promotion is applied (both auto and manual), assign new rank role and remove old rank role
6. Nickname should update synchronously when promotion is applied (both auto and manual)
7. ORBAT announcements must include a direct link to the ORBAT on the website
8. Prevent double signups - Discord signups must update website signups (and vice versa) to maintain a single source of truth
9. Rank-to-Discord-role mapping is managed in the web application (not in bot config), bot fetches mappings from `/bot/ranks/discord-roles`

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Discord Bot Application                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│  │  Schedulers  │    │   Commands   │    │   Services   │     │
│  │              │    │              │    │              │     │
│  │ - ORBAT      │    │ - signup     │    │ - API        │     │
│  │   Announce   │    │ - training   │    │   Client     │     │
│  │ - Attendance │    │ - notify    │    │ - User      │     │
│  │   Compile   │    │ - nickname   │    │   Sync       │     │
│  │ - Training   │    │              │    │ - Message    │     │
│  │   Reminder  │    │              │    │   Handler    │     │
│  └──────────────┘    └──────────────┘    └──────────────┘     │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Discord.NET Client                        ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 6MD Management Platform API                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │  /bot/*     │  │  /orbats    │  │ /ranks/p... │               │
│  │  /users    │  │  /signups   │  │ /promotions │               │
│  │  /events   │  │  /attendance│  │             │               │
│  └─────────────┘  └─────────────┘  └─────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### Project Structure

```
6MD-DiscordBot/
├── src/
│   ├── Config/
│   │   ├── AppConfig.cs          # Configuration model
│   │   └── ConfigLoader.cs       # Configuration loading
│   ├── Services/
│   │   ├── ApiClient.cs          # API client wrapper
│   │   ├── OrbatService.cs       # ORBAT-related operations
│   │   ├── SignupService.cs      # Signup management
│   │   ├── AttendanceService.cs  # Attendance compilation
│   │   ├── PromotionService.cs   # Promotion handling
│   │   ├── TrainingService.cs     # Training notifications
│   │   ├── UserSyncService.cs    # Discord-Web user sync
│   │   └── NotificationService.cs# Notification management
│   ├── Schedulers/
│   │   ├── OrbatAnnouncementScheduler.cs
│   │   ├── AttendanceCompilationScheduler.cs
│   │   └── TrainingReminderScheduler.cs
│   ├── Commands/
│   │   ├── SignupCommands.cs
│   │   ├── TrainingCommands.cs
│   │   ├── PromotionCommands.cs
│   │   └── AdminCommands.cs
│   ├── Handlers/
│   │   ├── MessageHandler.cs     # Message response handling
│   │   └── TrainingResponseHandler.cs
│   ├── Models/
│   │   ├── ApiModels/            # API request/response models
│   │   └── BotModels/            # Bot-specific models
│   └── Program.cs                # Entry point
├── appsettings.json
├── appsettings.Development.json
└── 6MD-DiscordBot.csproj
```

---

## Configuration

**IMPORTANT:** The bot API token can ONLY be created by a user with `system:super_admin` permission in the web application. All `/bot/*` endpoints require this token for authentication.

### Required Configuration Values

```json
{
  "Discord": {
    "Token": "<discord-bot-token>",
    "GuildId": "<main-server-id>",
    "TestGuildId": "<test-server-id>",
    "CommandPrefix": "!",
    "AdminRoleId": "<admin-role-id>",
    "AdminChannelId": "<admin-only-channel-id>",
    "TrainingChatChannelId": "<training-chat-channel-id>",
    "AnnouncementChannelId": "<announcements-channel-id>"
  },
  "Api": {
    "BaseUrl": "https://orbat.6md.net/api",
    "BotToken": "<bot-api-token-from-admin>",
    "TimeoutSeconds": 30
  },
  "Schedulers": {
    "AttendanceCompileTime": "01:00:00"
  },
  "FeatureFlags": {
    "EnableAutoNicknameSync": true,
    "EnableTrainingNotifications": true,
    "EnablePromotionAnnouncements": true
  }
}
```

### Environment Variables

- `DISCORD_TOKEN`: Discord bot token
- `API_BASE_URL`: Base URL for the 6MD API
- `BOT_API_TOKEN`: Bot API token (from admin panel) - **Must be created by a user with `system:super_admin` permission**
- `ENVIRONMENT`: Production or Development

---

## Features and Implementation

### 0. Admin Promotion Approval

**Requirement:** Admins should be asked for promotions that are NOT marked as auto in a separate Discord channel that only users with the admin role can see. If approved, promote the user. If not approved, reset the attendance counter to current attendance (user must accumulate full requirement from new baseline).

**Implementation:**
- Bot listens for pending promotions via `/bot/promotions/pending`
- Sends notification to **admin-only channel** with approve/decline buttons
- Channel is restricted to users with Discord admin role
- On approve: calls `/bot/promotions/{id}/approve`
- On decline: calls `/bot/promotions/{id}/decline` AND increments attendance counter

**Configuration:**
```json
{
  "Discord": {
    "AdminChannelId": "<admin-only-channel-id>",
    "AdminRoleId": "<admin-role-id>"
  }
}
```

**API Endpoints Used:**
- `GET /bot/promotions/pending` - List pending promotions
- `POST /bot/promotions/{id}/approve` - Approve promotion
- `POST /bot/promotions/{id}/decline` - Decline promotion

**Attendance Counter Behavior on Decline:**
- Attendance counter reset on promotion decline is implemented on the website side via API
- Bot simply calls `/bot/promotions/{id}/decline` and the website resets `attendanceSinceLastRank` to current attendance
- User must then accumulate the full rank requirement from this new baseline

**Discord Role Synchronization:**
- When promotion is applied (auto or manual), bot assigns new Discord role and removes old rank role
- Rank-to-Discord-role mapping is managed in the web application, NOT in bot configuration
- Bot fetches role mappings from the API via `/bot/ranks/discord-roles` endpoint

**Discord Integration:**
- Admin-only channel with restricted permissions
- Notification message with action buttons visible only to admins
- On approve: 
  - Calls `/bot/promotions/{id}/approve` API
  - **Synchronously** updates user nickname with new rank
  - **Synchronously** assigns new Discord role for the rank
  - **Synchronously** removes old rank role
- On decline: calls `/bot/promotions/{id}/decline` (website resets attendance counter to current attendance)
- Confirmation message on action
- Error handling for non-admin users attempting to interact

**Synchronous Update Flow (for BOTH auto and manual promotions):**
```
User promoted on website (auto or manual) → API event triggered → Bot receives notification → 
Bot updates Discord nickname → Bot assigns new role → Bot removes old role
```

**Note:** The attendance counter reset on decline is already implemented on the website side, so the bot only needs to call the decline endpoint.

---

### 1. ORBAT Announcements

**Requirement:** Announce new ORBATs on Monday when one is already created or as soon as a new ORBAT for that week is available. The announcement must include a direct link to the ORBAT on the website.

**Implementation:**
- Scheduler checks for new ORBATs on Monday at configured time
- Also listens to SSE stream `/orbats/events` for immediate announcements
- Falls back to polling every hour
- Tracks announced ORBATs to avoid duplicates
- Constructs website URL for each ORBAT (e.g., `https://orbat.6md.net/orbats/{orbatId}`)

**API Endpoints Used:**
- `GET /bot/orbats?includePast=false&limit=10`
- SSE: `/orbats/events` (for real-time notifications)

---

### 2. User Signup for Slots

**Requirement:** Allow users to signup for each slot using Discord commands with their Discord ID. Must prevent double signups by synchronizing with website signups.

**Command:** `!signup <orbat-id> [slot-id]`

**Implementation:**
- Validates user has linked Discord account on website
- Checks if user is already signed up for this ORBAT via `/bot/orbats/{id}/signups` or `/bot/users/discord/{discordId}/signups`
- If not already signed up: calls `/bot/signups` to create signup on website
- If already signed up: informs user and provides option to change slot or cancel
- Provides confirmation or error feedback
- Discord signup automatically updates website signup (single source of truth)

**Preventing Double Signups:**
- Bot checks website for existing signup before creating new one
- All signups (Discord and website) are stored in the same database via the API
- Discord commands and website signup form use the same `/bot/signups` endpoint
- Bot tracks Discord signups and website signups as the same entity

**API Endpoints Used:**
- `POST /bot/signups` - Create signup (used by both Discord bot and website)
- `GET /bot/orbats/{id}/signups` - Get all signups for an ORBAT (to check for duplicates)
- `GET /bot/users/discord/{discordId}` - Get user info and validate Discord link
- `GET /bot/orbats/{id}` - Get ORBAT details

---

### 3. Attendance Compilation

**Requirement:** Run compile attendance at 1am UTC from the previous day.

**Implementation:**
- Scheduler runs daily at 01:00 UTC
- Queries for ORBATs from previous day
- Calls `/bot/attendance/compile` for each relevant ORBAT
- Handles errors gracefully

**API Endpoints Used:**
- `POST /bot/attendance/compile`
- `GET /bot/orbats?includePast=true&limit=100`

---

### 4. Training and ORBAT Notifications

**Requirement:** Send notifications for training and ORBATs when user subscribes. Announce when user selects to receive Discord notifications.

**Implementation:**
- Users opt-in via `!notify <type> on/off` command
- Bot maintains notification preferences in SQLite database
- Sends DMs or channel mentions based on preference
- Announces subscription changes

**API Endpoints Used:**
- None (bot maintains own preference store)
- Training data from `/trainings` for content

---

### 5. Training Announcement Responses

**Requirement:** Allow users to answer to training announcements, with responses redirected to the training chat.

**Implementation:**
- Bot tracks which messages are training announcements
- Listens for replies to those messages
- Redirects reply content to training chat channel
- Optionally deletes original response

**API Endpoints Used:**
- None (pure Discord functionality)

---

### 6. Discord Nickname Synchronization

**Requirement:** Update Discord server **nickname** with rank prefix and website username.

**Implementation:**
- Periodic sync (hourly) for all users
- Sync on user join
- Uses format: `[RankAbbreviation] Username`
- Requires `ManageNicknames` permission

**API Endpoints Used:**
- `GET /bot/users/discord/{discordId}`
- `GET /bot/users`

---

### 7. Promotion Announcements

**Requirement:** Announce promotions to users (both auto and manual).

**Implementation:**
- Periodic check (every 5 minutes) for new promotions
- Uses `/bot/promotions/auto` for auto-promotions
- Uses `/bot/promotions/pending` for manual promotions (handled via admin approval in separate admin-only channel)
- Tracks announced promotions to avoid duplicates
- Posts rich embed in announcements channel
- **For both auto and manual promotions:** Triggers synchronous Discord nickname and role update

**API Endpoints Used:**
- `GET /bot/promotions/auto?days=1`
- `GET /bot/promotions/pending`

**Note:** Both auto and manual promotions trigger the same synchronous Discord update (nickname + role).

---

### 8. Interactive Signup System

**Requirement:** Users should have a button that shows "signup" when pressed, it gives the user a message that only they can see in the channel with more buttons to signup for each slot they are allowed to signup for. Must prevent double signups.

**Implementation:**
- ORBAT announcement includes "Signup" button (with direct link to website ORBAT)
- Clicking button shows ephemeral message with available slot buttons
- Bot first checks `/bot/orbats/{id}/signups` to see if user is already signed up
- If already signed up: shows current signup and offers change/cancel options
- If not signed up: bot filters slots based on user eligibility (training, rank, capacity)
- Each slot button signs user up via `/bot/signups` when clicked
- Signup is stored in the same database used by the website (single source of truth)

**API Endpoints Used:**
- `POST /bot/signups` - Sign up for slot (shared with website)
- `GET /bot/orbats/{id}/signups` - Check existing signups for ORBAT
- `GET /bot/orbats/{id}` - Get ORBAT details
- `GET /bot/users/discord/{discordId}` - Get user info and verify eligibility

**Workaround:** Bot filters slots client-side using data from existing endpoints. Double signup prevention via checking existing signups before creating new ones.

---

### 9. Attendance Status Buttons

**Requirement:** User should be able to note if they are absent, late, goes early, or if they are unsure if they attend.

**Implementation:**
- Command: `!attendance <orbat-id>`
- Shows ephemeral message with status buttons (Present, Absent, Late, Leave Early, Unsure)
- Bot stores status in its own database (until API endpoint is available)
- Status is used for attendance tracking

**API Endpoints Used:**
- None currently (workaround uses bot's own database)

**Future:** When `/bot/orbats/{orbatId}/attendance` endpoint is available, bot will use it.

---

### 10. Training Notification Settings

**Requirement:** Users should be able to turn on/off Discord notifications for training.

**Implementation:**
- Command: `!notify training on|off`
- Bot updates notification preference in database
- Uses TrainingRequestSubscription for request-specific notifications
- Uses bot's own tracking for general training notifications

**API Endpoints Used:**
- `GET /bot/users/discord/{discordId}` - Get user info
- `GET/POST /training-requests/{id}/subscription` - For request-specific notifications

---

## Service Design

### API Client (IApiClient)

Wrapper for all API communications with error handling, retries, and logging.

**Key Methods:**
```csharp
Task<Orbat> GetOrbatByIdAsync(int orbatId)
Task<SignupResult> SignupForOrbatAsync(int orbatId, string discordUserId, int? slotId)
Task<AttendanceCompilationResult> CompileAttendanceAsync(int orbatId)
Task<User> GetUserByDiscordIdAsync(string discordUserId)
Task<AutoPromotionResult> GetAutoPromotionsAsync(int days, int limit)
Task<Dictionary<int, ulong>> GetDiscordRankRoleMappingsAsync()  // Fetches rank-to-Discord-role mappings from web app
```

### Notification Service

Manages notification preferences and delivery.

**Features:**
- Toggle notification types (training, orbat, promotion)
- Send DMs or channel mentions
- Track preferences in SQLite

### User Sync Service

Synchronizes Discord nicknames and roles with web data.

**Features:**
- Periodic bulk sync (hourly)
- Sync on user join
- Sync on promotion (immediate, for both auto and manual promotions)
- Format: `[Rank] Username` for nickname
- Assigns Discord role based on rank
- Removes old rank role when promoted (both auto and manual)

**Implementation:**
```csharp
public class UserSyncService : BackgroundService
{
    private readonly IApiClient _apiClient;
    private readonly IDiscordClient _discordClient;
    private readonly IConfiguration _config;
    private Dictionary<int, ulong> _rankRoleMappings;
    private DateTime _lastRoleMappingSync = DateTime.MinValue;
    private readonly TimeSpan _roleMappingCacheDuration = TimeSpan.FromHours(1);
    
    public UserSyncService(IApiClient apiClient, IDiscordClient discordClient, IConfiguration config)
    {
        _apiClient = apiClient;
        _discordClient = discordClient;
        _config = config;
    }
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await SyncAllUsers();
            await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
        }
    }
    
    // Fetch rank-to-Discord-role mappings from the web API
    private async Task<Dictionary<int, ulong>> GetRankRoleMappingsAsync()
    {
        // Use cached mappings if still valid
        if (DateTime.UtcNow - _lastRoleMappingSync < _roleMappingCacheDuration && _rankRoleMappings != null)
        {
            return _rankRoleMappings;
        }
        
        // Fetch fresh mappings from API
        _rankRoleMappings = await _apiClient.GetDiscordRankRoleMappingsAsync();
        _lastRoleMappingSync = DateTime.UtcNow;
        return _rankRoleMappings;
    }
    
    public async Task SyncUserAsync(ulong discordUserId)
    {
        var webUser = await _apiClient.GetUserByDiscordId(discordUserId.ToString());
        if (webUser == null || webUser.CurrentRank == null) return;
        
        var guild = await _discordClient.GetGuildAsync(ulong.Parse(_config["Discord:GuildId"]));
        var member = await guild.GetUserAsync(discordUserId);
        
        if (member != null)
        {
            // Update nickname
            var nickname = $"[{webUser.CurrentRank.Abbreviation}] {webUser.Username}";
            await member.ModifyAsync(m => m.Nickname = nickname);
            
            // Update roles - fetch mappings from API
            var roleMappings = await GetRankRoleMappingsAsync();
            await UpdateRankRole(member, webUser.CurrentRank.Id, roleMappings);
        }
    }
    
    private async Task UpdateRankRole(IGuildUser member, int newRankId, Dictionary<int, ulong> roleMappings)
    {
        // Get all rank roles from API mappings
        var allRankRoleIds = roleMappings.Values.ToList();
        
        // Remove all existing rank roles from user
        var rolesToRemove = member.RoleIds.Where(r => allRankRoleIds.Contains(r)).ToList();
        if (rolesToRemove.Any())
        {
            await member.RemoveRolesAsync(rolesToRemove.Select(r => guild.GetRole(r)));
        }
        
        // Add new rank role if mapping exists
        if (roleMappings.TryGetValue(newRankId, out var newRoleId))
        {
            var role = guild.GetRole(newRoleId);
            if (role != null)
            {
                await member.AddRoleAsync(role);
            }
        }
    }
    
    // Called when promotion is applied (auto or manual)
    public async Task SyncUserAfterPromotionAsync(ulong discordUserId, int oldRankId, int newRankId)
    {
        var guild = await _discordClient.GetGuildAsync(ulong.Parse(_config["Discord:GuildId"]));
        var member = await guild.GetUserAsync(discordUserId);
        
        if (member != null)
        {
            var webUser = await _apiClient.GetUserByDiscordId(discordUserId.ToString());
            if (webUser != null && webUser.CurrentRank != null)
            {
                // Update nickname with new rank
                var nickname = $"[{webUser.CurrentRank.Abbreviation}] {webUser.Username}";
                await member.ModifyAsync(m => m.Nickname = nickname);
                
                // Fetch fresh role mappings and update roles
                var roleMappings = await GetRankRoleMappingsAsync();
                await UpdateRankRole(member, newRankId, roleMappings);
            }
        }
    }
}
```

### Schedulers

Background services for time-based operations:
- `OrbatAnnouncementScheduler` - Monday announcements + real-time
- `AttendanceCompilationScheduler` - Daily at 01:00 UTC
- `PromotionAnnouncementScheduler` - Every 5 minutes

---

## Database (Bot-Specific)

SQLite database for bot state:

```csharp
// User notification preferences
public class UserPreference
{
    [Key] public ulong DiscordUserId { get; set; }
    public bool TrainingNotifications { get; set; }
    public bool OrbatNotifications { get; set; }
    public bool PromotionNotifications { get; set; }
}

// Track announced ORBATs
public class AnnouncedOrbat
{
    [Key] public int OrbatId { get; set; }
    public DateTime AnnouncedAt { get; set; }
}

// Track announced promotions
public class AnnouncedPromotion
{
    [Key] public int PromotionId { get; set; }
    public DateTime AnnouncedAt { get; set; }
}
```

---

## Discord Integration

### Commands

| Command | Description | Example |
|---------|-------------|---------|
| `!signup <orbat> [slot]` | Sign up for ORBAT | `!signup 123` |
| `!signup list <orbat>` | List ORBAT slots | `!signup list 123` |
| `!orbats [limit]` | List upcoming ORBATs | `!orbats 5` |
| `!notify <type> on\|off` | Toggle notifications | `!notify training on` |
| `!attendance <orbat>` | Set attendance status | `!attendance 123` |
| `!promotions` | List pending promotions | `!promotions` |
| `!whois [user]` | Get user info | `!whois @User` |
| `!help [cmd]` | Show help | `!help signup` |

**Admin Commands:**
| Command | Description | Example |
|---------|-------------|---------|
| `!admin sync` | Sync all nicknames | `!admin sync` |
| `!admin promote approve <id>` | Approve promotion | `!admin promote approve 456` |
| `!admin promote decline <id>` | Decline promotion | `!admin promote decline 456` |

### Required Permissions

**Bot Permissions:**
- Send Messages
- Embed Links
- Read Message History
- Manage Nicknames
- Use External Emojis
- Add Reactions
- Read Messages

**Intents:**
- Guilds
- GuildMessages
- GuildMessageReactions
- GuildMembers

---

## Deployment

### Production
- Build: `dotnet publish -c Release`
- Deploy to server with .NET 10 runtime
- Configure as systemd service
- Set environment variables

### Development
- Run locally: `dotnet run`
- Use test Discord guild
- Use development API endpoint

### Docker

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish -c Release -o /app
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "6MD-DiscordBot.dll"]
```

---

## Dependencies

**NuGet Packages:**
- Discord.Net.Core
- Discord.Net.Commands
- Discord.Net.Rest
- Microsoft.Extensions.DependencyInjection
- Microsoft.Extensions.Http
- Microsoft.Extensions.Logging
- Microsoft.EntityFrameworkCore
- Microsoft.EntityFrameworkCore.Sqlite

---

## Error Handling

- API errors: Retry with exponential backoff
- Discord errors: Handle rate limits, reconnect
- Bot errors: Log, notify, restart services
- Graceful degradation for partial failures

---

## Security

- Store tokens securely (environment variables)
- Never commit secrets to source control
- Use HTTPS for API communications
- Respect user privacy preferences
- Comply with Discord data policies
- **Bot API tokens can ONLY be created by users with `system:super_admin` permission**

---

## Message Formats

### ORBAT Announcement
```
:loudspeaker: NEW ORBAT: {Name} :loudspeaker:

Date: {Date}
Time: {StartTime} - {EndTime} UTC
View on website: https://orbat.6md.net/orbats/{OrbatId}
Signups: !signup {OrbatId}

{Description}

Available Slots: {SlotInfo}
```

### Promotion Announcement
```
:tada: PROMOTION: {Username} :tada:

From: {PreviousRank}
To: {NewRank}

Congratulations! :clap:
```

---

*Document Version: 1.2*
*Last Updated: 2026-07-29*
*Author: 6MD Development Team*

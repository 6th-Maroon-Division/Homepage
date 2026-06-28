# Discord Bot Integration Guide

This document provides comprehensive guidance for integrating a C# Discord bot with the 6MD Management Platform API for attendance tracking and promotion handling.

## Overview

The 6MD Management Platform provides a RESTful API with **bot-specific endpoints** that allow external Discord bots to:

- **Track Attendance**: Record user check-ins and check-outs for operations using **both Steam ID and Discord ID**
- **Manage Promotions**: Approve/decline pending promotion proposals
- **Query User Data**: Lookup users by Discord ID or Steam ID
- **Access ORBAT Information**: Get operation details and signup lists

## Authentication

All bot endpoints require API key authentication using the `BOT_API_TOKEN` environment variable.

### Authentication Header

```http
Authorization: Bearer YOUR_BOT_API_TOKEN
```

### Environment Setup

1. Set the `BOT_API_TOKEN` in your web application's `.env` file:
   ```env
   BOT_API_TOKEN=your_secure_random_token_here
   ```

2. Configure your C# bot with the same token.

## Base URL

- **Development**: `http://localhost:3000/api`
- **Production**: `https://your-domain.com/api`

---

## API Endpoints

### Bot-Specific Endpoints

#### Attendance Tracking

**🎯 Record Attendance**
- **Endpoint**: `POST /api/bot/attendance`
- **Purpose**: Submit check-in/check-out times for users
- **✅ Supports Both Steam ID and Discord ID**

**Request Body**:
```json
{
  "steamId": "76561198123456789",
  "discordUserId": "123456789012345678", 
  "checkinTime": "2026-01-15T18:30:00Z",
  "checkoutTime": "2026-01-15T23:30:00Z",
  "orbatId": 123,
  "notes": "Auto-recorded via Discord bot"
}
```

**Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `steamId` | string | ❌ Optional | Steam64 ID - Primary lookup |
| `discordUserId` | string | ❌ Optional | Discord user ID - Fallback lookup |
| `checkinTime` | string | ❌ Optional | ISO 8601 timestamp |
| `checkoutTime` | string | ❌ Optional | ISO 8601 timestamp |
| `orbatId` | number | ❌ Optional | Specific ORBAT ID (auto-detected by date if omitted) |
| `notes` | string | ❌ Optional | Additional notes |

**⚠️ Requirements**:
- At least one of `steamId` or `discordUserId` is required
- At least one of `checkinTime` or `checkoutTime` is required

**🔍 Behavior**:
1. If `steamId` is provided → tries to find user by Steam ID first
2. If not found and `discordUserId` is provided → tries Discord ID
3. If `orbatId` is not provided → automatically finds ORBAT by date
4. Validates that user is signed up for the ORBAT
5. Creates or updates attendance session
6. Calculates attendance status based on time present

**Response**:
```json
{
  "success": true,
  "message": "Attendance recorded",
  "userId": 42,
  "username": "PlayerName", 
  "orbatId": 123,
  "orbatName": "Operation Storm"
}
```

#### User Management

**👥 List All Users**
- **Endpoint**: `GET /api/bot/users`
- **Query Parameters**:
  - `activeOnly=true` - Filter to non-retired users only
  - `hasDiscord=true` - Filter to users with Discord accounts
  - `hasSteam=true` - Filter to users with Steam accounts

**Response**:
```json
{
  "success": true,
  "users": [
    {
      "id": 42,
      "username": "PlayerName",
      "email": "player@example.com",
      "avatarUrl": "https://cdn.discordapp.com/avatars/...",
      "isRetired": false,
      "currentRank": {
        "id": 5,
        "name": "Private",
        "abbreviation": "Pvt"
      },
      "discordId": "123456789012345678",
      "steamId": "76561198123456789",
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ],
  "total": 50
}
```

**🔍 Get User by Discord ID**
- **Endpoint**: `GET /api/bot/users/discord/{discordId}`
- **Response**: Single user object with all linked accounts

**🎮 Get User by Steam ID**
- **Endpoint**: `GET /api/bot/users/steam/{steamId}`
- **Response**: Single user object with all linked accounts

#### ORBAT Information

**📋 List ORBATs**
- **Endpoint**: `GET /api/bot/orbats`
- **Query Parameters**:
  - `limit=10` - Maximum number of ORBATs to return (default: 10)
  - `includePast=true` - Include past operations

**Response**: Array of ORBATs with squad/slot structure and signups (includes Discord IDs and Steam IDs)

**📄 Get Specific ORBAT**
- **Endpoint**: `GET /api/bot/orbats/{id}`
- **Response**: Detailed ORBAT with all signups and Discord/Steam IDs

#### Promotion Management

**🏆 List Pending Promotions**
- **Endpoint**: `GET /api/ranks/bot/promotions`
- **Response**: Array of pending promotion proposals

**✅ Approve Promotion**
- **Endpoint**: `POST /api/ranks/bot/promotions/approve`
- **Request Body**:
  ```json
  {
    "proposalId": 456,
    "discordActorId": "123456789012345678"
  }
  ```

**❌ Decline Promotion**
- **Endpoint**: `POST /api/ranks/bot/promotions/{id}/decline`
- **Request Body**:
  ```json
  {
    "reason": "Needs more training",
    "discordActorId": "123456789012345678"
  }
  ```

---

## C# Client Implementation

### Complete C# Client Library

#### 1. Models (OrbatBotModels.cs)

```csharp
using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

// Base Response
public class ApiResponse<T>
{
    [JsonPropertyName("success")] public bool Success { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
}

// User Models
public class User
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("username")] public string? Username { get; set; }
    [JsonPropertyName("email")] public string? Email { get; set; }
    [JsonPropertyName("avatarUrl")] public string? AvatarUrl { get; set; }
    [JsonPropertyName("isRetired")] public bool IsRetired { get; set; }
    [JsonPropertyName("currentRank")] public Rank? CurrentRank { get; set; }
    [JsonPropertyName("discordId")] public string? DiscordId { get; set; }
    [JsonPropertyName("steamId")] public string? SteamId { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
}

public class Rank
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("abbreviation")] public string? Abbreviation { get; set; }
}

// ORBAT Models
public class Orbat
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("eventDate")] public DateTime? EventDate { get; set; }
    [JsonPropertyName("startTime")] public string? StartTime { get; set; }
    [JsonPropertyName("endTime")] public string? EndTime { get; set; }
    [JsonPropertyName("isActive")] public bool IsActive { get; set; }
    [JsonPropertyName("squads")] public List<Squad>? Squads { get; set; }
    [JsonPropertyName("signupCount")] public int SignupCount { get; set; }
}

public class Squad
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("slots")] public List<Slot>? Slots { get; set; }
}

public class Slot
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("maxSignups")] public int MaxSignups { get; set; }
    [JsonPropertyName("available")] public int Available { get; set; }
    [JsonPropertyName("signups")] public List<Signup>? Signups { get; set; }
}

public class Signup
{
    [JsonPropertyName("userId")] public int UserId { get; set; }
    [JsonPropertyName("username")] public string? Username { get; set; }
    [JsonPropertyName("discordId")] public string? DiscordId { get; set; }
    [JsonPropertyName("steamId")] public string? SteamId { get; set; }
    [JsonPropertyName("rank")] public Rank? Rank { get; set; }
    [JsonPropertyName("position")] public string? Position { get; set; }
}

// Promotion Models
public class PromotionProposal
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("userId")] public int UserId { get; set; }
    [JsonPropertyName("username")] public string? Username { get; set; }
    [JsonPropertyName("currentRank")] public Rank? CurrentRank { get; set; }
    [JsonPropertyName("nextRank")] public Rank? NextRank { get; set; }
    [JsonPropertyName("attendanceTotalAtProposal")] public int AttendanceTotalAtProposal { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
}

// Request/Response Models
public class AttendanceRequest
{
    [JsonPropertyName("steamId")] public string? SteamId { get; set; }
    [JsonPropertyName("discordUserId")] public string? DiscordUserId { get; set; }
    [JsonPropertyName("checkinTime")] public DateTime? CheckinTime { get; set; }
    [JsonPropertyName("checkoutTime")] public DateTime? CheckoutTime { get; set; }
    [JsonPropertyName("orbatId")] public int? OrbatId { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

public class AttendanceResponse : ApiResponse<object>
{
    [JsonPropertyName("userId")] public int UserId { get; set; }
    [JsonPropertyName("username")] public string? Username { get; set; }
    [JsonPropertyName("orbatId")] public int OrbatId { get; set; }
    [JsonPropertyName("orbatName")] public string? OrbatName { get; set; }
}

public class UsersResponse : ApiResponse<List<User>>
{
    [JsonPropertyName("total")] public int Total { get; set; }
}

public class OrbatsResponse : ApiResponse<List<Orbat>>
{
    [JsonPropertyName("total")] public int Total { get; set; }
}

public class OrbatResponse : ApiResponse<Orbat>
{ }

public class UserResponse : ApiResponse<User>
{ }

public class PromotionsResponse : ApiResponse<List<PromotionProposal>>
{ }

public class ApproveRequest
{
    [JsonPropertyName("proposalId")] public int ProposalId { get; set; }
    [JsonPropertyName("discordActorId")] public string? DiscordActorId { get; set; }
}

public class DeclineRequest
{
    [JsonPropertyName("reason")] public string? Reason { get; set; }
    [JsonPropertyName("discordActorId")] public string? DiscordActorId { get; set; }
}
```

#### 2. Client Service (OrbatBotClient.cs)

```csharp
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

public class OrbatBotClient : IDisposable
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly JsonSerializerOptions _jsonOptions;

    public OrbatBotClient(string baseUrl, string apiToken)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        
        _httpClient = new HttpClient();
        _httpClient.DefaultRequestHeaders.Authorization = 
            new AuthenticationHeaderValue("Bearer", apiToken);
        _httpClient.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));
        _httpClient.Timeout = TimeSpan.FromSeconds(30);

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };
    }

    // ========== Attendance Methods ==========

    /// <summary>
    /// Record attendance for a user using Steam ID or Discord ID
    /// </summary>
    /// <param name="request">Attendance data with Steam ID and/or Discord ID</param>
    /// <returns>Attendance response with success status</returns>
    public async Task<AttendanceResponse?> RecordAttendanceAsync(AttendanceRequest request)
    {
        try
        {
            var json = JsonSerializer.Serialize(request, _jsonOptions);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            
            var response = await _httpClient.PostAsync(
                $"{_baseUrl}/api/bot/attendance", content);
            
            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadFromJsonAsync<AttendanceResponse>(_jsonOptions);
            }
            else
            {
                var error = await response.Content.ReadAsStringAsync();
                Console.WriteLine($"Attendance error: {response.StatusCode} - {error}");
                return null;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Attendance recording failed: {ex.Message}");
            return null;
        }
    }

    // ========== User Methods ==========

    /// <summary>
    /// Get user by Discord ID
    /// </summary>
    public async Task<User?> GetUserByDiscordIdAsync(ulong discordId)
    {
        try
        {
            var response = await _httpClient.GetAsync(
                $"{_baseUrl}/api/bot/users/discord/{discordId}");
            
            if (response.IsSuccessStatusCode)
            {
                var result = await response.Content.ReadFromJsonAsync<UserResponse>(_jsonOptions);
                return result?.Data;
            }
            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Get user by Discord ID failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Get user by Steam ID
    /// </summary>
    public async Task<User?> GetUserBySteamIdAsync(string steamId)
    {
        try
        {
            var response = await _httpClient.GetAsync(
                $"{_baseUrl}/api/bot/users/steam/{steamId}");
            
            if (response.IsSuccessStatusCode)
            {
                var result = await response.Content.ReadFromJsonAsync<UserResponse>(_jsonOptions);
                return result?.Data;
            }
            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Get user by Steam ID failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Get all users with optional filters
    /// </summary>
    public async Task<List<User>?> GetAllUsersAsync(
        bool activeOnly = false, 
        bool hasDiscord = false, 
        bool hasSteam = false)
    {
        try
        {
            var query = new StringBuilder("?");
            if (activeOnly) query.Append("activeOnly=true&");
            if (hasDiscord) query.Append("hasDiscord=true&");
            if (hasSteam) query.Append("hasSteam=true&");
            
            var url = $"{_baseUrl}/api/bot/users{query}";
            var response = await _httpClient.GetAsync(url);
            
            if (response.IsSuccessStatusCode)
            {
                var result = await response.Content.ReadFromJsonAsync<UsersResponse>(_jsonOptions);
                return result?.Data;
            }
            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Get all users failed: {ex.Message}");
            return null;
        }
    }

    // ========== ORBAT Methods ==========

    /// <summary>
    /// Get list of ORBATs
    /// </summary>
    public async Task<List<Orbat>?> GetOrbatsAsync(int limit = 10, bool includePast = false)
    {
        try
        {
            var query = $"?limit={limit}&includePast={includePast.ToString().ToLower()}";
            var response = await _httpClient.GetAsync(
                $"{_baseUrl}/api/bot/orbats{query}");
            
            if (response.IsSuccessStatusCode)
            {
                var result = await response.Content.ReadFromJsonAsync<OrbatsResponse>(_jsonOptions);
                return result?.Data;
            }
            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Get orbats failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Get specific ORBAT by ID
    /// </summary>
    public async Task<Orbat?> GetOrbatAsync(int orbatId)
    {
        try
        {
            var response = await _httpClient.GetAsync(
                $"{_baseUrl}/api/bot/orbats/{orbatId}");
            
            if (response.IsSuccessStatusCode)
            {
                var result = await response.Content.ReadFromJsonAsync<OrbatResponse>(_jsonOptions);
                return result?.Data;
            }
            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Get ORBAT failed: {ex.Message}");
            return null;
        }
    }

    // ========== Promotion Methods ==========

    /// <summary>
    /// Get list of pending promotions
    /// </summary>
    public async Task<List<PromotionProposal>?> GetPendingPromotionsAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync(
                $"{_baseUrl}/api/ranks/bot/promotions");
            
            if (response.IsSuccessStatusCode)
            {
                var result = await response.Content.ReadFromJsonAsync<PromotionsResponse>(_jsonOptions);
                return result?.Data;
            }
            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Get pending promotions failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Approve a promotion proposal
    /// </summary>
    public async Task<bool> ApprovePromotionAsync(int proposalId, ulong discordActorId)
    {
        try
        {
            var request = new ApproveRequest
            {
                ProposalId = proposalId,
                DiscordActorId = discordActorId.ToString()
            };
            
            var json = JsonSerializer.Serialize(request, _jsonOptions);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            
            var response = await _httpClient.PostAsync(
                $"{_baseUrl}/api/ranks/bot/promotions/approve", content);
            
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Approve promotion failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Decline a promotion proposal
    /// </summary>
    public async Task<bool> DeclinePromotionAsync(int proposalId, string reason, ulong discordActorId)
    {
        try
        {
            var request = new DeclineRequest
            {
                Reason = reason,
                DiscordActorId = discordActorId.ToString()
            };
            
            var json = JsonSerializer.Serialize(request, _jsonOptions);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            
            var response = await _httpClient.PostAsync(
                $"{_baseUrl}/api/ranks/bot/promotions/{proposalId}/decline", content);
            
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Decline promotion failed: {ex.Message}");
            return false;
        }
    }

    // ========== Utility Methods ==========

    /// <summary>
    /// Check if the bot can connect to the API
    /// </summary>
    public async Task<bool> TestConnectionAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync(
                $"{_baseUrl}/api/bot/users?activeOnly=true&limit=1");
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Find user by Steam ID or Discord ID
    /// </summary>
    public async Task<User?> FindUserAsync(string steamId = null, ulong? discordId = null)
    {
        if (!string.IsNullOrEmpty(steamId))
        {
            var user = await GetUserBySteamIdAsync(steamId);
            if (user != null) return user;
        }
        
        if (discordId.HasValue)
        {
            var user = await GetUserByDiscordIdAsync(discordId.Value);
            if (user != null) return user;
        }
        
        return null;
    }

    public void Dispose()
    {
        _httpClient?.Dispose();
    }
}
```

#### 3. Discord Bot Integration Example (DiscordBotExample.cs)

```csharp
using Discord;
using Discord.Commands;
using Discord.WebSocket;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Threading.Tasks;

public class DiscordBotService
{
    private DiscordSocketClient _client;
    private OrbatBotClient _orbatClient;
    private CommandService _commandService;
    private IServiceProvider _serviceProvider;

    public DiscordBotService(string discordToken, string orbatApiUrl, string orbatApiToken)
    {
        // Initialize Discord client
        _client = new DiscordSocketClient(new DiscordSocketConfig
        {
            LogLevel = LogSeverity.Info,
            MessageCacheSize = 100
        });

        // Initialize ORBAT API client
        _orbatClient = new OrbatBotClient(orbatApiUrl, orbatApiToken);

        // Set up command service
        _commandService = new CommandService(new CommandServiceConfig
        {
            LogLevel = LogSeverity.Info,
            CaseSensitiveCommands = false
        });

        // Set up dependency injection
        _serviceProvider = new ServiceCollection()
            .AddSingleton(_client)
            .AddSingleton(_orbatClient)
            .BuildServiceProvider();
    }

    public async Task StartAsync()
    {
        // Test API connection
        var connected = await _orbatClient.TestConnectionAsync();
        Console.WriteLine($"ORBAT API connected: {connected}");

        // Set up events
        _client.Log += LogAsync;
        _client.Ready += ReadyAsync;
        _client.MessageReceived += MessageReceivedAsync;
        _client.ReactionAdded += ReactionAddedAsync;

        // Add command modules
        await _commandService.AddModulesAsync(typeof(DiscordBotService).Assembly, _serviceProvider);
        _client.MessageReceived += HandleCommandsAsync;

        // Start Discord client
        await _client.LoginAsync(TokenType.Bot, "YOUR_DISCORD_BOT_TOKEN");
        await _client.StartAsync();
    }

    private Task LogAsync(LogMessage log)
    {
        Console.WriteLine(log.ToString());
        return Task.CompletedTask;
    }

    private Task ReadyAsync()
    {
        Console.WriteLine($"Bot connected as {_client.CurrentUser.Username}#{_client.CurrentUser.Discriminator}");
        return Task.CompletedTask;
    }

    private async Task HandleCommandsAsync(SocketMessage arg)
    {
        var message = arg as SocketUserMessage;
        if (message == null) return;

        var context = new SocketCommandContext(_client, message);
        var result = await _commandService.ExecuteAsync(context, arg.Content, _serviceProvider);

        if (!result.IsSuccess)
        {
            await context.Channel.SendMessageAsync(result.ErrorReason);
        }
    }

    private async Task MessageReceivedAsync(SocketMessage arg)
    {
        // Handle non-command messages
        var message = arg as SocketUserMessage;
        if (message == null || message.Author.IsBot) return;

        // Example: Auto-respond to attendance check-ins
        if (message.Content.StartsWith("!checkin"))
        {
            await HandleCheckinAsync(message);
        }
        else if (message.Content.StartsWith("!checkout"))
        {
            await HandleCheckoutAsync(message);
        }
    }

    private async Task ReactionAddedAsync(Cacheable<IUserMessage, ulong> cachedMessage, Cacheable<IMessageChannel, ulong> channel, SocketReaction reaction)
    {
        // Example: Handle promotion approvals via reactions
        if (reaction.Emote.Name == "✅")
        {
            await HandlePromotionApprovalAsync(reaction, true);
        }
        else if (reaction.Emote.Name == "❌")
        {
            await HandlePromotionApprovalAsync(reaction, false);
        }
    }

    private async Task HandleCheckinAsync(SocketUserMessage message)
    {
        try
        {
            // Parse command: !checkin <orbatId> <steamId>
            var parts = message.Content.Split(' ');
            if (parts.Length < 3)
            {
                await message.Channel.SendMessageAsync("Usage: !checkin <orbatId> <steamId>");
                return;
            }

            if (!int.TryParse(parts[1], out int orbatId))
            {
                await message.Channel.SendMessageAsync("Invalid ORBAT ID");
                return;
            }

            var steamId = parts[2];

            // Record checkin
            var request = new AttendanceRequest
            {
                SteamId = steamId,
                DiscordUserId = message.Author.Id.ToString(),
                DiscordUsername = $"{message.Author.Username}#{message.Author.Discriminator}",
                CheckinTime = DateTime.UtcNow,
                OrbatId = orbatId,
                Notes = "Checked in via Discord bot"
            };

            var response = await _orbatClient.RecordAttendanceAsync(request);

            if (response?.Success == true)
            {
                await message.Channel.SendMessageAsync(
                    $"✅ {message.Author.Mention} checked in for ORBAT {response.OrbatName}!");
            }
            else
            {
                await message.Channel.SendMessageAsync(
                    $"❌ Failed to check in: {response?.Error ?? 'Unknown error'}");
            }
        }
        catch (Exception ex)
        {
            await message.Channel.SendMessageAsync($"❌ Error: {ex.Message}");
        }
    }

    private async Task HandleCheckoutAsync(SocketUserMessage message)
    {
        try
        {
            // Parse command: !checkout <steamId>
            var parts = message.Content.Split(' ');
            if (parts.Length < 2)
            {
                await message.Channel.SendMessageAsync("Usage: !checkout <steamId>");
                return;
            }

            var steamId = parts[1];

            // Record checkout
            var request = new AttendanceRequest
            {
                SteamId = steamId,
                DiscordUserId = message.Author.Id.ToString(),
                DiscordUsername = $"{message.Author.Username}#{message.Author.Discriminator}",
                CheckoutTime = DateTime.UtcNow,
                Notes = "Checked out via Discord bot"
            };

            var response = await _orbatClient.RecordAttendanceAsync(request);

            if (response?.Success == true)
            {
                await message.Channel.SendMessageAsync(
                    $"✅ {message.Author.Mention} checked out!");
            }
            else
            {
                await message.Channel.SendMessageAsync(
                    $"❌ Failed to check out: {response?.Error ?? 'Unknown error'}");
            }
        }
        catch (Exception ex)
        {
            await message.Channel.SendMessageAsync($"❌ Error: {ex.Message}");
        }
    }

    private async Task HandlePromotionApprovalAsync(SocketReaction reaction, bool approve)
    {
        try
        {
            // Check if the message is a promotion notification
            var message = await reaction.Channel.GetMessageAsync(reaction.MessageId);
            if (message == null) return;

            // Parse promotion ID from message embed
            if (!message.Embeds.Count > 0) return;

            var embed = message.Embeds[0];
            if (!embed.Description?.Contains("Promotion Proposal #") == true) return;

            var proposalIdStr = embed.Description.Split('#')[1].Split(' ')[0];
            if (!int.TryParse(proposalIdStr, out int proposalId)) return;

            if (approve)
            {
                var success = await _orbatClient.ApprovePromotionAsync(
                    proposalId, reaction.UserId);
                
                if (success)
                {
                    await reaction.Channel.SendMessageAsync(
                        $"✅ Promotion #{proposalId} approved by {reaction.User.Mention}");
                }
            }
            else
            {
                var success = await _orbatClient.DeclinePromotionAsync(
                    proposalId, "Declined via Discord", reaction.UserId);
                
                if (success)
                {
                    await reaction.Channel.SendMessageAsync(
                        $"❌ Promotion #{proposalId} declined by {reaction.User.Mention}");
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Promotion handling error: {ex.Message}");
        }
    }

    public async Task StopAsync()
    {
        await _client.LogoutAsync();
        await _client.StopAsync();
        _orbatClient.Dispose();
    }
}
```

#### 4. Discord Command Modules (AttendanceCommands.cs)

```csharp
using Discord.Commands;
using Discord.WebSocket;
using System;
using System.Threading.Tasks;

public class AttendanceCommands : ModuleBase<SocketCommandContext>
{
    private readonly OrbatBotClient _orbatClient;

    public AttendanceCommands(OrbatBotClient orbatClient)
    {
        _orbatClient = orbatClient;
    }

    [Command("checkin")]
    [Summary("Check in for an operation")]
    public async Task CheckinAsync(int orbatId, [Remainder] string steamId = null)
    {
        try
        {
            // If no steamId provided, try to get from linked account
            if (string.IsNullOrEmpty(steamId))
            {
                var user = await _orbatClient.GetUserByDiscordIdAsync(Context.User.Id);
                steamId = user?.SteamId;
                
                if (string.IsNullOrEmpty(steamId))
                {
                    await ReplyAsync("❌ You need to provide a Steam ID or link your Steam account");
                    return;
                }
            }

            var request = new AttendanceRequest
            {
                SteamId = steamId,
                DiscordUserId = Context.User.Id.ToString(),
                DiscordUsername = $"{Context.User.Username}#{Context.User.Discriminator}",
                CheckinTime = DateTime.UtcNow,
                OrbatId = orbatId,
                Notes = "Checked in via command"
            };

            var response = await _orbatClient.RecordAttendanceAsync(request);

            if (response?.Success == true)
            {
                await ReplyAsync($"✅ {Context.User.Mention} checked in for **{response.OrbatName}**!");
            }
            else
            {
                await ReplyAsync($"❌ Failed to check in: {response?.Error ?? 'Unknown error'}");
            }
        }
        catch (Exception ex)
        {
            await ReplyAsync($"❌ Error: {ex.Message}");
        }
    }

    [Command("checkout")]
    [Summary("Check out from an operation")]
    public async Task CheckoutAsync([Remainder] string steamId = null)
    {
        try
        {
            // If no steamId provided, try to get from linked account
            if (string.IsNullOrEmpty(steamId))
            {
                var user = await _orbatClient.GetUserByDiscordIdAsync(Context.User.Id);
                steamId = user?.SteamId;
                
                if (string.IsNullOrEmpty(steamId))
                {
                    await ReplyAsync("❌ You need to provide a Steam ID or link your Steam account");
                    return;
                }
            }

            var request = new AttendanceRequest
            {
                SteamId = steamId,
                DiscordUserId = Context.User.Id.ToString(),
                DiscordUsername = $"{Context.User.Username}#{Context.User.Discriminator}",
                CheckoutTime = DateTime.UtcNow,
                Notes = "Checked out via command"
            };

            var response = await _orbatClient.RecordAttendanceAsync(request);

            if (response?.Success == true)
            {
                await ReplyAsync($"✅ {Context.User.Mention} checked out!");
            }
            else
            {
                await ReplyAsync($"❌ Failed to check out: {response?.Error ?? 'Unknown error'}");
            }
        }
        catch (Exception ex)
        {
            await ReplyAsync($"❌ Error: {ex.Message}");
        }
    }

    [Command("orbats")]
    [Summary("List current operations")]
    public async Task ListOrbatsAsync(int limit = 5)
    {
        try
        {
            var orbats = await _orbatClient.GetOrbatsAsync(limit);
            
            if (orbats?.Count > 0)
            {
                var message = "📋 **Current Operations**\n\n";
                
                foreach (var orbat in orbats)
                {
                    var date = orbat.EventDate?.ToString("yyyy-MM-dd");
                    var status = orbat.IsActive ? "🟢 Active" : "🔴 Past";
                    message += $"**{orbat.Name}** ({date}) - {status}\n";
                    message += $"   Signups: {orbat.SignupCount}\n\n";
                }
                
                await ReplyAsync(message);
            }
            else
            {
                await ReplyAsync("No operations found");
            }
        }
        catch (Exception ex)
        {
            await ReplyAsync($"❌ Error: {ex.Message}");
        }
    }

    [Command("whois")]
    [Summary("Get user information")]
    public async Task WhoIsAsync(ulong discordId)
    {
        try
        {
            var user = await _orbatClient.GetUserByDiscordIdAsync(discordId);
            
            if (user != null)
            {
                var embed = new EmbedBuilder
                {
                    Title = $"User: {user.Username}",
                    Color = Color.Blue,
                    ThumbnailUrl = user.AvatarUrl
                };

                embed.AddField("ID", user.Id.ToString(), true);
                embed.AddField("Retired", user.IsRetired ? "Yes" : "No", true);
                embed.AddField("Rank", user.CurrentRank?.Name ?? "None", true);
                
                if (!string.IsNullOrEmpty(user.DiscordId))
                    embed.AddField("Discord ID", user.DiscordId, true);
                if (!string.IsNullOrEmpty(user.SteamId))
                    embed.AddField("Steam ID", user.SteamId, true);
                
                embed.AddField("Created", user.CreatedAt.ToString("yyyy-MM-dd"), true);

                await ReplyAsync(embed: embed.Build());
            }
            else
            {
                await ReplyAsync("❌ User not found");
            }
        }
        catch (Exception ex)
        {
            await ReplyAsync($"❌ Error: {ex.Message}");
        }
    }
}

public class PromotionCommands : ModuleBase<SocketCommandContext>
{
    private readonly OrbatBotClient _orbatClient;

    public PromotionCommands(OrbatBotClient orbatClient)
    {
        _orbatClient = orbatClient;
    }

    [Command("promotions")]
    [Summary("List pending promotions")]
    [RequireUserPermission(GuildPermission.Administrator)]
    public async Task ListPromotionsAsync()
    {
        try
        {
            var promotions = await _orbatClient.GetPendingPromotionsAsync();
            
            if (promotions?.Count > 0)
            {
                var message = "🏆 **Pending Promotions**\n\n";
                
                foreach (var promo in promotions)
                {
                    message += $"**#{promo.Id}** - {promo.Username}\n";
                    message += $"   From: {promo.CurrentRank?.Name} → To: {promo.NextRank?.Name}\n";
                    message += $"   Attendance: {promo.AttendanceTotalAtProposal}\n\n";
                }
                
                await ReplyAsync(message);
            }
            else
            {
                await ReplyAsync("No pending promotions");
            }
        }
        catch (Exception ex)
        {
            await ReplyAsync($"❌ Error: {ex.Message}");
        }
    }

    [Command("approve")]
    [Summary("Approve a promotion")]
    [RequireUserPermission(GuildPermission.Administrator)]
    public async Task ApprovePromotionAsync(int proposalId)
    {
        try
        {
            var success = await _orbatClient.ApprovePromotionAsync(
                proposalId, Context.User.Id);
            
            if (success)
            {
                await ReplyAsync($"✅ Promotion #{proposalId} approved!");
            }
            else
            {
                await ReplyAsync($"❌ Failed to approve promotion #{proposalId}");
            }
        }
        catch (Exception ex)
        {
            await ReplyAsync($"❌ Error: {ex.Message}");
        }
    }

    [Command("decline")]
    [Summary("Decline a promotion")]
    [RequireUserPermission(GuildPermission.Administrator)]
    public async Task DeclinePromotionAsync(int proposalId, [Remainder] string reason = "No reason given")
    {
        try
        {
            var success = await _orbatClient.DeclinePromotionAsync(
                proposalId, reason, Context.User.Id);
            
            if (success)
            {
                await ReplyAsync($"❌ Promotion #{proposalId} declined: {reason}");
            }
            else
            {
                await ReplyAsync($"❌ Failed to decline promotion #{proposalId}");
            }
        }
        catch (Exception ex)
        {
            await ReplyAsync($"❌ Error: {ex.Message}");
        }
    }
}
```

---

## Usage Examples

### 1. Recording Attendance via Steam ID

```csharp
var request = new AttendanceRequest
{
    SteamId = "76561198123456789",
    CheckinTime = DateTime.UtcNow,
    OrbatId = 123
};

var response = await orbatClient.RecordAttendanceAsync(request);
```

### 2. Recording Attendance via Discord ID

```csharp
var request = new AttendanceRequest
{
    DiscordUserId = "123456789012345678",
    DiscordUsername = "Player#1234",
    CheckinTime = DateTime.UtcNow,
    CheckoutTime = DateTime.UtcNow.AddHours(2),
    Notes = "Full session"
};

var response = await orbatClient.RecordAttendanceAsync(request);
```

### 3. Finding a User

```csharp
// Try Steam ID first, then Discord ID
var user = await orbatClient.FindUserAsync(
    steamId: "76561198123456789",
    discordId: 123456789012345678
);

if (user != null)
{
    Console.WriteLine($"Found: {user.Username} (Rank: {user.CurrentRank?.Name})");
}
```

### 4. Processing Pending Promotions

```csharp
var promotions = await orbatClient.GetPendingPromotionsAsync();

foreach (var promo in promotions)
{
    Console.WriteLine($"Promo #{promo.Id}: {promo.Username} -> {promo.NextRank?.Name}");
    
    // Auto-approve if attendance is good
    if (promo.AttendanceTotalAtProposal >= 10)
    {
        await orbatClient.ApprovePromotionAsync(promo.Id, 0);
    }
}
```

---

## Error Handling

The client library includes comprehensive error handling:

- **Network Errors**: Connection issues, timeouts
- **Authentication Errors**: Invalid or missing API token
- **Validation Errors**: Invalid request data
- **Not Found Errors**: User, ORBAT, or promotion not found

All errors are caught and logged, with `null` returns or `false` status for failed operations.

---

## Security Considerations

### 🔒 API Token Security

1. **Never commit the token** to version control
2. **Use environment variables** for configuration
3. **Rotate tokens regularly** (every 90 days recommended)
4. **Restrict token access** to only necessary services

### 🛡️ Rate Limiting

The API does not currently enforce rate limiting for bot endpoints, but:

- Implement **client-side rate limiting** in your bot
- Use **exponential backoff** for retries
- Cache **frequently accessed data** locally
- Avoid **bulk operations** during peak times

### 🔐 Discord Bot Security

1. **Use proper permissions** - Only grant necessary permissions
2. **Validate all inputs** - Sanitize user-provided data
3. **Implement command cooldowns** - Prevent spam
4. **Use secure token storage** - Environment variables, secret management

---

## Deployment

### Prerequisites

- .NET 6.0 or higher
- Discord.NET library
- HTTP client with TLS 1.2+ support

### Configuration

```json
{
  "Discord": {
    "Token": "YOUR_DISCORD_BOT_TOKEN",
    "Prefix": "!",
    "GuildId": 123456789012345678
  },
  "Orbat": {
    "ApiUrl": "https://your-orbat-domain.com/api",
    "ApiToken": "YOUR_BOT_API_TOKEN"
  }
}
```

### Running the Bot

```csharp
var botService = new DiscordBotService(
    discordToken: config["Discord:Token"],
    orbatApiUrl: config["Orbat:ApiUrl"],
    orbatApiToken: config["Orbat:ApiToken"]
);

await botService.StartAsync();
// Keep running...
await Task.Delay(-1);
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **401 Unauthorized** | Check BOT_API_TOKEN in both web app and bot config |
| **404 Not Found** | Verify endpoint URLs and IDs |
| **Connection Failed** | Check API URL, network connectivity, SSL certificates |
| **User Not Found** | Ensure user has linked Steam/Discord account in web app |
| **ORBAT Not Found** | Verify ORBAT ID exists and is accessible |

### Debugging

Enable debug logging in both the bot and web application:

```csharp
// In C# bot
HttpClient.DefaultRequestHeaders.Add("X-Debug", "true");
```

---

## API Versioning

The bot API follows the same versioning as the main web application. Check the `/api` endpoints for version information.

---

## Support

For issues with the bot integration:

1. Check the **web application logs** for API errors
2. Verify the **BOT_API_TOKEN** is correctly configured
3. Test endpoints with **Postman** or **cURL**
4. Review the **OpenAPI specification** (`openapi.yaml`) for endpoint details

---

## Changelog

### v1.0.0
- Initial bot API implementation
- Attendance tracking with Steam ID and Discord ID support
- User lookup endpoints
- ORBAT information endpoints
- Promotion management endpoints
- Complete C# client library

---

## License

The bot integration code and documentation are proprietary to the 6th Maroon Division.

# 6MD Management Platform

Web application for managing Arma 3 unit operations, signups, attendance, ranks, training progression, and admin workflows.

## Current Feature Set (Code-Verified)

### Authentication & Accounts
- Discord OAuth via NextAuth
- Steam OpenID login/link flow (custom callback routes)
- Multi-provider account linking to one user account (`Discord + Steam`)
- Session includes cached permission map

### User Profile
- Primary user profile page at `/profile`
- Tabbed self-service profile view:
  - Overview
  - Attendance
  - Trainings (completed + available/request flow)
  - Rank History
  - Actions (avatar upload + provider refresh)
- Legacy routes redirect to `/profile`:
  - `/settings`
  - `/settings/rank-history`
  - `/trainings`

### Operations (ORBAT)
- Calendar-based operations browsing (`/orbats`)
- Detailed operation pages with slot/subslot hierarchy
- Signup/unsignup flows and signup movement endpoints
- Realtime ORBAT change stream (SSE) at `/api/orbats/[id]/events` for signup/move/edit/delete updates
- Operation metadata: factions, intel fields, start/end time
- Radio frequency assignment (including temporary frequencies)
- Admin ORBAT create/edit/delete workflows with permission checks

### Templates
- ORBAT template CRUD and usage tracking
- Template structure includes slots/subslots, frequencies, and intel defaults
- Read-only template access for ORBAT creators/editors without template-manage permissions

### Trainings
- Training CRUD (with active/inactive state)
- Training categories CRUD + ordering
- User training assignments and completion tracking
- Training request workflow (`pending`, `approved`, `rejected`, `completed`)
- Training gating by:
  - minimum rank requirement
  - prerequisite trainings
  - circular dependency prevention logic

### Attendance
- Operation attendance records with rich statuses:
  `present`, `absent`, `late`, `gone_early`, `partial`, `no_show`
- Session-based check-in/check-out tracking with minute calculations
- Automated attendance ingestion endpoint using SteamID mapping
- Attendance logs/audit trail (`manual` and `automated_system` sources)
- Admin attendance overview + per-operation attendance management
- Legacy attendance data import/mapping tools

### Rank System
- Rank CRUD + drag/drop ordering
- Auto-rankup eligibility checks
- Manual promotion proposal workflow (approve/decline)
- User rank state (`retired`, interview flag, attendance since last rank)
- Rank history timeline exposed to users in the profile tab view
- Rank transition requirements (required trainings per target rank)
- Rank migration preview/apply workflow
- Legacy user rank data CSV import pipeline

### Messaging & Notifications
- Admin message broadcast UI
- Message types: `general`, `orbat`, `training`, `rankup`, `alert`
- Audience targeting: all users or admins
- In-app inbox with unread badge, filters, and mark-read APIs
- Auto message creation on rankup approval flows

### Permissions & Access Control
- 26 granular permissions across 8 domains
- Integer permission values (`0-255`) with sparse storage
- Enforcement layers:
  - API route authorization (authoritative)
  - server page guards
  - client-side UI visibility helpers
- Permission audit logging and user-level permission management APIs

### Admin Areas
- Dashboard (`/admin`) with module access by role/permission
- ORBAT management
- Template management
- User management
- Radio frequencies
- Training management + request handling
- Attendance management
- Rank configuration
- Pending promotions
- System messaging
- Legacy user data import
- Theme page currently indicates theme system removal (static light/dark behavior)

## Tech Stack

- Next.js 16 (App Router) + React 19
- TypeScript
- Prisma ORM + PostgreSQL
- NextAuth.js
- Tailwind CSS v4

## Environment Variables

Copy `.env.example` to `.env`.

Required:
- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `STEAM_API_KEY`

Optional / integration-specific:
- `BOT_API_TOKEN` (for bot rank promotion endpoints)

## Prisma Notes

This project uses a custom Prisma client output path: `generated/prisma/`.

- Import Prisma via `@/lib/prisma`
- Do not import directly from generated files

## Local Development

Node.js requirement: `^20.19 || ^22.12 || >=24.0`.

1) Install dependencies

```bash
npm install
```

2) Configure environment

```bash
cp .env.example .env
```

3) Run migrations + generate client

```bash
npm run prisma:migrate
npm run prisma:generate
```

4) Seed data (choose one)

```bash
npm run seed:dev
# or
npm run seed:prod
```

5) Start app

```bash
npm run dev
```

Default URL: `http://localhost:3000`

## Scripts

- `npm run dev` - Start dev server
- `npm run build` - Build production bundle
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run test:permissions` - Run permission-focused tests
- `npm run prisma:migrate` - Run Prisma migrate dev
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:studio` - Open Prisma Studio
- `npm run db:push` - Push schema without migration
- `npm run seed` - Generic seed entry
- `npm run seed:dev` - Development seed data
- `npm run seed:prod` - Production seed data
- `npm run seed:migrate` - Migration-time seed script

## Key Paths

- `app/` - App Router pages and API routes
- `app/api/` - REST-style route handlers
- `app/admin/` - Admin UI modules
- `lib/` - Shared server/business logic
- `prisma/schema.prisma` - Full data model
- `docs/PERMISSIONS.md` - Permission model details
- `docs/RANK_SYSTEM.md` - Rank subsystem documentation

## Validation

Before shipping permission/auth/rank changes:

```bash
npm run test:permissions
npm run build
```

## License

Proprietary - 6th Maroon Division


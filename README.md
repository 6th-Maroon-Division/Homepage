# 6MD Management Platform

A comprehensive web-based management platform for the 6th Maroon Division Arma 3 milsim unit. This system handles operation planning, player signups, user management, and will expand to include Discord bot integration, attendance tracking, and training management.

## Current Features

- **Operations Management**: Create and manage Arma 3 operations with slots and subslots (ORBAT system)
- **User Signups**: Players can sign up for available positions in upcoming operations
- **Authentication**: Discord and Steam OAuth integration for easy community access
- **Admin Panel**: Comprehensive admin tools for managing operations, users, and signups
- **Calendar View**: Visual calendar interface for browsing and creating operations
- **Responsive Design**: Mobile-friendly interface with a modern dark theme
- **Granular Permission System**: 19 fine-grained permissions for role-based access control

## Permission System

The platform uses a comprehensive permission system with 19 granular permissions organized into 6 domains:

### Permission Domains

**User Management (4 permissions)**
- `user:edit` - Edit user profile details
- `user:promote` - Promote users to higher ranks
- `user:manage` - Full user management (admin actions, retire, interview status)
- `user:manage_permissions` - Grant/revoke permissions (special permission)

**Training System (5 permissions)**
- `training:create` - Create new training programs
- `training:edit` - Edit existing trainings
- `training:delete` - Delete trainings
- `training:mark` - Mark users as trained/assign trainings
- `training:approve_request` - Approve/reject training requests

**Operations (ORBATs) (3 permissions)**
- `orbat:create` - Create new operations
- `orbat:edit` - Edit operations and templates
- `orbat:delete` - Delete operations

**Attendance (2 permissions)**
- `attendance:view` - View detailed attendance records
- `attendance:edit` - Modify attendance data

**Rank System (4 permissions)**
- `rank:create` - Create new ranks
- `rank:edit` - Edit rank definitions and requirements
- `rank:delete` - Delete ranks
- `rank:manage_promotions` - Propose/approve rank promotions

**System Administration (1 permission)**
- `admin:system` - Full system access (messaging, imports, system settings)

### How Permissions Work

1. **Hierarchy System**: Permissions use 0-255 integer values for future role-based comparisons
2. **Sparse Storage**: Only non-zero permission values are stored in the database
3. **Session-Based**: Permissions loaded into user session on login (minimal DB queries)
4. **Multi-Layer Protection**:
   - API endpoints check permissions before operations
   - Admin pages redirect unauthorized users
   - UI buttons/actions hidden from users without permissions
   - Navigation adapts dynamically to user capabilities

### Assigning Permissions

Admins with `user:manage_permissions` can assign permissions through the admin panel:

1. Navigate to **Admin Panel → Users**
2. Click **Permissions** next to any user
3. Set permission values using sliders (0-255)
   - **0** = No access
   - **100** = Standard access
   - **255** = Full access
4. Use quick buttons: **None (0)**, **Standard (100)**, **Full (255)**
5. Click **Save Permissions**

**Note:** Users cannot modify their own permissions (system enforced).

### Developer Guide

**Using Permission Hooks in Client Components:**
```tsx
import { usePermission } from '@/app/hooks/usePermissions';

function DeleteButton() {
  const canDelete = usePermission('orbat:delete');
  
  if (!canDelete) return null; // Hide button without permission
  
  return <button>Delete ORBAT</button>;
}
```

**Checking Permissions in API Routes:**
```tsx
import { checkPermission } from '@/lib/auth-middleware';

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const hasPermission = await checkPermission(session.user.id, 'orbat:delete');
  if (!hasPermission) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  // Proceed with deletion...
}
```

**Protecting Server-Side Pages:**
```tsx
import { checkPermission } from '@/lib/auth-middleware';

export default async function RanksPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/');
  
  const hasPermission = session.user.isAdmin || await checkPermission(session.user.id, 'rank:edit');
  if (!hasPermission) redirect('/admin');
  
  return <RankManagement />;
}
```

See [PERMISSION_AUDIT.md](./PERMISSION_AUDIT.md) for detailed implementation documentation.

## Planned Features

- **Discord Bot Integration**: 
  - Automated operation announcements
  - User management and role synchronization
  - Operation reminders and notifications
- **Attendance System**:
  - Arma 3 server integration for automatic attendance tracking
  - TeamSpeak presence detection
  - Attendance reports and statistics
- **Training Management**:
  - Schedule and track training sessions
  - Training requirements and completion tracking
  - Certification system for specialized roles
  - **Role-based signups**: Users can only sign up for slots they are certified/trained for
  - Automatic slot restrictions based on completed training and qualifications

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: NextAuth.js with Discord and Steam providers
- **Styling**: Tailwind CSS v4
- **TypeScript**: Full type safety

## Prerequisites

- Node.js 18+ or Bun
- PostgreSQL database
- Discord OAuth application
- Steam API key

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd orbat-web
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `NEXTAUTH_URL`: Your app URL (http://localhost:3000 for dev)
- `NEXTAUTH_SECRET`: Generate with `openssl rand -base64 32`
- `DISCORD_CLIENT_ID` & `DISCORD_CLIENT_SECRET`: From Discord Developer Portal
- `DISCORD_OAUTH_URL`: Discord OAuth URL with your client ID
- `STEAM_API_KEY`: From https://steamcommunity.com/dev/apikey

### 4. Set up the database

```bash
# Run Prisma migrations
npx prisma migrate dev

# Generate Prisma Client
npx prisma generate

# (Optional) Seed the database
npx prisma db seed
```

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
orbat-web/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   ├── admin/             # Admin panel pages
│   ├── orbats/            # Operations pages
│   ├── settings/          # User settings
│   └── components/        # Shared components
├── lib/                   # Utility functions
├── prisma/                # Database schema and migrations
│   ├── schema.prisma     # Prisma schema definition
│   └── migrations/       # Database migrations
└── public/               # Static assets
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npx prisma studio` - Open Prisma Studio (database GUI)
- `npx prisma migrate dev` - Run database migrations
- `npx prisma generate` - Generate Prisma Client

## Admin Access

The first user to sign up will need to be manually promoted to admin in the database. After that, admins can promote other users through the admin panel.

## License

Proprietary - 6th Maroon Division


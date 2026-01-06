# 6MD Management Platform

A comprehensive web-based management platform for the 6th Maroon Division Arma 3 milsim unit. This system handles operation planning, player signups, user management, and will expand to include Discord bot integration, attendance tracking, and training management.

## Current Features

- **Operations Management**: Create and manage Arma 3 operations with slots and subslots (ORBAT system)
- **User Signups**: Players can sign up for available positions in upcoming operations
- **Authentication**: Discord and Steam OAuth integration for easy community access
- **Admin Panel**: Comprehensive admin tools for managing operations, users, and signups
- **Calendar View**: Visual calendar interface for browsing and creating operations
- **Responsive Design**: Mobile-friendly interface with a modern dark theme

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


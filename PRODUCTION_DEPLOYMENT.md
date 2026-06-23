# Production Deployment Guide

## Current Status: ✅ BUILD READY

- **Build**: ✅ Passing
- **Tests**: ✅ Passing (21/21 permission tests)
- **Linting**: ⚠️ 28 issues (1 error, 27 warnings)
- **Database**: ✅ Connected and populated

---

## Deployment Steps

### 1. Prerequisites

```bash
# Node.js version requirement
node --version  # Must be ^20.19 || ^22.12 || >=24.0

# Install dependencies
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env

# Edit .env with your values:
DATABASE_URL="postgresql://user:password@host:port/database"
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="your-secure-secret-here"
DISCORD_CLIENT_ID="your-discord-client-id"
DISCORD_CLIENT_SECRET="your-discord-client-secret"
STEAM_API_KEY="your-steam-api-key"
# Optional
BOT_API_TOKEN="your-bot-api-token"
```

### 3. Database Setup

```bash
# Check database connectivity
npx prisma migrate status

# Apply pending migrations (if any)
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Optional: seed data if needed
npm run seed:prod
```

### 4. Build for Production

```bash
npm run build
```

This will:
- Compile TypeScript
- Generate static pages
- Optimize production bundle

### 5. Start Production Server

```bash
npm run start
```

The application will be available at the port specified in your environment.

---

## Production Checklist

### ✅ Completed
- [x] TypeScript build succeeds
- [x] All permission tests pass
- [x] Database schema synchronized
- [x] Environment variables configured
- [x] Core features type-safe

### ⚠️ Pending (Non-Blocking)
- [ ] Fix linting warnings (27 warnings)
- [ ] Fix linting error (1 error in UserManagementClient.tsx)
- [ ] Remove remaining `any` types
- [ ] Add missing React hook dependencies
- [ ] Remove unused variables

### 🔍 To Test
- [ ] Discord OAuth authentication
- [ ] Steam OpenID authentication
- [ ] Real-time SSE connections
- [ ] Admin functionality
- [ ] User profile management
- [ ] ORBAT creation and management

---

## Monitoring & Maintenance

### Health Checks
```bash
# Check build
npm run build

# Run tests
npm run test:permissions

# Check linting
npm run lint

# Database health
PGPASSWORD=your-password psql -h localhost -U user -d database -c "SELECT COUNT(*) FROM \"User\";"
```

### Logs
- Next.js logs: `npm run start` output
- Database logs: PostgreSQL logs
- Application logs: Check console output

---

## Troubleshooting

### Build Fails
If `npm run build` fails:
1. Check TypeScript errors in console output
2. Look for type mismatches in recently modified files
3. Ensure all types are properly imported

### Database Connection Issues
1. Verify PostgreSQL is running: `pg_lsclusters`
2. Test connection: `psql -h localhost -U user -d database`
3. Check .env DATABASE_URL format

### Authentication Issues
1. Verify Discord OAuth credentials in .env
2. Check callback URLs in Discord developer portal
3. Test Steam API key

### Real-time Features Not Working
1. Check SSE endpoint accessibility
2. Verify client-side connection handling
3. Check for CORS issues in production

---

## Rollback Plan

If deployment fails:
1. Revert to previous commit: `git revert HEAD`
2. Rebuild: `npm run build`
3. Restart server: `npm run start`

---

## Performance Considerations

- Next.js 16 with Turbopack for faster builds
- Static page generation for better performance
- SSE for real-time features (more efficient than polling)
- Consider adding caching layer for API routes

---

## Security Notes

- Keep NEXTAUTH_SECRET secure
- Use HTTPS in production
- Regularly rotate API keys
- Monitor for suspicious activity
- Keep dependencies updated


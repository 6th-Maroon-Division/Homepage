# Permission System: Production Migration Guide

## Overview

This guide explains how to safely migrate the production database to add the new permission system without losing existing data.

## Pre-Migration Checklist

- [ ] Backup production database
- [ ] Test migration on staging environment first
- [ ] All team members informed of downtime (if any)
- [ ] Feature branch `feature/permission-system` is ready

## Migration Steps

### Step 1: Pull Latest Changes

```bash
# Fetch the permission system branch
git fetch origin feature/permission-system

# Switch to the branch
git checkout feature/permission-system

# Verify you have all changes
git log --oneline | head -5
```

### Step 2: Apply Database Migrations

This creates new tables without deleting existing data:

```bash
# Apply Prisma migrations
npx prisma migrate deploy

# OR if you need to create a migration:
npx prisma migrate dev
```

**What this does:**
- Creates `Permission` table (22 permissions)
- Creates `UserPermission` table (permission assignments)
- Creates `PermissionAuditLog` table (audit trail)
- PermissionAuditLog migration: `20260215033424_add_permission_audit_logs`
- Existing user/orbat/training data is **NOT modified**

### Step 3: Seed Permissions (Safe Migration)

```bash
# Run the safe migration seed script
npm run seed:migrate
```

**What this does:**
- Seeds all 22 permissions into database (idempotent)
- Finds all existing admin users (users with `isAdmin = true`)
- Grants all 22 permissions with value 255 to each admin
- **Preserves all existing data** (ORBATs, signups, users, etc.)
- Prints summary of affected admins and database status

### Step 4: Verify Migration

```bash
# Open Prisma Studio to inspect data
npm run prisma:studio

# Check:
# 1. Permission table has 22 records
# 2. Admin users have UserPermission entries
# 3. All user/orbat/training data still present
```

### Step 5: Deploy Application

```bash
# Build application
npm run build

# Start production server
npm start
```

## Important Notes

### ✅ What is Preserved:
- All existing users
- All existing ORBATs and signups
- All training data
- All attendance records
- All ranks and rank histories
- User accounts (Discord/Steam)
- All other operational data

### ⚠️ What Happens to Non-Admin Users:
- **No permissions initially** (all values = 0)
- Cannot perform admin operations until permissions are granted
- Can still use regular user features (view public ORBATs, sign up for operations, etc.)
- Permissions can be granted via Admin UI: `/admin/users` → select user → "Permissions" button

### 🔐 What Happens to Admin Users:
- Automatically granted all 22 permissions (value = 255)
- Can immediately use all admin features
- Can manage other users' permissions

## Post-Migration Verification

1. **Check Admin Access:**
   - Log in as admin user
   - Verify `/admin` pages are accessible
   - Check `/admin/users` page loads correctly

2. **Check Non-Admin Users:**
   - Log in as regular user
   - Verify they can still use main features
   - Verify they cannot access `/admin` pages (expected)

3. **Grant Specific Permissions (if needed):**
   - Go to `/admin/users`
   - Select a user
   - Click "Permissions" button
   - Grant desired permissions using sliders
   - User can now perform those operations

## Rollback (if needed)

If something goes wrong:

```bash
# Revert to previous code
git checkout main

# Migrations can be reversed:
npx prisma migrate resolve --rolled-back <migration_name>

# Restore from backup
# (Specific steps depend on your database setup)
```

## Troubleshooting

### Issue: Build fails after migration

**Solution:** Regenerate Prisma client:
```bash
npm run prisma:generate
npm run build
```

### Issue: Admin users don't have permissions

**Solution:** Check if seed script ran:
```bash
npm run seed:migrate
```

### Issue: Migrations won't apply

**Solution:** Check migration status:
```bash
npx prisma migrate status
```

## Key Differences: Seed Scripts

| Script | Purpose | Use Case | Data Safety |
|--------|---------|----------|------------|
| `seed.prod.ts` | Initial production setup | Fresh database setup | ❌ Clears all data |
| `seed.dev.ts` | Development with test data | Local development | ❌ Clears all data |
| `seed.migrate.ts` | **Safe production migration** | Add permissions to existing DB | ✅ **Preserves all data** |

---

**For questions or issues, refer to the Permission System documentation in README.md**

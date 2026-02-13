# Permission System Audit Report

Generated: February 13, 2026

## ✅ What's Correct

### 1. **API Endpoints - Fully Migrated** (65+ routes)
All API routes have been successfully migrated from `isAdmin` to granular permissions:

**User Management:**
- `/api/users/[id]/admin` → `user:manage`
- `/api/users/[id]/permissions` → `user:manage_permissions` ⭐
- `/api/users/[id]/retired/toggle` → `user:manage`
- `/api/users/[id]/rank/assign` → `rank:manage_promotions`
- `/api/admin/users/*` → Various `user:manage`, `rank:manage_promotions`

**Training System:**
- `/api/trainings/*` → `training:create/edit/delete`
- `/api/training-requests/*` → `training:approve_request`
- `/api/user-trainings/*` → `training:mark`

**ORBAT System:**
- `/api/orbats/*` → `orbat:create/edit/delete`
- `/api/templates/*` → `orbat:edit/delete`
- `/api/signups/*` → `orbat:edit`

**Attendance:**
- `/api/attendance/*` → `attendance:edit/view`
- `/api/orbats/[id]/attendance` → `attendance:edit`

**Ranks:**
- `/api/ranks/*` → `rank:create/edit/delete`
- `/api/ranks/promotions/propose` → `rank:manage_promotions`

**System Admin:**
- `/api/admin/import/*` → `admin:system`
- `/api/messaging/send` → `admin:system`

### 2. **Auth System - Properly Configured**
Only 1 legitimate `isAdmin` reference in API routes:
- `/app/api/auth/[...nextauth]/route.ts` (line 183) - Sets isAdmin in session

## ⚠️ Areas Still Using `isAdmin`

### 1. **Admin Page Guards** (11 files)
Server-side pages protecting entire admin sections:
```tsx
if (!session || !session.user?.isAdmin) {
  redirect('/');
}
```

**Files:**
- `/app/admin/page.tsx`
- `/app/admin/ranks/page.tsx`
- `/app/admin/radio-frequencies/page.tsx`
- `/app/admin/attendance/page.tsx`
- `/app/admin/attendance/[id]/page.tsx`
- `/app/admin/users/page.tsx`
- `/app/admin/messaging/page.tsx`
- `/app/admin/promotions/page.tsx`
- `/app/admin/orbats/new/page.tsx`
- `/app/admin/orbats/[id]/page.tsx`
- `/app/admin/orbats/[id]/edit/page.tsx`

**Status:** ⚠️ **May be too restrictive**
- These guards prevent ALL non-admins from accessing admin pages
- A user with only `rank:manage_promotions` can't access `/admin/promotions`
- Two-layer security is good, but first layer is too coarse

### 2. **UI Navigation** (2 files)
Components showing/hiding admin menu link:

**`/app/components/layout/TopBar.tsx` (line 284):**
```tsx
{session.user?.isAdmin && (
  <Link href="/admin">Admin</Link>
)}
```

**`/app/components/auth/UserMenu.tsx` (line 90):**
```tsx
{session.user?.isAdmin && (
  <MenuItem href="/admin">Admin Panel</MenuItem>
)}
```

**Status:** ❌ **Too restrictive**
- Users with granular permissions can't see admin link
- They have API access but can't navigate to the UI

### 3. **React Hooks - Not Used**
**`/app/hooks/usePermissions.ts`** exists with 7 hooks but **ZERO usage** in components:
- `usePermission(key)`
- `usePermissionValue(key)`
- `useCanPerformAction(key, targetValue)`
- `useIsAdmin()`
- `useAllPermissions()`
- `useAnyPermission(keys)`
- `useHasAllPermissions(keys)`

**Status:** ❌ **Created but not integrated**

## 📋 Recommended Actions

### Priority 1: Fix Navigation Visibility
**Files:** `TopBar.tsx`, `UserMenu.tsx`

```tsx
// Current (Too restrictive):
{session.user?.isAdmin && <Link href="/admin">Admin</Link>}

// Recommended (Check for any permission):
{session.user?.permissions && Object.keys(session.user.permissions).length > 0 && (
  <Link href="/admin">Admin</Link>
)}
```

### Priority 2: Update Admin Page Guards
**Option A - Keep coarse guard, check specific permissions in components:**
```tsx
// Page guard (allows anyone with ANY permission):
if (!session?.user?.permissions || Object.keys(session.user.permissions).length === 0) {
  redirect('/');
}
```

**Option B - Permission-specific guards (more granular):**
```tsx
// Example: /admin/ranks/page.tsx
const hasRankPermission = await checkPermission(
  session.user.id, 
  'rank:create' || 'rank:edit' || 'rank:delete'
);
if (!hasRankPermission) redirect('/admin');
```

### Priority 3: Use React Hooks in UI Components
Add permission-based UI visibility:

```tsx
// In client components:
import { usePermission } from '@/app/hooks/usePermissions';

function RankManagementButton() {
  const canManageRanks = usePermission('rank:edit');
  
  if (!canManageRanks) return null;
  
  return <button>Manage Ranks</button>;
}
```

## 📊 Permission System Summary

**Total Permissions:** 19
1. `user:edit` - Edit user details
2. `user:promote` - Promote users to higher ranks
3. `user:manage` - Full user management
4. `user:manage_permissions` - Manage permissions ⭐ NEW
5. `training:create` - Create new trainings
6. `training:edit` - Edit trainings
7. `training:delete` - Delete trainings
8. `training:mark` - Mark trainings as completed
9. `training:approve_request` - Approve training requests
10. `orbat:create` - Create ORBATs
11. `orbat:edit` - Edit ORBATs
12. `orbat:delete` - Delete ORBATs
13. `attendance:edit` - Edit attendance records
14. `attendance:view` - View detailed attendance
15. `rank:create` - Create ranks
16. `rank:edit` - Edit ranks
17. `rank:delete` - Delete ranks
18. `rank:manage_promotions` - Handle promotions
19. `admin:system` - Full system admin access

## 🎯 Current Implementation Status

| Layer | Status | Coverage |
|-------|--------|----------|
| **API Endpoints** | ✅ Complete | 65+ routes |
| **Admin Pages** | ⚠️ Too restrictive | 11 pages |
| **Navigation UI** | ❌ Needs update | 2 components |
| **Client Hooks** | ❌ Not used | 0 usages |
| **Permission UI** | ✅ Complete | Admin panel |

## 🔐 Security Posture

**Strengths:**
- All API operations protected with granular permissions
- Self-permission modification blocked
- Permission management requires special permission
- Sparse database storage (efficient)

**Weaknesses:**
- UI doesn't reflect granular permissions
- Admin pages inaccessible to non-admin staff with permissions
- Navigation links hidden from authorized users

## Next Steps

1. **Immediate:** Update TopBar/UserMenu to show admin link for anyone with permissions
2. **Short-term:** Replace admin page guards with permission-aware checks
3. **Medium-term:** Integrate `usePermissions` hooks throughout UI components
4. **Long-term:** Consider permission groups/roles for easier management

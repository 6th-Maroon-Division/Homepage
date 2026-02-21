# Permission System Audit Report

**Status:** ✅ Active and Enforced  
**Last Updated:** February 21, 2026

## Scope

This audit summarizes the current (code-verified) permission model and enforcement behavior across API routes, server page guards, and client UI visibility.

## Permission Model

- 22 granular permissions across 7 domains
- Permission values use integer range `0-255`
- Standard access check is `value > 0`
- Sparse storage in `UserPermission` (zero values are not stored)
- Session/JWT caches permission map for fast runtime checks

Domains:
- User (`user:*`)
- Training (`training:*`)
- ORBAT (`orbat:*`)
- Templates (`template:*`)
- Attendance (`attendance:*`)
- Rank (`rank:*`)
- System (`admin:system`)

## Enforcement Layers

### 1) API Route Authorization (Source of Truth)

Implemented patterns:
- Unauthenticated requests return `401`
- Unauthorized requests return `403`
- `checkPermission(userId, permissionKey)` guards protected actions
- Permission-management endpoints require `user:manage_permissions`

Permission management specifics:
- `PUT /api/users/[id]/permissions` blocks self-modification
- Permission changes are audit logged (`GRANT`, `REVOKE`, `MODIFY`)
- Audit metadata includes request context (IP/user-agent when available)

### 2) Server Page Guards

Admin pages use session + permission checks and redirect unauthorized users.

Examples:
- `/app/admin/users/page.tsx` → `user:manage`
- `/app/admin/trainings/page.tsx` → any of `training:create/edit/delete`
- `/app/admin/attendance/page.tsx` → `attendance:view` or `attendance:edit`
- `/app/admin/promotions/page.tsx` → `rank:manage_promotions`
- `/app/admin/messaging/page.tsx` → `admin:system`
- `/app/admin/orbats/new/page.tsx` → `orbat:create`
- `/app/admin/templates/page.tsx` → template manage perms or ORBAT read-only eligibility

### 3) Client UI Visibility

Permission hooks in `app/hooks/usePermissions.ts` are used for UX-level visibility:
- `usePermission`
- `usePermissionValue`
- `useAllPermissions`
- `useAnyPermission`
- `useCanPerformAction`

Important:
- UI checks are convenience/UX only
- API checks remain authoritative

## Template Access Split (Implemented)

Templates currently support two access modes:
- Full management: `template:create/edit/delete` (or admin)
- Read-only template usage: `orbat:create` or `orbat:edit`

This allows ORBAT-focused staff to consume templates without editing definitions.

## Key Protected Route Areas (Current)

- Users + permission APIs (`/api/users/*`)
- Trainings + training requests (`/api/trainings/*`, `/api/training-requests/*`)
- ORBAT + signup mutation routes (`/api/orbats/*`, `/api/subslots/*`, `/api/signups/*`)
- Attendance routes (`/api/attendance/*`, `/api/orbats/[id]/attendance*`)
- Ranks + promotions + migration (`/api/ranks/*`)
- Messaging send/admin actions (`/api/messaging/send`)
- Legacy import admin routes (`/api/admin/import/*`)

## Security Notes

Strengths observed:
- ✅ Multi-layer permission enforcement (API, server page, client visibility)
- ✅ Dedicated permission-management permission (`user:manage_permissions`)
- ✅ Self-permission modification blocked server-side
- ✅ Permission change audit trail implemented
- ✅ Session-backed permission caching in auth callbacks
- ✅ Admin navigation visibility adapts to available permissions

## Verification

Recommended verification commands:

```bash
npm run test:permissions
npm run build
```

## Related Documentation

- [Permissions Guide](./docs/PERMISSIONS.md)
- [Rank System](./docs/RANK_SYSTEM.md)
- [Project README](./README.md)

# Permissions System Guide

## Overview

The app uses a granular permission model with **22 permissions** in **7 domains**.

- Permission values are integers from `0` to `255`
- `0` means no access
- Any value `> 0` grants access for standard checks
- Some user-targeted operations also use hierarchy checks (`actorValue > targetValue`)
- Only non-zero values are stored in `UserPermission` (sparse storage)

## Permission Domains

### User Management (4)
- `user:edit`
- `user:promote`
- `user:manage`
- `user:manage_permissions`

### Training (5)
- `training:create`
- `training:edit`
- `training:delete`
- `training:mark`
- `training:approve_request`

### ORBAT (3)
- `orbat:create`
- `orbat:edit`
- `orbat:delete`

### Templates (3)
- `template:create`
- `template:edit`
- `template:delete`

### Attendance (2)
- `attendance:view`
- `attendance:edit`

### Rank (4)
- `rank:create`
- `rank:edit`
- `rank:delete`
- `rank:manage_promotions`

### System (1)
- `admin:system`

## Enforcement Model

Permissions are enforced at multiple layers:

1. **API routes (authoritative)**
   - `checkPermission()` and related guards in server code
2. **Server page guards**
   - Admin pages redirect unauthorized users
3. **Client UI visibility**
   - Buttons/actions hidden when permission is missing
4. **Session/JWT permission cache**
   - Permission map loaded into session to reduce DB reads

API checks remain the source of truth.

## Current Permission APIs

### User Permission Management
- `GET /api/users/[id]/permissions` — list all permission keys + current values for user
- `PUT /api/users/[id]/permissions` — update values (`0` deletes record, `>0` upserts)

Requirements:
- Caller must have `user:manage_permissions`
- Caller cannot modify their own permissions

### Permission Audit Log
- `GET /api/users/[id]/permissions/audit`
  - supports `limit`, `offset`, `action=GRANT|REVOKE|MODIFY`

Audit captures actor/target/permission/action/value changes and metadata (IP/user-agent when available).

## Template Access Model

Template UI uses split access:

- `template:create/edit/delete` (or admin) → full management
- `orbat:create` or `orbat:edit` without template perms → read-only template access

This enables ORBAT builders to use templates without editing template definitions.

## Developer Usage

### Server-side
- Use `checkPermission(userId, permission)` from `lib/auth-middleware.ts`
- For user-vs-user operations, use hierarchy-aware helpers where needed
- Return `401` for unauthenticated and `403` for unauthorized

### Client-side
- Use hooks from `app/hooks/usePermissions.ts`
  - `usePermission`
  - `usePermissionValue`
  - `useAllPermissions`
  - `useAnyPermission`
  - `useCanPerformAction`

Client checks are UX-only and do not replace server authorization.

## Verification

- `npm run test:permissions`
- `npm run build`

## Related Docs

- [Permission Audit](../PERMISSION_AUDIT.md)
- [Project README](../README.md)

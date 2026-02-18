# Permissions System Guide

## Overview

The platform uses a granular permission model with **22 permissions** across **7 domains**.

- Permission values are integers from `0` to `255`
- `0` means no access
- Any value `> 0` grants access
- Higher values support hierarchy-based logic where needed
- Only non-zero values are stored (sparse storage)

---

## Permission Domains

### User Management (4)
- `user:edit` — Edit user details
- `user:promote` — Promote users
- `user:manage` — Manage users/admin user operations
- `user:manage_permissions` — Grant/revoke user permissions

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

---

## Enforcement Layers

Permissions are enforced in multiple layers:

1. **API Routes (authoritative)**
   - Every protected route validates session + permission before action
2. **Server Page Guards**
   - Admin pages redirect unauthorized users
3. **Client UI Visibility**
   - Action buttons and controls are hidden/disabled for unauthorized users
4. **Session Permission Cache**
   - Permissions are loaded into session/JWT for efficient checks

> API checks are the source of truth. UI checks improve UX but are not relied on for security.

---

## Template Access Model

Templates use a split access model:

- `template:create/edit/delete` (or admin) → **full management**
- `orbat:create` or `orbat:edit` only → **read-only template access**

This allows ORBAT editors/creators to browse and use templates without managing template definitions.

---

## Permission Management Rules

- Managing user permissions requires `user:manage_permissions`
- Users cannot modify their own permissions (enforced server-side)
- Permission changes are audit logged

---

## Developer Usage

### Server/API checks

- Use `checkPermission(userId, permissionKey)` from auth middleware utilities
- Always return `401` for unauthenticated and `403` for unauthorized

### Client checks

- Use hooks from the permissions hooks module (`usePermission`, `useAnyPermission`, etc.)
- Treat hooks as UI helpers only; keep server/API checks in place

---

## Verification

Run these before merging permission-related changes:

- `npm run test:permissions`
- `npm run build`

---

## Related Docs

- [Permission Audit](../PERMISSION_AUDIT.md)
- [Project README](../README.md)

# Theme Snapshot Workflow

## Overview
The theme system now uses a snapshot-based approach to separate private theme edits from public theme updates. This ensures that:
1. Users can continue editing their private custom theme after it becomes public
2. Public themes only change when admin approves a change request
3. Each submission creates a snapshot of the theme's current state

## Workflow

### 1. Initial Theme Creation & Submission
```
User creates custom theme → Theme is created with isPublic=false
↓
User edits their private theme (name, colors, custom CSS)
↓
User clicks "Submit for Review"
↓
ThemeSubmission created with snapshot of current theme state:
  - snapshotName
  - snapshotBackground, snapshotForeground, etc. (11 color fields)
  - snapshotCustomCss
↓
Admin reviews submission in admin panel
↓
Admin approves → Theme updated with snapshot data AND isPublic=true
```

### 2. Requesting Changes to Public Theme
```
User's theme is now public (isPublic=true)
↓
User continues editing their PRIVATE custom theme
↓
User clicks "Request Change" (instead of "Submit for Review")
↓
New ThemeSubmission created with snapshot of current private theme state
↓
Admin reviews change request
↓
Admin approves → Public theme updated with snapshot data
↓
User's private theme remains independent and editable
```

## Key Components

### Database Schema
**ThemeSubmission Model**:
- `snapshotName`: String - Name of theme at submission time
- `snapshotBackground` through `snapshotBorder`: String - All color values
- `snapshotCustomCss`: String? - Custom CSS at submission time
- `status`: enum (pending, approved, rejected)

**Theme Model**:
- `isPublic`: Boolean - Whether theme is available to all users
- `createdById`: Int - The user who owns the private theme

### API Endpoints

#### POST /api/themes/submit
Creates a ThemeSubmission with snapshot of user's current custom theme:
```typescript
await prisma.themeSubmission.create({
  data: {
    themeId: customTheme.id,
    submittedById: session.user.id,
    message,
    status: 'pending',
    // Snapshot all current theme data
    snapshotName: customTheme.name,
    snapshotBackground: customTheme.background,
    // ... all other snapshot fields
  },
});
```

#### POST /api/themes/admin/submissions/[id]/approve
Applies snapshot to the theme when admin approves:
```typescript
await prisma.theme.update({
  where: { id: submission.themeId },
  data: {
    isPublic: true,
    // Apply all snapshot data to the theme
    name: submission.snapshotName,
    background: submission.snapshotBackground,
    // ... all other snapshot fields
  },
});
```

### UI Components

#### ThemeSettings.tsx
- Shows "Submit for Review" for private themes
- Shows "Request Change" for public themes
- Delete button only shown for private themes
- Uses `customTheme.isPublic` to determine UI state

## Example Flow

### Scenario 1: First-time submission
1. User creates "My Cool Theme" with blue colors
2. User submits for review
3. Snapshot created: name="My Cool Theme", background="#0000ff", etc.
4. Admin approves
5. Theme updated: isPublic=true, all fields from snapshot

### Scenario 2: Requesting changes to public theme
1. User's theme "My Cool Theme" is now public (isPublic=true)
2. User edits their private version to use red colors
3. User clicks "Request Change"
4. New snapshot created: name="My Cool Theme (Updated)", background="#ff0000", etc.
5. Admin approves
6. Public theme updated with red colors from snapshot
7. User's private theme remains editable and independent

## Benefits
- ✅ Users can freely edit their private themes
- ✅ Public themes only change through admin approval
- ✅ Admins review exact changes before applying
- ✅ Change history preserved in ThemeSubmission table
- ✅ No risk of accidental public theme modification

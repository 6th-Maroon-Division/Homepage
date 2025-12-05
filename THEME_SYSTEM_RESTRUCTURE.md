# Theme System Restructure - New Architecture

## Overview
Complete overhaul of the theme system to support collaborative theme creation, derived themes, and admin-user communication.

## Key Changes

### 1. Theme Types
**Two types of themes:**
- **Original**: User-created themes that start as private
  - Created by users and initially private
  - Must be submitted for review to become public
  - Cannot be edited after becoming public
  - Any user can submit change requests via the submission system
  
- **Derived**: Themes based on public themes with user modifications
  - Linked to parent theme via `parentThemeId`
  - Private to the user
  - Can be freely edited while private
  - Can be submitted for review to become public

### 2. Database Schema Changes

**Theme Model:**
```prisma
model Theme {
  type              ThemeType          @default(original)
  parentThemeId     Int?               // Links to parent public theme
  parentTheme       Theme?             @relation("ThemeHierarchy")
  childThemes       Theme[]            @relation("ThemeHierarchy")
  createdById       Int?               // No longer unique - users can have multiple themes
  customThemes      Theme[]            @relation("UserThemes")  // Changed from customTheme
}
```

**ThemeSubmission Model:**
```prisma
model ThemeSubmission {
  message           String?            @db.Text  // User's submission message
  adminMessage      String?            @db.Text  // Admin feedback/rejection reason
}
```

**New Enum:**
```prisma
enum ThemeType {
  original  // User-created theme that becomes public
  derived   // Theme based on a public theme with modifications
}
```

### 3. API Changes

#### GET /api/themes
Returns:
```json
{
  "publicThemes": [...],  // All public themes (original and approved derived)
  "customThemes": [...]   // User's private derived themes (array, not single object)
}
```

#### POST /api/themes
**Create or update themes:**
- Without `parentThemeId`: Creates **original** theme (private, can be edited until submitted and approved)
- With `parentThemeId`: Creates **derived** theme (private, editable)
- Themes cannot be edited after becoming public
- Users can only edit their own private themes

**Request body:**
```json
{
  "id": 123,  // Optional: for updating existing theme
  "name": "My Theme",
  "type": "derived",  // Optional: auto-detected from parentThemeId
  "parentThemeId": 1,  // Optional: for derived themes
  "background": "#000",
  // ... other color fields
}
```

#### POST /api/themes/derive
**Create a derived theme from a public theme:**
```json
{
  "parentThemeId": 1,
  "name": "My Custom Dark Theme",
  // Optional: custom color overrides
  "background": "#111",
  "customCss": ".custom { color: red; }"
}
```
Copies all values from parent theme, applies any provided overrides.

#### POST /api/themes/submit
**Submit theme change request:**
- Works for any public theme (not just user's own)
- Requires themeId + all snapshot fields
- Anyone can submit changes to any public theme
- Users can submit changes to their derived themes for approval

**Request body:**
```json
{
  "themeId": 1,
  "message": "Changed colors for better contrast",
  "name": "Dark Theme v2",
  "background": "#000",
  // ... all color snapshot fields required
}
```

#### POST /api/themes/admin/submissions/[id]/reject
**Admin rejects with feedback:**
```json
{
  "adminMessage": "Please adjust the primary color for better readability"
}
```

#### DELETE /api/themes?id=123
**Delete a theme:**
- Can delete derived (private) themes
- Cannot delete original public themes
- Requires theme ownership

### 4. Workflow Examples

#### Creating an Original Theme
```
1. User creates new theme → type='original', isPublic=false
2. User can edit and customize the theme
3. User submits theme for review
4. Admin approves → theme becomes public (isPublic=true)
5. Theme appears in public themes list for everyone
6. Creator cannot edit it anymore (locked)
7. Anyone can request changes via submissions
```

#### Creating a Derived Theme
```
1. User sees public theme they like
2. Clicks "Save as My Theme" or "Customize"
3. POST /api/themes/derive with parentThemeId
4. Derived theme created: type='derived', isPublic=false, parentThemeId set
5. User can freely edit colors/CSS
6. User can submit for review to make it public
```

#### Requesting Changes to Public Theme
```
1. User modifies a public theme (or their derived version)
2. Clicks "Request Changes to [Theme Name]"
3. POST /api/themes/submit with themeId + snapshot
4. Admin reviews submission, sees proposed changes
5. Admin approves → applies snapshot to public theme
   OR
   Admin rejects with feedback → user sees adminMessage
```

#### Admin Communication Flow
```
1. User submits theme changes
2. Admin reviews in admin panel
3. Admin rejects with message: "Please increase contrast on buttons"
4. User sees rejection message in their submissions
5. User makes changes and resubmits
6. Admin approves → changes applied
```

### 5. Migration

**Migration:** `20251205215849_restructure_theme_system`
- Created `ThemeType` enum
- Removed unique constraint on `Theme.name`
- Removed unique constraint on `Theme.createdById`
- Added `Theme.parentThemeId` and `Theme.type`
- Added `ThemeSubmission.adminMessage`
- Added indexes for performance

### 6. UI Requirements (To be implemented)

**Theme Settings Page:**
- Show list of public themes
- Each public theme has "Save as My Theme" button
- Show user's derived themes separately
- Each derived theme shows parent theme link
- Edit button only for derived themes
- Submit button for derived themes

**Submission Interface:**
- Allow requesting changes to any public theme
- Show admin messages on rejected submissions
- Display theme hierarchy (parent → child)

**Admin Panel:**
- Show snapshot preview for submissions
- Input field for rejection messages
- Display theme type and parent theme
- Show submitter (not necessarily theme creator)

## Benefits
✅ Anyone can suggest improvements to public themes
✅ Users can customize public themes without affecting originals
✅ Admin feedback helps users improve submissions
✅ Theme hierarchy shows relationships
✅ Original themes are protected from accidental changes
✅ Users can have multiple themes
✅ Clear separation between public and private themes

# Rank System Brainstorm - Summary

**Status**: ✅ Complete  
**Date**: January 19, 2026  
**Output**: Design documents ready for implementation

---

## What We Designed

A comprehensive **dynamic rank system** for the ORBAT web platform with the following features:

### Core Features
- **Attendance-based progression**: Users rankup after accumulating configurable attendances from main ops.
- **Simple attendance baseline**: Store snapshot of total attendance at rankup; eligibility = `currentAttendance - attendanceSinceLastRank >= rankRequirement`.
- **Declined proposals**: Reset baseline to current attendance (no special logic; user just accumulates requirement from new baseline).
- **Auto vs manual rankups**: Ranks can be set to auto-rankup (apply immediately + announce) or require manual admin approval via web UI or Discord bot.
- **Training gating**: Rankups can be blocked by missing required trainings (e.g., BCT required for Cadet→Recruit).
- **Retired users**: Can attend and be logged but cannot progress or request trainings.
- **Interview flag**: Track interview completion; required to progress past Cadet.
- **Audit trail**: Full history of all rankups with attendance snapshots and actor information.
- **Legacy data import**: Bulk import from old system CSV with rank mapping and initialization.
- **Rank system migration**: Admin-friendly UI to rename ranks, adjust thresholds, and re-evaluate users.

### Key Decisions

| Aspect | Decision |
|--------|----------|
| **Attendance baseline** | Store snapshot of total attendance at rankup in `attendanceSinceLastRank` |
| **Eligibility formula** | `currentAttendance - attendanceSinceLastRank >= rankRequirement` |
| **Declined proposals** | Reset baseline: `attendanceSinceLastRank = currentAttendance` (clean, no special logic) |
| **Main ops only** | Attendance counted only if `orbat.isMainOp = true` |
| **Attendance statuses** | Only `present` status counts |
| **Auto rankup** | Apply immediately; announce to Discord and web UI |
| **Manual rankup** | Notify admins via Discord (#admin-promotions) + web UI toast |
| **Unretire** | Treated as rankup; admin chooses starting rank + whether BCT required |
| **Retired attendance** | Not counted toward progression; attendance logged but ignored |
| **Web UI notification** | Toast on login showing pending promotions count |
| **Bot notifications** | Send to Discord admin channel; inline buttons deferred to implementation |
| **Rank structure** | Single dynamic structure per system (no multi-template) |
| **Training prerequisites** | Support both rank requirements and training → training requirements (with cycle detection) |
| **Rank decay** | NOT implemented; removed from schema |
| **User rank history** | Users can see their full rankup history with attendance counts |

---

## Deliverables

Two comprehensive documents are now available in `/drafts/`:

### 1. `RANK_SYSTEM_DESIGN.md`
**Complete system specification** covering:
- Data models (11 new/updated Prisma models)
- Eligibility engine & reason codes
- Rankup flows (auto, manual, unretire, demotion)
- Admin interfaces (rank config, unranked list, promotions queue, history, migration wizard)
- Bot integration (4 API endpoints)
- Legacy data import process
- Rank migration scenarios
- Full API contracts (11 web endpoints, 4 bot endpoints)
- Implementation notes & future enhancements

**Page count**: ~400 lines; includes schema definitions, workflow diagrams (via text), and technical details.

### 2. `IMPLEMENTATION_CHECKLIST.md`
**Actionable task breakdown** organized by phase:
- **Phase 1**: Schema & database (10 schema tasks)
- **Phase 2**: Core backend APIs (7 API groups)
- **Phase 3**: Rankup automation (3 automation tasks)
- **Phase 4**: Admin web UI (5 UI pages)
- **Phase 5**: Training prerequisites (3 training tasks)
- **Phase 6**: Legacy import (2 import features)
- **Phase 7**: Notifications (framework)
- **Testing**: Unit, integration, UI tests
- **Performance, security, deployment** notes

**Total tasks**: 100+ checkbox items; easily tracked in project management tools.

---

## What Was Decided During Brainstorm

### Questions Answered (Project Lead)

1. **Declined proposal re-proposal window**: User must accumulate attendance for the *next* rank before eligible again (e.g., if Cpl→Sgt declined at 20 atts, user must reach Sgt's threshold before next proposal).
2. **Admin notification channels**: Both Discord admin channel (#admin-promotions) and web UI toast on login.
3. **Rank decay system**: Do NOT implement; removed from schema.
4. **Training history visibility**: Users can see their own rankup history (project lead to confirm: full history or hide attendance counts).

---

## Next Steps

### When Ready to Implement

1. **Review** the design documents with the project lead.
2. **Adjust** any requirements based on feedback.
3. **Kick off Phase 1**: Begin with Prisma schema updates and migrations.
4. **Track progress** using the implementation checklist.

### Expected Timeline (Estimate)

- **Phase 1-2** (Schema + Core APIs): 2-3 weeks
- **Phase 3-4** (Rankup automation + Admin UI): 2-3 weeks
- **Phase 5-6** (Training gating + Legacy import): 1-2 weeks
- **Phase 7** (Notifications + Testing): 1-2 weeks

**Total**: ~6-10 weeks for full implementation (depending on team size and priorities).

### Coordination

- **Project lead** should review and approve design before Phase 1 starts.
- **Bot team** should review bot endpoint contracts for integration planning.
- **QA team** should review test plan in implementation checklist.

---

## Files Generated

```
/home/chilla55/orbat-web/drafts/
├── RANK_SYSTEM_DESIGN.md          ← Main system specification
├── IMPLEMENTATION_CHECKLIST.md    ← Task breakdown by phase
└── BRAINSTORM_SUMMARY.md          ← This document
```

All documents are ready for sharing and handoff to the development team.

---

**Status**: Brainstorm Complete ✅  
**Ready for**: Implementation Kickoff  
**Questions?**: Refer to design documents or reconvene with project lead for clarification.

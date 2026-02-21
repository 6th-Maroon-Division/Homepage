# Rank System Documentation

## Overview

The rank system tracks user progression based on attendance, eligibility checks, and admin review workflows.

Implemented capabilities include:
- rank configuration and ordering
- automatic rankups for fully eligible users
- manual promotion proposals for review-required cases
- rank history/audit entries
- rank transition training requirements
- migration preview/apply tooling
- legacy user rank data import

## Core Data Model

### Primary Models
- `Rank`
- `UserRank`
- `RankHistory`
- `PromotionProposal`

### Related Requirement Models
- `RankTransitionRequirement`
- `TrainingRankRequirement`
- `TrainingTrainingRequirement`

### Legacy Import Models
- `LegacyUserData`
- `LegacyAttendanceData`

## Rank Eligibility

Eligibility logic is centralized in `lib/rank-eligibility.ts`.

Common outcomes:
- `eligible_auto`
- `eligible_manual`
- `ineligible_no_rank`
- `ineligible_attendance`
- `ineligible_retired`
- `ineligible_interview`
- `ineligible_training`
- `ineligible_max_rank`

Notes:
- auto-rankup paths update `UserRank` and write `RankHistory`
- manual-required outcomes create/maintain `PromotionProposal` records

## Current API Endpoints

### Rank CRUD and Ordering
- `GET /api/ranks`
- `POST /api/ranks`
- `PUT /api/ranks/[id]`
- `DELETE /api/ranks/[id]`
- `PUT /api/ranks/reorder`

### Promotions and Eligibility Flow
- `POST /api/ranks/promotions/propose`
  - creates pending proposal for manual flow
  - or performs immediate auto-rankup when `eligible_auto`
- `GET /api/ranks/promotions/pending`
- `POST /api/ranks/promotions/[id]/approve`
- `POST /api/ranks/promotions/[id]/decline`
- `POST /api/ranks/auto-rankup`

### Rank Migration
- `POST /api/ranks/migrate/preview`
- `POST /api/ranks/migrate/apply`

### Rank Transition Training Requirements
- `GET /api/ranks/[id]/transitions`
- `POST /api/ranks/[id]/transitions`
- `DELETE /api/ranks/[id]/transitions/[trainingId]`

### User-Facing Rank Data
- `GET /api/users/[id]/rank`
- `GET /api/users/[id]/rank-history?page=...`
- `PUT /api/users/[id]/rank/assign`
- `PUT /api/users/[id]/rank/demote`

### Bot Integration Endpoints
- `GET /api/ranks/bot/promotions`
- `POST /api/ranks/bot/promotions` (approve by `proposalId` in body)
- `POST /api/ranks/bot/promotions/[id]/decline`

Bot endpoints use Bearer token auth with `BOT_API_TOKEN`.

## Admin UI Areas

### Rank Configuration (`/admin/ranks`)
- create/edit/delete ranks
- drag-and-drop ordering + save order
- attendance requirement and auto-rankup settings
- training transition requirement assignment

### Pending Promotions (`/admin/promotions`)
- list pending proposals
- approve/decline with notes
- trigger auto-rankup process

### Rank Migration (`/admin/ranks/migrate`)
- strategies: `recalculate`, `grandfather`, `map`
- preview impact before apply
- applies updates with rank history entries

### Legacy Import (`/admin/import`)
- CSV upload
- preview records
- map legacy users to current users
- apply imported data to rank state/history

## User-Facing Rank Features

### Settings Rank Summary (`/settings`)
- current rank badge
- attendance since last rank
- link to rank history

### Rank History Page (`/settings/rank-history`)
- paginated timeline
- promotion/decline outcomes
- trigger source and attendance context

## Security and Authorization

- Admin pages are protected by session checks and/or permission checks.
- Rank APIs commonly require:
  - `rank:create`, `rank:edit`, `rank:delete`, or `rank:manage_promotions`
- Some pages additionally enforce `isAdmin` for high-impact workflows.
- User rank history access allows self-access; cross-user access requires `user:manage`.

## Operational Notes

- Attendance counts used for rank logic are based on present attendance in main operations.
- Rank changes write `RankHistory` for auditability.
- Migration `grandfather` strategy keeps current ranks unchanged.

## Related Docs

- [Permissions Guide](./PERMISSIONS.md)
- [Project README](../README.md)

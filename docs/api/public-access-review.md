# Public-access review

The user confirmed that logged-out visitors must be able to browse operations and all data shown by the ORBAT view. Public endpoints support anonymous access with the common payload/response/UTC conventions. Mutation authorization is unchanged. This is a read-only audit, not authorization to make unrelated endpoints public or to remove existing checks.

## Confirmed ORBAT flow

| Consumer / operation | Current evidence |
|---|---|
| `/orbats` initial page | [Page](../../app/orbats/page.tsx) reads ORBATs directly through Prisma without requiring a session. Personal training-session calendar entries are optional authenticated enrichment. |
| Calendar updates | [CalendarWithOps](../../app/orbats/components/CalendarWithOps.tsx) subscribes to `GET /api/orbats/events` and refreshes `GET /api/orbats/calendar`. Both allow anonymous ORBAT data; the calendar handles its session as optional. |
| `/orbats/{id}` initial detail | [Page](../../app/orbats/[id]/page.tsx) loads and serializes operation data directly through Prisma without requiring authentication. |
| Detail updates | [OrbatDetailClient](../../app/orbats/components/OrbatDetailClient.tsx) subscribes to `GET /api/orbats/{id}/events` and refreshes `GET /api/orbats/{id}/full`. Both currently allow anonymous access; SSE uses the public event projection. |
| Roles, requirements, ranks, frequencies | Initial detail and full-refresh responses embed these values. The public detail does not fetch the migrated standalone radio-frequency, subslot-definition, rank, or training catalogs. |
| Optional user controls | `/api/user/current`, ORBAT eligibility, and qualification-panel requests can fail authentication for anonymous visitors. The client retains ordinary viewing and hides or omits personalized/staff controls. |
| Editing catalog requests | Migrated radio-frequency/subslot requests occur in administrative [OrbatForm](../../app/components/orbat/OrbatForm.tsx), not the public detail view. |

No regression from the migrated catalog authentication was identified in this confirmed public ORBAT path. Preserve anonymous initial rendering, full refresh, calendar updates, and public event streams during future migrations. Anonymous regression tests for these ORBAT flows are required as part of that future migration; this read-only review does not claim those tests have been added or run.

## Additional candidates needing a product decision

Current source allows anonymous reads for `GET /api/orbats` (a small operation selector), `GET /api/users/{id}/attendance`, and `GET /api/users/{id}/attendance/stats`. The attendance helpers access Prisma directly without an authentication gate. These are observations, not confirmation that each should remain public. Authentication initiation/callback routes are separate transport exceptions, not business-data candidates. Automation routes with token checks through other helpers must not be classified as public from a missing direct session marker.

## Authentication added by earlier migrations: review, do not automatically undo

Comparing the pre-migration source at commit `a71b888` identifies these formerly anonymous GET handlers now protected by the shared API handler:

- `/api/radio-frequencies`
- `/api/training-categories`
- `/api/ranks`
- `/api/users/{id}/rank`

The radio-frequency POST was also unauthenticated previously; public-read requirements do not authorize public mutations. Training catalog GET was already session-protected before migration. Other public examples may exist: this bounded review is not a complete access certification. Keep protected behavior until the intended access for each candidate is confirmed, and add anonymous-access regression tests when migrating an explicitly public operation.

# Public-access review

The user confirmed that logged-out visitors must be able to browse operations and all data shown by the ORBAT view. Public endpoints support anonymous access with the common payload/response/UTC conventions. Mutation authorization is unchanged. The review began as a read-only audit. The public full-detail, calendar, and collection endpoints are now explicit migration batches; this does not authorize making unrelated endpoints public or removing their checks.

## Confirmed ORBAT flow

| Consumer / operation | Current evidence |
|---|---|
| `/orbats` initial page | [Page](../../app/orbats/page.tsx) collects the shared calendar service pages without requiring a session. Personal training-session entries use live authenticated enrichment and are not available to stale sessions. |
| Calendar updates | [CalendarWithOps](../../app/orbats/components/CalendarWithOps.tsx) subscribes to `GET /api/orbats/events` and refreshes `GET /api/orbats/calendar`. Both allow anonymous ORBAT data. Calendar responses now use the standard envelope and typed cursor pagination; sessions provide optional live enrichment. |
| `/orbats/{id}` initial detail | [Page](../../app/orbats/[id]/page.tsx) loads the shared `getPublicOrbat` projection without requiring authentication. |
| Detail updates | [OrbatDetailClient](../../app/orbats/components/OrbatDetailClient.tsx) subscribes to `GET /api/orbats/{id}/events` and refreshes `GET /api/orbats/{id}/full`. Both allow anonymous access; full detail uses the shared envelope/projection and SSE retains its public event projection. |
| Roles, requirements, ranks, frequencies | Initial detail and full-refresh responses embed these values. The public detail does not fetch the migrated standalone radio-frequency, subslot-definition, rank, or training catalogs. |
| Optional user controls | Browser session state controls optional actions; ORBAT eligibility and qualification-panel requests require their documented authentication. The old `/api/user/current` alias is removed. The client retains ordinary viewing and hides or omits personalized/staff controls. |
| Editing catalog requests | Migrated radio-frequency/subslot requests occur in administrative [OrbatForm](../../app/components/orbat/OrbatForm.tsx), not the public detail view. |

No regression from the migrated catalog authentication was identified in this confirmed public ORBAT path. Preserve anonymous initial rendering, full refresh, calendar updates, and public event streams during future migrations. Public-detail, calendar, and collection batches add anonymous regression coverage for full-detail reads, the shared server-rendering projection, calendar pages, and the operation list. Event-stream regression tests now cover anonymous access, explicit invalid/revoked tokens, payload minimization and listener cleanup.

## Other preserved public reads

The public `GET /api/orbats` selector is now migrated with an explicit anonymous contract; its recent-operation caller keeps `limit=5`. The migrated `GET /api/users/{id}/attendance` and `/attendance/stats` preserve their existing anonymous access while restricting responses to display data; private notes, logs and actors are excluded. Public wrappers validate explicit bearer credentials and audit returned other-user data, including anonymous reads. A question about restricting these reads received no answer, so the migration preserves access rather than inferring permission to restrict it. Authentication initiation/callback routes are separate transport exceptions, not business-data candidates. Automation routes with token checks through other helpers must not be classified as public from a missing direct session marker.

## Authentication added by earlier migrations: review, do not automatically undo

Comparing the pre-migration source at commit `a71b888` identifies these formerly anonymous GET handlers now protected by the shared API handler:

- `/api/radio-frequencies`
- `/api/training-categories`
- `/api/ranks`
- `/api/users/{id}/rank`

The radio-frequency POST was also unauthenticated previously; public-read requirements do not authorize public mutations. Training catalog GET was already session-protected before migration. Other public examples may exist: this bounded review is not a complete access certification. Keep protected behavior until the intended access for each candidate is confirmed, and add anonymous-access regression tests when migrating an explicitly public operation.

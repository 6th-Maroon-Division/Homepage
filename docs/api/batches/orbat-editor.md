# ORBAT editor API migration

`GET /api/orbats/{id}` remains restricted to `orbat:edit`; it returns the editor catalog with UTC dates, role definitions and `frequencyIds`, excluding creator and participant identities. It remains separate from public `/full`, whose display projection includes signups and attendance notes.

`PATCH /api/orbats/{id}` requires `orbat:edit`, returns `{data:{id},meta:{}}`, and accepts a nonempty subset of canonical creation fields. Dates use explicit UTC offsets; past dates are allowed when editing. Omitted fields remain unchanged. Timing is checked against the merged stored state. Legacy `eventDate`, `startTime`, `endTime`, slot `name`, and `_deleted` inputs are rejected.

A supplied `squads` array replaces the full structure. Squad and slot IDs are optional for new rows, must belong to this operation when supplied, and cannot repeat. Retained slots can move between squads without losing signups. Omitted slots are deleted along with their dependent signups/attendance. Unique negative staging positions safely handle swaps and large positive order indices. Position indices must be unique per scope, and all role and radio references are checked before mutation; retired roles return 409.

`DELETE /api/orbats/{id}` requires `orbat:delete` and returns `{data:null,meta:{}}`. All methods require positive Int32 path IDs, reject query parameters, accept live user sessions or active bot tokens, and use common errors. Missing records/references return 404, malformed JSON/path/query 400, invalid payloads 422, constraint/concurrency conflicts 409.

Both mutations use Serializable Prisma transactions containing the change, metadata-only audit, and bot outbox event. Audits capture affected participant IDs and dependent record IDs without attendance notes or operation prose. Realtime notifications run after commit and listener failures do not change committed success into an error. DELETE includes cascade and detached training-status-history identifiers.

OrbatForm and DeleteOrbatButton now use shared response handling. Edit submissions use full replacement arrays with deleted rows omitted and no legacy slot aliases. Template list/read calls in OrbatForm also use the shared client in coordination with the template migration.

Validation: `tests/api/orbat-editor.test.ts` covers all methods and shared auth, validation, dates, references, swaps, mutation effects, audit/outbox errors and listener failures. `tests/api-integration/orbat-editor.test.ts` exercises real Prisma nested changes, signup retention, attendance cascades, authorization and atomic rollback. Add `app/api/orbats/[[]id]/route.ts` to the migrated coverage inventory.

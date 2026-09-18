# Training requests, chat and per-user state

This batch migrates the request workflow to session or active bot authentication, standard `{data,meta}` responses, strict numeric IDs and UTC timestamps. Bots remain superadmin; their messages have no fabricated user sender. Website callers migrate together. The request SSE endpoint remains for the separate transport migration.

| Endpoint | Contract |
| --- | --- |
| GET `/api/training-requests` | Descending ID cursor pages, default 50/max 100, optional status. Visibility applies before pagination; metadata includes `isStaff`. |
| POST `/api/training-requests` | Required numeric `userId`, `trainingId`; optional nullable `requestMessage`. Returns common request DTO, 201. |
| GET `/api/training-requests/{id}` | Same flattened request DTO as collection, metadata `isStaff`; no embedded message collection or implicit read-state update. |
| PATCH `/api/training-requests/{id}` | Required workflow `status`, optional nullable `adminResponse`; replaces PUT. Existing transition rules apply. Cancellation uses DELETE. |
| DELETE `/api/training-requests/{id}` | Cancels pending/approved requests, returns null; retains attendance detachment and approved-credential removal. |
| GET/POST `/api/training-requests/{id}/messages` | GET ascending ID cursor pages; POST strict `{body}` returns message, 201. GET never marks messages read. |
| GET/PATCH `/api/training-requests/{id}/subscriptions/{userId}` | Two notification booleans; missing row reads as false without creation. PATCH is nonempty and partial; Discord enable requires a linked account. |
| PATCH `/api/training-requests/{id}/read-states/{userId}` | Strict `{lastReadMessageId}`, belonging to the request. Pointer only advances; older/equal values are no-ops. |

Request owners can read their own requests and chat. Staff requires positive `training:approve_request` or `training:mark`; mutations for other users also check the corresponding live permission hierarchy. On-behalf creation requires staff authority; ordinary creation still applies prerequisites, active-request exclusion, and retry cooldown. Subscription/read-state targets must themselves be eligible request participants; another target additionally requires hierarchy-aware `user:edit`. `me` is session-only; bots address numeric users.

The common DTO contains request scalars, training, minimal user display data, latest message, unread flag, caller subscription, and eligible scheduling information. Nonstaff cannot see staff chat identities, handling administrator, or unconfirmed trainer/session details. Chat pages return minimal sender display data, UTC dates, uppercase sender role and `isMine`; staff senders appear as “Staff” to members. Returned other-user records are audited without message bodies. Empty/self-only reads generate no personal-data audit.

Mutations retain credential/history transitions and notification preferences. Database inbox notifications, request messages, state updates and redacted audit records commit atomically. Realtime publication and Discord delivery happen after commit. Eligibility reads use the transaction connection; transaction retries clear queued notifications from unsuccessful attempts. Cancellation closes chat. Invalid fields return 422, malformed JSON/path/query 400, missing references 404, permission denial 403, workflow/concurrency conflicts 409; failed audit writes roll back the mutation.

Scheduling now uses `/api/training-sessions` POST or `/api/training-sessions/{id}` PATCH. Session creation accepts optional `requestAssignments: [{userId, trainingRequestId}]`: unique users and request IDs, users included in `attendeeUserIds`, and matching active request ownership/training. Missing mappings return 404; mismatches return 409. Omission preserves automatic request selection. Cancelled previous attendance links can be released atomically before reassignment. The old request `/schedule` and `/subscription` endpoints are removed, eliminating duplicate scheduling and implicit-current-user preference routes.

Validation: 65 request unit tests, 64 session unit tests including explicit mapping cases, and eight Prisma/PGlite request integration tests. Integration covers eligibility, workflow/credential history, hierarchy, bots/revocation, privacy, pure GETs, pagination, preferences, monotonic read state, cancellation, explicit scheduling, notification behavior and audit rollback. No developer database or raw SQL is used.

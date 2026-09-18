# Discord bot integration

Bots and the website use the same API resources. The canonical contract is [openapi.yaml](../openapi.yaml); [the route inventory](api/inventory.md) links handlers, callers and tests. Previous `/api/bot/*` aliases and legacy payload/response formats are removed together with the website migration.

## Authentication

Create a database-backed token through the application's bot-token administration (`/api/bot-tokens`). Send it on each request:

```http
Authorization: Bearer YOUR_DATABASE_BOT_TOKEN
Content-Type: application/json
```

Tokens are checked against the database on every request and during long-lived streams. Deactivation takes effect without redeploying. By the owner's explicit policy, active tokens have superadmin rights. An explicitly invalid bearer token never falls back to a website session or anonymous access. Tokens are secrets; store them only in your bot's server-side configuration. `BOT_API_TOKEN` is not an application authentication bypass.

`DISCORD_BOT_TOKEN` is a separate Discord credential used for provider requests/optional Discord delivery. It is not accepted as an application API token unless independently created as one (do not reuse secrets).

Protected resources accept either a live browser session or an active application bearer token and apply their resource permissions. Public operation list/full/calendar/available-slot/event views remain available anonymously. `me` is a browser-session alias; bots always supply numeric application user IDs.

## Shared request and response conventions

- Database IDs are positive Int32 JSON numbers; IDs in URL paths/query parameters are decimal text. Discord/Steam IDs remain strings.
- Reject unknown/repeated query keys and unknown payload fields. Updates use PATCH. JSON commands specify their documented body, including `{}` when no fields are needed.
- Timestamps are explicit ISO datetimes with an offset or Z; output uses UTC Z. Calendar-only values use `YYYY-MM-DD`.
- Success: `{data,meta}`. Error: `{error:{code,message,details,correlationId}}`, with matching `X-Request-Id` header.
- List pages default to50, cap100, and return `meta.nextCursor`; continue until null. Some bounded batch commands have separate documented limits. Durable events additionally return `resumeCursor` for the next polling run.
- Successful mutations and their audits commit atomically. Reads of someone else's personal data are audited; catalog and self-only reads are not. Audit records omit tokens, private message bodies and personal snapshots.

## Common resources

| Task | Canonical request |
| --- | --- |
| Find a linked Discord user | `GET /api/users?discordId=123456789012345678` |
| Find a linked Steam user | `GET /api/users?steamId=76561198123456789` |
| List operations | `GET /api/orbats?includePast=false` |
| Read public operation details | `GET /api/orbats/{id}/full` |
| List available slots | `GET /api/orbats/{id}/available-slots` |
| Check a user's slot eligibility | `GET /api/orbats/{id}/eligibility?userId=42` |
| Sign a user up | `POST /api/signups` with `{slotId:17,userId:42}` |
| Move/remove a signup | `PATCH` or `DELETE /api/signups/{id}` |
| Read/update an attendance note | `GET` / `PATCH /api/orbats/{id}/availability/{userId}` |
| Submit a join/leave event | `POST /api/attendance/events` |
| Submit a completed attendance session | `POST /api/attendance/sessions` |
| Compile an operation's raw events | `POST /api/orbats/{id}/attendance/compile` with `{}` |
| Link pending attendance identities | `POST /api/attendance/events/backfill` with `{limit:100}` |
| Read pending promotions | `GET /api/ranks/promotions/pending` |
| Approve/decline a proposal | `POST /api/ranks/promotions/{id}/approve` with `{}` or `/decline` with `{declineReason:"..."}` |
| Run automatic promotions | `POST /api/ranks/promotions/automatic` with `{}` |
| Trigger due training reminders | `POST /api/training-reminders` with `{}` |
| Send inbox messages | `POST /api/messages` |
| Read a user's inbox | `GET /api/users/{id}/messages` |
| Consume durable events | `GET /api/events?aggregate=rank` (`rank`, `orbat`, or `training`) |

See the OpenAPI contract and [batch notes](api/batches/) for all payloads, limits and permissions. Operation discovery returns minimal IDs/names; use full details and user-directory lookups instead of expecting embedded authentication accounts.

## Attendance examples

A known application user:

```json
{
  "userId": 42,
  "isJoin": true,
  "eventTime": "2026-09-18T18:00:00Z"
}
```

An external identity (exactly one of userId or identity):

```json
{
  "identity": { "provider": "steam", "providerUserId": "76561198123456789" },
  "isJoin": true,
  "eventTime": "2026-09-18T18:00:00Z"
}
```

Unknown identities remain pending until linked/backfilled. Completed sessions use numeric userId, optional orbatId and explicitly zoned checkinTime/checkoutTime. See [attendance automation](api/batches/attendance-automation.md) for operation windows, grace periods, side operations and duplicate handling.

## Durable events and realtime streams

`GET /api/events?aggregate=rank&cursor=0&limit=100` returns ascending durable event IDs as strings. Persist `meta.resumeCursor` after processing each successful page, and drain pages until `nextCursor:null`. Never convert BigInt event IDs to JavaScript numbers. SSE content negotiation (`Accept: text/event-stream`) supports `Last-Event-ID`, rechecks live credentials and uses canonical data/meta frames. Personal event payloads are minimized and audited before delivery.

Website event streams such as `/api/orbats/events` and `/api/users/{id}/events` are transient invalidation streams. They do not replay missed events; fetch the relevant canonical resource on reconnect. Do not treat them as a durable job queue.

## Minimal Node.js client

```js
const baseUrl = process.env.WEBSITE_API_URL;
const token = process.env.WEBSITE_API_TOKEN;

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

const page = await api('/users?discordId=123456789012345678');
const user = page.data[0];
if (user) await api('/signups', { method: 'POST', body: { userId: user.id, slotId: 17 } });
```

A separate bot process can use these APIs without coupling the Discord connection lifecycle to the website's request workers. The API contracts are language-independent; Node.js is one client option.

## Deployment

Apply the committed Prisma migrations through your normal deployment process before enabling the new code. Tests provision their own Prisma-managed PGlite database and do not apply migrations to development or production. Run `npm run test:backend` for the complete automatic backend gate; retain UI checks for browser interactions. See [testing](api/testing.md).

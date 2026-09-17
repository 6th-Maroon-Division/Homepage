# Automated API testing

The backend test goal is to verify every endpoint and supported method automatically, starting at 80% lines, branches, functions, and statements and increasing toward 100%. The current suite and coverage gate cover migrated batches, not the entire API. The [inventory](./inventory.md) tracks the remaining route surface; a test reference is not proof of per-method coverage.

## Commands

Use Node 24, matching CI. Install dependencies and generate Prisma Client:

```sh
npm ci
npm run prisma:generate
```

Run the fast unit/handler suite in `tests/api/`:

```sh
npm run test:api
```

Run that suite with the enforced coverage threshold:

```sh
npm run test:api:coverage
```

Reports are written to `coverage/api/`: HTML (`index.html`), LCOV (`lcov.info`), and JSON summary (`coverage-summary.json`), plus console output. The threshold currently covers `lib/api/`, notification-preference helpers, and the canonical migrated handlers. The first batch covered bot tokens, notification preferences, and audit logs; the second adds radio frequencies, subslot definitions, and training categories; the third consolidates Discord rank mappings. Consult [vitest.config.mts](../../vitest.config.mts) for the exact scope. Expand this scope with each migration batch; meeting the current threshold does not establish 80% coverage of all endpoints.

Run isolated database integration tests:

```sh
npm run test:api:integration
```

The runner starts a fresh, stateless Prisma-managed PGlite database on automatically assigned local ports, pushes the Prisma schema to that database, generates the client, runs `tests/api-integration/`, and closes the server. It overrides the child processes’ database URL with the temporary database URL. Tests use Prisma Client, with no raw SQL queries and no development database access. No PostgreSQL service or test database URL needs to be supplied. Local loopback ports must be available.

The integration setup supplies a real Prisma Client with the PostgreSQL adapter configured with `max: 1` and `maxUses: 1`. Retiring a connection after use avoids reusing a PGlite wire-transport socket after an intentionally triggered constraint error. This adjustment is test-only: it does not mock database results, bypass constraints, or change the production connection pool. The runner uses the public `startPrismaDevServer` API.

The integration-only Prisma PostgreSQL adapter uses one connection and retires it after each checkout (`max: 1`, `maxUses: 1`). This avoids PGlite socket reuse problems after constraint failures; each interactive transaction still holds one real connection through commit or rollback. Application connection pooling is unchanged, and no model or query is mocked. The runner preserves a failing exit status after database cleanup.

Unit tests use controlled doubles for authentication and failure cases; integration tests exercise database relations and transactional behavior through Prisma. PGlite does not establish production deployment, performance, or concurrency guarantees. The integration command is separate from the unit coverage calculation.

## CI and rollout

The [API tests workflow](../../.github/workflows/api-tests.yml) runs on pull requests and pushes to `main`, `master`, and `work/fixes-and-features`. It installs dependencies, generates Prisma Client, runs the coverage gate and integration suite, and uploads `coverage/api` as the `api-coverage` artifact even after failures. Failing tests or any coverage metric below 80% fail the job. Repository branch protection must require this job to make it a merge gate; the workflow alone does not configure that protection.

Each migrated endpoint must cover session and bot authentication, invalid/inactive/revoked credentials, permission and ownership/hierarchy checks, argument/payload validation, response contracts, and supported method behavior. Add pagination, UTC conversion/date boundaries, mutation rollback, audit attribution, and redaction checks where applicable. Track gaps before raising thresholds. Regenerate the route report after changes:

```sh
npm run api:inventory
```

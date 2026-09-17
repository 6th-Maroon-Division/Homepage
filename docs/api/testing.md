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

Reports are written to `coverage/api/`: HTML (`index.html`), LCOV (`lcov.info`), and JSON summary (`coverage-summary.json`), plus console output. The threshold currently covers `lib/api/`, notification-preference helpers, and the canonical migrated handlers. The [migration contract](./migration-contract.md) tracks each resource batch. Consult [vitest.config.mts](../../vitest.config.mts) for the exact scope. Expand this scope with each migration batch; meeting the current threshold does not establish 80% coverage of all endpoints.

Run isolated database integration tests:

```sh
npm run test:api:integration
```

The runner starts a fresh, stateless Prisma-managed PGlite database on automatically assigned local ports, pushes the Prisma schema to that database, generates the client, runs `tests/api-integration/`, and closes the server. It overrides the child processes’ database URL with the temporary database URL. Tests use Prisma Client, with no raw SQL queries and no development database access. No PostgreSQL service or test database URL needs to be supplied. Local loopback ports must be available.

The runner starts the database service from pinned `@prisma/dev` 0.24.3 through its exported `internal/db` and `internal/state` modules. The public launcher also starts a Streams/WAL sidecar whose background schema reads can interfere with deliberately failing transactions in PGlite's shared session. Running only Prisma's database service removes that unrelated background work. Prisma still provisions the emulator and applies the schema; tests continue to use real Prisma Client queries and database constraints. Review these internal exports when upgrading the pinned dependency.

The integration setup supplies a real Prisma Client with the PostgreSQL adapter configured with `max: 1` and `maxUses: 1`. Retiring each checkout avoids reusing a PGlite socket after a constraint error; each interactive transaction keeps its connection until commit or rollback. Application connection pooling is unchanged. These adjustments neither mock database results nor bypass constraints, and tests are not automatically retried. The runner closes both the database and its temporary server state, and preserves failing exit status after cleanup.

Unit tests use controlled doubles for authentication and failure cases; integration tests exercise database relations and transactional behavior through Prisma. PGlite does not establish production deployment, performance, or concurrency guarantees. The integration command is separate from the unit coverage calculation.

## CI and rollout

The [API tests workflow](../../.github/workflows/api-tests.yml) runs on pull requests and pushes to `main`, `master`, and `work/fixes-and-features`. It installs dependencies, generates Prisma Client, runs the coverage gate and integration suite, and uploads `coverage/api` as the `api-coverage` artifact even after failures. Failing tests or any coverage metric below 80% fail the job. Repository branch protection must require this job to make it a merge gate; the workflow alone does not configure that protection.

Each migrated endpoint must cover session and bot authentication, invalid/inactive/revoked credentials, permission and ownership/hierarchy checks, argument/payload validation, response contracts, and supported method behavior. Add pagination, UTC conversion/date boundaries, mutation rollback, audit attribution, and redaction checks where applicable. Track gaps before raising thresholds. Regenerate the route report after changes:

```sh
npm run api:inventory
```

# Automated API testing

The backend test goal is to verify every endpoint and supported method automatically, with an enforced 100% lines, branches, functions, and statements requirement. The release gate combines unit and real Prisma integration coverage across every API route and every library file. The [inventory](./inventory.md) tracks the remaining route surface; a test reference is not proof of per-method coverage.

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

Run the fast unit-only coverage report:

```sh
npm run test:api:coverage
```

The unit-only report remains in `coverage/api/` for quick feedback. The complete backend gate is:

```sh
npm run test:backend
```

This starts the same isolated Prisma database, runs both Vitest projects, and produces one combined coverage map. [vitest.backend.config.mts](../../vitest.backend.config.mts) includes **all** `app/api/**/route.ts` and `lib/**/*.ts`, including unimported files; only type declaration files are excluded. All four coverage metrics must reach 100%. Reports are written to `coverage/backend/` (HTML, LCOV, full JSON and JSON summary). Generated Prisma/framework code and UI components are outside the backend scope. Passing unit-only coverage does not replace this gate.

Run isolated database integration tests:

```sh
npm run test:api:integration
```

The runner starts a fresh, stateless Prisma-managed PGlite database on automatically assigned local ports, pushes the Prisma schema to that database, generates the client, runs `tests/api-integration/`, and closes the server. It overrides the child processes’ database URL with the temporary database URL. Tests use Prisma Client, with no raw SQL queries and no development database access. No PostgreSQL service or test database URL needs to be supplied. Local loopback ports must be available.

The runner starts the database service from pinned `@prisma/dev` 0.25.2 through its exported `internal/db` and `internal/state` modules. The public launcher also starts a Streams/WAL sidecar whose background schema reads can interfere with deliberately failing transactions in PGlite's shared session. Running only Prisma's database service removes that unrelated background work. Prisma still provisions the emulator and applies the schema; tests continue to use real Prisma Client queries and database constraints. Review these internal exports when upgrading the pinned dependency.

The integration setup supplies a real Prisma Client with the PostgreSQL adapter configured with `max: 1` and `maxUses: 1`. Retiring each checkout avoids reusing a PGlite socket after a constraint error; each interactive transaction keeps its connection until commit or rollback. Application connection pooling is unchanged. These adjustments neither mock database results nor bypass constraints, and tests are not automatically retried. The runner closes both the database and its temporary server state, and preserves failing exit status after cleanup.

Unit tests use controlled doubles for authentication and failure cases; integration tests exercise database relations and transactional behavior through Prisma. PGlite does not establish production deployment, performance, or concurrency guarantees. The standalone integration command is useful during development; the combined backend command measures both projects together.

## CI and rollout

The [API tests workflow](../../.github/workflows/api-tests.yml) runs on pull requests and pushes to `main`, `master`, and `work/fixes-and-features`. It installs dependencies, generates Prisma Client, runs the combined backend test/coverage gate, and uploads `coverage/backend` as the `backend-coverage` artifact even after failures. Failing tests or any coverage metric below 100% fail the job. Repository branch protection must require this job to make it a merge gate; the workflow alone does not configure that protection.

Each migrated endpoint must cover session and bot authentication, invalid/inactive/revoked credentials, permission and ownership/hierarchy checks, argument/payload validation, response contracts, and supported method behavior. Add pagination, UTC conversion/date boundaries, mutation rollback, audit attribution, and redaction checks where applicable. Track gaps before raising thresholds. Regenerate the route report after changes:

```sh
npm run api:inventory
```


## Migration completion check

The verified run passed 2,242 tests across 116 test files with 100% statements, branches, functions and lines. TypeScript and all 19 standalone regression tests also passed.

The expanded suite covers authentication and permissions, request validation, UTC boundaries, transaction conflicts and rollback, legacy imports, operation presets and signups, attendance, training workflows, ranks, audit privacy, notification failures and stream cancellation. Coverage includes every route and library, without new exclusions or ignored branches. The 100% code-coverage gate measures execution of those paths; it does not prove every possible input or production behavior. CI computes current results on each change.

`npm run api:check` verifies every exported method has an OpenAPI operation and a direct test import, rejects unfinished or stale operations, and resolves local schema references. This static contract check supplements behavioral coverage; an import alone does not prove adequate testing. The completed inventory contains 103 route files/155 methods with no missing or stale specification operations.

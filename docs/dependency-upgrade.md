# Dependency upgrade review — 18 September 2026

Versions were checked against npm package metadata and upstream release notes. Use the latest supported LTS line where one exists, otherwise the latest stable compatible release. Node.js is restricted to 24 LTS (`.nvmrc` and package engines), with matching Node 24 types. Prisma 8 prereleases are excluded. Most npm libraries do not publish separate LTS releases.

| Dependency | Selected version | Compatibility decision |
| --- | --- | --- |
| Next.js / eslint-config-next | 16.3.5 | Keep both packages aligned. React 19.3 satisfies Next's published React 19 peer range. Next's default type-checking integration still imports the TypeScript compiler API. [Next source](https://github.com/vercel/next.js/blob/v16.3.5/packages/next/src/lib/verify-typescript-setup.ts), [package metadata](https://github.com/vercel/next.js/blob/v16.3.5/packages/next/package.json). |
| React / react-dom | 19.3.0 | Upgrade together with React 19.3 types. New View Transitions and Fragment Refs are opt-in. Existing behavior changes include independent Transition rendering, number-input default-value handling, focus fixes and hydration fixes; browser form and navigation tests remain relevant. [Release notes](https://react.dev/blog/2026/09/09/react-19-3). |
| TypeScript CLI | 7.0.2 | Install as `@typescript/native: npm:typescript@7.0.2`, providing `tsc`. TypeScript 7 has no compiler API, so replacing the existing API package outright would break our AST scripts and dependent tooling. [Microsoft migration guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/). |
| TypeScript API compatibility | 6.0.2 package | Install as `typescript: npm:@typescript/typescript6@6.0.2`, providing the API and `tsc6`; this compatibility package delegates to TypeScript `^6`. Retains `import ts from 'typescript'` in `api-inventory.mjs`, `check-api-contract.mjs`, and `check-ui-coverage.mjs`, and supports Next/ESLint. Existing tsconfig already avoids removed ES5/baseUrl/node10 options. [Official side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/). |
| ESLint | 9.39.5 | Temporary compatibility exception to 10.x: ESLint 9 is end-of-life, not an LTS release. Published React, JSX accessibility and import plugins used by Next currently declare support through ESLint 9, despite Next's broader peer range. TypeScript ESLint also requires the TypeScript 6 API (`>=4.8.4 <6.1`). Its upstream deprecation warning remains expected during installation. Revisit when all installed plugins support 10. [ESLint support status](https://eslint.org/version-support/). [React plugin peers](https://github.com/jsx-eslint/eslint-plugin-react/blob/v7.37.5/package.json), [accessibility plugin peers](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/v6.10.2/package.json), [TypeScript ESLint policy](https://typescript-eslint.io/users/dependency-versions/). |
| dotenv | 18.0.0 | Keeps `import 'dotenv/config'`, used by Prisma configuration and the database module. Removes legacy preload configuration and `.env.vault` support; injection messages move to stderr. Repository has no vault/preload-option usage. Published v18 `./config` export was inspected and still invokes `config()`. [Changelog](https://github.com/motdotla/dotenv/blob/master/CHANGELOG.md), [release](https://github.com/motdotla/dotenv/releases/tag/v18.0.0). |
| Prisma CLI / client / pg adapter | 7.10.0 | Keep all three aligned on stable 7.10; the registry's Prisma 8 release candidate is deliberately excluded. Regenerate the client and validate the isolated test database harness after updating. [Stable release](https://github.com/prisma/orm/releases/tag/7.10.0). |
| next-auth | 4.24.15 | Stable v4 security patch. Provider-bound OAuth check cookies invalidate sign-ins already in flight during deployment; retry starts a fresh flow. Explicit NEXTAUTH_URL now wins over a forwarded host. Malformed Bearer values return null from getToken. Retain the existing native auth transports and canonical host configuration. [Release notes](https://github.com/nextauthjs/next-auth/releases/tag/next-auth%404.24.15). |

The TypeScript compatibility package is intentional: application/CLI checks can use native 7 while API consumers use supported 6. Do not replace aliases or force peer dependencies merely to clear an `npm outdated` entry.

## Prisma tooling security overrides

The stable Prisma CLI pins transitive dependencies below their patched releases. Scoped overrides keep the stable CLI while updating `@prisma/config`'s `deepmerge-ts` to 8.0.2 and Prisma's `mysql2` to 3.24.4. Deepmerge 8 changes Map/into APIs and some type exports; this configuration uses plain-record `deepmerge`, verified by generation and test database setup. MySQL2 remains on major 3; the application uses PostgreSQL. [Deepmerge release notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0), [MySQL2 changelog](https://github.com/sidorares/node-mysql2/blob/master/Changelog.md).

`@prisma/dev` is pinned at 0.25.2 and Prisma's nested copy uses the same version. Its published database/state APIs and CLI-facing server APIs were compared with the prior versions before upgrading. Both automated runners continue using only its database service, with isolated Prisma-managed PGlite databases.

## Validation after installation

- [x] Clean dependency installation and peer dependency tree.
- [x] Native `tsc` and compatibility `tsc6` checks; API inventory/contract and UI route checks.
- [x] Prisma client generation and isolated backend suite, preserving 100% backend coverage.
- [x] Playwright suite with isolated database; production build.
- [x] ESLint execution and any pre-existing diagnostics documented separately.
- [x] Final installed versions and any remaining intentional exceptions recorded.

Validation results:

- `npm ci`: succeeds without peer dependency conflicts; zero audit vulnerabilities. ESLint 9's deprecation warning remains the documented temporary exception.
- `npm ls --depth=0`: valid dependency tree.
- `npm run typecheck` (native TypeScript 7), `npx tsc6 --noEmit --incremental false`, `npm run api:check`, and `npm run ui:check`: pass.
- `npm run test:backend`: 2,242 passing tests, with 100% statements, branches, functions and lines across all 201 measured files.
- `npm run test:ui`: all 58 browser scenarios pass, including existing screenshot baselines.
- `npm run build`: production build passes. All 19 standalone regression tests pass.
- `npm run lint`: executes correctly but reports 51 errors and 58 warnings in existing code and generated coverage artifacts. No upgraded source file has lint diagnostics. This is not a lint-clean release.
- `npm audit`: zero vulnerabilities at verification time; future advisories may change this result.

External Steam/Discord provider login remains outside browser automation. Next.js 16.3's development server generates `AGENTS.md` and `CLAUDE.md`; those generated repository guidance files are retained in this upgrade.

## Existing Dependabot PR overlap

Compare against this branch's lockfile before merging overlapping dependency PRs. This does not close or merge any PR automatically.

| PR | Lockfile result |
| --- | --- |
| #75 baseline-browser-mapping | 2.11.25, newer than proposed 2.11.22 |
| #74 sharp / next | sharp 0.35.4 and Next.js 16.3.5 |
| #73 hono | No longer present in the dependency tree |
| #72 browserslist | 4.29.0, newer than proposed 4.28.9 |
| #70 fast-uri | 3.1.8, newer than proposed 3.1.7 |
| #69 @hono/node-server / prisma | Adapter no longer present; Prisma remains stable 7.10.0 |
| #68 nanoid | 3.3.19, newer than proposed 3.3.18 |
| #62 next-auth | 4.24.15 |
| #42 / #41 Tailwind / PostCSS plugin | Both 4.3.3, newer than proposed 4.3.2 |
| #40 Node typings | Intentionally uses 24.13.5 to match Node 24 LTS, instead of Node 26 |
| #39 / #38 Next / ESLint config | Both 16.3.5, newer than proposed 16.2.10 |

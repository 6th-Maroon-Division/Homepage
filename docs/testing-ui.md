# Automated UI tests

Playwright runs the website in Chromium and exercises browser interactions against the real application and API. These tests complement the backend suite: they catch problems such as a displayed slot limit that is missing from the submitted payload, stale calendar entries, and timezone conversion mistakes.

## Run locally

```sh
npm ci
npx playwright install chromium
npm run ui:check
npm run test:ui
```

The first browser installation downloads Chromium. Linux also needs its browser system libraries; CI installs these with `npx playwright install --with-deps chromium`. Local installation of missing system packages may require administrator access.

The test runner creates a disposable Prisma-managed database, applies the schema with Prisma, seeds fixtures through Prisma Client, starts the application, and runs the browser tests. It supplies the isolated database URL to the application and fixtures. It does not use the development database, require a running development server, or execute raw SQL to prepare test data. Database state is discarded after the run.

Run one UI suite at a time in a checkout. The runner holds `.ui-test-lock/` while working, so a second run fails immediately instead of overwriting shared Prisma-generated files and browser reports. The database, Next build output, temporary configuration, and fixture client are isolated per run; the application still uses the shared generated Prisma client. Avoid regenerating that client from another command during the run. Normal completion or interruption releases the lock. Remove a leftover lock only after confirming that the previous runner and its child processes have stopped.

To run a focused suite, pass Playwright arguments through the runner:

```sh
npm run test:ui -- member-pages.spec.ts
```

Authenticated scenarios use signed test sessions for seeded users. The application still validates the session and permissions through its normal authentication paths; there is no application authentication bypass or test login endpoint.

## Page coverage

Browser scenarios cover all 30 current `app/**/page.tsx` route patterns, including redirect-only pages and dynamic detail pages with seeded IDs. The suite exercises:

| Area | Browser checks |
| --- | --- |
| Public operations | Home redirect, public calendar and briefing, roles, hidden anonymous signup controls, member signup, live calendar refresh, Berlin summer/winter UTC conversions. |
| Member pages | Profile overview, attendance and rank-history tabs, saved notification preferences, leave dates, username changes, training requests and persisted chat messages, access denial for another member's request. Settings, rank-history and trainings aliases redirect to the profile. |
| Operation administration | Dashboard navigation, operation filtering, creation with a role, copying saved templates and previous ORBATs without copying signups, detail view, editing, deletion confirmation, and anonymous/member access restrictions. |
| Templates and catalogs | Template list, search, creation with the default slot limit, editing and its legacy alias; reusable slot roles; radio-frequency creation, updates and deletion; appearance information. |
| Users and training | User directory filtering and local profile edits, training creation and catalog filtering, promotion queue refresh, web notifications, attendance recording and statistics. |
| Tokens and ranks | Bot-token creation, rename, disable and deletion; rank creation, editing and deletion; rank migration wizard preview. |

`npm run ui:check` compares the application's page inventory with the literal `coveredPages` exports in browser specs. It fails for missing or stale route declarations. When adding a page, add a scenario that actually opens it and verifies its behavior, then declare its route pattern in the relevant spec. Dynamic patterns retain their source form, for example `/trainings/requests/[id]`.

The inventory check verifies declarations; `npm run test:ui` verifies behavior in Chromium. Coverage of every route does **not** mean every action, error state, permission combination, viewport, or browser is tested. For example, the rank migration scenario previews a strategy without applying it. This is not a claim of 100% UI code coverage or 80% browser coverage; the backend coverage threshold measures backend code separately. Expand scenarios as workflows and regressions require.

The initial run also exposed a date-format hydration mismatch in the public ORBAT view when server and browser locales differ. React recovers and the functional assertions pass; this suite does not yet fail on every browser console error. That rendering issue remains a follow-up.

Steam and Discord provider interactions are deliberately excluded from these automated scenarios. Real login redirects, provider approval screens, provider cookies, and external provider actions still need manual checks. Test sessions exercise authenticated website behavior without depending on external accounts or provider availability. Visual appearance and usability also remain useful manual checks.

## Continuous integration and failures

The `UI tests` GitHub Actions workflow runs on pull requests and pushes to `main`, `master`, and `work/fixes-and-features`. It installs Chromium, checks the route inventory with `npm run ui:check`, and runs `npm run test:ui` against the disposable database.

On failure, the workflow uploads `playwright-report/` and `test-results/` when present. Download these artifacts to inspect the failing steps and any captured browser diagnostics. Reports may contain seeded test data; do not replace test fixtures with production data or real login cookies.

To view a locally generated HTML report:

```sh
npx playwright show-report
```

Configuration reference: [Playwright browser options](https://playwright.dev/docs/test-use-options).

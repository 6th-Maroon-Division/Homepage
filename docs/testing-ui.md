# Automated UI tests

Playwright runs the website in Chromium and exercises browser interactions against the real application and API. These tests complement the backend suite: they catch problems such as a displayed slot limit that is missing from the submitted payload, stale calendar entries, and timezone conversion mistakes.

## Run locally

```sh
npm ci
npx playwright install chromium
npm run test:ui
```

The first browser installation downloads Chromium. Linux also needs its browser system libraries; CI installs these with `npx playwright install --with-deps chromium`. Local installation of missing system packages may require administrator access.

The test runner creates a disposable Prisma-managed database, applies the schema with Prisma, seeds fixtures through Prisma Client, starts the application, and runs the browser tests. It supplies the isolated database URL to the application and fixtures. It does not use the development database, require a running development server, or execute raw SQL to prepare test data. Database state is discarded after the run.

Authenticated scenarios use signed test sessions for seeded users. The application still validates the session and permissions through its normal authentication paths; there is no application authentication bypass or test login endpoint.

## Initial coverage

The initial regression suite covers:

- Public ORBAT viewing and hiding signup buttons when logged out.
- Member signup through the UI, verified against persisted data.
- Template creation with the default slot signup limit included in the saved data.
- Calendar refresh after ORBAT creation, deletion, and calendar detail changes.
- Berlin local operation times being saved as UTC and displayed correctly.

This is a starting suite for Chromium, not complete UI coverage or a claim of 80% browser coverage. The backend coverage threshold measures backend code separately. Add browser scenarios for further workflows and supported browsers as the suite grows.

The initial run also exposed a date-format hydration mismatch in the public ORBAT view when server and browser locales differ. React recovers and the functional assertions pass; this suite does not yet fail on every browser console error. That rendering issue remains a follow-up.

Real Steam and Discord login redirects, provider approval screens, and provider cookies still need manual checks. Test sessions exercise authenticated website behavior without depending on external accounts or provider availability. Visual appearance and usability also remain useful manual checks.

## Continuous integration and failures

The `UI tests` GitHub Actions workflow runs on pull requests and pushes to `main`, `master`, and `work/fixes-and-features`. It installs Chromium and runs `npm run test:ui` against the disposable database.

On failure, the workflow uploads `playwright-report/` and `test-results/` when present. Download these artifacts to inspect the failing steps and any captured browser diagnostics. Reports may contain seeded test data; do not replace test fixtures with production data or real login cookies.

To view a locally generated HTML report:

```sh
npx playwright show-report
```

Configuration reference: [Playwright browser options](https://playwright.dev/docs/test-use-options).

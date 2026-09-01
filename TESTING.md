# Testing

The project has two deliberately separate test layers:

- Vitest exercises the extension logic and package contracts without launching a browser.
- Playwright opens the packaged popup in Chromium and Firefox for browser-level rendering and security smoke tests.

## Setup

Use Node.js 20.19+, 22.13+, or 24+ and install the exact dependency versions from the lockfile:

```sh
npm ci
```

Playwright also needs the Chromium revision paired with the pinned Playwright version. Install it once, and repeat this command after a Playwright upgrade:

```sh
npx playwright install chromium firefox
```

CI uses `npx playwright install --with-deps chromium firefox` to install the Linux system libraries as well.

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run the fast browser-free suite; this is an alias for `test:unit`. |
| `npm run test:unit` | Run all Vitest unit and package-contract tests once. |
| `npm run test:watch` | Rerun affected Vitest tests while developing. |
| `npm run test:coverage` | Run Vitest and enforce the repository coverage thresholds. |
| `npm run test:e2e` | Run the popup smoke tests in Chromium and Firefox. |
| `npm run lint:extension` | Validate the package with Mozilla's extension linter. |
| `npm run test:all` | Run extension lint, coverage checks, and the browser suite. |

Use `npm test` for the quickest feedback while developing. Use `npm run test:all` before opening a pull request; CI runs this complete command on every push and pull request.

## Layout and extension

- Put unit and package-contract tests in `tests/` and name them `*.test.js`.
- Put browser user-flow tests in `e2e/` and name them `*.spec.js`.
- Keep WebExtension API fakes isolated per unit test so background state and event listeners cannot leak between cases.
- Prefer observable behavior over implementation details. For popup browser tests, install the `browser` API stub before navigation and use Playwright's web-first assertions.
- Update the manifest contract tests whenever an intentional permission or packaged-asset change is made.
- Add tests with every behavior change; coverage is a guardrail, not a substitute for boundary and event-flow cases.

Coverage includes every production JavaScript file outside the test, generated-report, dependency, and runner-config directories. Thresholds are enforced per file, so a new untested production module cannot be hidden by existing coverage.

## Expected-failure regression tests

Four background tests use Vitest's `it.fails` marker to keep confirmed concurrency defects executable while allowing the baseline suite to complete. They describe lost simultaneous storage updates, duplicate overlapping flushes, and stale asynchronous tab results superseding newer events. A test unexpectedly passing is treated as a failure so the marker must be removed when the production race is fixed.

These are known product limitations, not skipped checks. Serialize or version background state transitions and storage mutations before converting the four cases to ordinary tests.

Coverage reports are written to `coverage/`. Playwright writes its HTML report to `playwright-report/` and failure traces to `test-results/`. These generated directories are ignored by Git; CI retains browser diagnostics when a run fails.

## Missing browser executable

If Playwright reports that an executable does not exist, first run `npm ci` and then `npx playwright install chromium firefox`. A browser downloaded for another Playwright version is not necessarily compatible with the version pinned in this project.

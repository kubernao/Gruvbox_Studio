# Testing Guide

Gruvbox Studio uses a layered testing strategy to protect core desktop workflows, IPC contracts, and UI behavior. This guide maps each test tier to its purpose and commands so you can pick the smallest useful scope first and then scale up to broader confidence checks as needed.

## Test tiers at a glance

- Unit tests (`tests/unit/*.test.cjs`): Node/main-process and utility behavior.
- Vitest tests (`tests/vitest/**/*.test.ts[x]`): renderer logic, UI helpers, and feature-level logic.
- E2E tests (`tests/e2e/**/*.test.ts`): packaged app workflows through Playwright.

## Common commands

From repository root:

```bash
npm run test:unit
npm run test:vitest
npm test
```

Additional useful commands:

```bash
npm run test:e2e:preflight
npm run test:e2e:smoke
npm run test:visual
npm run test:ux
```

Quality gates:

```bash
npm run qa:fast
npm run qa:smoke
npm run qa:full
```

## E2E details

Playwright E2E tests run against the packaged app artifacts under `out/`, not a raw webpack main entry. This mirrors real user install behavior and reduces false positives caused by development-only loading paths.

Single-spec execution pattern:

```bash
node scripts/ensure-e2e-package.cjs && npx playwright test tests/e2e/<file>.test.ts
```

Trace report:

```bash
npx playwright show-report
```

## Choosing what to run

- Small logic or parser change: run targeted unit/vitest tests first.
- UI component behavior change: run relevant vitest specs, then targeted E2E.
- Main-process IPC or file/git behavior change: run affected unit tests and at least one E2E path that exercises the flow.
- Broad refactor or release prep: run `qa:full` and then full Playwright suite.

## Writing stable tests

- Prefer deterministic fixtures from `tests/fixtures/`.
- Avoid fixed sleeps; wait for explicit UI or state signals.
- Assert visible outcomes, not just interactions.
- Use stable selectors (`data-e2e-*`, robust role selectors) for E2E tests.

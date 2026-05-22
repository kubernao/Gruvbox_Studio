# E2E Testing Workflow

Playwright launches the **packaged app** under `out/` (from `npm run package`), not raw `.webpack/main/index.js`. That matches a real install and avoids missing offline renderer HTML.

## Commands
- Run all E2E tests: `npm test`
- Run targeted critical-path smoke E2E: `npm run test:e2e:smoke`
- Preflight only (build `out/` if missing): `npm run test:e2e:preflight`
- Run one spec: `node scripts/ensure-e2e-package.cjs && npx playwright test tests/e2e/<file>.test.ts`
- Open trace report: `npx playwright show-report`
- Playwright planner sub-agent: `npm run pw:planner -- --feature "<feature>" --journeys "a,b"`
- Playwright generator sub-agent: `npm run pw:generator -- --name "<spec name>"`
- Playwright healer sub-agent: `npm run pw:healer -- --spec "tests/e2e/<file>.test.ts"`
- Agent QA fast/smoke/full tiers: `npm run qa:fast`, `npm run qa:smoke`, `npm run qa:full`
- Machine-readable agent QA report: `node scripts/run-agent-qa.cjs --tier=fast`

## Suite design
- Shared Electron launch/bootstrap lives in `tests/e2e/helpers/electronApp.ts` (resolves `out/**/*.app/Contents/MacOS/*` on macOS, or `out/*/<productName>` on Linux).
- Prefer condition-based waits (`expect(...).toBeVisible`, `toHaveCount`) over sleep-based waits.
- Every critical-path test should assert both behavior and a visible user outcome.

## AI-assisted test authoring checklist
- AI-generated tests must use stable selectors (`data-e2e-*`, role selectors, text with clear scope).
- Tests must include explicit assertions for correctness (not only click-through steps).
- Tests cannot rely on fixed sleeps unless there is no observable readiness signal.
- Add fixture-backed inputs for reproducibility whenever possible.
- All AI-authored tests require human review before merge.

## Visual and UX checks
- `tests/e2e/visual-critical-ui.test.ts` catches clipped UI labels and enforces visual baselines via `toHaveScreenshot`.
- Update visual baselines intentionally with: `npx playwright test tests/e2e/visual-critical-ui.test.ts --update-snapshots`.
- `tests/e2e/ux-signals.test.ts` validates that UX friction signals (dead click / rage click) are tracked in renderer runtime.

## Production-signal scenario mining
- Run `npm run e2e:mine-scenarios` to transform UX/production signal data into a prioritized E2E backlog.
- Input data defaults to `tests/fixtures/ux-signals/production-signals.sample.json`.
- Journey-to-spec mapping lives in `tests/e2e/scenario-catalog.json`.
- Generated reports are written to:
  - `.cursor/reports/e2e-scenario-backlog.json`
  - `.cursor/reports/e2e-scenario-backlog.md`
- Prioritize `critical` and `high` rows first and convert unmapped journeys into deterministic specs under `tests/e2e`.

## Playwright AI sub-agent prompts
- `.cursor/playwright-agents/planner.md`
- `.cursor/playwright-agents/generator.md`
- `.cursor/playwright-agents/healer.md`

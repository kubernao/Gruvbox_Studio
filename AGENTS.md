# Gruvbox Studio Agent Rules

These rules apply to AI agents working from the repository root.

## Validation Resources

This project includes two Pi resources for structured code validation:

1. **Skill** (`.pi/skills/electron-validate/`) — Step-by-step validation layers. Invoke with `/skill:electron-validate` or let the agent auto-load it when validation is needed.
2. **Extension** (`~/.pi/agent/extensions/electron-validate.ts`) — Custom tools callable by the agent for targeted or comprehensive validation checks.

Available custom tools:
- `electron_typecheck` — TypeScript type checking only
- `electron_lint_bridge` — IPC bridge contract validation
- `electron_lint_styles` — CSS stylelint
- `electron_verify_generated` — Generated artifact integrity
- `electron_run_unit_tests` — Unit tests (Node native + Vitest)
- `electron_run_e2e` — Playwright e2e tests with preflight
- `electron_build` — Electron Forge packaging
- `electron_qa_fast` — Fast QA tier (typecheck + bridge + artifacts + unit)
- `electron_qa_smoke` — Smoke QA tier (fast + e2e smoke + submodule lint)
- `electron_validate` — Full multi-layer validation (all layers, stops on first failure)

Use these tools instead of raw bash commands when validating code changes.

## Mandatory targeted Playwright QA workflow

When the user asks for a bug fix, refactor, or feature implementation, the agent must not stop at code edits. The default verification path is targeted Playwright coverage for the changed behavior and likely regressions, iterated until green.

Required loop:

1. Implement requested change.
2. Create or update focused Playwright test(s) that validate:
   - the behavior changed by the task
   - at least one likely regression path around that change
3.0 Compile your new changes using `npm run package`
3. Run only the new/updated spec(s) (or a narrow related spec group), not the full suite by default.
4. If any targeted test fails, patch code/tests and rerun the same targeted set.
5. Repeat until targeted tests pass.
6. Report completion with the exact test command(s) run.

## Escalation policy (when broader QA is needed)

- Do not run full QA tiers (`smoke`/`full`) by default.
- Escalate to broader suites only when:
  - the user explicitly requests it, or
  - targeted failures indicate cross-cutting risk outside the touched area.
- If escalation is needed, prefer the smallest additional scope first.

## Autonomy requirement

- The agent should autonomously iterate without asking the user to manually run checks.
- The agent should surface grouped failures and what it fixed each iteration.
- The agent should stop only for true blockers (missing credentials, external services down, destructive ambiguity).

## Convenience commands

- `npm run qa:fast`
- `npm run qa:smoke`
- `npm run qa:full`
- `npm run qa:diagnose:fast`
- `npm run qa:diagnose:smoke`

Default for implementation tasks: run targeted Playwright spec(s) that cover the change and nearby regressions.

## Playwright AI sub-agents

This project includes three Playwright-focused AI sub-agent roles:

- Planner prompt: `.cursor/playwright-agents/planner.md`
- Generator prompt: `.cursor/playwright-agents/generator.md`
- Healer prompt: `.cursor/playwright-agents/healer.md`

Use helper commands:

- `npm run pw:planner -- --feature "<feature/bug>" --journeys "journey A,journey B"`
- `npm run pw:generator -- --name "<spec name>" [--dir tests/e2e]`
- `npm run pw:healer -- --spec "tests/e2e/<spec>.test.ts"`

Role contract:

1. Planner produces coverage plan + validation commands.
2. Generator implements deterministic tests from that plan.
3. Healer reproduces failures and emits machine-readable failure reports in `.cursor/reports/playwright-heal/`.

After any generator/healer changes, run the mandatory targeted Playwright loop from this file.

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
- `electron_build` — Electron Forge packaging
- `electron_qa_fast` — Fast QA tier (typecheck + bridge + artifacts + unit)
- `electron_validate` — Full multi-layer validation (all layers, stops on first failure)

Use these tools instead of raw bash commands when validating code changes.

## Verification workflow

When the user asks for a bug fix, refactor, or feature implementation, the agent must not stop at code edits. The default verification path is the fast QA gate plus any focused unit or Vitest specs that cover the changed behavior.

Required loop:

1. Implement requested change.
2. Run `npm run qa:fast` (or `electron_qa_fast` via Pi tools).
3. Add or update focused unit/Vitest tests when they materially cover the change or a likely regression.
4. If checks fail, patch code/tests and rerun the same scope.
5. Repeat until checks pass.
6. Report completion with the exact command(s) run.

Do not run Playwright or other E2E suites unless the user explicitly requests it.

## Escalation policy

- Do not run broad QA tiers by default.
- Escalate only when the user explicitly requests it, or when failures indicate cross-cutting risk outside the touched area.
- Prefer the smallest additional scope first (e.g. a single Vitest file before the full Vitest suite).

## Autonomy requirement

- The agent should autonomously iterate without asking the user to manually run checks.
- The agent should surface grouped failures and what it fixed each iteration.
- The agent should stop only for true blockers (missing credentials, external services down, destructive ambiguity).

## Convenience commands

- `npm run qa:fast`
- `npm run qa:diagnose:fast`
- `npm run test:unit`
- `npm run test:vitest`

Default for implementation tasks: `npm run qa:fast`, plus targeted Vitest specs when they add meaningful coverage.

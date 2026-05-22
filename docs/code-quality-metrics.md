# Code Quality Metrics

This report is intended to be reviewed monthly.

## Targets
- Cyclomatic complexity: `< 10` per function
- Function length: `< 50` lines
- File length: `< 400` lines (excluding generated artifacts)
- Test coverage: ratchet upward from current baseline each sprint
- Duplication: `< 3%`

## Monthly Review Template
1. Top 10 largest files and ownership.
2. Top complexity hotspots and decomposition plan.
3. Coverage trend and any new low-coverage areas.
4. Flaky tests and reliability issues.
5. Duplicate logic detected and consolidation candidates.

## Notes
- `submodules/pi-mono/packages/ai/src/models.generated.ts` is generated and excluded from manual quality targets.
- Generated artifacts must pass `npm run lint:generated`.

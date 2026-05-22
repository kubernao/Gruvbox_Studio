## Summary
- What changed and why

## Code Review Checklist
- [ ] Correctness: edge cases and error paths covered
- [ ] Design: responsibilities are focused and boundaries are clear
- [ ] Readability: names are meaningful and comments explain why
- [ ] Testing: added/updated tests for changed behavior
- [ ] Performance: no obvious regressions or N+1 style issues
- [ ] Security: no secrets, authz/authn paths preserved

## Review Comment Severity
- `nit:` minor optional improvement
- `suggestion:` non-blocking recommendation
- `blocking:` must fix before merge

## Quality Gate Results
- [ ] `npm run quality:ci`

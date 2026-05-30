# Troubleshooting

This guide collects high-frequency setup and runtime issues when developing Gruvbox Studio from source. It focuses on fast diagnosis paths tied to the current codebase and scripts, so you can quickly recover a working local environment without guessing.

## App starts but renderer does not load

Symptoms:

- Blank window
- Fallback hint page appears
- Console logs indicate renderer entry not loadable

Checks:

1. Start from repo root with `npm start` (preferred dev entrypoint).
2. Confirm webpack dev server port is `3001` unless overridden by `GRUVBOX_WEBPACK_PORT`.
3. If build artifacts are stale, clear and rebuild:

```bash
rm -rf .webpack
npm run package
```

Why this happens:

- Main process can start before dev server is ready, or renderer HTML on disk may be invalid for direct `file://` loading in a dev scenario.

## "Pi CLI not found" or Gruvie session fails to start

Checks:

```bash
npm run build:pi
```

If the repository is new on disk, ensure submodules were initialized first:

```bash
git submodule update --init --recursive
```

Why this happens:

- Pi integration binaries/scripts under `submodules/pi-mono` were not built yet or are stale.

## File operations fail with native addon errors

Checks:

```bash
npm run build:rust
```

If needed, run full dependency prep:

```bash
npm run build:prepare
```

Why this happens:

- Rust sidecar artifacts are missing, incompatible with current environment, or not copied into expected runtime paths yet.

## E2E tests fail before app launch

Checks:

```bash
npm run test:e2e:preflight
```

Why this helps:

- Preflight ensures packaged `out/` artifacts exist before Playwright attempts to launch the desktop binary.

## Credentials or key storage behavior is inconsistent

Checks:

- Confirm keys are set in app settings (primary source during desktop use).
- Verify optional environment variables only when intentionally using dev fallback behavior.
- Re-test with clean app restart after updating credentials.

Implementation note:

- Key storage is mediated in main process via `createCredentialsStore` and credential IPC registration, with keychain usage when available.

## Git operations in app return structured errors

Checks:

- Confirm selected folder is a git repository.
- Resolve local merge/rebase/cherry-pick states before retrying actions.
- Ensure paths referenced by git commands still exist.

Why this helps:

- Main-process git handlers normalize and classify errors (for example dirty tree, missing ref, merge in progress) and expect repository state to be coherent for each operation.

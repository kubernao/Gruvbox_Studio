# Development Workflow

This guide defines the standard local workflow for developing Gruvbox Studio from source. It emphasizes predictable setup, repeatable verification commands, and small incremental changes so contributors can move quickly without creating hidden build or runtime drift.

## Prerequisites

- Node.js 20+
- npm
- Rust toolchain (`rustup`, `cargo`) for the native sidecar
- Git with submodule support

## Initial setup

From the repository root:

```bash
git submodule update --init --recursive
npm install
npm run build:prepare
```

`build:prepare` performs:

- `build:pi` -> installs and builds `submodules/pi-mono`
- `build:rust` -> builds the Rust sidecar bridge artifacts

## Daily development loop

### Start the desktop app

```bash
npm start
```

Notes:

- Development renderer runs through Electron Forge webpack on port `3001`.
- Main-process changes (for example in `src/electron-main/main.js` or preload code) require an Electron restart to take effect.

### Fast verification gate

```bash
npm run qa:fast
```

This command is the quickest broad confidence check and runs:

- Typecheck
- IPC bridge verification
- Generated artifact checks
- Node unit tests

### Lint and type safety

```bash
npm run lint
```

`lint` currently runs typecheck plus IPC bridge checks. Additional style checks are available via:

```bash
npm run lint:styles
```

## Packaging workflows

### Local packaged build

```bash
npm run build:from-source
```

This runs preparation and then production packaging.

### Release package script

```bash
npm run release:desktop
```

Use this for production-focused packaging automation from project scripts.

## Environment and credentials notes

- `OPENROUTER_API_KEY` can be used as a local development convenience.
- App settings remain the primary source for runtime API keys in normal desktop usage.
- Optional keys:
  - `OPENAI_API_KEY` for cloud audiobook TTS
  - `GRUVBOX_BRAVE_SEARCH_API_KEY` or `BRAVE_API_KEY` for web search tools
- `GRUVBOX_PI_DEBUG=1` enables verbose Pi integration logging in main process flows.

## Recommended change strategy

- Keep changes focused and scoped by feature area.
- Verify behavior locally with the smallest relevant test command before broader runs.
- Update docs in the same PR when command names, architecture boundaries, or user-facing flows change.

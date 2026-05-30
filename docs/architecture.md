# Architecture Overview

Gruvbox Studio is an Electron desktop application with a React renderer, a Node-based Electron main process, and a Rust sidecar for performance-sensitive file and diff operations. The app is designed as a local-first writing environment with AI assistance, version control workflows, and document listening tools, while keeping user content in the local workspace by default.

## System components

### Electron main process

Primary entry point: `src/electron-main/main.js`.

Responsibilities:

- Owns native app lifecycle and window creation.
- Registers IPC handlers for file operations, git commands, AI orchestration, menu integration, and export flows.
- Bridges secure credential access through a credentials store (`src/electron-main/credentials/`).
- Coordinates native features like dialogs, shell open, and system-level behaviors.
- Initializes and routes events from the Rust bridge.

### Preload bridge

Primary entry point: `src/electron-main/ipc/preload.js`.

Responsibilities:

- Exposes a constrained `window.electronAPI` surface to the renderer.
- Enforces channel-level IPC allowlists.
- Provides safe wrappers for common operations (files, watcher, credentials, command palette, AI stream subscriptions).

### React renderer

Primary entry points: `src/frontend/main.tsx`, `src/frontend/App.tsx`.

Responsibilities:

- Implements the full UI shell and feature tabs (editor, Gruvie assistant, git, memory, listen, explorer, diff viewer).
- Uses context providers for shared state and orchestration (`DiffViewerProvider`, `FileExplorerProvider`, toast system, theme).
- Talks to the main process only through preload-exposed APIs.

### Rust sidecar

Directory: `rust-sidecar/`.

Responsibilities:

- Handles high-throughput or structured native operations such as file operations and diff/markdown helper functions.
- Exposes a stable IPC-compatible interface consumed by `RustBridge` in the main process.

### Pi submodule integration

Directory: `submodules/pi-mono/`.

Responsibilities:

- Provides the AI coding-agent stack used by Gruvie.
- Built from source via `npm run build:pi`.
- Invoked by main-process handlers under `src/electron-main/ipc/handlers/`.

## Runtime data flow

Typical request path:

1. Renderer action triggers a `window.electronAPI` call.
2. Preload forwards to an allowlisted IPC invoke channel.
3. Main process handler validates inputs and executes the operation.
4. Handler returns structured data or emits event streams back to renderer.
5. Renderer updates UI state and user-visible status.

For AI chat sessions:

1. Renderer initiates a session command through IPC.
2. Main process streams assistant events from Pi integration handlers.
3. Preload subscription listeners relay chunk/tool/progress events to the renderer.
4. Renderer merges stream events into chat and tool cards.

## Packaging and build architecture

Build orchestration is defined in `package.json` and `forge.config.js`.

- Electron Forge webpack plugin serves renderer in development (port `3001`).
- `build:prepare` builds dependencies required for local runtime (`build:pi` and `build:rust`).
- Packaging includes extra runtime resources (`dist-rust`, `submodules/pi-mono`, `node_modules/keytar`, icons).
- Post-package hook copies `keytar` into packaged resource paths so native resolution works consistently.

## Key boundaries

- Renderer does not directly access Node APIs or filesystem internals.
- IPC contracts define permitted calls between renderer and main process.
- Main process centralizes privileged operations and security checks.
- Rust sidecar is called through bridge abstractions, not directly from renderer.

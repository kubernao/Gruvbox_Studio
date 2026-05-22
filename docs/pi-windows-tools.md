# Pi tools on Windows (Gruvbox Studio)

## Shell / `bash` tool

Pi’s built-in **`bash`** tool runs commands through the coding-agent shell integration (see Pi settings: shell path, command prefix). On Windows:

- Prefer **Git Bash** or **PowerShell** explicitly in Pi agent settings if commands assume Unix-style paths or `grep`/`sed`.
- Paths in tool arguments are often **workspace-relative**; Gruvbox passes the explorer **root** as Pi’s `cwd`, so `read`/`edit`/`write` use that tree.

## Line endings and paths

- Workspace paths may use `\`; the assistant resolves **`gruvbox_open_file`** relative paths against the explorer root before calling `selectFile`.
- If a tool returns “file not found”, verify the path is under the opened folder or use an absolute path.

## Debugging

- Set **`GRUVBOX_PI_DEBUG=1`** on the Electron main process to log Pi spawn vs **session reuse** (`pi session: spawn new child` / `pi session: reuse child`) and stderr tails.
- See [pi-integration-debug.md](./pi-integration-debug.md) for the full symptom matrix.

# Git branch list line parsing

Plain `git branch` (and `--list`) prints a two-character prefix column ahead of branch names:

- `*` marks the branch checked out in the **current** worktree.
- `+` marks the branch checked out **elsewhere**, typically another linked worktree.
- Rows may be left-padded with spaces so the markers still align vertically.

Consumers that strip only `*` accidentally leave branch names literally starting with `+ `, which breaks `git switch`, destructive deletes, and UI pickers. **All parsers that touch `git branch` output must funnel through [`src/electron-main/utils/gitBranchListLine.js`](../src/electron-main/utils/gitBranchListLine.js)** (`normalizeGitBranchListLine`).

Embedded consumers include Electron IPC (`git-provider` handlers), Pi GUI cleanup helpers, and CLI maintenance scripts such as [`scripts/cleanup-orphan-ai.cjs`](../scripts/cleanup-orphan-ai.cjs). Prefer mapping `normalizeGitBranchListLine(line)` → `{ name }` plus `.filter(Boolean)` after projecting names when mirroring orchestration-layer patterns.

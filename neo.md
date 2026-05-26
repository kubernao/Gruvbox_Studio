# Gruvbox Studio

**Local-first markdown editor** with **Gruvie**, a project-aware AI assistant for prose. Your manuscripts stay on disk; rules and memory live in Markdown you control.

<p align="center">
  <img
    src="assets/editor-gruvie-overview.png"
    alt="Gruvbox Studio: markdown editor with Gruvie AI panel beside an open document"
    width="900"
  />
</p>

> **Early preview.** Gruvbox Studio is under active development. Build from source today, or follow releases on the [landing site](https://gruvbox.studio/) and project Discord.

## Overview

Gruvbox Studio is the desktop application in the Gruvbox project: an Electron app with a markdown editor, Git history, Listen/audiobook tools, and **Gruvie**.

**Gruvie** runs locally via the [Pi](https://github.com/badlogic/pi-mono) coding-agent stack, talks to models through [OpenRouter](https://openrouter.ai/), and can read and update files in your workspace—including memory and style rules you write as Markdown.

## Why Gruvbox Studio

- **Cursor-shaped, writer-focused** — Project files, rules, and context stay in the workspace Gruvie can see, not in a paste buffer.
- **Local-first** — Documents live on your machine by default. You choose what leaves the disk (model API calls, optional cloud TTS).
- **Your workflow** — Global and project memory, voice guides, and guardrails are plain Markdown.
- **Bring your own keys** — The editor is free to use. Gruvie bills through your OpenRouter account.

## Features

- **Editor** — Markdown/MDX, CodeMirror, LaTeX, Mermaid, command palette
- **Gruvie** — Streaming chat, project memory, rules in Markdown, document tools, optional web search
- **Git** — Status, branches, commits, diff viewer
- **Listen** — Read aloud and optional cloud audiobook export
- **Gruvbox** dark theme throughout

## Quick start

```bash
git clone git@github.com:kubernao/Gruvbox_studio.git
cd Gruvbox_studio
git submodule update --init --recursive
npm install
npm run build:prepare
npm start
```

## Documentation

| Topic | Location |
|-------|----------|
| Gruvie / Pi | [docs/pi-integration-debug.md](docs/pi-integration-debug.md) |
| Git UI | [docs/git-README.md](docs/git-README.md) |
| Diff viewer | [docs/DiffViewer-README.md](docs/DiffViewer-README.md) |

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).

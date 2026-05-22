# Gruvbox Studio

Local-first markdown editor with **Gruvie**, a project-aware AI assistant powered by [OpenRouter](https://openrouter.ai/).

## Requirements

- Node.js 20+
- npm
- OpenRouter API key ([create one](https://openrouter.ai/keys))
- Optional: OpenAI API key for cloud TTS / audiobook MP3 generation only

## Quick start

```bash
cd Gruvbox_studio
npm install
npm run build:pi
npm start
```

On first launch, open **Gruvie** → settings (gear) → paste your **OpenRouter API key** → **Save keys** → pick a model → chat.

Keys are stored in the OS keychain when available, with a file fallback under your user data directory.

## Environment (optional)

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | Dev convenience; UI settings override for the desktop app |
| `OPENAI_API_KEY` | Cloud TTS when not set via settings UI |
| `GRUVBOX_BRAVE_SEARCH_API_KEY` | Brave Search for Gruvie `web_search` tool |
| `GRUVBOX_PI_DEBUG=1` | Pi IPC debug logging |

## Project layout

- `src/electron-main/` — Electron main process, credentials, Pi IPC
- `src/frontend/` — React UI
- `submodules/pi-mono/` — Pi coding-agent (build with `npm run build:pi`)
- `docs/pi-integration-debug.md` — troubleshooting Gruvie

## License

See [LICENSE](../LICENSE) in the repository root.

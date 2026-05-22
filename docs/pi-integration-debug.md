# Gruvie (Pi) integration debug

## Flow

1. **Renderer** — `AIAssistantTab` sends `pi-gui` IPC (`list-models`, `send-message`, …).
2. **Main** — [`pi-gui.js`](../src/electron-main/ipc/handlers/pi-gui.js) loads models from OpenRouter (`GET https://openrouter.ai/api/v1/models`), spawns Pi RPC with `OPENROUTER_API_KEY`, and streams JSONL on stdout.
3. **Pi child** — coding-agent uses the built-in **openrouter** provider. Extensions: `gruvbox-editor-bridge`, `gruvbox-memory-tool`, `gruvbox-doc-tools`, `gruvbox-web-search`, reliability guards. **`web_search`** uses Brave when `GRUVBOX_BRAVE_SEARCH_API_KEY` or `BRAVE_API_KEY` is set.

## Environment

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | Set automatically in the Pi child from the key saved in Gruvie settings (or keychain). |
| `GRUVBOX_BRAVE_SEARCH_API_KEY` / `BRAVE_API_KEY` | Optional web search in Pi. |
| `GRUVBOX_PI_DEBUG=1` | Verbose `[gruvbox-pi]` logs in main. |
| `GRUVBOX_E2E=1` | E2E stubs (with `E2E_PI_STUB=1` for chat). |

## Common issues

| Symptom | Check |
|---------|--------|
| Empty models | OpenRouter key in Gruvie settings; key valid at https://openrouter.ai/keys |
| “Pi CLI not found” | `npm run build:pi` from Gruvbox_studio |
| Chat 401 | Replace OpenRouter API key in settings |
| Cloud TTS fails | Separate **OpenAI** key in settings (TTS only) |

Model ids use the `openrouter/<id>` prefix (Pi convention).

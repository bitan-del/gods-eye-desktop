# Gods Eye Desktop

> The official desktop client for the Gods Eye AI platform.

[![Version](https://img.shields.io/badge/version-1.9.13-32CD32?style=flat-square)](https://github.com/bitan-del/gods-eye-desktop/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-32CD32?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6C757D?style=flat-square)](https://github.com/bitan-del/gods-eye-desktop/releases)

---

## About

Gods Eye Desktop is a cross-platform desktop application that serves as the primary interface to the Gods Eye AI gateway. It provides a unified workspace where you can interact with 100+ AI models, install community skills, and manage autonomous agents — all from one app.

### Key Features

- **100+ AI Models** — Google Gemini, DeepSeek, OpenAI, Anthropic, Mistral, Qwen, and many more. Switch models mid-conversation.
- **55,000+ Skills** — Browse and install community-built skills from the built-in Skill Store.
- **Agent Workspace** — AI agents that can read/write files, execute code, search the web, and automate tasks on your machine.
- **Multi-Agent Support** — Run multiple AI agents simultaneously in separate sessions.
- **Remote Access** — Connect to your AI workspace from anywhere through the gateway.
- **Cross-Platform** — Native builds for macOS (Intel + Apple Silicon), Windows (x64), and Linux (amd64).

---

## Download

Get the latest release for your platform:

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [Gods Eye-mac-arm64.dmg](https://github.com/bitan-del/gods-eye/releases) |
| macOS (Intel) | [Gods Eye-mac-x64.dmg](https://github.com/bitan-del/gods-eye/releases) |
| Windows (x64) | [Gods Eye-win-x64.exe](https://github.com/bitan-del/gods-eye/releases) |
| Linux (amd64) | [Gods Eye-linux-amd64.deb](https://github.com/bitan-del/gods-eye/releases) |

Or install via the one-liner:

```bash
curl -fsSL https://gods-eye.org/install.sh | bash
```

---

## Build from Source

```bash
git clone https://github.com/bitan-del/gods-eye-desktop.git
cd gods-eye-desktop

# Install dependencies
npm install

# Development
npm run dev

# Production build
npm run build
```

---

## How It Works

Gods Eye Desktop connects to the Gods Eye gateway — a local (or remote) Node.js service that manages AI model routing, plugin loading, and tool execution.

```
+--------------------+          +--------------------+
|                    |  WS/HTTP |                    |
|   Gods Eye         |<-------->|   Gods Eye         |
|   Desktop          |  :18789  |   Gateway          |
|   (Electron)       |          |   (Node.js)        |
+--------------------+          +--------------------+
                                         |
                                +--------+--------+
                                |        |        |
                              Gemini  DeepSeek  OpenAI
                              Claude  Qwen     100+ more
```

1. Start the gateway: `godseye gateway run`
2. Open Gods Eye Desktop — it auto-discovers the gateway on your network
3. Chat, switch models, install skills, run agents

---

## Project Structure

```
src/
  renderer/        React UI — chat, settings, skill store, model picker
  process/         Electron main process — window management, IPC
  preload/         Preload scripts — secure bridge between main and renderer
  common/          Shared types, constants, utilities
  server.ts        Local auth server

resources/         App icons and platform assets
tests/             Unit and integration tests
scripts/           Build and packaging scripts
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron |
| UI | React + TypeScript |
| Build | Vite + electron-vite |
| Styling | UnoCSS |
| Packaging | electron-builder |
| Testing | Vitest + Playwright |

---

## Configuration

The app stores settings in your OS application data directory:

- **macOS**: `~/Library/Application Support/Gods Eye/`
- **Windows**: `%APPDATA%/Gods Eye/`
- **Linux**: `~/.config/Gods Eye/`

Gateway connection defaults to `ws://127.0.0.1:18789`. You can configure this in Settings.

---

## Related

- [Gods Eye](https://github.com/bitan-del/gods-eye) — Core AI gateway and runtime
- [gods-eye.org](https://gods-eye.org) — Official website and downloads

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

---

## License

[Apache License 2.0](./LICENSE)

---

**Gods Eye** — See everything. Automate anything.

<p align="center">
  <img src="https://img.shields.io/github/v/release/bitan-del/gods-eye-desktop?style=flat-square&color=32CD32" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-32CD32?style=flat-square&logo=apache&logoColor=white" alt="License">
  &nbsp;
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6C757D?style=flat-square&logo=electron&logoColor=white" alt="Platform">
</p>

---

<h1 align="center">Gods Eye Desktop</h1>

<p align="center">
  <strong>The official desktop client for Gods Eye — your AI command center.</strong><br>
  <em>Built with Electron + React + TypeScript</em>
</p>

<p align="center">
  <a href="https://github.com/bitan-del/gods-eye/releases">
    <img src="https://img.shields.io/badge/Download-Latest%20Release-32CD32?style=for-the-badge&logo=github&logoColor=white" alt="Download" height="40">
  </a>
  &nbsp;
  <a href="https://gods-eye.org">
    <img src="https://img.shields.io/badge/Website-gods--eye.org-0078D4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Website" height="40">
  </a>
</p>

---

## What is Gods Eye Desktop?

Gods Eye Desktop is a cross-platform Electron application that provides a modern chat interface to the [Gods Eye](https://github.com/bitan-del/gods-eye) AI gateway. It connects to your local or remote Gods Eye gateway and gives you:

- **Multi-model chat** — Switch between Google Gemini, DeepSeek, OpenAI, Anthropic, and 100+ more models
- **Skill Store** — Browse and install from 55,000+ community skills
- **Agent workspace** — File operations, code execution, web search, and automation
- **Remote access** — Connect from anywhere via the gateway
- **Cross-platform** — macOS (Intel + Apple Silicon), Windows, and Linux

---

## Quick Start

### Install from Release

Download the latest installer for your platform from [Releases](https://github.com/bitan-del/gods-eye/releases):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `Gods Eye-*-mac-arm64.dmg` |
| macOS (Intel) | `Gods Eye-*-mac-x64.dmg` |
| Windows | `Gods Eye-*-win-x64.exe` |
| Linux | `Gods Eye-*-linux-amd64.deb` |

### Build from Source

```bash
# Clone the repo
git clone https://github.com/bitan-del/gods-eye-desktop.git
cd gods-eye-desktop

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

---

## Architecture

```
gods-eye-desktop/
  src/
    renderer/       # React UI (chat, settings, skill store)
    process/        # Electron main process
    preload/        # Preload scripts for IPC
    common/         # Shared types and utilities
    server.ts       # Local web server for auth
  resources/        # App icons and assets
  tests/            # Unit and integration tests
  electron-builder.yml  # Build configuration
```

---

## How It Works

1. **Gods Eye Gateway** runs locally (or remotely) and manages AI model connections, plugins, and tools
2. **Gods Eye Desktop** connects to the gateway via WebSocket on port `18789`
3. You chat, switch models, install skills, and manage your AI workspace — all from one app

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│  Gods Eye        │ ◄──────────────►  │  Gods Eye         │
│  Desktop App     │    port 18789     │  Gateway          │
│  (Electron)      │                   │  (Node.js)        │
└─────────────────┘                    └──────────────────┘
                                              │
                                    ┌─────────┼─────────┐
                                    ▼         ▼         ▼
                                 Gemini    DeepSeek   OpenAI
                                 Claude    Qwen       100+
```

---

## Configuration

The desktop app auto-discovers the gateway via Bonjour/mDNS on your local network. You can also manually configure:

- **Gateway URL**: `ws://127.0.0.1:18789`
- **Auth Token**: Set in Gods Eye gateway config (`~/.godseye/godseye.json`)

---

## Tech Stack

- **Electron** — Cross-platform desktop framework
- **React** — UI components
- **TypeScript** — Type-safe codebase
- **Vite** — Fast build tooling
- **electron-builder** — Packaging and distribution
- **UnoCSS** — Utility-first CSS
- **Vitest** — Testing framework

---

## Related Projects

- [Gods Eye](https://github.com/bitan-del/gods-eye) — The AI gateway and core runtime
- [Gods Eye Website](https://gods-eye.org) — Download and documentation

---

## License

[Apache License 2.0](./LICENSE)

---

<p align="center">
  <strong>Gods Eye</strong> — See everything. Automate anything.<br>
  <a href="https://gods-eye.org">gods-eye.org</a>
</p>

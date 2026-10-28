# MonkeyPatch — Chrome Extension & Patch SDK for MonkeyBrain

**MonkeyPatch** is a Chrome Manifest V3 extension, Side Panel toolkit, and standardized TypeScript **Patch SDK** backed by **MonkeyBrain** (defaults to `https://stash.monkeybrain.cc`, or configurable via `.env`).

It provides a Tampermonkey-like workflow with built-in Quick Notes, interactive Quick CSS Rules / Element Tweaker, optional client-side End-to-End Encryption (`AES-256-GCM` + `HMAC-SHA256`), CORS-free background requests (`ctx.net`), live Side Panel UI (`ctx.panel`), and AI-agent-friendly patch conventions (`AGENTS.md`).

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Extension
- **Personal Build (includes your private scripts in `patches/personal/`):**
  ```bash
  npm run build:personal
  ```
  Outputs to `dist/personal/`.
- **Public Build (includes only `patches/examples/` + runs isolation verification):**
  ```bash
  npm run build:public
  ```
  Outputs to `dist/public/` and creates `dist/monkeypatch-public.zip`.

> **Windows Shortcut:** Double-click `rebuild-extension.cmd` to build both `personal` and `public` profiles automatically.

### 3. Load in Chrome
1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select `dist/personal` (or `dist/public`).

### 4. Customizing the API Server (Optional)
MonkeyPatch defaults to `https://stash.monkeybrain.cc`. If you self-host your own MonkeyBrain API server, copy `.env.example` to `.env` before building:
```dotenv
MONKEYBRAIN_API_URL=https://stash.monkeybrain.cc
```

---

## Creating Your Own Patches (with AI Coding Agents or Manually)

All personal patches belong in:
```text
patches/personal/<your-patch-name>/index.ts
```
`patches/personal/` is git-ignored so your personal scripts and host permissions are never committed to the public repository.

See **[AGENTS.md](./AGENTS.md)** for the complete Patch SDK reference (`ctx.store`, `ctx.panel`, `ctx.badge`, `ctx.net`, `ctx.page`, E2EE `{ encrypted: true }`, and document lifecycle `staleAt`/`expiresAt`) and **[DESIGN.md](./DESIGN.md)** for the Side Panel design system.

---

## Repository Structure

```text
MonkeyPatch/
├── src/
│   ├── background/       # MV3 service worker (per-origin API tokens, E2EE crypto, CORS fetch, context menus)
│   ├── content/          # Automatic URL patch matcher, SPA navigation observer, Quick CSS & Element Tweaker
│   ├── sdk/              # Strongly-typed Patch SDK (ctx.store, ctx.panel, ctx.badge, ctx.net, ctx.page)
│   ├── core/             # URL pattern matcher, crypto helpers & runtime messaging
│   └── popup/            # Chrome Side Panel UI (Output, Quick Notes & CSS Rules, Scripts, Server & DB Inspector)
├── patches/
│   ├── examples/
│   │   └── demo/         # Example patch (Demo Page & Domain Notes)
│   └── personal/         # Git-ignored directory for your private patches
├── scripts/
│   ├── build.mjs               # Vite multi-target build pipeline (personal & public profiles)
│   ├── patch-discovery.mjs     # Automatic patch discovery & virtual:patch-registry plugin
│   └── verify-public-build.mjs # Fail-closed verification ensuring personal patches never leak into public builds
├── AGENTS.md             # Guide & guardrails for AI coding agents creating new patches
├── DESIGN.md             # UI/UX color ramp & typography design system
├── manifest.json         # Base Chrome Manifest V3 definition
└── package.json
```

---

## Running Unit Tests

```bash
npm test
```

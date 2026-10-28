# Example Patch: Demo Page & Domain Notes (`demo-notes`)

This demonstration patch shows how to build a self-contained site modification using the **MonkeyPatch SDK** without any specialized backend endpoints.

## Features
- Matches `https://example.com/*` and the local MonkeyBrain Demo Sandbox (`/demo`).
- Injects a floating notes widget in the bottom-right corner.
- Associates every saved note with two resources:
  - `url:<current-page-url>`
  - `domain:<current-hostname>`
- Supports toggling between **This Page URL** notes and **Domain-Wide** notes.
- Supports creating, editing (`store.set()`), and deleting (`store.delete()`) notes.
- Automatically cleans up and refreshes when single-page application (SPA) navigation occurs.

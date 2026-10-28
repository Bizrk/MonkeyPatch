# AGENTS.md — AI Coding Agent Guide for MonkeyPatch

This repository contains **MonkeyPatch**, a Chrome Manifest V3 extension runtime and Patch SDK designed to run site-specific browser modifications called **patches**, backed by a **MonkeyBrain** API server (`https://stash.monkeybrain.cc`, `http://localhost:27246`, or custom HTTPS).

Before creating or modifying any patches, read and follow the architectural rules and security boundaries in this document.

---

## 1. Core Architectural Principle

**MonkeyPatch defines site-specific browser behavior. MonkeyBrain provides generic cloud storage.**

- **MonkeyPatch (this repo):** Runs site-specific browser modifications called **patches**. Each patch defines its own namespace, document types, JSON data shapes, resource tags, URL matchers, DOM extractors, Side Panel output views, and UI overlays.
- **MonkeyBrain API:** Provides authentication, tenant isolation, revocable API tokens, and a generic document store (`POST /api/documents`, `POST /api/documents/upsert`, `POST /api/documents/query`, resource associations).

---

## 2. Default Behavior When Asked to Create a New Patch

When the user asks you to create a new site-specific patch (e.g., *"Add a patch for website ABC that collects XYZ data and displays a summary on another page"*):

1. **Default to `patches/personal/<patch-name>/`:**
   - **Personal is ALWAYS the default destination for new patches.**
   - Only place a patch in `patches/examples/` if the user **explicitly** states the patch is for public distribution.
2. **Self-Contained Patch Directory:**
   - Create a dedicated directory under `patches/personal/<patch-name>/`.
   - Never modify unrelated patches.
   - Do **not** modify `src/` core runtime files unless the generic platform genuinely lacks a required capability.
3. **Preserve Git Separation:**
   - `/patches/personal/` is ignored by `.gitignore` so personal patches are never accidentally committed to the public `MonkeyPatch` repository (and `patches/personal/` can optionally be initialized as its own private Git repository).
   - Never force-add (`git add -f`) personal patches into the public `MonkeyPatch` repository.
4. **Build & Verify:**
   - Run `npm run build:personal` to compile the personal extension into `dist/personal/`.
   - Run `npm run build:public` to verify the public build still compiles cleanly and passes the isolation verification check (`verify:public`).

---

## 3. Which Directories Agents May Modify for a New Patch

| Directory | Allowed When Creating a Patch? | Notes |
|---|---|---|
| `patches/personal/<patch-name>/` | **YES (Default)** | Create `index.ts`, `extractor.ts`, `ui.ts`, `styles.css`, `README.md` here. |
| `patches/examples/<patch-name>/` | **Only if explicitly requested as Public** | Included in public builds and `monkeypatch-public.zip`. |
| `src/**` | **NO** (unless upgrading core SDK/runtime) | Patch discovery is automatic via `virtual:patch-registry`. Do not hardcode patch imports in core files. |

---

## 4. Patch Directory Conventions & Registration Interface

Each patch lives in its own folder:

```text
patches/personal/my-patch/
├── index.ts        # Required: Default export implementing MonkeyPatchDefinition
├── extractor.ts    # Optional: DOM scraping / page metadata extraction helpers
├── ui.ts           # Optional: Overlay / widget mounting & DOM cleanup
├── styles.css      # Optional: Scoped CSS imported via `?inline`
└── README.md       # Optional: Documentation of resources, keys, and permissions
```

### Patch Registration (`index.ts`)

Every patch must have an `index.ts` (or `index.tsx`) that default-exports a `MonkeyPatchDefinition`:

```typescript
import type { MonkeyPatchDefinition } from '../../../src/sdk/types';

const myPatch: MonkeyPatchDefinition = {
  id: 'jira-helper',
  name: 'Jira Ticket Notes & Context',
  description: 'Collects ticket metadata and displays cross-page notes.',
  matches: [
    'https://*.atlassian.net/browse/*',
    'https://*.atlassian.net/jira/*'
  ],
  // Optional: Merged into dist/personal/manifest.json only during build:personal
  hostPermissions: [
    'https://*.atlassian.net/*'
  ],
  runOnSpaNavigation: true,
  // Set true if this patch publishes to the Chrome Side Panel "Output" tab via ctx.panel.set(...)
  // When true, opening the Side Panel on a matching page automatically defaults to the "Output" tab.
  usesPanel: true,

  async run(ctx) {
    const store = ctx.store.namespace('jira-helper');

    // 1. Optional: Set tab-scoped badge count/text on the Chrome toolbar icon
    ctx.badge.set(3);

    // 2. Optional: Publish live structured UI into the MonkeyPatch Side Panel ("Output" tab)
    ctx.panel.set({
      title: 'Jira Ticket Context',
      badge: '3 notes',
      subtitle: ctx.page.pathname,
      status: 'Synced with MonkeyBrain ✓',
      sections: [
        {
          type: 'stats',
          columns: 2,
          items: [
            { label: 'Open Tasks', value: 3 },
            { label: 'Priority', value: 'High' },
          ],
        },
      ],
      actions: [
        { id: 'refresh', label: 'Refresh', variant: 'primary' },
      ],
    });

    ctx.panel.onAction((actionId, payload) => {
      if (actionId === 'refresh') {
        // Re-query or re-scan
      }
    });

    // 3. Register cleanup when navigating away in an SPA or when toggled Off
    ctx.onCleanup(() => {
      ctx.badge.clear();
      ctx.panel.clear();
      document.getElementById('my-patch-root')?.remove();
    });
  }
};

export default myPatch;
```

---

## 5. Patch SDK Capabilities (`store`, `panel`, `badge`, `net`, `page`, `log`)

The `ctx` object passed to `run(ctx)` provides:
- `ctx.store.namespace(ns, options?)` — Returns a strongly-typed `PatchStore` scoped to namespace `ns`.
  - Pass `{ encrypted: true }` (`ctx.store.namespace('my-patch', { encrypted: true })`) for opt-in client-side End-to-End Encryption (E2EE) inside the background service worker: JSONB `data` is encrypted with `AES-256-GCM`, and `namespace`, `key`, `type`, and `resources` are deterministically hashed with `HMAC-SHA256` (`enc-ns:...`, `enc-k:...`, `enc-r:...`) so PostgreSQL index lookups still work without exposing plaintext URLs or payloads on the server. JSONB `filters` are evaluated client-side after decryption when `{ encrypted: true }` is enabled.
- `ctx.panel` — Publishes structured live UI (`ctx.panel.set(view)`, `ctx.panel.clear()`) and handles user actions (`ctx.panel.onAction((actionId, payload) => ...)`) inside the dedicated **📊 Output** tab of the MonkeyPatch Chrome Side Panel (adhering to `DESIGN.md`). Supports `stats`, `text`, `list`, `form`, and `actions`.
- `ctx.badge` — Sets or clears a tab-scoped badge number or short text on the MonkeyPatch Chrome toolbar icon (`ctx.badge.set(countOrText, options?)`, `ctx.badge.clear()`). Styled with Brain Pink (`#F43F5E`) by default. If multiple active patches on the same tab set numeric badges, they are automatically summed.
- `ctx.net` — Performs CORS-free HTTP requests routed through the Manifest V3 background service worker (`ctx.net.fetch(url, options?)`, `ctx.net.getJson<T>(url, headers?)`, `ctx.net.getText(url, headers?)`), similar to Tampermonkey's `GM_xmlhttpRequest`.
- `ctx.page` — Helpers for the current URL (`url`, `domain`, `origin`, `pathname`, `urlResource`, `domainResource`, `defaultResources()`).
- `ctx.log` — Structured logger (`info`, `warn`, `error`, `debug`).
- `ctx.onCleanup(fn)` — Registers a teardown callback for SPA navigation or when the user toggles the script Off in the Side Panel.

> **Output Flexibility:** Patches can use **toolbar badges (`ctx.badge`)**, **Side Panel live output (`ctx.panel` + `usesPanel: true`)**, **in-page DOM overlays (`ui.ts` + `styles.css`)**, or **any combination** of the three. If a patch only needs Side Panel output and/or toolbar badges, it does not even need `ui.ts` or `styles.css`!

### Upserting & Retrieving by Logical Key
```typescript
const store = ctx.store.namespace('jira-notes');

// Upsert a document by logical key with resource associations
await store.set(
  'CCDF-123-review',
  {
    status: 'pending',
    priority: 3,
    notes: 'Review eligibility rules'
  },
  {
    type: 'note',
    resources: [
      ctx.page.domainResource,        // e.g. "domain:mainstream.atlassian.net"
      'jira-project:CCDF',
      'jira:CCDF-123'
    ]
  }
);

// Retrieve by logical key
const doc = await store.get<{ status: string; priority: number; notes: string }>('CCDF-123-review');
```

### Querying by Resource, Multiple Resources, Context, or JSONB Fields
```typescript
// 1. Query by single resource
const ticketDocs = await store.query({
  resource: 'jira:CCDF-123'
});

// 2. Query by multiple resources (ANY or ALL) + JSONB field filter
const highPriority = await store.query({
  resources: ['jira-project:CCDF', 'domain:mainstream.atlassian.net'],
  resourceMatch: 'ALL',
  filters: [
    { field: 'status', operator: 'eq', value: 'pending' }
  ],
  sortBy: 'updatedAt',
  sortDirection: 'desc'
});

// 3. Cross-patch aggregation (querying a different patch's namespace within the same tenant)
const emailRecords = await store.query({
  namespace: 'email-tracker',
  resource: 'jira:CCDF-123'
});

// 4. Delete by logical key or document UUID
await store.delete('CCDF-123-review');
```

---

## 5.5. Data Lifecycle, Freshness (`staleAt`) & Auto-Purge (`expiresAt`)

MonkeyBrain documents support two optional UTC lifecycle timestamps (`DateTime?`):
- **`staleAt` (Soft TTL / Freshness Window):** Indicates when the document should be considered stale (`doc.isStale === true`). Stale documents are **still returned** by `store.get()` and `store.query()`, allowing patches to immediately display cached data while triggering a background refresh and rolling the `staleAt` timer forward.
- **`expiresAt` (Hard TTL / Auto-Purge):** Indicates when the document expires. Once `expiresAt <= UtcNow`, the document is immediately excluded from queries/reads by default and is periodically hard-deleted from PostgreSQL.

### The 4 Supported Lifecycle Combinations

| Lifecycle Mode | `staleAt` | `expiresAt` | Example Use Case |
|---|---|---|---|
| **1. No Stale / No Expire** | `null` | `null` | Permanent user notes, saved bookmarks, ticket annotations. |
| **2. Stale / No Expire** | `Date` / `staleInSeconds` | `null` | Recurring dashboard item (e.g. team Jira ticket counts)—refresh whenever stale (`doc.isStale`), but keep the last known snapshot indefinitely even if untouched for months. |
| **3. No Stale / Expire** | `null` | `Date` / `expiresInSeconds` | Ephemeral session state, temporary cross-tab context, or audit logs that are always valid until auto-purged after 30 days. |
| **4. Stale / Expire** | `Date` / `staleInSeconds` | `Date` / `expiresInSeconds` | Stock chart or sprint cache—stale after 5 minutes (`staleInSeconds: 300`), auto-purged after 5 years (`expiresInSeconds: 157680000`) if never refreshed again. |

### Questionnaire Before Creating New API Entries / Patches

Whenever you are designing or creating a new patch that stores data in MonkeyBrain, **always ask the user (or confirm) these lifecycle questions** if not already specified:

1. **Lifecycle Mode:** Which of the 4 modes applies to this document (`no stale/no expire`, `stale/no expire`, `no stale/expire`, or `stale/expire`)?
2. **Freshness / Refresh Interval (`staleAt`):** How long until this data needs a refresh (e.g. 5 minutes, 1 hour, 2 days, or never)?
3. **Retention / Auto-Purge (`expiresAt`):** How long should MonkeyBrain retain the data before automatically purging it from the database if untouched (e.g. 24 hours, 14 days, 5 years, or keep forever)?
4. **Stale Behavior:** When `doc.isStale === true`, should the patch render the cached data immediately and refresh in the background, or wait for the refresh to complete first?

### Example: Recurring Dashboard Item with `staleAt` & `expiresAt`
```typescript
const store = ctx.store.namespace('jira-team-workload');
let doc = await store.get<{ countsByAssignee: Record<string, number> }>('team-alpha-summary');

// If missing or stale, refresh from source and roll the stale/expire timers forward
if (!doc || doc.isStale) {
  const freshCounts = await fetchLiveJiraCounts();
  doc = await store.set(
    'team-alpha-summary',
    { countsByAssignee: freshCounts },
    {
      type: 'workload-summary',
      staleInSeconds: 300,              // Stale 5 minutes from now (or pass staleAt: new Date(...))
      expiresInSeconds: 5 * 365 * 86400 // Auto-purge 5 years from now (or null for no expire)
    }
  );
}
```

---

## 6. Public vs. Personal Build Rules & Security Boundaries

1. **Public Build (`npm run build:public`):**
   - Bundles `patches/examples/**` only.
   - Never imports, compiles, or packages anything from `patches/personal/**`.
   - Runs `scripts/verify-public-build.mjs` automatically, which inspects `dist/public/` and fails if any personal patch IDs, paths, permissions, or `.map` source maps exist.
   - Generates `dist/monkeypatch-public.zip`.
2. **Personal Build (`npm run build:personal`):**
   - Bundles both `patches/examples/**` and `patches/personal/**`.
   - Outputs to `dist/personal/` for loading unpacked in Chrome Developer Mode.
3. **Credential Security Boundary & API Configuration:**
   - Content scripts (`src/content/`) and patches **never** touch API tokens, server URLs, or call `fetch()` against MonkeyBrain directly.
   - All SDK calls send structured messages (`chrome.runtime.sendMessage`) to the Manifest V3 background service worker (`src/background/index.ts`), which owns the `mb_live_...` API tokens in `chrome.storage.local` (`TRUSTED_CONTEXTS`).
   - MonkeyPatch defaults to `https://stash.monkeybrain.cc` (or a self-hosted server URL configured at build time via `MONKEYBRAIN_API_URL` in `.env`).
   - Never inject API tokens into page DOM or `window`.

---

## 7. Building & Testing

From the repository root:

```powershell
npm install
npm run build:personal   # Outputs dist/personal (includes patches/personal)
npm run build:public     # Outputs dist/public + dist/monkeypatch-public.zip
npm test                 # Runs Vitest SDK & build-profile unit tests
```

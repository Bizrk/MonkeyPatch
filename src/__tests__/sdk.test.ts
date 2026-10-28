import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchesUrlPattern } from '../core/urlMatcher';
import {
  PRODUCTION_SERVER_URL,
  LOCAL_SERVER_URL,
  DEFAULT_SERVER_URL,
  validateAndNormalizeServerUrl,
  resolveActiveServerUrl,
} from '../core/messaging';
import { NamespacedPatchStore, type TransportFn } from '../sdk/index';
import { handleMessage, CONFIG_STORAGE_KEY } from '../background/index';
import { resolveBuildProfile } from '../../vite.config';

describe('URL Pattern Matcher', () => {
  it('matches exact domain and path wildcards', () => {
    expect(matchesUrlPattern('https://example.com/hello', 'https://example.com/*')).toBe(true);
    expect(matchesUrlPattern('http://example.com/hello', 'https://example.com/*')).toBe(false);
    expect(matchesUrlPattern('https://other.com/hello', 'https://example.com/*')).toBe(false);
  });

  it('matches localhost port 27246 and wildcards with query strings', () => {
    expect(
      matchesUrlPattern('http://localhost:27246/demo?page=alpha', 'http://localhost:27246/demo*')
    ).toBe(true);
    expect(
      matchesUrlPattern('http://localhost:27246/demo?page=alpha', 'http://localhost:*/demo*')
    ).toBe(true);
    expect(
      matchesUrlPattern('http://localhost:27246/other', 'http://localhost:*/demo*')
    ).toBe(false);
  });

  it('matches subdomain wildcards', () => {
    expect(
      matchesUrlPattern(
        'https://mainstream.atlassian.net/browse/CCDF-123',
        'https://*.atlassian.net/browse/*'
      )
    ).toBe(true);
  });

  it('matches comma-separated multi-patterns and bare domain shorthands', () => {
    const multiPattern = 'https://example.com/*, *.acme-docs.org/ guides/*, portal.acme.io/projects/*'.replace(
      '*.acme-docs.org/ guides/*',
      '*.acme-docs.org/guides/*'
    );
    expect(
      matchesUrlPattern('https://en.acme-docs.org/guides/getting-started/step-12', multiPattern)
    ).toBe(true);
    expect(
      matchesUrlPattern('https://portal.acme.io/projects/alpha/overview', multiPattern)
    ).toBe(true);
    expect(matchesUrlPattern('https://unrelated.org/page', multiPattern)).toBe(false);
  });
});

describe('Build Profile Fail-Closed Logic', () => {
  it('defaults to public for missing or unknown profiles', () => {
    expect(resolveBuildProfile(undefined)).toBe('public');
    expect(resolveBuildProfile('')).toBe('public');
    expect(resolveBuildProfile('unknown')).toBe('public');
    expect(resolveBuildProfile('dev')).toBe('public');
    expect(resolveBuildProfile('personal')).toBe('personal');
    expect(resolveBuildProfile('PERSONAL')).toBe('personal');
  });
});

describe('API Server Environments & URL Security Validation', () => {
  it('defaults new installations to Production https://stash.monkeybrain.cc', () => {
    expect(DEFAULT_SERVER_URL).toBe('https://stash.monkeybrain.cc');
    expect(PRODUCTION_SERVER_URL).toBe('https://stash.monkeybrain.cc');
    expect(LOCAL_SERVER_URL).toBe('http://localhost:27246');
    expect(resolveActiveServerUrl('production')).toBe('https://stash.monkeybrain.cc');
    expect(resolveActiveServerUrl('local')).toBe('http://localhost:27246');
  });

  it('rejects insecure HTTP URLs for custom remote servers', () => {
    const insecure = validateAndNormalizeServerUrl('http://custom-remote.example.com');
    expect(insecure.ok).toBe(false);
    if (!insecure.ok) {
      expect(insecure.error).toMatch(/HTTPS/i);
    }

    const secure = validateAndNormalizeServerUrl('https://custom-remote.example.com/');
    expect(secure.ok).toBe(true);
    if (secure.ok) {
      expect(secure.url).toBe('https://custom-remote.example.com');
      expect(secure.origin).toBe('https://custom-remote.example.com');
      expect(secure.isLoopback).toBe(false);
    }
  });

  it('allows HTTP for localhost and 127.0.0.1 loopback addresses', () => {
    const local1 = validateAndNormalizeServerUrl('http://localhost:27246/');
    expect(local1.ok).toBe(true);
    if (local1.ok) {
      expect(local1.url).toBe('http://localhost:27246');
      expect(local1.isLoopback).toBe(true);
    }

    const local2 = validateAndNormalizeServerUrl('http://127.0.0.1:27246');
    expect(local2.ok).toBe(true);
    if (local2.ok) {
      expect(local2.isLoopback).toBe(true);
    }
  });
});

describe('Background Service Worker Server Switching & Per-Origin Token Isolation', () => {
  let memoryStorage: Record<string, any> = {};
  const fetchCalls: Array<{ url: string; headers: Record<string, string>; method: string }> = [];

  beforeEach(() => {
    memoryStorage = {};
    fetchCalls.length = 0;

    (globalThis as any).chrome = {
      runtime: {
        id: 'test-extension-id',
        lastError: null,
      },
      storage: {
        local: {
          get: (keys: string[], cb: (res: Record<string, any>) => void) => {
            const out: Record<string, any> = {};
            for (const k of keys) {
              if (k in memoryStorage) out[k] = memoryStorage[k];
            }
            cb(out);
          },
          set: (items: Record<string, any>, cb?: () => void) => {
            Object.assign(memoryStorage, items);
            cb?.();
          },
        },
      },
      tabs: {
        query: (_q: any, cb: (tabs: any[]) => void) => cb([]),
      },
      action: {
        setBadgeText: vi.fn(async () => {}),
        setBadgeBackgroundColor: vi.fn(async () => {}),
        setBadgeTextColor: vi.fn(async () => {}),
      },
    };

    (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers as Record<string, string>) || {};
      const method = init?.method || 'GET';
      fetchCalls.push({ url, headers, method });

      if (url.endsWith('/api/auth/extension-login')) {
        const isProd = url.startsWith(PRODUCTION_SERVER_URL);
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              apiToken: isProd ? 'mb_live_prod_secret_token' : 'mb_live_local_secret_token',
              user: {
                id: isProd ? 'u-prod' : 'u-local',
                email: isProd ? 'prod@example.com' : 'local@example.com',
                displayName: isProd ? 'Prod User' : 'Local User',
              },
              tenant: {
                id: isProd ? 't-prod' : 't-local',
                name: isProd ? 'Prod Tenant' : 'Local Tenant',
                slug: isProd ? 'prod-ws' : 'local-ws',
                role: 'Owner',
              },
            }),
        };
      }

      if (url.endsWith('/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'healthy', database: 'connected' }),
        };
      }

      if (url.endsWith('/api/auth/me')) {
        const authHeader = headers.Authorization || '';
        if (url.startsWith(PRODUCTION_SERVER_URL) && authHeader === 'Bearer mb_live_prod_secret_token') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              user: { id: 'u-prod', email: 'prod@example.com', displayName: 'Prod User' },
              tenant: { id: 't-prod', name: 'Prod Tenant', slug: 'prod-ws', role: 'Owner' },
            }),
          };
        }
        return { ok: false, status: 401, json: async () => ({}) };
      }

      if (url.includes('/api/documents/query')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              items: [],
              totalCount: 0,
              page: 1,
              pageSize: 50,
            }),
        };
      }

      return { ok: true, status: 200, text: async () => '{}' };
    });
  });

  const sender = { id: 'test-extension-id' } as chrome.runtime.MessageSender;

  it('defaults to Production and isolates tokens between Production, Local, and Custom servers', async () => {
    // 1. Default status should be Production and unauthenticated
    const initStatus = await handleMessage({ type: 'MB_AUTH_STATUS' }, sender);
    expect(initStatus.ok).toBe(true);
    expect(initStatus.data.selectedEnv).toBe('production');
    expect(initStatus.data.serverUrl).toBe(PRODUCTION_SERVER_URL);
    expect(initStatus.data.authenticated).toBe(false);

    // 2. Log in on Production
    const prodLogin = await handleMessage(
      {
        type: 'MB_AUTH_LOGIN',
        payload: { email: 'prod@example.com', password: 'Password123!' },
      },
      sender
    );
    expect(prodLogin.ok).toBe(true);
    expect(prodLogin.data.authenticated).toBe(true);

    // 3. Switch to Local (http://localhost:27246) — should NOT be authenticated with Prod token
    const switchToLocal = await handleMessage(
      {
        type: 'MB_SELECT_SERVER',
        payload: { selectedEnv: 'local' },
      },
      sender
    );
    expect(switchToLocal.ok).toBe(true);
    expect(switchToLocal.data.serverUrl).toBe(LOCAL_SERVER_URL);
    expect(switchToLocal.data.authenticated).toBe(false);

    // Attempting an SDK API request on Local before logging into Local must fail with 401 and never send Prod token
    const unauthLocalCall = await handleMessage(
      {
        type: 'MB_API_REQUEST',
        payload: { method: 'POST', path: '/api/documents/query', body: {} },
      },
      sender
    );
    expect(unauthLocalCall.ok).toBe(false);
    expect(unauthLocalCall.status).toBe(401);

    // 4. Log in on Local
    const localLogin = await handleMessage(
      {
        type: 'MB_AUTH_LOGIN',
        payload: { email: 'local@example.com', password: 'Password123!' },
      },
      sender
    );
    expect(localLogin.ok).toBe(true);
    expect(localLogin.data.authenticated).toBe(true);

    // 5. Make an SDK call while on Local -> must hit http://localhost:27246 with mb_live_local_secret_token
    fetchCalls.length = 0;
    const localApiRes = await handleMessage(
      {
        type: 'MB_API_REQUEST',
        payload: { method: 'POST', path: '/api/documents/query', body: { namespace: 'demo' } },
      },
      sender
    );
    expect(localApiRes.ok).toBe(true);
    expect(fetchCalls[0].url).toBe(`${LOCAL_SERVER_URL}/api/documents/query`);
    expect(fetchCalls[0].headers.Authorization).toBe('Bearer mb_live_local_secret_token');

    // 6. Switch back to Production -> must automatically restore Prod token without re-logging in
    const switchBackProd = await handleMessage(
      {
        type: 'MB_SELECT_SERVER',
        payload: { selectedEnv: 'production' },
      },
      sender
    );
    expect(switchBackProd.ok).toBe(true);
    expect(switchBackProd.data.authenticated).toBe(true);
    expect(switchBackProd.data.user.email).toBe('prod@example.com');

    fetchCalls.length = 0;
    const prodApiRes = await handleMessage(
      {
        type: 'MB_API_REQUEST',
        payload: { method: 'POST', path: '/api/documents/query', body: { namespace: 'demo' } },
      },
      sender
    );
    expect(prodApiRes.ok).toBe(true);
    expect(fetchCalls[0].url).toBe(`${PRODUCTION_SERVER_URL}/api/documents/query`);
    expect(fetchCalls[0].headers.Authorization).toBe('Bearer mb_live_prod_secret_token');

    // 7. Reject insecure HTTP custom server URL
    const badCustom = await handleMessage(
      {
        type: 'MB_SELECT_SERVER',
        payload: { selectedEnv: 'custom', customServerUrl: 'http://insecure.example.com' },
      },
      sender
    );
    expect(badCustom.ok).toBe(false);
    expect(badCustom.error).toMatch(/HTTPS/i);
  });

  it('verifies Test Connection distinguishes authenticated vs unauthenticated states', async () => {
    // Log in on Production
    await handleMessage(
      {
        type: 'MB_AUTH_LOGIN',
        payload: { email: 'prod@example.com', password: 'Password123!' },
      },
      sender
    );

    const prodTest = await handleMessage(
      {
        type: 'MB_TEST_CONNECTION',
        payload: { selectedEnv: 'production' },
      },
      sender
    );
    expect(prodTest.ok).toBe(true);
    expect(prodTest.data.state).toBe('authenticated');

    // Test Local where no token is stored yet -> reachable (/health 200) but unauthenticated
    const localTest = await handleMessage(
      {
        type: 'MB_TEST_CONNECTION',
        payload: { selectedEnv: 'local' },
      },
      sender
    );
    expect(localTest.ok).toBe(true);
    expect(localTest.data.state).toBe('unauthenticated');
    expect(localTest.data.healthOk).toBe(true);
  });

  it('persists disabled patch IDs via MB_SET_PATCH_ENABLED and MB_GET_PATCH_SETTINGS', async () => {
    const initSettings = await handleMessage({ type: 'MB_GET_PATCH_SETTINGS' }, sender);
    expect(initSettings.ok).toBe(true);
    expect(initSettings.data.disabledPatchIds).toEqual([]);

    const disableRes = await handleMessage(
      {
        type: 'MB_SET_PATCH_ENABLED',
        payload: { patchId: 'demo-notes', enabled: false },
      },
      sender
    );
    expect(disableRes.ok).toBe(true);
    expect(disableRes.data.disabledPatchIds).toEqual(['demo-notes']);

    const reEnableRes = await handleMessage(
      {
        type: 'MB_SET_PATCH_ENABLED',
        payload: { patchId: 'demo-notes', enabled: true },
      },
      sender
    );
    expect(reEnableRes.ok).toBe(true);
    expect(reEnableRes.data.disabledPatchIds).toEqual([]);
  });

  it('updates tab-scoped toolbar badge via MB_UPDATE_TAB_BADGE', async () => {
    const tabSender = {
      id: 'test-extension-id',
      tab: { id: 42 },
    } as chrome.runtime.MessageSender;

    const badgeRes = await handleMessage(
      {
        type: 'MB_UPDATE_TAB_BADGE',
        payload: { text: '17' },
      },
      tabSender
    );
    expect(badgeRes.ok).toBe(true);
    expect(badgeRes.data.tabId).toBe(42);
    expect(badgeRes.data.text).toBe('17');
    expect(badgeRes.data.backgroundColor).toBe('#F43F5E');
    expect((globalThis as any).chrome.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 42,
      text: '17',
    });
  });
});

describe('NamespacedPatchStore SDK', () => {
  it('sends upsert request with namespace and key on store.set()', async () => {
    const calls: Array<{ method: string; path: string; body: any }> = [];
    const mockTransport: TransportFn = vi.fn(async (method, path, body) => {
      calls.push({ method, path, body });
      return {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        namespace: body.namespace,
        key: body.key,
        type: body.type,
        data: body.data,
        resources: body.resources || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any;
    });

    const store = new NamespacedPatchStore('jira-notes', mockTransport);
    const doc = await store.set(
      'CCDF-123',
      { status: 'pending', priority: 3 },
      { type: 'note', resources: ['jira:CCDF-123'] }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/api/documents/upsert');
    expect(calls[0].body.namespace).toBe('jira-notes');
    expect(calls[0].body.key).toBe('CCDF-123');
    expect(doc.data.priority).toBe(3);
  });

  it('supports StaleAt and ExpiresAt lifecycle options (Date, ISO string, relative seconds, and explicit null clearing)', async () => {
    const calls: Array<{ method: string; path: string; body: any }> = [];
    const mockTransport: TransportFn = vi.fn(async (method, path, body) => {
      calls.push({ method, path, body });
      return {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        namespace: body.namespace || 'jira-workload',
        key: body.key,
        type: body.type,
        data: body.data,
        resources: body.resources || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        staleAt: body.staleAt ?? null,
        expiresAt: body.expiresAt ?? null,
        isStale: false,
      } as any;
    });

    const store = new NamespacedPatchStore('jira-workload', mockTransport);

    // 1. Relative seconds convenience (e.g., stale in 5 mins, expires in 5 years)
    const beforeMs = Date.now();
    await store.set(
      'team-counts',
      { alice: 4, bob: 7 },
      {
        type: 'summary',
        staleInSeconds: 300,
        expiresInSeconds: 5 * 365 * 86400,
      }
    );

    expect(calls[0].body.staleAt).toBeTruthy();
    expect(calls[0].body.expiresAt).toBeTruthy();
    const parsedStale = Date.parse(calls[0].body.staleAt);
    const parsedExpires = Date.parse(calls[0].body.expiresAt);
    expect(parsedStale).toBeGreaterThanOrEqual(beforeMs + 295_000);
    expect(parsedExpires).toBeGreaterThanOrEqual(beforeMs + 5 * 365 * 86400 * 1000 - 5000);

    // 2. Explicit Date / ISO string + null clearing
    const explicitStale = new Date('2030-01-01T00:00:00.000Z');
    await store.set(
      'team-counts',
      { alice: 5, bob: 6 },
      {
        staleAt: explicitStale,
        expiresAt: null,
      }
    );

    expect(calls[1].body.staleAt).toBe('2030-01-01T00:00:00.000Z');
    expect(calls[1].body.expiresAt).toBeNull();
    expect(calls[1].body.clearExpiresAt).toBe(true);

    // 3. Query with isStale and includeExpired filters
    await store.query({ isStale: false, includeExpired: true, sortBy: 'staleAt' });
    expect(calls[2].body.isStale).toBe(false);
    expect(calls[2].body.includeExpired).toBe(true);
    expect(calls[2].body.sortBy).toBe('staleAt');
  });

  it('queries within the configured namespace by default', async () => {
    const mockTransport: TransportFn = vi.fn(async (_method, _path, body) => {
      return {
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            tenantId: '22222222-2222-4222-8222-222222222222',
            namespace: body.namespace,
            key: 'item-1',
            data: { title: 'Hello' },
            resources: [body.resource],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        totalCount: 1,
        page: 1,
        pageSize: 50,
      } as any;
    });

    const store = new NamespacedPatchStore('my-patch', mockTransport);
    const results = await store.query({ resource: 'project:456' });

    expect(results).toHaveLength(1);
    expect(results[0].namespace).toBe('my-patch');
    expect(results[0].resources).toContain('project:456');
  });

  it('supports opt-in client-side E2EE ({ encrypted: true }) with AES-256-GCM data and HMAC-SHA256 hashed identifiers', async () => {
    let lastUpsertBody: any = null;
    const memoryStorage: Record<string, any> = {};

    (globalThis as any).chrome = {
      runtime: { id: 'test-extension-id', lastError: null },
      storage: {
        local: {
          get: (keys: string[], cb: (res: Record<string, any>) => void) => {
            const out: Record<string, any> = {};
            for (const k of keys) if (k in memoryStorage) out[k] = memoryStorage[k];
            cb(out);
          },
          set: (items: Record<string, any>, cb?: () => void) => {
            Object.assign(memoryStorage, items);
            cb?.();
          },
        },
      },
      tabs: { query: (_q: any, cb: (tabs: any[]) => void) => cb([]) },
    };

    (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/extension-login')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              apiToken: 'mb_live_e2ee_token',
              user: { id: 'u-1', email: 'test@example.com', displayName: 'Test' },
              tenant: { id: 't-1', name: 'Tenant', slug: 'tenant', role: 'Owner' },
            }),
        };
      }
      if (url.endsWith('/api/documents/upsert')) {
        lastUpsertBody = JSON.parse(String(init?.body || '{}'));
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              id: 'doc-123',
              tenantId: 't-1',
              namespace: lastUpsertBody.namespace,
              key: lastUpsertBody.key,
              type: lastUpsertBody.type,
              data: lastUpsertBody.data,
              resources: lastUpsertBody.resources || [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
        };
      }
      return { ok: true, status: 200, text: async () => '{}' };
    });

    const sender = { id: 'test-extension-id' } as chrome.runtime.MessageSender;
    await handleMessage(
      { type: 'MB_AUTH_LOGIN', payload: { email: 'test@example.com', password: 'pw' } },
      sender
    );

    const transport: TransportFn = async (method, path, body, options) => {
      const res = await handleMessage(
        {
          type: 'MB_API_REQUEST',
          payload: { method, path, body, encrypted: options?.encrypted },
        },
        sender
      );
      if (!res.ok) throw new Error(res.error);
      return res.data;
    };

    const encryptedStore = new NamespacedPatchStore('secret-patch', transport, {
      encrypted: true,
    });

    const saved = await encryptedStore.set(
      'sensitive-key-1',
      { secretNote: 'top-secret-payload', count: 99 },
      {
        type: 'private-note',
        resources: ['domain:vault.example.com', 'project:alpha-release'],
      }
    );

    // 1. Verify outgoing payload sent to fetch() was HMAC-hashed and AES-GCM encrypted
    expect(lastUpsertBody).toBeTruthy();
    expect(lastUpsertBody.namespace).toMatch(/^enc-ns:[0-9a-f]{32}$/);
    expect(lastUpsertBody.key).toMatch(/^enc-k:[0-9a-f]{32}$/);
    expect(lastUpsertBody.type).toMatch(/^enc-t:[0-9a-f]{32}$/);
    expect(lastUpsertBody.resources[0]).toMatch(/^enc-r:[0-9a-f]{32}$/);
    expect(lastUpsertBody.data.__mb_enc).toBe('v1');
    expect(typeof lastUpsertBody.data.iv).toBe('string');
    expect(typeof lastUpsertBody.data.ct).toBe('string');
    expect(JSON.stringify(lastUpsertBody)).not.toContain('top-secret-payload');
    expect(JSON.stringify(lastUpsertBody)).not.toContain('vault.example.com');

    // 2. Verify returned document is transparently decrypted back to plaintext for the patch!
    expect(saved.namespace).toBe('secret-patch');
    expect(saved.key).toBe('sensitive-key-1');
    expect(saved.type).toBe('private-note');
    expect(saved.resources).toEqual(['domain:vault.example.com', 'project:alpha-release']);
    expect(saved.data).toEqual({ secretNote: 'top-secret-payload', count: 99 });
  });

  it('supports background CORS-free fetch (MB_CORS_FETCH) and Quick CSS Rules (MB_SAVE_QUICK_RULE)', async () => {
    const memoryStorage: Record<string, any> = {};
    (globalThis as any).chrome = {
      runtime: { id: 'test-extension-id', lastError: null, sendMessage: vi.fn() },
      storage: {
        local: {
          get: (keys: string[], cb: (res: Record<string, any>) => void) => {
            const out: Record<string, any> = {};
            for (const k of keys) if (k in memoryStorage) out[k] = memoryStorage[k];
            cb(out);
          },
          set: (items: Record<string, any>, cb?: () => void) => {
            Object.assign(memoryStorage, items);
            cb?.();
          },
        },
      },
      tabs: { query: (_q: any, cb: (tabs: any[]) => void) => cb([]) },
    };

    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url.startsWith('https://api.reddit.com/search.json')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          url,
          headers: new Map([['content-type', 'application/json']]),
          text: async () => JSON.stringify({ data: { children: [{ data: { id: 'r1' } }] } }),
        };
      }
      return { ok: true, status: 200, text: async () => '{}' };
    });

    const sender = { id: 'test-extension-id' } as chrome.runtime.MessageSender;

    // 1. Test MB_CORS_FETCH
    const corsRes = await handleMessage(
      {
        type: 'MB_CORS_FETCH',
        payload: { url: 'https://api.reddit.com/search.json?q=test' },
      },
      sender
    );
    expect(corsRes.ok).toBe(true);
    expect(corsRes.data.status).toBe(200);
    expect(corsRes.data.json.data.children[0].data.id).toBe('r1');

    // 2. Test MB_SAVE_QUICK_RULE & MB_GET_QUICK_RULES
    const saveRuleRes = await handleMessage(
      {
        type: 'MB_SAVE_QUICK_RULE',
        payload: {
          rule: {
            id: 'rule-test-1',
            name: 'Hide Banner',
            matchPattern: 'https://example.com/*',
            selector: 'div.banner',
            css: 'div.banner { display: none !important; }',
            enabled: true,
          },
        },
      },
      sender
    );
    expect(saveRuleRes.ok).toBe(true);
    expect(saveRuleRes.data.rules).toHaveLength(1);
    expect(saveRuleRes.data.rules[0].name).toBe('Hide Banner');
  });
});

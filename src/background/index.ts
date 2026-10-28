import {
  PRODUCTION_SERVER_URL,
  LOCAL_SERVER_URL,
  QUICKNOTES_NAMESPACE,
  QUICKRULES_NAMESPACE,
  resolveActiveServerUrl,
  validateAndNormalizeServerUrl,
  type ApiEnvironmentMode,
  type BgRequestMessage,
  type BgResponseMessage,
  type ConnectionTestResult,
  type QuickCssRule,
  type SavedQuickNote,
  type ServerSessionRecord,
  type StoredAuthSession,
  type StoredExtensionConfig,
} from '../core/messaging';
import {
  decryptIncomingResponseData,
  encryptOutgoingRequestBody,
  generateDefaultEncryptionSecret,
} from '../core/crypto';

export const CONFIG_STORAGE_KEY = 'monkeypatch_config_v2';
const LEGACY_STORAGE_KEY = 'monkeypatch_session';

const ALLOWED_API_PREFIXES = ['/api/documents', '/api/version'];
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Restricts chrome.storage.local access so content scripts can never read stored API tokens directly.
 */
function configureStorageAccessLevel() {
  if (
    typeof chrome !== 'undefined' &&
    chrome.storage?.local &&
    typeof (chrome.storage.local as any).setAccessLevel === 'function'
  ) {
    try {
      (chrome.storage.local as any).setAccessLevel({
        accessLevel: 'TRUSTED_CONTEXTS',
      });
    } catch {
      // Ignore if unsupported by browser version
    }
  }

  if (
    typeof chrome !== 'undefined' &&
    (chrome as any).sidePanel &&
    typeof (chrome as any).sidePanel.setPanelBehavior === 'function'
  ) {
    try {
      (chrome as any).sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch(() => {});
    } catch {
      // Ignore if sidePanel API is unavailable
    }
  }
}

configureStorageAccessLevel();

export function getOriginKey(serverUrl: string): string {
  const validated = validateAndNormalizeServerUrl(serverUrl, { requireHttpsForRemote: false });
  return validated.ok ? validated.origin : serverUrl.trim().toLowerCase().replace(/\/+$/, '');
}

export async function getExtensionConfig(): Promise<StoredExtensionConfig> {
  return new Promise((resolve) => {
    chrome.storage.local.get([CONFIG_STORAGE_KEY, LEGACY_STORAGE_KEY], (result) => {
      const saved = result[CONFIG_STORAGE_KEY] as Partial<StoredExtensionConfig> | undefined;
      if (saved && saved.selectedEnv) {
        const secret =
          typeof saved.encryptionSecret === 'string' && saved.encryptionSecret.trim()
            ? saved.encryptionSecret.trim()
            : generateDefaultEncryptionSecret();
        const hydrated: StoredExtensionConfig = {
          selectedEnv: saved.selectedEnv,
          customServerUrl: saved.customServerUrl || '',
          sessionsByOrigin: saved.sessionsByOrigin || {},
          disabledPatchIds: Array.isArray(saved.disabledPatchIds) ? saved.disabledPatchIds : [],
          encryptionSecret: secret,
          quickCssRules: Array.isArray(saved.quickCssRules) ? saved.quickCssRules : [],
        };
        if (!saved.encryptionSecret) {
          chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: hydrated });
        }
        resolve(hydrated);
        return;
      }

      // Migrate legacy v1 session if present; otherwise default new installations to Production
      const legacy = result[LEGACY_STORAGE_KEY] as Partial<StoredAuthSession> | undefined;
      const sessionsByOrigin: Record<string, ServerSessionRecord> = {};
      let selectedEnv: ApiEnvironmentMode = 'production';
      let customServerUrl = '';

      if (legacy?.serverUrl) {
        const validated = validateAndNormalizeServerUrl(legacy.serverUrl, {
          requireHttpsForRemote: false,
        });
        if (validated.ok) {
          if (legacy.apiToken) {
            sessionsByOrigin[validated.origin] = {
              serverUrl: validated.url,
              apiToken: legacy.apiToken,
              user: legacy.user || null,
              tenant: legacy.tenant || null,
            };
          }
          if (validated.isLoopback) {
            selectedEnv = 'local';
          } else if (validated.origin === getOriginKey(PRODUCTION_SERVER_URL)) {
            selectedEnv = 'production';
          } else if (validated.url.startsWith('https://')) {
            selectedEnv = 'custom';
            customServerUrl = validated.url;
          }
        }
      }

      const initialConfig: StoredExtensionConfig = {
        selectedEnv,
        customServerUrl,
        sessionsByOrigin,
        disabledPatchIds: [],
        encryptionSecret: generateDefaultEncryptionSecret(),
        quickCssRules: [],
      };
      chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: initialConfig });
      resolve(initialConfig);
    });
  });
}

export async function saveExtensionConfig(config: StoredExtensionConfig): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: config }, () => resolve());
  });
}

export function getActiveServerAndSession(config: StoredExtensionConfig): {
  serverUrl: string;
  originKey: string;
  session: ServerSessionRecord;
} {
  const serverUrl = resolveActiveServerUrl(config.selectedEnv, config.customServerUrl);
  const originKey = getOriginKey(serverUrl);
  const existing = config.sessionsByOrigin[originKey];

  return {
    serverUrl,
    originKey,
    session: existing || {
      serverUrl,
      apiToken: null,
      user: null,
      tenant: null,
    },
  };
}

function broadcastEnvironmentChange(selectedEnv: ApiEnvironmentMode, serverUrl: string) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(
            tab.id,
            {
              type: 'MB_SERVER_CHANGED',
              selectedEnv,
              serverUrl,
            },
            () => {
              // Ignore tabs without content script
              void chrome.runtime.lastError;
            }
          );
        }
      }
    });
  } catch {
    // Ignore broadcast errors
  }
}

function broadcastPatchStatesChange(disabledPatchIds: string[]) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(
            tab.id,
            {
              type: 'MB_PATCH_STATES_CHANGED',
              disabledPatchIds,
            },
            () => {
              void chrome.runtime.lastError;
            }
          );
        }
      }
    });
  } catch {
    // Ignore broadcast errors
  }
}

function broadcastQuickRulesUpdate(rules: QuickCssRule[]) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(
            tab.id,
            {
              type: 'MB_QUICK_RULES_UPDATED',
              rules,
            },
            () => {
              void chrome.runtime.lastError;
            }
          );
        }
      }
    });
  } catch {
    // Ignore broadcast errors
  }
  try {
    chrome.runtime.sendMessage({ type: 'MB_QUICK_RULES_UPDATED', rules }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Ignore if popup/sidePanel closed
  }
}

async function forwardTelemetry(
  serverUrl: string,
  level: string,
  category: string,
  message: string,
  data?: string | null
) {
  try {
    await fetch(`${serverUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        category,
        message,
        data: data ?? null,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Never fail or loop on telemetry
  }
}

export async function handleMessage(
  msg: BgRequestMessage,
  sender: chrome.runtime.MessageSender
): Promise<BgResponseMessage> {
  // Security boundary: Only accept messages from our own extension ID
  if (sender.id && sender.id !== chrome.runtime.id) {
    return { ok: false, error: 'Unauthorized message origin.' };
  }

  const config = await getExtensionConfig();
  const active = getActiveServerAndSession(config);

  switch (msg.type) {
    case 'MB_AUTH_STATUS': {
      return {
        ok: true,
        data: {
          selectedEnv: config.selectedEnv,
          customServerUrl: config.customServerUrl,
          serverUrl: active.serverUrl,
          authenticated: Boolean(
            active.session.apiToken && active.session.user && active.session.tenant
          ),
          user: active.session.user,
          tenant: active.session.tenant,
        },
      };
    }

    case 'MB_SELECT_SERVER':
    case 'MB_SET_SERVER_URL': {
      const requestedEnv: ApiEnvironmentMode =
        msg.payload?.selectedEnv ||
        (msg.payload?.serverUrl
          ? msg.payload.serverUrl === LOCAL_SERVER_URL
            ? 'local'
            : msg.payload.serverUrl === PRODUCTION_SERVER_URL
            ? 'production'
            : 'custom'
          : config.selectedEnv);

      let nextCustomUrl = config.customServerUrl;

      if (requestedEnv === 'custom') {
        const rawCustom = String(
          msg.payload?.customServerUrl ?? msg.payload?.serverUrl ?? config.customServerUrl
        );
        const validated = validateAndNormalizeServerUrl(rawCustom, {
          requireHttpsForRemote: true,
        });
        if (!validated.ok) {
          return { ok: false, error: validated.error };
        }
        nextCustomUrl = validated.url;
      } else if (msg.payload?.serverUrl && msg.type === 'MB_SET_SERVER_URL') {
        const validated = validateAndNormalizeServerUrl(String(msg.payload.serverUrl), {
          requireHttpsForRemote: true,
        });
        if (!validated.ok) {
          return { ok: false, error: validated.error };
        }
      }

      config.selectedEnv = requestedEnv;
      config.customServerUrl = nextCustomUrl;
      await saveExtensionConfig(config);

      const nextActive = getActiveServerAndSession(config);
      broadcastEnvironmentChange(config.selectedEnv, nextActive.serverUrl);

      return {
        ok: true,
        data: {
          selectedEnv: config.selectedEnv,
          customServerUrl: config.customServerUrl,
          serverUrl: nextActive.serverUrl,
          authenticated: Boolean(
            nextActive.session.apiToken && nextActive.session.user && nextActive.session.tenant
          ),
          user: nextActive.session.user,
          tenant: nextActive.session.tenant,
        },
      };
    }

    case 'MB_TEST_CONNECTION': {
      const targetEnv: ApiEnvironmentMode = msg.payload?.selectedEnv || config.selectedEnv;
      const targetCustomUrl: string =
        msg.payload?.customServerUrl !== undefined
          ? String(msg.payload.customServerUrl)
          : config.customServerUrl;

      let targetUrl = PRODUCTION_SERVER_URL;
      if (targetEnv === 'local') {
        targetUrl = LOCAL_SERVER_URL;
      } else if (targetEnv === 'custom') {
        const validated = validateAndNormalizeServerUrl(targetCustomUrl, {
          requireHttpsForRemote: true,
        });
        if (!validated.ok) {
          return { ok: false, error: validated.error };
        }
        targetUrl = validated.url;
      }

      const originKey = getOriginKey(targetUrl);
      const storedSession = config.sessionsByOrigin[originKey];

      // Step 1: Call /health to verify server availability
      let healthOk = false;
      let databaseStatus = 'unknown';
      try {
        const healthRes = await fetch(`${targetUrl}/health`, { method: 'GET' });
        if (healthRes.ok) {
          healthOk = true;
          const healthJson = await healthRes.json().catch(() => ({}));
          databaseStatus = healthJson?.database || 'connected';
        } else {
          const result: ConnectionTestResult = {
            serverUrl: targetUrl,
            state: 'unreachable',
            healthOk: false,
            authenticated: false,
            message: `Server returned HTTP ${healthRes.status} on /health.`,
          };
          return { ok: true, data: result };
        }
      } catch (err: any) {
        const result: ConnectionTestResult = {
          serverUrl: targetUrl,
          state: 'unreachable',
          healthOk: false,
          authenticated: false,
          message: `Unreachable: Could not connect to ${targetUrl}/health (${
            err?.message || 'Network error'
          }).`,
        };
        return { ok: true, data: result };
      }

      // Step 2: If reachable, check current token for this server origin against /api/auth/me
      if (!storedSession?.apiToken) {
        const result: ConnectionTestResult = {
          serverUrl: targetUrl,
          state: 'unauthenticated',
          healthOk: true,
          databaseStatus,
          authenticated: false,
          message: 'Server reachable and healthy, but not authenticated. Please sign in below.',
        };
        return { ok: true, data: result };
      }

      try {
        const meRes = await fetch(`${targetUrl}/api/auth/me`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${storedSession.apiToken}`,
          },
        });

        if (meRes.ok) {
          const meData = await meRes.json();
          // Refresh cached user/tenant metadata
          config.sessionsByOrigin[originKey] = {
            serverUrl: targetUrl,
            apiToken: storedSession.apiToken,
            user: meData.user || storedSession.user,
            tenant: meData.tenant || storedSession.tenant,
          };
          await saveExtensionConfig(config);

          const result: ConnectionTestResult = {
            serverUrl: targetUrl,
            state: 'authenticated',
            healthOk: true,
            databaseStatus,
            authenticated: true,
            user: meData.user,
            tenant: meData.tenant,
            message: `Authenticated as ${meData.user?.email} (${meData.tenant?.slug}).`,
          };
          return { ok: true, data: result };
        } else {
          // Token expired or revoked on this server
          const result: ConnectionTestResult = {
            serverUrl: targetUrl,
            state: 'unauthenticated',
            healthOk: true,
            databaseStatus,
            authenticated: false,
            message: 'Server reachable, but stored token is invalid or revoked. Please sign in again.',
          };
          return { ok: true, data: result };
        }
      } catch (err: any) {
        const result: ConnectionTestResult = {
          serverUrl: targetUrl,
          state: 'unauthenticated',
          healthOk: true,
          databaseStatus,
          authenticated: false,
          message: `Server reachable, but auth verification failed: ${err?.message || 'Error'}`,
        };
        return { ok: true, data: result };
      }
    }

    case 'MB_AUTH_LOGIN': {
      const email = String(msg.payload?.email || '').trim();
      const password = String(msg.payload?.password || '');

      let targetServerUrl = active.serverUrl;
      if (msg.payload?.serverUrl) {
        const validated = validateAndNormalizeServerUrl(String(msg.payload.serverUrl), {
          requireHttpsForRemote: true,
        });
        if (!validated.ok) {
          return { ok: false, error: validated.error };
        }
        targetServerUrl = validated.url;
      }

      if (!email || !password) {
        return { ok: false, error: 'Email and password are required.' };
      }

      try {
        const res = await fetch(`${targetServerUrl}/api/auth/extension-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            tokenName: `MonkeyPatch (${config.selectedEnv.toUpperCase()})`,
          }),
        });

        const text = await res.text();
        let body: any = null;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = null;
          }
        }

        if (!res.ok || !body?.apiToken) {
          return {
            ok: false,
            status: res.status,
            error: body?.error || `Authentication failed (${res.status}).`,
          };
        }

        const originKey = getOriginKey(targetServerUrl);
        config.sessionsByOrigin[originKey] = {
          serverUrl: targetServerUrl,
          apiToken: body.apiToken,
          user: body.user,
          tenant: body.tenant,
        };
        await saveExtensionConfig(config);

        forwardTelemetry(
          targetServerUrl,
          'info',
          'BackgroundAuth',
          `Extension authenticated for tenant ${body.tenant?.slug} on ${originKey}`
        );

        broadcastEnvironmentChange(config.selectedEnv, targetServerUrl);

        return {
          ok: true,
          data: {
            selectedEnv: config.selectedEnv,
            customServerUrl: config.customServerUrl,
            serverUrl: targetServerUrl,
            authenticated: true,
            user: body.user,
            tenant: body.tenant,
          },
        };
      } catch (err: any) {
        return {
          ok: false,
          error: `Could not connect to MonkeyBrain at ${targetServerUrl}: ${
            err?.message || 'Network error'
          }`,
        };
      }
    }

    case 'MB_AUTH_LOGOUT': {
      if (active.session.apiToken) {
        try {
          await fetch(`${active.serverUrl}/api/auth/logout`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${active.session.apiToken}`,
            },
          });
        } catch {
          // Ignore network errors on logout
        }
      }

      delete config.sessionsByOrigin[active.originKey];
      await saveExtensionConfig(config);
      broadcastEnvironmentChange(config.selectedEnv, active.serverUrl);

      return {
        ok: true,
        data: {
          selectedEnv: config.selectedEnv,
          customServerUrl: config.customServerUrl,
          serverUrl: active.serverUrl,
          authenticated: false,
          user: null,
          tenant: null,
        },
      };
    }

    case 'MB_GET_VERSION': {
      try {
        const res = await fetch(`${active.serverUrl}/api/version`);
        if (!res.ok) {
          return { ok: false, error: `Version check failed (${res.status})` };
        }
        const data = await res.json();
        return { ok: true, data };
      } catch (err: any) {
        return { ok: false, error: err?.message || 'Could not reach server.' };
      }
    }

    case 'MB_GET_PATCH_SETTINGS': {
      return {
        ok: true,
        data: {
          disabledPatchIds: config.disabledPatchIds || [],
        },
      };
    }

    case 'MB_SET_PATCH_ENABLED': {
      const patchId = String(msg.payload?.patchId || '').trim();
      const enabled = Boolean(msg.payload?.enabled);
      if (!patchId) {
        return { ok: false, error: 'patchId is required.' };
      }

      const disabledSet = new Set(config.disabledPatchIds || []);
      if (enabled) {
        disabledSet.delete(patchId);
      } else {
        disabledSet.add(patchId);
      }

      config.disabledPatchIds = Array.from(disabledSet);
      await saveExtensionConfig(config);
      broadcastPatchStatesChange(config.disabledPatchIds);

      return {
        ok: true,
        data: {
          disabledPatchIds: config.disabledPatchIds,
        },
      };
    }

    case 'MB_CONTENT_PANEL_UPDATED': {
      return { ok: true };
    }

    case 'MB_UPDATE_TAB_BADGE': {
      const tabId = sender.tab?.id ?? msg.payload?.tabId;
      const text = String(msg.payload?.text ?? '');
      const backgroundColor = String(msg.payload?.backgroundColor || '#F43F5E');
      const textColor = String(msg.payload?.textColor || '#FFFBEB');

      if (typeof chrome !== 'undefined' && chrome.action && tabId !== undefined) {
        try {
          await chrome.action.setBadgeText({ tabId, text });
          if (text) {
            await chrome.action.setBadgeBackgroundColor({ tabId, color: backgroundColor });
            if (typeof (chrome.action as any).setBadgeTextColor === 'function') {
              await (chrome.action as any).setBadgeTextColor({ tabId, color: textColor });
            }
          }
        } catch {
          // Ignore if tab closed while setting badge
        }
      }
      return {
        ok: true,
        data: { tabId, text, backgroundColor, textColor },
      };
    }

    case 'MB_GET_ENCRYPTION_SECRET': {
      if (sender.tab) {
        return { ok: false, error: 'Encryption key access is restricted to extension UI.' };
      }
      return {
        ok: true,
        data: {
          encryptionSecret: config.encryptionSecret || '',
        },
      };
    }

    case 'MB_SET_ENCRYPTION_SECRET': {
      if (sender.tab) {
        return { ok: false, error: 'Encryption key modification is restricted to extension UI.' };
      }
      const nextSecret = String(msg.payload?.encryptionSecret || '').trim();
      if (nextSecret.length < 8) {
        return {
          ok: false,
          error: 'Encryption passphrase must be at least 8 characters long.',
        };
      }
      config.encryptionSecret = nextSecret;
      await saveExtensionConfig(config);
      broadcastEnvironmentChange(config.selectedEnv, active.serverUrl);
      return {
        ok: true,
        data: {
          encryptionSecret: config.encryptionSecret,
        },
      };
    }

    case 'MB_LOG_TELEMETRY': {
      await forwardTelemetry(
        active.serverUrl,
        msg.payload?.level || 'info',
        msg.payload?.category || 'EXT',
        msg.payload?.message || '',
        msg.payload?.data || null
      );
      return { ok: true };
    }

    case 'MB_CORS_FETCH': {
      const targetUrl = String(msg.payload?.url || '').trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        return { ok: false, error: 'MB_CORS_FETCH requires an http:// or https:// URL.' };
      }

      const method = String(msg.payload?.method || 'GET').toUpperCase();
      const reqHeaders: Record<string, string> = { ...(msg.payload?.headers || {}) };
      const rawBody = msg.payload?.body;
      let fetchBody: string | undefined;

      if (rawBody !== undefined && rawBody !== null && method !== 'GET' && method !== 'HEAD') {
        if (typeof rawBody === 'string') {
          fetchBody = rawBody;
        } else {
          fetchBody = JSON.stringify(rawBody);
          if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
            reqHeaders['Content-Type'] = 'application/json';
          }
        }
      }

      try {
        const res = await fetch(targetUrl, {
          method,
          headers: reqHeaders,
          body: fetchBody,
        });

        const text = await res.text();
        let json: any = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }

        const outHeaders: Record<string, string> = {};
        res.headers?.forEach?.((val, key) => {
          outHeaders[key] = val;
        });

        return {
          ok: true,
          status: res.status,
          data: {
            ok: res.ok,
            status: res.status,
            statusText: res.statusText || '',
            url: res.url || targetUrl,
            headers: outHeaders,
            text,
            json,
          },
        };
      } catch (err: any) {
        return {
          ok: false,
          error: `Background CORS fetch failed for ${targetUrl}: ${err?.message || 'Network error'}`,
        };
      }
    }

    case 'MB_GET_QUICK_RULES': {
      const syncFromServer = Boolean(msg.payload?.syncFromServer);
      let rules = Array.isArray(config.quickCssRules) ? [...config.quickCssRules] : [];

      if (syncFromServer && active.session.apiToken) {
        try {
          const res = await fetch(`${active.serverUrl}/api/documents/query`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${active.session.apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              namespace: QUICKRULES_NAMESPACE,
              page: 1,
              pageSize: 100,
              sortBy: 'updatedAt',
              sortDirection: 'desc',
            }),
          });
          if (res.ok) {
            const parsed = await res.json();
            if (Array.isArray(parsed?.items)) {
              const serverRules: QuickCssRule[] = parsed.items
                .map((doc: any) => {
                  const d = doc.data || {};
                  if (!d.css || !d.matchPattern) return null;
                  return {
                    id: String(doc.key || d.id || doc.id),
                    name: String(d.name || doc.key || 'Quick CSS Rule'),
                    matchPattern: String(d.matchPattern),
                    selector: d.selector ? String(d.selector) : undefined,
                    css: String(d.css),
                    enabled: d.enabled !== false,
                    updatedAt: String(doc.updatedAt || d.updatedAt || new Date().toISOString()),
                  } as QuickCssRule;
                })
                .filter(Boolean);
              rules = serverRules;
              config.quickCssRules = rules;
              await saveExtensionConfig(config);
              broadcastQuickRulesUpdate(rules);
            }
          }
        } catch {
          // Return cached rules if offline
        }
      }

      return {
        ok: true,
        data: { rules },
      };
    }

    case 'MB_SAVE_QUICK_RULE': {
      const rawRule = msg.payload?.rule || {};
      const ruleId = String(rawRule.id || `rule-${Date.now()}`).trim();
      const matchPattern = String(rawRule.matchPattern || '').trim();
      const css = String(rawRule.css || '').trim();

      if (!matchPattern || !css) {
        return { ok: false, error: 'Both URL matchPattern and CSS content are required.' };
      }

      const nextRule: QuickCssRule = {
        id: ruleId,
        name: String(rawRule.name || rawRule.selector || matchPattern).trim(),
        matchPattern,
        selector: rawRule.selector ? String(rawRule.selector).trim() : undefined,
        css,
        enabled: rawRule.enabled !== false,
        updatedAt: new Date().toISOString(),
      };

      const existingRules = Array.isArray(config.quickCssRules) ? [...config.quickCssRules] : [];
      const idx = existingRules.findIndex((r) => r.id === ruleId);
      if (idx >= 0) {
        existingRules[idx] = nextRule;
      } else {
        existingRules.unshift(nextRule);
      }

      config.quickCssRules = existingRules;
      await saveExtensionConfig(config);
      broadcastQuickRulesUpdate(existingRules);

      if (active.session.apiToken) {
        try {
          await fetch(`${active.serverUrl}/api/documents/upsert`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${active.session.apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              namespace: QUICKRULES_NAMESPACE,
              key: nextRule.id,
              type: 'quick-css-rule',
              data: nextRule,
              resources: [`pattern:${nextRule.matchPattern}`],
            }),
          });
        } catch {
          // Local rule still saved if server is offline
        }
      }

      return {
        ok: true,
        data: { rule: nextRule, rules: existingRules },
      };
    }

    case 'MB_DELETE_QUICK_RULE': {
      const ruleId = String(msg.payload?.id || '').trim();
      if (!ruleId) {
        return { ok: false, error: 'Rule id is required.' };
      }

      const existingRules = Array.isArray(config.quickCssRules) ? [...config.quickCssRules] : [];
      const filtered = existingRules.filter((r) => r.id !== ruleId);
      config.quickCssRules = filtered;
      await saveExtensionConfig(config);
      broadcastQuickRulesUpdate(filtered);

      if (active.session.apiToken) {
        try {
          const queryRes = await fetch(`${active.serverUrl}/api/documents/query`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${active.session.apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              namespace: QUICKRULES_NAMESPACE,
              key: ruleId,
              page: 1,
              pageSize: 5,
            }),
          });
          if (queryRes.ok) {
            const parsed = await queryRes.json();
            for (const item of parsed?.items || []) {
              if (item?.id) {
                await fetch(`${active.serverUrl}/api/documents/${encodeURIComponent(item.id)}`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${active.session.apiToken}` },
                });
              }
            }
          }
        } catch {
          // Ignore server delete error if offline
        }
      }

      return {
        ok: true,
        data: { rules: filtered },
      };
    }

    case 'MB_API_REQUEST': {
      // Strictly retrieve the token scoped ONLY to the currently selected server origin
      if (!active.session.apiToken) {
        return {
          ok: false,
          status: 401,
          error: `MonkeyPatch is not authenticated for ${active.serverUrl}. Click the MonkeyPatch toolbar icon to sign in.`,
        };
      }

      const method = String(msg.payload?.method || 'GET').toUpperCase();
      const path = String(msg.payload?.path || '');
      const isEncrypted = Boolean(msg.payload?.encrypted);
      const encryptionSecret = config.encryptionSecret || '';
      const reqBody =
        isEncrypted && msg.payload?.body !== undefined && encryptionSecret
          ? await encryptOutgoingRequestBody(path, msg.payload.body, encryptionSecret)
          : msg.payload?.body;

      if (!ALLOWED_METHODS.has(method)) {
        return { ok: false, error: `Unsupported HTTP method: ${method}` };
      }

      const isAllowedPath = ALLOWED_API_PREFIXES.some((prefix) => path.startsWith(prefix));
      if (!isAllowedPath) {
        return { ok: false, error: `Restricted API path: ${path}` };
      }

      const requestOriginKey = active.originKey;
      const requestServerUrl = active.serverUrl;
      const requestToken = active.session.apiToken;

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${requestToken}`,
        };
        if (reqBody !== undefined && method !== 'GET') {
          headers['Content-Type'] = 'application/json';
        }

        const res = await fetch(`${requestServerUrl}${path}`, {
          method,
          headers,
          body: reqBody !== undefined && method !== 'GET' ? JSON.stringify(reqBody) : undefined,
        });

        // Guard against environment switches while an API call was in-flight
        const latestConfig = await getExtensionConfig();
        const latestActive = getActiveServerAndSession(latestConfig);
        if (latestActive.originKey !== requestOriginKey) {
          return {
            ok: false,
            error: 'Active MonkeyBrain server environment changed while request was in flight.',
          };
        }

        const text = await res.text();
        let parsed: any = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
        }

        if (res.status === 401) {
          return {
            ok: false,
            status: 401,
            error: `Session expired or token revoked for ${requestServerUrl}. Please log in again via the MonkeyPatch popup.`,
          };
        }

        if (!res.ok) {
          return {
            ok: false,
            status: res.status,
            error: parsed?.error || `MonkeyBrain API error (${res.status})`,
          };
        }

        const skipDecrypt = Boolean(msg.payload?.skipDecrypt);
        const finalData = encryptionSecret
          ? await decryptIncomingResponseData(parsed, encryptionSecret, skipDecrypt)
          : parsed;

        return { ok: true, status: res.status, data: finalData };
      } catch (err: any) {
        return {
          ok: false,
          error: `Network error calling MonkeyBrain (${requestServerUrl}): ${
            err?.message || 'Unknown error'
          }`,
        };
      }
    }

    default:
      return { ok: false, error: `Unknown message type: ${(msg as any)?.type}` };
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: BgRequestMessage, sender, sendResponse) => {
    handleMessage(message, sender)
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err?.message || 'Unexpected background worker error.',
        })
      );
    return true;
  });
}

function registerContextMenus() {
  if (typeof chrome === 'undefined' || !chrome.contextMenus?.create) return;
  try {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      chrome.contextMenus.create(
        {
          id: 'mp-save-quicknote',
          title: '📝 MonkeyPatch: Save to Quick Notes',
          contexts: ['selection', 'link', 'page'],
        },
        () => void chrome.runtime.lastError
      );
      chrome.contextMenus.create(
        {
          id: 'mp-tweak-element',
          title: '🎯 MonkeyPatch: Tweak / Hide Clicked Element (CSS)',
          contexts: ['all'],
        },
        () => void chrome.runtime.lastError
      );
    });
  } catch {
    // Ignore if contextMenus unavailable in test env
  }
}

registerContextMenus();

function reinjectContentScriptsIntoOpenTabs() {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query || !chrome.scripting?.executeScript) {
    return;
  }
  try {
    chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs) => {
      void chrome.runtime?.lastError;
      if (!Array.isArray(tabs)) return;
      for (const tab of tabs) {
        const tabId = tab.id;
        if (!tabId) continue;
        chrome.tabs.sendMessage(tabId, { type: 'MB_TAB_PATCH_STATUS' }, (res) => {
          if (chrome.runtime?.lastError || !res?.ok) {
            chrome.scripting
              .executeScript({
                target: { tabId },
                files: ['content.js'],
              })
              .catch(() => {});
          }
        });
      }
    });
  } catch {
    // Ignore errors when querying or injecting tabs
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    registerContextMenus();
    reinjectContentScriptsIntoOpenTabs();
  });
}

if (typeof chrome !== 'undefined' && chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const tabId = tab?.id;

    if (info.menuItemId === 'mp-tweak-element' && tabId !== undefined) {
      chrome.tabs.sendMessage(tabId, { type: 'MB_OPEN_ELEMENT_TWEAKER' }, () => {
        if (chrome.runtime.lastError && chrome.scripting?.executeScript) {
          chrome.scripting
            .executeScript({ target: { tabId }, files: ['content.js'] })
            .then(() => {
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { type: 'MB_OPEN_ELEMENT_TWEAKER' }, () => {
                  void chrome.runtime.lastError;
                });
              }, 80);
            })
            .catch(() => {});
        }
      });
      return;
    }

    if (info.menuItemId === 'mp-save-quicknote') {
      const config = await getExtensionConfig();
      const active = getActiveServerAndSession(config);
      const pageUrl = String(info.pageUrl || tab?.url || '');
      const cleanUrl = pageUrl.split('#')[0];
      let domain = 'unknown';
      try {
        domain = new URL(pageUrl).hostname.toLowerCase();
      } catch {
        // Fallback
      }

      const selectionText = info.selectionText ? String(info.selectionText).trim() : undefined;
      const linkUrl = info.linkUrl ? String(info.linkUrl).trim() : undefined;
      const title = String(tab?.title || domain || 'Saved Note').trim();

      const notePayload: SavedQuickNote = {
        title,
        note: selectionText || linkUrl || `Saved page: ${title}`,
        selectionText,
        linkUrl,
        pageUrl,
        domain,
        createdAt: new Date().toISOString(),
      };

      if (!active.session.apiToken) {
        if (tabId !== undefined) {
          chrome.tabs.sendMessage(
            tabId,
            {
              type: 'MB_SHOW_TOAST',
              message: '⚠️ Sign in to MonkeyPatch first to save Quick Notes.',
              tone: 'error',
            },
            () => void chrome.runtime.lastError
          );
        }
        return;
      }

      try {
        const res = await fetch(`${active.serverUrl}/api/documents/upsert`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${active.session.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            namespace: QUICKNOTES_NAMESPACE,
            key: `note-${Date.now()}`,
            type: 'quick-note',
            data: notePayload,
            resources: [`domain:${domain}`, `url:${cleanUrl}`],
          }),
        });

        if (res.ok) {
          if (tabId !== undefined) {
            chrome.tabs.sendMessage(
              tabId,
              {
                type: 'MB_SHOW_TOAST',
                message: '📝 Saved to MonkeyBrain Quick Notes ✓',
              },
              () => void chrome.runtime.lastError
            );
          }
          try {
            chrome.runtime.sendMessage({ type: 'MB_QUICKNOTES_UPDATED' }, () => {
              void chrome.runtime.lastError;
            });
          } catch {
            // Ignore if Side Panel closed
          }
        }
      } catch {
        if (tabId !== undefined) {
          chrome.tabs.sendMessage(
            tabId,
            {
              type: 'MB_SHOW_TOAST',
              message: '⚠️ Failed to save Quick Note to server.',
              tone: 'error',
            },
            () => void chrome.runtime.lastError
          );
        }
      }
    }
  });
}

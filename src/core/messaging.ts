declare const __MONKEYBRAIN_API_URL__: string | undefined;

export type ApiEnvironmentMode = 'production' | 'local' | 'custom';

export const PRODUCTION_SERVER_URL =
  (typeof __MONKEYBRAIN_API_URL__ !== 'undefined' && __MONKEYBRAIN_API_URL__) ||
  'https://stash.monkeybrain.cc';
export const LOCAL_SERVER_URL = 'http://localhost:27246';
export const DEFAULT_SERVER_URL = PRODUCTION_SERVER_URL;

export const QUICKNOTES_NAMESPACE = 'monkeybrain-saved-quicknotes';
export const QUICKRULES_NAMESPACE = 'monkeybrain-quick-rules';

export interface SavedQuickNote {
  title: string;
  note: string;
  selectionText?: string;
  linkUrl?: string;
  pageUrl: string;
  domain: string;
  createdAt: string;
}

export interface QuickCssRule {
  id: string;
  name: string;
  matchPattern: string;
  selector?: string;
  css: string;
  enabled: boolean;
  updatedAt: string;
}

export type BgMessageType =
  | 'MB_AUTH_STATUS'
  | 'MB_AUTH_LOGIN'
  | 'MB_AUTH_LOGOUT'
  | 'MB_SET_SERVER_URL'
  | 'MB_SELECT_SERVER'
  | 'MB_TEST_CONNECTION'
  | 'MB_API_REQUEST'
  | 'MB_LOG_TELEMETRY'
  | 'MB_GET_VERSION'
  | 'MB_GET_PATCH_SETTINGS'
  | 'MB_SET_PATCH_ENABLED'
  | 'MB_CONTENT_PANEL_UPDATED'
  | 'MB_UPDATE_TAB_BADGE'
  | 'MB_GET_ENCRYPTION_SECRET'
  | 'MB_SET_ENCRYPTION_SECRET'
  | 'MB_CORS_FETCH'
  | 'MB_GET_QUICK_RULES'
  | 'MB_SAVE_QUICK_RULE'
  | 'MB_DELETE_QUICK_RULE';

export interface BgRequestMessage {
  type: BgMessageType;
  payload?: any;
}

export interface BgResponseMessage<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface ServerSessionRecord {
  serverUrl: string;
  apiToken: string | null;
  user: UserSummary | null;
  tenant: TenantSummary | null;
}

export interface StoredExtensionConfig {
  selectedEnv: ApiEnvironmentMode;
  customServerUrl: string;
  sessionsByOrigin: Record<string, ServerSessionRecord>;
  disabledPatchIds?: string[];
  encryptionSecret?: string;
  quickCssRules?: QuickCssRule[];
}

/**
 * Legacy v1 shape for seamless migration if present.
 */
export interface StoredAuthSession extends ServerSessionRecord {}

export interface ConnectionTestResult {
  serverUrl: string;
  state: 'unreachable' | 'unauthenticated' | 'authenticated';
  healthOk: boolean;
  databaseStatus?: string;
  authenticated: boolean;
  user?: UserSummary | null;
  tenant?: TenantSummary | null;
  message: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validates and normalizes an API server URL.
 * - Requires https:// for all remote/custom servers.
 * - Allows http:// or https:// for localhost / loopback development.
 */
export function validateAndNormalizeServerUrl(
  rawUrl: string,
  options?: { requireHttpsForRemote?: boolean }
): { ok: true; url: string; origin: string; isLoopback: boolean } | { ok: false; error: string } {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return { ok: false, error: 'Server URL is required.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid URL format.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Server URL must use http:// or https://.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost');
  const requireHttps = options?.requireHttpsForRemote !== false;

  if (requireHttps && !isLoopback && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: 'Custom remote API servers must use HTTPS (http:// is only allowed for localhost/loopback).',
    };
  }

  const normalizedPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  const normalizedUrl = `${parsed.origin}${normalizedPath}`;

  return {
    ok: true,
    url: normalizedUrl,
    origin: parsed.origin.toLowerCase(),
    isLoopback,
  };
}

export function resolveActiveServerUrl(
  selectedEnv: ApiEnvironmentMode,
  customServerUrl?: string
): string {
  if (selectedEnv === 'local') {
    return LOCAL_SERVER_URL;
  }
  if (selectedEnv === 'custom' && customServerUrl) {
    const validated = validateAndNormalizeServerUrl(customServerUrl);
    if (validated.ok) {
      return validated.url;
    }
  }
  return PRODUCTION_SERVER_URL;
}

export function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export function isInvalidatedContextError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return (
    msg.includes('extension context invalidated') ||
    msg.includes('chrome extension runtime is not available')
  );
}

export function sendBackgroundMessage<T = any>(
  type: BgMessageType,
  payload?: any
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (
      typeof chrome === 'undefined' ||
      !chrome.runtime?.sendMessage ||
      (chrome.runtime && 'id' in chrome.runtime && !chrome.runtime.id)
    ) {
      reject(new Error('Extension context invalidated.'));
      return;
    }

    const message: BgRequestMessage = { type, payload };
    try {
      chrome.runtime.sendMessage(message, (response: BgResponseMessage<T>) => {
        const lastErr = chrome.runtime?.lastError;
        if (lastErr) {
          reject(new Error(lastErr.message || 'Background service worker communication error.'));
          return;
        }
        if (!response) {
          reject(new Error('No response from background service worker.'));
          return;
        }
        if (!response.ok) {
          reject(new Error(response.error || 'MonkeyBrain API request failed.'));
          return;
        }
        resolve(response.data as T);
      });
    } catch (err: any) {
      reject(new Error(err?.message || 'Extension context invalidated.'));
    }
  });
}

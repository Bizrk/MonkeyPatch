import {
  isExtensionContextValid,
  isInvalidatedContextError,
  sendBackgroundMessage,
} from '../core/messaging';
import type {
  CorsFetchOptions,
  CorsFetchResponse,
  CreateDocumentOptions,
  DocumentLifecycleOptions,
  MonkeyBrainDocument,
  NamespaceOptions,
  PageContextInfo,
  PagedDocuments,
  PatchBadgeController,
  PatchContext,
  PatchLogger,
  PatchNetController,
  PatchPanelController,
  PatchStore,
  SetDocumentOptions,
  StoreQueryOptions,
  UpdateDocumentOptions,
} from './types';

function resolveLifecyclePayload(options?: DocumentLifecycleOptions): {
  staleAt?: string | null;
  clearStaleAt?: boolean;
  expiresAt?: string | null;
  clearExpiresAt?: boolean;
} {
  if (!options) return {};

  let staleAt: string | null | undefined = undefined;
  let clearStaleAt = false;
  if (options.staleAt === null) {
    staleAt = null;
    clearStaleAt = true;
  } else if (options.staleAt instanceof Date) {
    staleAt = options.staleAt.toISOString();
  } else if (typeof options.staleAt === 'string' && options.staleAt.trim()) {
    staleAt = new Date(options.staleAt).toISOString();
  } else if (typeof options.staleInSeconds === 'number' && Number.isFinite(options.staleInSeconds)) {
    staleAt = new Date(Date.now() + options.staleInSeconds * 1000).toISOString();
  }

  let expiresAt: string | null | undefined = undefined;
  let clearExpiresAt = false;
  if (options.expiresAt === null) {
    expiresAt = null;
    clearExpiresAt = true;
  } else if (options.expiresAt instanceof Date) {
    expiresAt = options.expiresAt.toISOString();
  } else if (typeof options.expiresAt === 'string' && options.expiresAt.trim()) {
    expiresAt = new Date(options.expiresAt).toISOString();
  } else if (typeof options.expiresInSeconds === 'number' && Number.isFinite(options.expiresInSeconds)) {
    expiresAt = new Date(Date.now() + options.expiresInSeconds * 1000).toISOString();
  }

  const out: {
    staleAt?: string | null;
    clearStaleAt?: boolean;
    expiresAt?: string | null;
    clearExpiresAt?: boolean;
  } = {};

  if (staleAt !== undefined) out.staleAt = staleAt;
  if (clearStaleAt) out.clearStaleAt = true;
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  if (clearExpiresAt) out.clearExpiresAt = true;

  return out;
}

export type TransportFn = <T = any>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: any,
  options?: { encrypted?: boolean }
) => Promise<T>;

export const defaultBackgroundTransport: TransportFn = async <T = any>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: any,
  options?: { encrypted?: boolean }
): Promise<T> => {
  return sendBackgroundMessage<T>('MB_API_REQUEST', {
    method,
    path,
    body,
    encrypted: Boolean(options?.encrypted),
  });
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class NamespacedPatchStore implements PatchStore {
  public readonly namespace: string;
  public readonly encrypted: boolean;
  private readonly transport: TransportFn;

  constructor(
    namespace: string,
    transport: TransportFn = defaultBackgroundTransport,
    options?: NamespaceOptions
  ) {
    if (!namespace || !namespace.trim()) {
      throw new Error('PatchStore requires a non-empty namespace.');
    }
    this.namespace = namespace.trim();
    this.encrypted = Boolean(options?.encrypted);
    this.transport = transport;
  }

  async set<T = Record<string, any>>(
    key: string,
    data: T,
    options?: SetDocumentOptions
  ): Promise<MonkeyBrainDocument<T>> {
    if (!key || !key.trim()) {
      throw new Error('store.set() requires a non-empty logical key.');
    }

    const lifecycle = resolveLifecyclePayload(options);

    return this.transport<MonkeyBrainDocument<T>>(
      'POST',
      '/api/documents/upsert',
      {
        namespace: this.namespace,
        key: key.trim(),
        type: options?.type ?? null,
        data,
        resources: options?.resources ?? null,
        mergeData: options?.mergeData ?? false,
        mergeResources: options?.mergeResources ?? false,
        ...lifecycle,
      },
      { encrypted: this.encrypted }
    );
  }

  async get<T = Record<string, any>>(key: string): Promise<MonkeyBrainDocument<T> | null> {
    if (!key || !key.trim()) return null;

    const res = await this.queryPaged<T>({
      key: key.trim(),
      page: 1,
      pageSize: 1,
    });

    return res.items.length > 0 ? res.items[0] : null;
  }

  async getById<T = Record<string, any>>(id: string): Promise<MonkeyBrainDocument<T> | null> {
    try {
      return await this.transport<MonkeyBrainDocument<T>>(
        'GET',
        `/api/documents/${encodeURIComponent(id)}`,
        undefined,
        { encrypted: this.encrypted }
      );
    } catch (err: any) {
      if (String(err?.message || '').includes('404') || String(err?.message || '').toLowerCase().includes('not found')) {
        return null;
      }
      throw err;
    }
  }

  async create<T = Record<string, any>>(
    data: T,
    options?: CreateDocumentOptions
  ): Promise<MonkeyBrainDocument<T>> {
    const lifecycle = resolveLifecyclePayload(options);
    return this.transport<MonkeyBrainDocument<T>>(
      'POST',
      '/api/documents',
      {
        namespace: this.namespace,
        key: options?.key ?? null,
        type: options?.type ?? null,
        data,
        resources: options?.resources ?? null,
        staleAt: lifecycle.staleAt ?? null,
        expiresAt: lifecycle.expiresAt ?? null,
      },
      { encrypted: this.encrypted }
    );
  }

  async updateById<T = Record<string, any>>(
    id: string,
    data: Partial<T>,
    options?: UpdateDocumentOptions
  ): Promise<MonkeyBrainDocument<T>> {
    const lifecycle = resolveLifecyclePayload(options);
    return this.transport<MonkeyBrainDocument<T>>(
      'PATCH',
      `/api/documents/${encodeURIComponent(id)}`,
      {
        key: options?.key,
        type: options?.type,
        data,
        mergeData: options?.mergeData ?? true,
        resources: options?.resources,
        ...lifecycle,
      },
      { encrypted: this.encrypted }
    );
  }

  async deleteById(id: string): Promise<boolean> {
    await this.transport(
      'DELETE',
      `/api/documents/${encodeURIComponent(id)}`,
      undefined,
      { encrypted: this.encrypted }
    );
    return true;
  }

  async delete(keyOrId: string): Promise<boolean> {
    const trimmed = keyOrId.trim();
    const existingByKey = await this.get(trimmed);
    if (existingByKey) {
      await this.deleteById(existingByKey.id);
      return true;
    }

    if (UUID_REGEX.test(trimmed)) {
      await this.deleteById(trimmed);
      return true;
    }

    return false;
  }

  async query<T = Record<string, any>>(
    options?: StoreQueryOptions & { namespace?: string }
  ): Promise<MonkeyBrainDocument<T>[]> {
    const paged = await this.queryPaged<T>(options);
    return paged.items;
  }

  async queryPaged<T = Record<string, any>>(
    options?: StoreQueryOptions & { namespace?: string }
  ): Promise<PagedDocuments<T>> {
    const targetNamespace =
      options && 'namespace' in options ? options.namespace : this.namespace;

    const res = await this.transport<PagedDocuments<T>>(
      'POST',
      '/api/documents/query',
      {
        namespace: targetNamespace,
        type: options?.type ?? null,
        key: options?.key ?? null,
        resource: options?.resource ?? null,
        resources: options?.resources ?? null,
        resourceMatch: options?.resourceMatch ?? 'ANY',
        resourcePrefix: options?.resourcePrefix ?? null,
        context: options?.context ?? null,
        // If encrypted, evaluate JSONB filters client-side after decryption
        filters: this.encrypted ? null : options?.filters ?? null,
        isStale: options?.isStale ?? null,
        includeExpired: options?.includeExpired ?? false,
        sortBy: options?.sortBy ?? 'updatedAt',
        sortDirection: options?.sortDirection ?? 'desc',
        page: options?.page ?? 1,
        pageSize: options?.pageSize ?? 50,
      },
      { encrypted: this.encrypted }
    );

    if (this.encrypted && options?.filters && options.filters.length > 0 && Array.isArray(res?.items)) {
      const filtered = res.items.filter((doc) => {
        const d = (doc.data || {}) as Record<string, any>;
        return options.filters!.every((f) => {
          const fieldVal = d[f.field];
          if (f.operator === 'contains') {
            return String(fieldVal ?? '')
              .toLowerCase()
              .includes(String(f.value ?? '').toLowerCase());
          }
          return String(fieldVal ?? '') === String(f.value ?? '');
        });
      });
      return {
        ...res,
        items: filtered,
        totalCount: filtered.length,
      };
    }

    return res;
  }

  async addResources<T = Record<string, any>>(
    documentId: string,
    resources: string[]
  ): Promise<MonkeyBrainDocument<T>> {
    return this.transport<MonkeyBrainDocument<T>>(
      'POST',
      `/api/documents/${encodeURIComponent(documentId)}/resources`,
      { resources }
    );
  }

  async removeResources<T = Record<string, any>>(
    documentId: string,
    resources: string[]
  ): Promise<MonkeyBrainDocument<T>> {
    return this.transport<MonkeyBrainDocument<T>>(
      'DELETE',
      `/api/documents/${encodeURIComponent(documentId)}/resources`,
      { resources }
    );
  }
}

export function createPageContextInfo(loc: Location = window.location): PageContextInfo {
  const cleanUrl = loc.href.split('#')[0];
  const domain = loc.hostname.toLowerCase();
  const origin = loc.origin;
  const pathname = loc.pathname;

  return {
    get url() {
      return window.location.href.split('#')[0];
    },
    get origin() {
      return window.location.origin;
    },
    get domain() {
      return window.location.hostname.toLowerCase();
    },
    get pathname() {
      return window.location.pathname;
    },
    get urlResource() {
      return `url:${window.location.href.split('#')[0]}`;
    },
    get domainResource() {
      return `domain:${window.location.hostname.toLowerCase()}`;
    },
    get originResource() {
      return `origin:${window.location.origin}`;
    },
    defaultResources(extra: string[] = []) {
      const currentCleanUrl = window.location.href.split('#')[0];
      const currentDomain = window.location.hostname.toLowerCase();
      return Array.from(
        new Set([`url:${currentCleanUrl}`, `domain:${currentDomain}`, ...extra])
      );
    },
  };
}

export function createPatchLogger(patchId: string): PatchLogger {
  const send = (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any) => {
    if (isInvalidatedContextError(message) || isInvalidatedContextError(data)) {
      return;
    }

    const prefix = `[MonkeyPatch::${patchId}] ${message}`;
    if (level === 'error') console.error(prefix, data ?? '');
    else if (level === 'warn') console.warn(prefix, data ?? '');
    else if (level === 'debug') console.debug(prefix, data ?? '');
    else console.info(prefix, data ?? '');

    if (!isExtensionContextValid()) return;

    sendBackgroundMessage('MB_LOG_TELEMETRY', {
      level,
      category: `Patch:${patchId}`,
      message,
      data: data !== undefined ? JSON.stringify(data) : null,
    }).catch(() => {});
  };

  return {
    info: (msg, data) => send('info', msg, data),
    warn: (msg, data) => send('warn', msg, data),
    error: (msg, data) => send('error', msg, data),
    debug: (msg, data) => send('debug', msg, data),
  };
}

export function createPatchNetController(): PatchNetController {
  return {
    async fetch<T = any>(
      url: string,
      options?: CorsFetchOptions
    ): Promise<CorsFetchResponse<T>> {
      return sendBackgroundMessage<CorsFetchResponse<T>>('MB_CORS_FETCH', {
        url,
        method: options?.method || 'GET',
        headers: options?.headers || {},
        body: options?.body,
      });
    },
    async getJson<T = any>(url: string, headers?: Record<string, string>): Promise<T> {
      const res = await sendBackgroundMessage<CorsFetchResponse<T>>('MB_CORS_FETCH', {
        url,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(headers || {}),
        },
      });
      if (!res.ok) {
        throw new Error(`CORS fetch failed (${res.status}): ${url}`);
      }
      if (res.json !== null && res.json !== undefined) {
        return res.json;
      }
      return JSON.parse(res.text) as T;
    },
    async getText(url: string, headers?: Record<string, string>): Promise<string> {
      const res = await sendBackgroundMessage<CorsFetchResponse>('MB_CORS_FETCH', {
        url,
        method: 'GET',
        headers: headers || {},
      });
      if (!res.ok) {
        throw new Error(`CORS fetch failed (${res.status}): ${url}`);
      }
      return res.text;
    },
  };
}

export function createPatchContext(
  patchId: string,
  registerCleanup: (fn: () => void) => void,
  transport: TransportFn = defaultBackgroundTransport,
  panelController?: PatchPanelController,
  badgeController?: PatchBadgeController,
  netController?: PatchNetController
): PatchContext {
  const noopPanel: PatchPanelController = {
    set() {},
    clear() {},
    onAction() {},
  };

  const noopBadge: PatchBadgeController = {
    set() {},
    clear() {},
  };

  return {
    patchId,
    page: createPageContextInfo(),
    log: createPatchLogger(patchId),
    panel: panelController || noopPanel,
    badge: badgeController || noopBadge,
    net: netController || createPatchNetController(),
    store: {
      namespace(ns: string, options?: NamespaceOptions) {
        return new NamespacedPatchStore(ns, transport, options);
      },
    },
    onCleanup(fn: () => void) {
      registerCleanup(fn);
    },
  };
}

export * from './types';

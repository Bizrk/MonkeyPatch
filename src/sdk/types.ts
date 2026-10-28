export interface MonkeyBrainDocument<T = Record<string, any>> {
  id: string;
  tenantId: string;
  namespace: string;
  key?: string | null;
  type?: string | null;
  data: T;
  resources: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * Optional UTC timestamp (ISO 8601) when this document becomes stale (needs refresh).
   * Null or undefined means the document never goes stale.
   */
  staleAt?: string | null;
  /**
   * Optional UTC timestamp (ISO 8601) when this document expires and is auto-purged by the server.
   * Null or undefined means the document never expires.
   */
  expiresAt?: string | null;
  /**
   * True when `staleAt` is set and the current UTC time is at or past `staleAt`.
   */
  isStale?: boolean;
}

export interface PagedDocuments<T = Record<string, any>> {
  items: MonkeyBrainDocument<T>[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface JsonFieldFilter {
  field: string;
  operator?: 'eq' | 'contains';
  value: any;
}

export interface ContextQueryFilter {
  url?: string;
  origin?: string;
  domain?: string;
  pathPrefix?: string;
}

export interface StoreQueryOptions {
  type?: string;
  key?: string;
  resource?: string;
  resources?: string[];
  resourceMatch?: 'ANY' | 'ALL';
  resourcePrefix?: string;
  context?: ContextQueryFilter;
  filters?: JsonFieldFilter[];
  /**
   * Filter by staleness (`true` = only stale documents, `false` = only fresh documents).
   */
  isStale?: boolean;
  /**
   * When true, includes expired documents that have not yet been purged by the background worker.
   */
  includeExpired?: boolean;
  sortBy?: 'createdAt' | 'updatedAt' | 'staleAt' | 'expiresAt' | 'key' | 'namespace' | 'type';
  sortDirection?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface DocumentLifecycleOptions {
  /**
   * Optional soft-TTL timestamp (`Date` or ISO string) indicating when the document becomes stale.
   * Pass `null` to explicitly clear an existing `staleAt` timestamp on update/upsert.
   */
  staleAt?: Date | string | null;
  /**
   * Convenience relative duration (in seconds) from now until the document becomes stale.
   * Converted to a UTC `staleAt` ISO timestamp before sending to the API.
   */
  staleInSeconds?: number;
  /**
   * Optional hard-TTL timestamp (`Date` or ISO string) indicating when the document expires and will be auto-purged.
   * Pass `null` to explicitly clear an existing `expiresAt` timestamp on update/upsert.
   */
  expiresAt?: Date | string | null;
  /**
   * Convenience relative duration (in seconds) from now until the document expires and is auto-purged.
   * Converted to a UTC `expiresAt` ISO timestamp before sending to the API.
   */
  expiresInSeconds?: number;
}

export interface SetDocumentOptions extends DocumentLifecycleOptions {
  type?: string;
  resources?: string[];
  mergeData?: boolean;
  mergeResources?: boolean;
}

export interface CreateDocumentOptions extends DocumentLifecycleOptions {
  key?: string;
  type?: string;
  resources?: string[];
}

export interface UpdateDocumentOptions extends DocumentLifecycleOptions {
  type?: string;
  key?: string;
  resources?: string[];
  mergeData?: boolean;
}

export interface NamespaceOptions {
  /**
   * When true, the extension background worker transparently encrypts `data` with AES-256-GCM
   * and HMAC-hashes `namespace`, `key`, `type`, and `resources` before sending to the MonkeyBrain API.
   */
  encrypted?: boolean;
}

export interface PatchStore {
  readonly namespace: string;
  readonly encrypted?: boolean;

  /**
   * Upsert a document by logical key inside this namespace.
   */
  set<T = Record<string, any>>(
    key: string,
    data: T,
    options?: SetDocumentOptions
  ): Promise<MonkeyBrainDocument<T>>;

  /**
   * Retrieve a single document by logical key inside this namespace, or null if not found.
   */
  get<T = Record<string, any>>(key: string): Promise<MonkeyBrainDocument<T> | null>;

  /**
   * Retrieve a single document by its UUID.
   */
  getById<T = Record<string, any>>(id: string): Promise<MonkeyBrainDocument<T> | null>;

  /**
   * Create a new document (with or without a logical key).
   */
  create<T = Record<string, any>>(
    data: T,
    options?: CreateDocumentOptions
  ): Promise<MonkeyBrainDocument<T>>;

  /**
   * Partially update a document by UUID.
   */
  updateById<T = Record<string, any>>(
    id: string,
    data: Partial<T>,
    options?: UpdateDocumentOptions
  ): Promise<MonkeyBrainDocument<T>>;

  /**
   * Delete a document by logical key (or UUID if key doesn't match and looks like a UUID).
   */
  delete(keyOrId: string): Promise<boolean>;

  /**
   * Delete a document explicitly by UUID.
   */
  deleteById(id: string): Promise<boolean>;

  /**
   * Query documents within this namespace (or across namespaces if crossNamespace is provided).
   */
  query<T = Record<string, any>>(
    options?: StoreQueryOptions & { namespace?: string }
  ): Promise<MonkeyBrainDocument<T>[]>;

  /**
   * Query documents with full pagination metadata.
   */
  queryPaged<T = Record<string, any>>(
    options?: StoreQueryOptions & { namespace?: string }
  ): Promise<PagedDocuments<T>>;

  /**
   * Add resource identifiers to an existing document by UUID.
   */
  addResources<T = Record<string, any>>(
    documentId: string,
    resources: string[]
  ): Promise<MonkeyBrainDocument<T>>;

  /**
   * Remove resource identifiers from an existing document by UUID.
   */
  removeResources<T = Record<string, any>>(
    documentId: string,
    resources: string[]
  ): Promise<MonkeyBrainDocument<T>>;
}

export interface PageContextInfo {
  readonly url: string;
  readonly origin: string;
  readonly domain: string;
  readonly pathname: string;
  readonly urlResource: string;
  readonly domainResource: string;
  readonly originResource: string;
  /**
   * Returns standard resource tags for the current page: [`url:<cleanUrl>`, `domain:<hostname>`]
   */
  defaultResources(extra?: string[]): string[];
}

export interface PatchLogger {
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, data?: any): void;
  debug(message: string, data?: any): void;
}

export interface PanelStatItem {
  label: string;
  value: string | number;
}

export interface PanelListItem {
  id?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  actionId?: string;
  actionLabel?: string;
}

export interface PanelFormField {
  name: string;
  label?: string;
  placeholder?: string;
  type?: 'text' | 'textarea' | 'select';
  defaultValue?: string;
  options?: Array<{ label: string; value: string }>;
}

export type PanelSection =
  | {
      type: 'stats';
      title?: string;
      columns?: 2 | 3 | 4;
      items: PanelStatItem[];
    }
  | {
      type: 'text';
      title?: string;
      content: string;
      tone?: 'default' | 'info' | 'highlight';
    }
  | {
      type: 'list';
      title?: string;
      emptyText?: string;
      items: PanelListItem[];
    }
  | {
      type: 'form';
      title?: string;
      actionId: string;
      submitLabel?: string;
      fields: PanelFormField[];
    };

export interface PanelActionButton {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface PatchPanelView {
  title?: string;
  badge?: string | number;
  subtitle?: string;
  status?: string;
  sections?: PanelSection[];
  actions?: PanelActionButton[];
}

export type PanelActionHandler = (
  actionId: string,
  payload?: Record<string, any>
) => void | Promise<void>;

export interface PatchPanelController {
  /**
   * Publish or update this patch's structured output in the MonkeyPatch Chrome Side Panel.
   */
  set(view: PatchPanelView): void;
  /**
   * Clear this patch's output from the Chrome Side Panel.
   */
  clear(): void;
  /**
   * Register a callback for buttons or forms triggered by the user inside the Chrome Side Panel.
   */
  onAction(handler: PanelActionHandler): void;
}

export interface BadgeOptions {
  /**
   * Hex color for the toolbar badge background (defaults to Brain Pink `#F43F5E`).
   */
  backgroundColor?: string;
  /**
   * Hex color for the toolbar badge text (defaults to Banana Cream `#FFFBEB`).
   */
  textColor?: string;
}

export interface PatchBadgeController {
  /**
   * Set the extension toolbar icon badge count or short text for the current browser tab.
   * Pass `0` or `""` to hide the badge, or call `ctx.badge.clear()`.
   */
  set(value: number | string, options?: BadgeOptions): void;
  /**
   * Clear this patch's badge from the extension toolbar icon on the current tab.
   */
  clear(): void;
}

export interface CorsFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | Record<string, any>;
}

export interface CorsFetchResponse<T = any> {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  text: string;
  json: T | null;
}

export interface PatchNetController {
  /**
   * Perform a CORS-free HTTP request via the extension's background service worker
   * (similar to Tampermonkey's GM_xmlhttpRequest).
   */
  fetch<T = any>(url: string, options?: CorsFetchOptions): Promise<CorsFetchResponse<T>>;
  /**
   * Convenience helper to fetch and parse JSON via the background service worker.
   */
  getJson<T = any>(url: string, headers?: Record<string, string>): Promise<T>;
  /**
   * Convenience helper to fetch raw text/HTML via the background service worker.
   */
  getText(url: string, headers?: Record<string, string>): Promise<string>;
}

export interface PatchContext {
  readonly patchId: string;
  readonly page: PageContextInfo;
  readonly log: PatchLogger;
  readonly panel: PatchPanelController;
  readonly badge: PatchBadgeController;
  readonly net: PatchNetController;
  readonly store: {
    namespace(ns: string, options?: NamespaceOptions): PatchStore;
  };
  /**
   * Register a cleanup callback that executes when the user navigates away (SPA navigation) or the patch re-runs.
   */
  onCleanup(fn: () => void): void;
}

export type CleanupFn = () => void;

export interface MonkeyPatchDefinition {
  /**
   * Unique identifier for the patch (e.g. "demo-notes", "jira-helper").
   */
  id: string;

  /**
   * Human-readable display name.
   */
  name: string;

  /**
   * Optional description shown in the extension popup.
   */
  description?: string;

  // Chrome match patterns or glob patterns (e.g. ["https://example.com/*"])
  matches: string[];

  /**
   * Optional extra host permissions required only when this patch is bundled.
   */
  hostPermissions?: string[];

  /**
   * Whether the patch should automatically re-run on History API SPA route changes (default: true).
   */
  runOnSpaNavigation?: boolean;

  /**
   * Declare that this patch publishes output to the MonkeyPatch Live Output tab (`ctx.panel`).
   * When true and this patch is active on the current tab, the Side Panel automatically defaults to the Live Output tab.
   */
  usesPanel?: boolean;

  /**
   * Entry point executed when the current page matches `matches`.
   * May optionally return a cleanup function.
   */
  run(ctx: PatchContext): Promise<void | CleanupFn> | void | CleanupFn;
}

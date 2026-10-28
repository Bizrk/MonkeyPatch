import React, { useEffect, useState, useCallback, useRef } from 'react';
import { patches, buildProfile } from 'virtual:patch-registry';
import { matchesUrlPattern, patchMatchesUrl } from '../core/urlMatcher';
import type { PatchPanelView, PanelSection } from '../sdk/types';
import {
  sendBackgroundMessage,
  PRODUCTION_SERVER_URL,
  QUICKNOTES_NAMESPACE,
  type ApiEnvironmentMode,
  type QuickCssRule,
  type SavedQuickNote,
} from '../core/messaging';

interface AuthState {
  selectedEnv: ApiEnvironmentMode;
  customServerUrl: string;
  serverUrl: string;
  authenticated: boolean;
  user: { id: string; email: string; displayName: string } | null;
  tenant: { id: string; name: string; slug: string; role: string } | null;
}

interface ActivePatchSummary {
  id: string;
  name: string;
  description: string;
  usesPanel?: boolean;
  badgeText?: string;
}

interface ActivePanelEntry {
  patchId: string;
  patchName: string;
  view: PatchPanelView;
}

type UiTab = 'output' | 'notes' | 'scripts' | 'connection';

// ColorRamp Design Tokens (DESIGN.md)
// Amber establishes the environment; Raspberry invites action; Typography establishes hierarchy.
const THEME = {
  bgCanvas: '#0B0700',
  bgSurface: '#1A1102',
  bgCardInner: '#130C01',
  bgElevated: '#271800',
  bgSecondary: '#423406',
  bgInset: '#0E0900',
  borderSubtle: 'rgba(91, 75, 30, 0.5)',
  borderStrong: '#85681A',
  textPrimary: '#FFFAE9',
  textSecondary: '#E2D7BD',
  textMuted: '#B89B49',
  brandAccent: '#FACC15',
  softHighlight: '#FFE04B',
  actionPrimary: '#DB2777',
  actionHover: '#F76F9F',
  actionSubtleBg: '#3B0018',
  actionBorder: '#AD175C',
  actionText: '#FFA9C8',
  successGreen: '#22C55E',
  successBg: 'rgba(20, 83, 45, 0.24)',
  successBorder: 'rgba(34, 197, 94, 0.38)',
};

// Cohesive SVG Icon System
const Icons = {
  Chart: ({ color = 'currentColor', size = 16 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  Note: ({ color = '#FACC15', size = 18 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  ),
  Bolt: ({ color = 'currentColor', size = 16 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Server: ({ color = 'currentColor', size = 16 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  ),
  External: ({ color = '#FACC15', size = 14 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  ),
  Globe: ({ color = '#FACC15', size = 20 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  Layers: ({ color = '#FACC15', size = 20 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  ),
  Trash: ({ color = 'currentColor', size = 15 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  Refresh: ({ color = '#FACC15', size = 16 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  ),
  Palette: ({ color = '#FACC15', size = 19 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill={color} />
      <circle cx="17.5" cy="10.5" r=".5" fill={color} />
      <circle cx="8.5" cy="7.5" r=".5" fill={color} />
      <circle cx="6.5" cy="12.5" r=".5" fill={color} />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  ),
  Edit: ({ color = '#FACC15', size = 15 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  Dots: ({ color = '#E2D7BD', size = 16 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  ),
  Menu: ({ color = 'currentColor', size = 17 }: { color?: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
};

export function PopupApp() {
  const [activeUiTab, setActiveUiTab] = useState<UiTab>('notes');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const userManuallySelectedTab = useRef(false);
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<AuthState>({
    selectedEnv: 'production',
    customServerUrl: '',
    serverUrl: PRODUCTION_SERVER_URL,
    authenticated: false,
    user: null,
    tenant: null,
  });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [currentTabUrl, setCurrentTabUrl] = useState<string>('');
  const [activeTabPatches, setActiveTabPatches] = useState<ActivePatchSummary[]>([]);
  const [activePanelViews, setActivePanelViews] = useState<ActivePanelEntry[]>([]);
  const [formStateByPatch, setFormStateByPatch] = useState<Record<string, Record<string, string>>>({});
  const [disabledPatchIds, setDisabledPatchIds] = useState<string[]>([]);
  const [expandedPatchIds, setExpandedPatchIds] = useState<Record<string, boolean>>({});
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>('MonkeyPatch');
  const [encryptionSecret, setEncryptionSecret] = useState<string>('');
  const [showEncryptionSecret, setShowEncryptionSecret] = useState(false);

  // Server DB Inspector State
  const [showServerDbInspector, setShowServerDbInspector] = useState(true);
  const [rawDbDocs, setRawDbDocs] = useState<any[]>([]);
  const [rawDbLoading, setRawDbLoading] = useState(false);
  const [rawDbSkipDecrypt, setRawDbSkipDecrypt] = useState(true);
  const [rawDbScope, setRawDbScope] = useState<'tab' | 'all'>('tab');
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  // Quick Notes & Quick CSS Rules State
  const [quickNotesDocs, setQuickNotesDocs] = useState<any[]>([]);
  const [quickNotesLoading, setQuickNotesLoading] = useState(false);
  const [quickNotesScope, setQuickNotesScope] = useState<'site' | 'all'>('site');
  const [newQuickNoteText, setNewQuickNoteText] = useState('');
  const [openNoteMenuId, setOpenNoteMenuId] = useState<string | null>(null);
  const [confirmClearNotes, setConfirmClearNotes] = useState(false);

  const [quickCssRules, setQuickCssRules] = useState<QuickCssRule[]>([]);
  const [quickCssScope, setQuickCssScope] = useState<'tab' | 'all'>('all');
  const [manageRulesExpanded, setManageRulesExpanded] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [openRuleMenuId, setOpenRuleMenuId] = useState<string | null>(null);
  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleCss, setNewRuleCss] = useState('');

  const localVersion =
    typeof chrome !== 'undefined' && chrome.runtime?.getManifest
      ? chrome.runtime.getManifest().version
      : '0.1.0';

  const fetchQuickNotes = useCallback(async () => {
    setQuickNotesLoading(true);
    try {
      const res = await sendBackgroundMessage<{ items: any[] }>('MB_API_REQUEST', {
        method: 'POST',
        path: '/api/documents/query',
        body: {
          namespace: QUICKNOTES_NAMESPACE,
          page: 1,
          pageSize: 50,
          sortBy: 'updatedAt',
          sortDirection: 'desc',
        },
      });
      setQuickNotesDocs(res?.items || []);
    } catch {
      setQuickNotesDocs([]);
    } finally {
      setQuickNotesLoading(false);
    }
  }, []);

  const fetchQuickCssRules = useCallback(async (syncFromServer = true) => {
    try {
      const res = await sendBackgroundMessage<{ rules: QuickCssRule[] }>('MB_GET_QUICK_RULES', {
        syncFromServer,
      });
      if (res && Array.isArray(res.rules)) {
        setQuickCssRules(res.rules);
      }
    } catch {
      // Ignore
    }
  }, []);

  const queryActiveTabStatus = useCallback(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      const tabUrl = activeTab?.url || '';
      setCurrentTabUrl(tabUrl);

      if (activeTab?.id) {
        const tabId = activeTab.id;
        const applyStatusResponse = (res: any) => {
          const nextActivePatches: ActivePatchSummary[] = res.activePatches || [];
          const nextPanelViews: ActivePanelEntry[] = res.panelViews || [];
          const effectiveUrl = res.url || tabUrl;

          setActiveTabPatches(nextActivePatches);
          setActivePanelViews(nextPanelViews);
          if (effectiveUrl) setCurrentTabUrl(effectiveUrl);

          const hasActivePanelScript =
            nextPanelViews.length > 0 ||
            nextActivePatches.some((p) => Boolean(p.usesPanel));

          if (!userManuallySelectedTab.current) {
            setActiveUiTab(hasActivePanelScript ? 'output' : 'notes');
          }
        };

        chrome.tabs.sendMessage(
          tabId,
          { type: 'MB_TAB_PATCH_STATUS' },
          (res) => {
            if (!chrome.runtime.lastError && res?.ok) {
              applyStatusResponse(res);
            } else {
              const isInjectableUrl = /^https?:\/\//i.test(tabUrl);
              if (isInjectableUrl && chrome.scripting?.executeScript) {
                chrome.scripting
                  .executeScript({
                    target: { tabId },
                    files: ['content.js'],
                  })
                  .then(() => {
                    setTimeout(() => {
                      chrome.tabs.sendMessage(
                        tabId,
                        { type: 'MB_TAB_PATCH_STATUS' },
                        (retryRes) => {
                          if (!chrome.runtime.lastError && retryRes?.ok) {
                            applyStatusResponse(retryRes);
                          }
                        }
                      );
                    }, 80);
                  })
                  .catch(() => {});
              }

              setActiveTabPatches([]);
              setActivePanelViews([]);
              const hasRegisteredPanelMatch = tabUrl
                ? patches.some((p) => p.usesPanel && patchMatchesUrl(p.matches, tabUrl))
                : false;
              if (!userManuallySelectedTab.current) {
                setActiveUiTab(hasRegisteredPanelMatch ? 'output' : 'notes');
              }
            }
          }
        );
      } else {
        setActiveTabPatches([]);
        setActivePanelViews([]);
      }
    });
  }, []);

  async function refreshStatus() {
    setLoading(true);
    setError(null);
    try {
      const [status, patchSettings, encSettings] = await Promise.all([
        sendBackgroundMessage<AuthState>('MB_AUTH_STATUS'),
        sendBackgroundMessage<{ disabledPatchIds: string[] }>('MB_GET_PATCH_SETTINGS').catch(
          () => ({ disabledPatchIds: [] })
        ),
        sendBackgroundMessage<{ encryptionSecret: string }>('MB_GET_ENCRYPTION_SECRET').catch(
          () => ({ encryptionSecret: '' })
        ),
      ]);

      let effectiveStatus = status;
      if (status.selectedEnv !== 'production') {
        try {
          effectiveStatus = await sendBackgroundMessage<AuthState>('MB_SELECT_SERVER', {
            selectedEnv: 'production',
          });
        } catch {
          // Keep status
        }
      }

      setAuth(effectiveStatus);
      setDisabledPatchIds(patchSettings?.disabledPatchIds || []);
      if (encSettings?.encryptionSecret) {
        setEncryptionSecret(encSettings.encryptionSecret);
      }

      fetchQuickNotes();
      fetchQuickCssRules(true);

      sendBackgroundMessage<any>('MB_GET_VERSION')
        .then((v) => {
          if (v?.extensionVersion) setRemoteVersion(v.extensionVersion);
          if (v?.extensionDisplayName) setDisplayName(v.extensionDisplayName);
        })
        .catch(() => {
          setRemoteVersion(null);
        });

      queryActiveTabStatus();
    } catch (err: any) {
      setError(err?.message || 'Failed to read extension status.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshStatus();

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const handleActivated = () => {
        userManuallySelectedTab.current = false;
        queryActiveTabStatus();
      };
      const handleUpdated = (_tabId: number, changeInfo: any) => {
        if (changeInfo.status === 'complete' || changeInfo.url) {
          queryActiveTabStatus();
          setTimeout(queryActiveTabStatus, 350);
          setTimeout(queryActiveTabStatus, 1000);
        }
      };

      chrome.tabs.onActivated?.addListener(handleActivated);
      chrome.tabs.onUpdated?.addListener(handleUpdated);

      const handleRuntimeMessage = (msg: any) => {
        if (msg?.type === 'MB_CONTENT_PANEL_UPDATED') {
          queryActiveTabStatus();
        } else if (msg?.type === 'MB_QUICKNOTES_UPDATED') {
          fetchQuickNotes();
        } else if (msg?.type === 'MB_QUICK_RULES_UPDATED' && Array.isArray(msg.rules)) {
          setQuickCssRules(msg.rules);
        }
      };
      chrome.runtime?.onMessage?.addListener(handleRuntimeMessage);

      return () => {
        chrome.tabs.onActivated?.removeListener(handleActivated);
        chrome.tabs.onUpdated?.removeListener(handleUpdated);
        chrome.runtime?.onMessage?.removeListener(handleRuntimeMessage);
      };
    }
  }, [queryActiveTabStatus, fetchQuickNotes, fetchQuickCssRules]);

  async function handleTogglePatch(patchId: string, nextEnabled: boolean) {
    setError(null);
    try {
      const res = await sendBackgroundMessage<{ disabledPatchIds: string[] }>(
        'MB_SET_PATCH_ENABLED',
        {
          patchId,
          enabled: nextEnabled,
        }
      );
      setDisabledPatchIds(res?.disabledPatchIds || []);
      setTimeout(() => {
        queryActiveTabStatus();
      }, 120);
    } catch (err: any) {
      setError(err?.message || 'Failed to toggle script state.');
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatusMsg(null);

    try {
      const data = await sendBackgroundMessage<AuthState>('MB_AUTH_LOGIN', {
        serverUrl: PRODUCTION_SERVER_URL,
        email,
        password,
      });
      setAuth(data);
      setPassword('');
      fetchQuickNotes();
      fetchQuickCssRules(true);
    } catch (err: any) {
      setError(err?.message || 'Login failed.');
    }
  }

  async function handleLogout() {
    setError(null);
    setStatusMsg(null);
    try {
      const updated = await sendBackgroundMessage<AuthState>('MB_AUTH_LOGOUT');
      setAuth(updated);
      setStatusMsg('Signed out.');
    } catch (err: any) {
      setError(err?.message || 'Logout failed.');
    }
  }

  async function handleSaveEncryptionSecret(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatusMsg(null);
    try {
      const res = await sendBackgroundMessage<{ encryptionSecret: string }>(
        'MB_SET_ENCRYPTION_SECRET',
        { encryptionSecret }
      );
      if (res?.encryptionSecret) {
        setEncryptionSecret(res.encryptionSecret);
        setStatusMsg('Updated client-side E2EE vault key.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save encryption key.');
    }
  }

  const fetchRawDbDocuments = useCallback(async (skipDecryptFlag: boolean) => {
    setRawDbLoading(true);
    setError(null);
    try {
      const res = await sendBackgroundMessage<{ items: any[]; totalCount: number }>(
        'MB_API_REQUEST',
        {
          method: 'POST',
          path: '/api/documents/query',
          body: {
            page: 1,
            pageSize: 50,
            sortBy: 'updatedAt',
            sortDirection: 'desc',
          },
          skipDecrypt: skipDecryptFlag,
        }
      );
      setRawDbDocs(res?.items || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to query raw documents from server.');
      setRawDbDocs([]);
    } finally {
      setRawDbLoading(false);
    }
  }, []);

  const disabledSet = new Set(disabledPatchIds);
  const runningIdsOnTab = new Set(activeTabPatches.map((p) => p.id));
  const matchingPatchesForTab = currentTabUrl
    ? patches.filter((p) => patchMatchesUrl(p.matches, currentTabUrl))
    : [];
  const matchingIdsForTabSet = new Set(matchingPatchesForTab.map((p) => p.id));
  const visibleDbDocs =
    rawDbScope === 'tab'
      ? rawDbDocs.filter((doc) => {
          const ns = String(doc._plaintextNamespace || doc.namespace || '');
          return matchingIdsForTabSet.has(ns);
        })
      : rawDbDocs;
  const enabledCount = patches.filter((p) => !disabledSet.has(p.id)).length;
  const updateAvailable = remoteVersion && remoteVersion !== localVersion;

  async function handleDeleteSingleDoc(docId: string) {
    setError(null);
    try {
      await sendBackgroundMessage('MB_API_REQUEST', {
        method: 'DELETE',
        path: `/api/documents/${encodeURIComponent(docId)}`,
      });
      setRawDbDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch (err: any) {
      setError(err?.message || 'Failed to delete document.');
    }
  }

  async function handleDeleteVisibleDocs() {
    setError(null);
    setRawDbLoading(true);
    try {
      const ids = visibleDbDocs.map((d) => d.id).filter(Boolean);
      const idSet = new Set(ids);
      await Promise.all(
        ids.map((id) =>
          sendBackgroundMessage('MB_API_REQUEST', {
            method: 'DELETE',
            path: `/api/documents/${encodeURIComponent(id)}`,
          })
        )
      );
      setRawDbDocs((prev) => prev.filter((d) => !idSet.has(d.id)));
      setConfirmDeleteAll(false);
      setStatusMsg(
        `Deleted ${ids.length} ${
          rawDbScope === 'tab' ? 'current-page script' : ''
        } document(s) from ${auth.serverUrl}.`
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to delete documents.');
    } finally {
      setRawDbLoading(false);
    }
  }

  async function handleAddQuickNote(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newQuickNoteText.trim();
    if (!trimmed) return;
    setError(null);
    let domain = 'general';
    const cleanUrl = (currentTabUrl || '').split('#')[0];
    try {
      if (currentTabUrl) domain = new URL(currentTabUrl).hostname.toLowerCase();
    } catch {
      // Fallback
    }

    const payload: SavedQuickNote = {
      title: domain,
      note: trimmed,
      pageUrl: currentTabUrl || '',
      domain,
      createdAt: new Date().toISOString(),
    };

    try {
      await sendBackgroundMessage('MB_API_REQUEST', {
        method: 'POST',
        path: '/api/documents/upsert',
        body: {
          namespace: QUICKNOTES_NAMESPACE,
          key: `note-${Date.now()}`,
          type: 'quick-note',
          data: payload,
          resources: cleanUrl ? [`domain:${domain}`, `url:${cleanUrl}`] : [`domain:${domain}`],
        },
      });
      setNewQuickNoteText('');
      fetchQuickNotes();
    } catch (err: any) {
      setError(err?.message || 'Failed to save Quick Note (make sure you are signed in).');
    }
  }

  async function handleDeleteQuickNote(docId: string) {
    try {
      await sendBackgroundMessage('MB_API_REQUEST', {
        method: 'DELETE',
        path: `/api/documents/${encodeURIComponent(docId)}`,
      });
      setQuickNotesDocs((prev) => prev.filter((d) => d.id !== docId));
      setOpenNoteMenuId(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete Quick Note.');
    }
  }

  async function handleClearVisibleQuickNotes(docsToDelete: any[]) {
    try {
      const ids = docsToDelete.map((d) => d.id).filter(Boolean);
      const idSet = new Set(ids);
      await Promise.all(
        ids.map((id) =>
          sendBackgroundMessage('MB_API_REQUEST', {
            method: 'DELETE',
            path: `/api/documents/${encodeURIComponent(id)}`,
          })
        )
      );
      setQuickNotesDocs((prev) => prev.filter((d) => !idSet.has(d.id)));
      setConfirmClearNotes(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to clear Quick Notes.');
    }
  }

  async function handleStartElementPicker() {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;
      chrome.tabs.sendMessage(tabId, { type: 'MB_START_ELEMENT_PICKER' }, () => {
        if (chrome.runtime.lastError && chrome.scripting?.executeScript) {
          chrome.scripting
            .executeScript({ target: { tabId }, files: ['content.js'] })
            .then(() => {
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { type: 'MB_START_ELEMENT_PICKER' }, () => {
                  void chrome.runtime.lastError;
                });
              }, 80);
            })
            .catch(() => {});
        }
      });
    });
  }

  async function handleSaveCssRuleForm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let defaultPattern = 'https://*/*';
    try {
      if (currentTabUrl) {
        const u = new URL(currentTabUrl);
        defaultPattern = `${u.origin}/*`;
      }
    } catch {
      // Ignore
    }
    const pattern = newRulePattern.trim() || defaultPattern;
    const css = newRuleCss.trim();
    if (!css) return;

    try {
      const res = await sendBackgroundMessage<{ rules: QuickCssRule[] }>('MB_SAVE_QUICK_RULE', {
        rule: {
          id: editingRuleId || `rule-${Date.now()}`,
          name: newRuleName.trim() || `Rule for ${pattern}`,
          matchPattern: pattern,
          css,
          enabled: true,
        },
      });
      if (res?.rules) setQuickCssRules(res.rules);
      setNewRuleName('');
      setNewRuleCss('');
      setEditingRuleId(null);
      setManageRulesExpanded(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to save Quick CSS Rule.');
    }
  }

  async function handleToggleQuickCssRule(rule: QuickCssRule) {
    try {
      const res = await sendBackgroundMessage<{ rules: QuickCssRule[] }>('MB_SAVE_QUICK_RULE', {
        rule: {
          ...rule,
          enabled: !rule.enabled,
        },
      });
      if (res?.rules) setQuickCssRules(res.rules);
    } catch (err: any) {
      setError(err?.message || 'Failed to toggle rule.');
    }
  }

  async function handleDeleteQuickCssRule(ruleId: string) {
    try {
      const res = await sendBackgroundMessage<{ rules: QuickCssRule[] }>('MB_DELETE_QUICK_RULE', {
        id: ruleId,
      });
      if (res?.rules) setQuickCssRules(res.rules);
      setOpenRuleMenuId(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete rule.');
    }
  }

  function toggleAccordion(key: string) {
    setExpandedPatchIds((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  function handleDispatchPanelAction(
    patchId: string,
    actionId: string,
    payload: Record<string, any> = {}
  ) {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) return;
      chrome.tabs.sendMessage(
        activeTab.id,
        {
          type: 'MB_PANEL_DISPATCH_ACTION',
          patchId,
          actionId,
          payload,
        },
        () => {
          void chrome.runtime.lastError;
          queryActiveTabStatus();
        }
      );
    });
  }

  // Reusable Raspberry Toggle Switch (46x26px)
  function renderRaspberryToggle(isEnabled: boolean, onClick: () => void, label: string) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={isEnabled}
        aria-label={label}
        onClick={onClick}
        style={{
          position: 'relative',
          width: '46px',
          height: '26px',
          borderRadius: '999px',
          border: isEnabled
            ? `1px solid ${THEME.actionHover}`
            : `1px solid ${THEME.borderSubtle}`,
          background: isEnabled ? THEME.actionPrimary : THEME.bgSecondary,
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
          transition: 'all 0.16s ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '2px',
            left: isEnabled ? '22px' : '2px',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: '#FFFFFF',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.45)',
            transition: 'left 0.16s ease',
          }}
        />
      </button>
    );
  }

  function renderPanelSection(patchId: string, section: PanelSection, idx: number) {
    if (section.type === 'stats') {
      const cols = section.columns || 2;
      return (
        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {section.title && (
            <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.textSecondary }}>
              {section.title}
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gap: '10px',
            }}
          >
            {section.items.map((stat, sIdx) => (
              <div
                key={sIdx}
                style={{
                  background: THEME.bgCardInner,
                  border: `1px solid ${THEME.borderSubtle}`,
                  borderRadius: '10px',
                  padding: '12px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: '14px', fontWeight: 500, color: THEME.textSecondary }}>
                  {stat.label}
                </span>
                <span
                  style={{
                    fontSize: '17px',
                    fontWeight: 700,
                    color: THEME.brandAccent,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (section.type === 'text') {
      const isHighlight = section.tone === 'highlight';
      return (
        <div
          key={idx}
          style={{
            background: isHighlight ? 'rgba(250, 204, 21, 0.08)' : THEME.bgCardInner,
            border: `1px solid ${isHighlight ? THEME.borderStrong : THEME.borderSubtle}`,
            borderRadius: '10px',
            padding: '12px 14px',
            fontSize: '14px',
            color: THEME.textSecondary,
            lineHeight: 1.5,
            wordBreak: 'break-word',
          }}
        >
          {section.title && (
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px', color: THEME.textPrimary }}>
              {section.title}
            </div>
          )}
          <div style={{ whiteSpace: 'pre-wrap' }}>{section.content}</div>
        </div>
      );
    }

    if (section.type === 'list') {
      return (
        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {section.title && (
            <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.textSecondary }}>
              {section.title}
            </div>
          )}
          {section.items.length === 0 ? (
            <div style={{ fontSize: '14px', color: THEME.textMuted, padding: '8px 0' }}>
              {section.emptyText || 'No items found.'}
            </div>
          ) : (
            section.items.map((item, iIdx) => (
              <div
                key={item.id || iIdx}
                style={{
                  background: THEME.bgCardInner,
                  border: `1px solid ${THEME.borderSubtle}`,
                  borderRadius: '10px',
                  padding: '12px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '15px', color: THEME.textPrimary }}>
                      {item.title}
                    </span>
                    {item.badge && (
                      <span
                        style={{
                          fontSize: '13px',
                          padding: '2px 8px',
                          borderRadius: '99px',
                          background: THEME.bgSecondary,
                          color: THEME.softHighlight,
                          fontWeight: 600,
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                  {item.subtitle && (
                    <div style={{ fontSize: '13px', color: THEME.textMuted, marginTop: '4px' }}>
                      {item.subtitle}
                    </div>
                  )}
                </div>
                {item.actionId && (
                  <button
                    type="button"
                    onClick={() =>
                      handleDispatchPanelAction(patchId, item.actionId!, { itemId: item.id })
                    }
                    style={{
                      minHeight: '36px',
                      padding: '0 12px',
                      fontSize: '14px',
                      fontWeight: 600,
                      borderRadius: '8px',
                      border: `1px solid ${THEME.borderSubtle}`,
                      background: THEME.bgElevated,
                      color: THEME.textPrimary,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    {item.actionLabel || 'Open'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      );
    }

    if (section.type === 'form') {
      const patchForms = formStateByPatch[patchId] || {};
      return (
        <form
          key={idx}
          onSubmit={(e) => {
            e.preventDefault();
            const payload: Record<string, string> = {};
            for (const f of section.fields) {
              payload[f.name] = patchForms[f.name] ?? f.defaultValue ?? '';
            }
            handleDispatchPanelAction(patchId, section.actionId, payload);
            setFormStateByPatch((prev) => ({ ...prev, [patchId]: {} }));
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            background: THEME.bgCardInner,
            border: `1px solid ${THEME.borderSubtle}`,
            borderRadius: '10px',
            padding: '14px',
          }}
        >
          {section.title && (
            <div style={{ fontSize: '15px', fontWeight: 700, color: THEME.textPrimary }}>
              {section.title}
            </div>
          )}
          {section.fields.map((field) => {
            const val = patchForms[field.name] ?? field.defaultValue ?? '';
            const updateVal = (next: string) =>
              setFormStateByPatch((prev) => ({
                ...prev,
                [patchId]: { ...(prev[patchId] || {}), [field.name]: next },
              }));

            if (field.type === 'textarea') {
              return (
                <textarea
                  key={field.name}
                  rows={3}
                  value={val}
                  onChange={(e) => updateVal(e.target.value)}
                  placeholder={field.placeholder || field.label || field.name}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: `1px solid ${THEME.borderSubtle}`,
                    background: THEME.bgInset,
                    color: THEME.textPrimary,
                    fontSize: '15px',
                    resize: 'vertical',
                  }}
                />
              );
            }

            if (field.type === 'select' && field.options) {
              return (
                <select
                  key={field.name}
                  value={val}
                  onChange={(e) => updateVal(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: `1px solid ${THEME.borderSubtle}`,
                    background: THEME.bgInset,
                    color: THEME.textPrimary,
                    fontSize: '15px',
                  }}
                >
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              );
            }

            return (
              <input
                key={field.name}
                type="text"
                value={val}
                onChange={(e) => updateVal(e.target.value)}
                placeholder={field.placeholder || field.label || field.name}
                style={{
                  width: '100%',
                  minHeight: '42px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: `1px solid ${THEME.borderSubtle}`,
                  background: THEME.bgInset,
                  color: THEME.textPrimary,
                  fontSize: '15px',
                }}
              />
            );
          })}
          <button
            type="submit"
            style={{
              alignSelf: 'flex-end',
              minHeight: '40px',
              padding: '0 16px',
              borderRadius: '8px',
              border: 'none',
              background: THEME.actionPrimary,
              color: THEME.textPrimary,
              fontSize: '15px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {section.submitLabel || 'Save'}
          </button>
        </form>
      );
    }

    return null;
  }

  const sectionDividerStyle: React.CSSProperties = {
    border: 'none',
    borderTop: `1px solid ${THEME.borderSubtle}`,
    margin: '2px 0',
    width: '100%',
  };

  function renderPanelEntry(entry: ActivePanelEntry, idx: number) {
    const { patchId, patchName, view } = entry;
    return (
      <React.Fragment key={patchId}>
        {idx > 0 && <hr style={sectionDividerStyle} />}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: '18px', color: THEME.textPrimary }}>
                {view.title || patchName}
              </div>
              {view.subtitle && (
                <div style={{ fontSize: '14px', color: THEME.textSecondary, marginTop: '2px' }}>
                  {view.subtitle}
                </div>
              )}
            </div>
            {view.badge !== undefined && (
              <span
                style={{
                  fontSize: '13px',
                  padding: '4px 12px',
                  borderRadius: '99px',
                  background: THEME.bgSecondary,
                  border: `1px solid ${THEME.borderStrong}`,
                  color: THEME.softHighlight,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {view.badge}
              </span>
            )}
          </div>

          {view.sections?.map((sec, sIdx) => renderPanelSection(patchId, sec, sIdx))}

          {(view.status || (view.actions && view.actions.length > 0)) && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                paddingTop: '8px',
                borderTop: `1px solid ${THEME.borderSubtle}`,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontSize: '13px', color: THEME.textMuted }}>
                {view.status || ''}
              </div>
              {view.actions && view.actions.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {view.actions.map((act) => {
                    const isPrimary = act.variant !== 'secondary';
                    return (
                      <button
                        key={act.id}
                        type="button"
                        onClick={() => handleDispatchPanelAction(patchId, act.id)}
                        style={{
                          minHeight: '38px',
                          padding: '0 14px',
                          fontSize: '14px',
                          fontWeight: 600,
                          borderRadius: '8px',
                          border: isPrimary ? 'none' : `1px solid ${THEME.borderSubtle}`,
                          background: isPrimary ? THEME.actionPrimary : THEME.bgElevated,
                          color: THEME.textPrimary,
                          cursor: 'pointer',
                        }}
                      >
                        {act.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </React.Fragment>
    );
  }

  function renderScriptCard(
    p: (typeof patches)[number],
    sectionPrefix: 'tab' | 'all'
  ) {
    const isEnabled = !disabledSet.has(p.id);
    const isRunning = runningIdsOnTab.has(p.id);
    const matchesCurrent = currentTabUrl ? patchMatchesUrl(p.matches, currentTabUrl) : false;
    const accordionKey = `${sectionPrefix}:${p.id}`;
    const isExpanded = Boolean(expandedPatchIds[accordionKey]);

    return (
      <div
        key={p.id}
        style={{
          background: THEME.bgCardInner,
          border: `1px solid ${isRunning ? THEME.borderStrong : THEME.borderSubtle}`,
          borderRadius: '10px',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          opacity: isEnabled ? 1 : 0.65,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          {renderRaspberryToggle(
            isEnabled,
            () => handleTogglePatch(p.id, !isEnabled),
            `Toggle ${p.name}`
          )}

          <div
            onClick={() => toggleAccordion(accordionKey)}
            style={{
              flex: 1,
              minWidth: 0,
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: '15px',
                color: THEME.textPrimary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {p.name}
            </div>
            <div
              style={{
                fontSize: '13px',
                color: THEME.textMuted,
                marginTop: '2px',
              }}
            >
              {isRunning ? 'Active on this page' : matchesCurrent ? 'Matches current site' : p.id}
            </div>
          </div>

          <button
            type="button"
            onClick={() => toggleAccordion(accordionKey)}
            aria-expanded={isExpanded}
            title={isExpanded ? 'Hide script details' : 'Show script details'}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              border: `1px solid ${THEME.borderSubtle}`,
              background: THEME.bgElevated,
              color: THEME.textSecondary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icons.Dots />
          </button>
        </div>

        {isExpanded && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              paddingTop: '10px',
              borderTop: `1px solid ${THEME.borderSubtle}`,
            }}
          >
            {p.description && (
              <div style={{ fontSize: '14px', color: THEME.textSecondary, lineHeight: 1.45 }}>
                {p.description}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {p.matches.map((pattern) => (
                <code
                  key={pattern}
                  style={{
                    fontSize: '13px',
                    background: THEME.bgCanvas,
                    border: `1px solid ${THEME.borderSubtle}`,
                    color: THEME.softHighlight,
                    padding: '4px 8px',
                    borderRadius: '6px',
                    wordBreak: 'break-all',
                  }}
                >
                  {pattern}
                </code>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  let currentDomain = '';
  try {
    if (currentTabUrl) currentDomain = new URL(currentTabUrl).hostname.toLowerCase();
  } catch {
    // Ignore
  }

  return (
    <div
      className="mp-root-container"
      style={{
        padding: '14px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        background: THEME.bgCanvas,
        color: THEME.textPrimary,
        minHeight: '100vh',
        maxWidth: '640px',
        margin: '0 auto',
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <img
            src="./icons/icon-48.png"
            alt="MonkeyPatch Logo"
            style={{
              width: '40px',
              height: '40px',
              objectFit: 'contain',
              flexShrink: 0,
              filter: 'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.6))',
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 800,
                fontSize: '20px',
                color: THEME.brandAccent,
                letterSpacing: '-0.01em',
                lineHeight: 1.15,
                whiteSpace: 'nowrap',
              }}
            >
              {displayName}
            </div>
            <div
              style={{
                fontSize: '13px',
                color: THEME.textSecondary,
                marginTop: '2px',
                whiteSpace: 'nowrap',
              }}
            >
              v{localVersion} •{' '}
              <span
                style={{
                  color: buildProfile === 'personal' ? THEME.actionHover : THEME.brandAccent,
                  fontWeight: 700,
                }}
              >
                {buildProfile.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => {
              userManuallySelectedTab.current = true;
              setStatusMsg(null);
              setError(null);
              setActiveUiTab('connection');
              if (auth.authenticated) fetchRawDbDocuments(rawDbSkipDecrypt);
            }}
            title={
              auth.authenticated
                ? `API Connected (${auth.serverUrl})`
                : `Not signed in (${auth.serverUrl})`
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '7px',
              height: '34px',
              padding: '0 11px',
              borderRadius: '99px',
              background: auth.authenticated ? THEME.successBg : THEME.bgSurface,
              border: auth.authenticated
                ? `1px solid ${THEME.successBorder}`
                : `1px solid ${THEME.borderSubtle}`,
              fontSize: '13px',
              fontWeight: 600,
              color: auth.authenticated ? THEME.actionText : THEME.textSecondary,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                flexShrink: 0,
                background: auth.authenticated ? THEME.successGreen : THEME.brandAccent,
                boxShadow: auth.authenticated ? '0 0 8px rgba(34, 197, 94, 0.7)' : 'none',
              }}
            />
            <span className="mp-hide-narrow">
              {auth.authenticated ? 'API Connected' : 'Sign In'}
            </span>
          </button>

          <a
            href={auth.serverUrl}
            target="_blank"
            rel="noreferrer"
            title={`Open MonkeyBrain Portal (${auth.serverUrl})`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              height: '34px',
              padding: '0 11px',
              borderRadius: '8px',
              background: THEME.bgSurface,
              border: `1px solid ${THEME.borderSubtle}`,
              fontSize: '14px',
              color: THEME.textPrimary,
              textDecoration: 'none',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            <Icons.External size={14} color={THEME.brandAccent} />
            <span className="mp-hide-xs">Portal</span>
          </a>
        </div>
      </div>

      {/* Top Navigation Bar: Output | Notes & CSS | ☰ More */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div
          style={{
            display: 'flex',
            gap: '8px',
            width: '100%',
          }}
        >
          {(
            [
              {
                id: 'output',
                label: 'Output',
                icon: (active: boolean) => (
                  <Icons.Chart color={active ? '#1A1102' : THEME.brandAccent} size={17} />
                ),
                count: activePanelViews.length > 0 ? activePanelViews.length : null,
              },
              {
                id: 'notes',
                label: 'Notes & CSS',
                icon: (active: boolean) => (
                  <Icons.Note color={active ? '#1A1102' : THEME.brandAccent} size={17} />
                ),
                count: null,
              },
            ] as const
          ).map((tab) => {
            const isActive = activeUiTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                title={tab.label}
                onClick={() => {
                  userManuallySelectedTab.current = true;
                  setMoreMenuOpen(false);
                  setStatusMsg(null);
                  setError(null);
                  setActiveUiTab(tab.id);
                  if (tab.id === 'notes') {
                    fetchQuickNotes();
                    fetchQuickCssRules(true);
                  }
                }}
                style={{
                  flex: tab.id === 'notes' ? '1.25 1 0' : '1 1 0',
                  minWidth: 0,
                  minHeight: '42px',
                  padding: '0 12px',
                  borderRadius: '10px',
                  border: isActive
                    ? `1px solid ${THEME.softHighlight}`
                    : `1px solid ${THEME.borderSubtle}`,
                  background: isActive
                    ? 'linear-gradient(180deg, #FFE04B 0%, #FACC15 100%)'
                    : THEME.bgSurface,
                  color: isActive ? '#1A1102' : THEME.textPrimary,
                  fontSize: '15px',
                  fontWeight: isActive ? 700 : 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                  whiteSpace: 'nowrap',
                  boxShadow: isActive ? '0 3px 12px rgba(250, 204, 21, 0.22)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ display: 'inline-flex', flexShrink: 0 }}>{tab.icon(isActive)}</span>
                <span>{tab.label}</span>
                {tab.count !== null && (
                  <span
                    style={{
                      fontSize: '13px',
                      padding: '1px 7px',
                      borderRadius: '99px',
                      background: isActive ? 'rgba(26, 17, 2, 0.18)' : THEME.bgSecondary,
                      color: isActive ? '#1A1102' : THEME.textPrimary,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}

          {/* ☰ More Hamburger Button (Scripts, Account & Saved Data) */}
          {(() => {
            const isMoreTabActive =
              activeUiTab === 'scripts' || activeUiTab === 'connection';
            const moreLabel =
              activeUiTab === 'scripts'
                ? 'Scripts'
                : activeUiTab === 'connection'
                ? 'Account'
                : 'More';

            return (
              <button
                type="button"
                aria-expanded={moreMenuOpen}
                title="More tools: Scripts, Account & Saved Data"
                onClick={() => setMoreMenuOpen((open) => !open)}
                style={{
                  flex: '0.9 1 0',
                  minWidth: 0,
                  minHeight: '42px',
                  padding: '0 12px',
                  borderRadius: '10px',
                  border: isMoreTabActive
                    ? `1px solid ${THEME.softHighlight}`
                    : moreMenuOpen
                    ? `1px solid ${THEME.borderStrong}`
                    : `1px solid ${THEME.borderSubtle}`,
                  background: isMoreTabActive
                    ? 'linear-gradient(180deg, #FFE04B 0%, #FACC15 100%)'
                    : moreMenuOpen
                    ? THEME.bgSecondary
                    : THEME.bgSurface,
                  color: isMoreTabActive ? '#1A1102' : THEME.textPrimary,
                  fontSize: '15px',
                  fontWeight: isMoreTabActive || moreMenuOpen ? 700 : 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                  whiteSpace: 'nowrap',
                  boxShadow: isMoreTabActive
                    ? '0 3px 12px rgba(250, 204, 21, 0.22)'
                    : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                  <Icons.Menu
                    color={isMoreTabActive ? '#1A1102' : THEME.brandAccent}
                    size={17}
                  />
                </span>
                <span>{moreLabel}</span>
              </button>
            );
          })()}
        </div>

        {/* Hamburger Dropdown Drawer */}
        {moreMenuOpen && (
          <div
            style={{
              background: THEME.bgElevated,
              border: `1px solid ${THEME.borderStrong}`,
              borderRadius: '12px',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              boxShadow: '0 12px 28px rgba(0, 0, 0, 0.65)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                userManuallySelectedTab.current = true;
                setStatusMsg(null);
                setError(null);
                setActiveUiTab('scripts');
                setMoreMenuOpen(false);
              }}
              style={{
                width: '100%',
                minHeight: '48px',
                padding: '8px 12px',
                borderRadius: '8px',
                border:
                  activeUiTab === 'scripts'
                    ? `1px solid ${THEME.borderStrong}`
                    : '1px solid transparent',
                background:
                  activeUiTab === 'scripts' ? THEME.bgSecondary : THEME.bgCardInner,
                color: THEME.textPrimary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <Icons.Bolt color={THEME.brandAccent} size={18} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: THEME.textPrimary }}>
                    Scripts &amp; Patches
                  </div>
                  <div style={{ fontSize: '13px', color: THEME.textSecondary }}>
                    {matchingPatchesForTab.length} matching this page • {enabledCount} enabled
                  </div>
                </div>
              </div>
              <span
                style={{
                  fontSize: '13px',
                  padding: '2px 9px',
                  borderRadius: '99px',
                  background: THEME.bgSurface,
                  color: THEME.softHighlight,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {enabledCount}/{patches.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                userManuallySelectedTab.current = true;
                setStatusMsg(null);
                setError(null);
                setActiveUiTab('connection');
                setMoreMenuOpen(false);
                if (auth.authenticated) {
                  fetchRawDbDocuments(rawDbSkipDecrypt);
                }
              }}
              style={{
                width: '100%',
                minHeight: '48px',
                padding: '8px 12px',
                borderRadius: '8px',
                border:
                  activeUiTab === 'connection'
                    ? `1px solid ${THEME.borderStrong}`
                    : '1px solid transparent',
                background:
                  activeUiTab === 'connection' ? THEME.bgSecondary : THEME.bgCardInner,
                color: THEME.textPrimary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <Icons.Server color={THEME.brandAccent} size={18} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: THEME.textPrimary }}>
                    Account &amp; Saved Data
                  </div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: THEME.textSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {auth.authenticated
                      ? `Signed in (${auth.user?.email || auth.serverUrl})`
                      : 'Sign in & inspect saved data'}
                  </div>
                </div>
              </div>
              <span
                style={{
                  width: '9px',
                  height: '9px',
                  borderRadius: '50%',
                  background: auth.authenticated ? THEME.successGreen : THEME.brandAccent,
                  flexShrink: 0,
                }}
              />
            </button>
          </div>
        )}
      </div>

      {updateAvailable && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            background: 'rgba(250, 204, 21, 0.12)',
            border: `1px solid ${THEME.borderStrong}`,
            color: THEME.softHighlight,
            fontSize: '14px',
          }}
        >
          Update available (v{remoteVersion}).{' '}
          <a
            href={`${auth.serverUrl}/#/download`}
            target="_blank"
            rel="noreferrer"
            style={{ color: THEME.brandAccent, fontWeight: 700 }}
          >
            Download latest ZIP
          </a>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            background: THEME.actionSubtleBg,
            border: `1px solid ${THEME.actionBorder}`,
            color: THEME.actionText,
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      {statusMsg && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            background: 'rgba(250, 204, 21, 0.1)',
            border: `1px solid ${THEME.borderStrong}`,
            color: THEME.softHighlight,
            fontSize: '14px',
          }}
        >
          {statusMsg}
        </div>
      )}

      <hr style={sectionDividerStyle} />

      {/* TAB 1: LIVE OUTPUT */}
      {activeUiTab === 'output' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {activePanelViews.length > 0 ? (
            activePanelViews.map((entry, idx) => renderPanelEntry(entry, idx))
          ) : (
            <div
              style={{
                padding: '20px 8px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '18px', color: THEME.textPrimary }}>
                No Active Script Output for This Page
              </div>
              <div style={{ fontSize: '15px', color: THEME.textSecondary, lineHeight: 1.5, maxWidth: '380px' }}>
                {matchingPatchesForTab.length > 0
                  ? 'A script matches this page, but it is either paused or has not published live output yet.'
                  : 'No installed script with live panel output matches the current tab URL.'}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={queryActiveTabStatus}
                  style={{
                    minHeight: '40px',
                    padding: '0 16px',
                    fontSize: '14px',
                    fontWeight: 600,
                    borderRadius: '8px',
                    border: `1px solid ${THEME.borderSubtle}`,
                    background: THEME.bgElevated,
                    color: THEME.textPrimary,
                    cursor: 'pointer',
                  }}
                >
                  Refresh Status
                </button>
                <button
                  type="button"
                  onClick={() => {
                    userManuallySelectedTab.current = true;
                    setStatusMsg(null);
                    setError(null);
                    setActiveUiTab('scripts');
                  }}
                  style={{
                    minHeight: '40px',
                    padding: '0 16px',
                    fontSize: '14px',
                    fontWeight: 700,
                    borderRadius: '8px',
                    border: 'none',
                    background: THEME.actionPrimary,
                    color: THEME.textPrimary,
                    cursor: 'pointer',
                  }}
                >
                  View Scripts ({matchingPatchesForTab.length} matching) →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: QUICK NOTES & QUICK CSS RULES */}
      {activeUiTab === 'notes' &&
        (() => {
          const siteNotesCount = currentDomain
            ? quickNotesDocs.filter(
                (d) =>
                  String(d?.data?.domain || '').toLowerCase() === currentDomain ||
                  (Array.isArray(d?.resources) && d.resources.includes(`domain:${currentDomain}`))
              ).length
            : quickNotesDocs.length;

          const visibleNotes =
            quickNotesScope === 'site' && currentDomain
              ? quickNotesDocs.filter(
                  (d) =>
                    String(d?.data?.domain || '').toLowerCase() === currentDomain ||
                    (Array.isArray(d?.resources) &&
                      d.resources.includes(`domain:${currentDomain}`))
                )
              : quickNotesDocs;

          const visibleRules =
            quickCssScope === 'tab' && currentTabUrl
              ? quickCssRules.filter((r) => matchesUrlPattern(currentTabUrl, r.matchPattern))
              : quickCssRules;

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* SECTION 1: Quick Notes Creation & Site Filter */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Icons.Note color={THEME.brandAccent} size={20} />
                  <span style={{ fontSize: '18px', fontWeight: 700, color: THEME.textPrimary }}>
                    Quick Notes
                  </span>
                </div>

                {/* Add Note Input + Raspberry Save Button */}
                <form
                  onSubmit={handleAddQuickNote}
                  style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}
                >
                  <input
                    type="text"
                    value={newQuickNoteText}
                    onChange={(e) => setNewQuickNoteText(e.target.value)}
                    placeholder="Add a note for this page..."
                    style={{
                      flex: '1 1 165px',
                      minWidth: 0,
                      minHeight: '44px',
                      padding: '0 14px',
                      borderRadius: '8px',
                      border: `1px solid ${THEME.borderSubtle}`,
                      background: THEME.bgInset,
                      color: THEME.textPrimary,
                      fontSize: '15px',
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      minHeight: '44px',
                      padding: '0 18px',
                      borderRadius: '8px',
                      border: 'none',
                      background: THEME.actionPrimary,
                      color: THEME.textPrimary,
                      fontSize: '15px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    + Save
                  </button>
                </form>

                {/* Site vs All Notes Filter Cards (stacks cleanly when narrow) */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
                    gap: '10px',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setQuickNotesScope('site')}
                    style={{
                      minHeight: '52px',
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border:
                        quickNotesScope === 'site'
                          ? `1px solid ${THEME.borderStrong}`
                          : `1px solid ${THEME.borderSubtle}`,
                      background:
                        quickNotesScope === 'site' ? THEME.bgSecondary : THEME.bgCardInner,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                      <Icons.Globe color={THEME.brandAccent} size={20} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color:
                            quickNotesScope === 'site' ? THEME.softHighlight : THEME.textPrimary,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Save for This Site
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          color: THEME.textSecondary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {currentDomain || 'Current tab'} ({siteNotesCount})
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setQuickNotesScope('all')}
                    style={{
                      minHeight: '52px',
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border:
                        quickNotesScope === 'all'
                          ? `1px solid ${THEME.borderStrong}`
                          : `1px solid ${THEME.borderSubtle}`,
                      background:
                        quickNotesScope === 'all' ? THEME.bgSecondary : THEME.bgCardInner,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                        <Icons.Layers color={THEME.brandAccent} size={20} />
                      </span>
                      <span
                        style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color:
                            quickNotesScope === 'all' ? THEME.softHighlight : THEME.textPrimary,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        View All Notes
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: '13px',
                          padding: '2px 8px',
                          borderRadius: '99px',
                          background: THEME.bgElevated,
                          color: THEME.textPrimary,
                          fontWeight: 700,
                        }}
                      >
                        {quickNotesDocs.length}
                      </span>
                      <span style={{ color: THEME.textMuted, fontSize: '16px' }}>›</span>
                    </div>
                  </button>
                </div>

                {/* Subtle Context Menu Hint */}
                <div
                  style={{
                    fontSize: '13px',
                    color: THEME.textSecondary,
                    background: THEME.bgCardInner,
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: `1px solid ${THEME.borderSubtle}`,
                  }}
                >
                  💡 Tip: Select any text or link on a webpage → Right-click →{' '}
                  <strong style={{ color: THEME.brandAccent }}>
                    MonkeyPatch: Save to Quick Notes
                  </strong>
                </div>
              </div>

              <hr style={sectionDividerStyle} />

              {/* SECTION 2: Saved Notes List */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Icons.Note color={THEME.brandAccent} size={20} />
                    <span style={{ fontSize: '18px', fontWeight: 700, color: THEME.textPrimary }}>
                      Saved Notes ({visibleNotes.length})
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {visibleNotes.length > 0 &&
                      (confirmClearNotes ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleClearVisibleQuickNotes(visibleNotes)}
                            style={{
                              height: '36px',
                              padding: '0 12px',
                              borderRadius: '8px',
                              border: 'none',
                              background: THEME.actionPrimary,
                              color: THEME.textPrimary,
                              fontSize: '13px',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Confirm ({visibleNotes.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmClearNotes(false)}
                            style={{
                              height: '36px',
                              padding: '0 10px',
                              borderRadius: '8px',
                              border: `1px solid ${THEME.borderSubtle}`,
                              background: THEME.bgCardInner,
                              color: THEME.textSecondary,
                              fontSize: '13px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmClearNotes(true)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            height: '36px',
                            padding: '0 12px',
                            borderRadius: '8px',
                            border: `1px solid ${THEME.actionBorder}`,
                            background: THEME.actionSubtleBg,
                            color: THEME.actionText,
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <Icons.Trash color={THEME.actionHover} size={14} />
                          Clear All
                        </button>
                      ))}

                    <button
                      type="button"
                      onClick={fetchQuickNotes}
                      title="Refresh Notes"
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        border: `1px solid ${THEME.borderSubtle}`,
                        background: THEME.bgElevated,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <Icons.Refresh color={THEME.brandAccent} size={16} />
                    </button>
                  </div>
                </div>

                {visibleNotes.length === 0 ? (
                  <div style={{ fontSize: '15px', color: THEME.textSecondary, padding: '8px 0' }}>
                    No saved notes yet. Add a note above or right-click any text on a webpage.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {visibleNotes.map((doc) => {
                      const d = (doc.data || {}) as SavedQuickNote;
                      const menuOpen = openNoteMenuId === doc.id;
                      const faviconUrl = d.domain
                        ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
                            d.domain
                          )}&sz=32`
                        : null;

                      return (
                        <div
                          key={doc.id}
                          style={{
                            background: THEME.bgCardInner,
                            border: `1px solid ${THEME.borderSubtle}`,
                            borderRadius: '10px',
                            padding: '14px 16px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '10px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                minWidth: 0,
                                flex: 1,
                              }}
                            >
                              {faviconUrl && (
                                <img
                                  src={faviconUrl}
                                  alt=""
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '4px',
                                    flexShrink: 0,
                                  }}
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              )}
                              <span
                                style={{
                                  fontSize: '16px',
                                  fontWeight: 700,
                                  color: THEME.textPrimary,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={d.title || d.domain}
                              >
                                {d.title || d.domain || 'Saved Note'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                              {(d.linkUrl || d.pageUrl) && (
                                <a
                                  href={d.linkUrl || d.pageUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    height: '34px',
                                    padding: '0 12px',
                                    borderRadius: '8px',
                                    background: THEME.bgElevated,
                                    border: `1px solid ${THEME.borderSubtle}`,
                                    color: THEME.textPrimary,
                                    textDecoration: 'none',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                  }}
                                >
                                  Open
                                  <Icons.External size={13} color={THEME.brandAccent} />
                                </a>
                              )}

                              <button
                                type="button"
                                onClick={() =>
                                  setOpenNoteMenuId(menuOpen ? null : doc.id)
                                }
                                title="More actions"
                                style={{
                                  width: '34px',
                                  height: '34px',
                                  borderRadius: '8px',
                                  border: `1px solid ${THEME.borderSubtle}`,
                                  background: THEME.bgElevated,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                }}
                              >
                                <Icons.Dots />
                              </button>
                            </div>
                          </div>

                          <div
                            style={{
                              fontSize: '14px',
                              color: THEME.textSecondary,
                              lineHeight: 1.45,
                              wordBreak: 'break-word',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {d.note}
                          </div>

                          <div style={{ fontSize: '13px', color: THEME.textMuted }}>
                            {d.domain || 'note'}
                            {d.createdAt ? ` • ${new Date(d.createdAt).toLocaleString()}` : ''}
                          </div>

                          {menuOpen && (
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'flex-end',
                                gap: '8px',
                                paddingTop: '8px',
                                marginTop: '4px',
                                borderTop: `1px solid ${THEME.borderSubtle}`,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(d.note || '');
                                  setOpenNoteMenuId(null);
                                  setStatusMsg('Copied note text to clipboard.');
                                }}
                                style={{
                                  height: '32px',
                                  padding: '0 12px',
                                  borderRadius: '6px',
                                  border: `1px solid ${THEME.borderSubtle}`,
                                  background: THEME.bgElevated,
                                  color: THEME.textPrimary,
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                Copy Text
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteQuickNote(doc.id)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  height: '32px',
                                  padding: '0 12px',
                                  borderRadius: '6px',
                                  border: `1px solid ${THEME.actionBorder}`,
                                  background: THEME.actionSubtleBg,
                                  color: THEME.actionText,
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                <Icons.Trash color={THEME.actionHover} size={13} />
                                Delete Note
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <hr style={sectionDividerStyle} />

              {/* SECTION 3: Quick CSS Rules */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Icons.Palette color={THEME.brandAccent} size={20} />
                    <span style={{ fontSize: '18px', fontWeight: 700, color: THEME.textPrimary }}>
                      Quick CSS Rules ({visibleRules.length})
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (!manageRulesExpanded && currentTabUrl && !newRulePattern) {
                        try {
                          const u = new URL(currentTabUrl);
                          setNewRulePattern(`${u.origin}/*`);
                        } catch {
                          // Ignore
                        }
                      }
                      setManageRulesExpanded((s) => !s);
                      setEditingRuleId(null);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      height: '36px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: `1px solid ${THEME.actionBorder}`,
                      background: THEME.actionSubtleBg,
                      color: THEME.actionText,
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    <span>⚙</span>
                    <span>
                      {manageRulesExpanded ? 'Close' : 'Manage'}
                      <span className="mp-hide-xs">
                        {manageRulesExpanded ? ' Manager' : ' Rules'}
                      </span>
                      {' ›'}
                    </span>
                  </button>
                </div>

                {/* Progressive Disclosure: Rule Manager Drawer */}
                {manageRulesExpanded && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      background: THEME.bgCardInner,
                      border: `1px solid ${THEME.borderStrong}`,
                      borderRadius: '10px',
                      padding: '14px',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={handleStartElementPicker}
                        style={{
                          flex: 1,
                          minHeight: '42px',
                          padding: '0 14px',
                          borderRadius: '8px',
                          border: 'none',
                          background: THEME.actionPrimary,
                          color: THEME.textPrimary,
                          fontSize: '14px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        🎯 Pick Element on Page
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setQuickCssScope((s) => (s === 'tab' ? 'all' : 'tab'))
                        }
                        style={{
                          minHeight: '42px',
                          padding: '0 14px',
                          borderRadius: '8px',
                          border: `1px solid ${THEME.borderSubtle}`,
                          background: THEME.bgElevated,
                          color: THEME.textPrimary,
                          fontSize: '14px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Filter: {quickCssScope === 'tab' ? 'Matching Tab' : 'All Sites'}
                      </button>
                    </div>

                    <form
                      onSubmit={handleSaveCssRuleForm}
                      style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
                    >
                      <div style={{ fontSize: '14px', fontWeight: 700, color: THEME.softHighlight }}>
                        {editingRuleId ? 'Edit CSS Rule' : 'Create New CSS Rule'}
                      </div>
                      <input
                        type="text"
                        value={newRuleName}
                        onChange={(e) => setNewRuleName(e.target.value)}
                        placeholder="Rule Name (e.g. Watch Layout Fix)"
                        style={{
                          width: '100%',
                          minHeight: '40px',
                          padding: '0 12px',
                          borderRadius: '8px',
                          border: `1px solid ${THEME.borderSubtle}`,
                          background: THEME.bgInset,
                          color: THEME.textPrimary,
                          fontSize: '14px',
                        }}
                      />
                      <input
                        type="text"
                        value={newRulePattern}
                        onChange={(e) => setNewRulePattern(e.target.value)}
                        placeholder="URL Pattern (e.g. https://example.com/*)"
                        required
                        style={{
                          width: '100%',
                          minHeight: '40px',
                          padding: '0 12px',
                          borderRadius: '8px',
                          border: `1px solid ${THEME.borderSubtle}`,
                          background: THEME.bgInset,
                          color: THEME.softHighlight,
                          fontSize: '14px',
                          fontFamily: 'monospace',
                        }}
                      />
                      <textarea
                        rows={3}
                        value={newRuleCss}
                        onChange={(e) => setNewRuleCss(e.target.value)}
                        placeholder={'.watch-layout { display: block !important; }'}
                        required
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: `1px solid ${THEME.borderSubtle}`,
                          background: THEME.bgInset,
                          color: THEME.textPrimary,
                          fontSize: '13px',
                          fontFamily: 'monospace',
                          resize: 'vertical',
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        {editingRuleId && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingRuleId(null);
                              setNewRuleName('');
                              setNewRuleCss('');
                            }}
                            style={{
                              minHeight: '38px',
                              padding: '0 12px',
                              borderRadius: '8px',
                              border: `1px solid ${THEME.borderSubtle}`,
                              background: THEME.bgElevated,
                              color: THEME.textSecondary,
                              fontSize: '14px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Cancel Edit
                          </button>
                        )}
                        <button
                          type="submit"
                          style={{
                            minHeight: '38px',
                            padding: '0 16px',
                            borderRadius: '8px',
                            border: 'none',
                            background: THEME.actionPrimary,
                            color: THEME.textPrimary,
                            fontSize: '14px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {editingRuleId ? 'Update Rule' : 'Save & Apply Rule'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {visibleRules.length === 0 ? (
                  <div style={{ fontSize: '15px', color: THEME.textSecondary, padding: '6px 0' }}>
                    No quick CSS rules yet. Right-click any page element or click Manage Rules to add one.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {visibleRules.map((rule) => {
                      const menuOpen = openRuleMenuId === rule.id;
                      const singleLineCss = rule.css.replace(/\s+/g, ' ').trim();
                      return (
                        <div
                          key={rule.id}
                          style={{
                            background: THEME.bgCardInner,
                            border: `1px solid ${THEME.borderSubtle}`,
                            borderRadius: '10px',
                            padding: '14px 16px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            opacity: rule.enabled ? 1 : 0.65,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '10px',
                            }}
                          >
                            {renderRaspberryToggle(
                              rule.enabled,
                              () => handleToggleQuickCssRule(rule),
                              `Toggle ${rule.name}`
                            )}

                            <div
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: '15px',
                                fontWeight: 700,
                                color: THEME.textPrimary,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={rule.name}
                            >
                              {rule.name}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRuleId(rule.id);
                                  setNewRuleName(rule.name);
                                  setNewRulePattern(rule.matchPattern);
                                  setNewRuleCss(rule.css);
                                  setManageRulesExpanded(true);
                                }}
                                title="Edit CSS Rule"
                                style={{
                                  width: '34px',
                                  height: '34px',
                                  borderRadius: '8px',
                                  border: `1px solid ${THEME.borderSubtle}`,
                                  background: THEME.bgElevated,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                }}
                              >
                                <Icons.Edit />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenRuleMenuId(menuOpen ? null : rule.id)
                                }
                                title="Rule options"
                                style={{
                                  width: '34px',
                                  height: '34px',
                                  borderRadius: '8px',
                                  border: `1px solid ${THEME.borderSubtle}`,
                                  background: THEME.bgElevated,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                }}
                              >
                                <Icons.Dots />
                              </button>
                            </div>
                          </div>

                          <div
                            style={{
                              background: THEME.bgCanvas,
                              border: `1px solid ${THEME.borderSubtle}`,
                              borderRadius: '6px',
                              padding: '6px 10px',
                              fontSize: '13px',
                              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                              color: THEME.softHighlight,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={rule.css}
                          >
                            {singleLineCss}
                          </div>

                          {menuOpen && (
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                paddingTop: '8px',
                                marginTop: '4px',
                                borderTop: `1px solid ${THEME.borderSubtle}`,
                              }}
                            >
                              <code style={{ fontSize: '13px', color: THEME.textMuted }}>
                                {rule.matchPattern}
                              </code>
                              <button
                                type="button"
                                onClick={() => handleDeleteQuickCssRule(rule.id)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  height: '32px',
                                  padding: '0 12px',
                                  borderRadius: '6px',
                                  border: `1px solid ${THEME.actionBorder}`,
                                  background: THEME.actionSubtleBg,
                                  color: THEME.actionText,
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                <Icons.Trash color={THEME.actionHover} size={13} />
                                Delete Rule
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* TAB 3: SCRIPTS & PATCHES */}
      {activeUiTab === 'scripts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Matching Current Page Section */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Icons.Bolt color={THEME.brandAccent} size={19} />
                <span style={{ fontWeight: 700, fontSize: '18px', color: THEME.textPrimary }}>
                  Matching Current Site ({matchingPatchesForTab.length})
                </span>
              </div>
              <button
                type="button"
                onClick={queryActiveTabStatus}
                title="Refresh tab status"
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  border: `1px solid ${THEME.borderSubtle}`,
                  background: THEME.bgElevated,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <Icons.Refresh color={THEME.brandAccent} size={16} />
              </button>
            </div>

            {currentDomain && (
              <div style={{ fontSize: '13px', color: THEME.textMuted }}>
                Active domain: <strong style={{ color: THEME.textSecondary }}>{currentDomain}</strong>
              </div>
            )}

            {matchingPatchesForTab.length === 0 ? (
              <div style={{ fontSize: '15px', color: THEME.textSecondary, padding: '6px 0' }}>
                No compiled scripts match this tab&apos;s URL.
              </div>
            ) : (
              matchingPatchesForTab.map((p) => renderScriptCard(p, 'tab'))
            )}
          </div>

          <hr style={sectionDividerStyle} />

          {/* All Installed Scripts */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Icons.Layers color={THEME.brandAccent} size={19} />
              <span style={{ fontSize: '18px', fontWeight: 700, color: THEME.textPrimary }}>
                All Installed Scripts ({patches.length})
              </span>
            </div>
            {patches.map((p) => renderScriptCard(p, 'all'))}
          </div>
        </div>
      )}

      {/* TAB 4: ACCOUNT & SAVED DATA */}
      {activeUiTab === 'connection' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Account / Sign-In Section */}
          {loading ? (
            <div style={{ fontSize: '15px', color: THEME.textSecondary }}>Loading account...</div>
          ) : auth.authenticated && auth.user && auth.tenant ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '18px', color: THEME.textPrimary }}>
                  {auth.user.displayName}
                </span>
                <span style={{ fontSize: '13px', color: THEME.textMuted }}>
                  {auth.tenant.role}
                </span>
              </div>
              <div style={{ fontSize: '14px', color: THEME.textSecondary }}>{auth.user.email}</div>
              <div style={{ fontSize: '14px', color: THEME.textSecondary }}>
                Workspace: <strong style={{ color: THEME.textPrimary }}>{auth.tenant.name}</strong> (
                <code style={{ color: THEME.softHighlight }}>{auth.tenant.slug}</code>)
              </div>
              <div
                style={{
                  marginTop: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <a
                  href={`${auth.serverUrl}/demo`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: '14px',
                    color: THEME.brandAccent,
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  Open Demo Sandbox ↗
                </a>
                <button
                  onClick={handleLogout}
                  style={{
                    minHeight: '36px',
                    padding: '0 14px',
                    fontSize: '14px',
                    fontWeight: 600,
                    borderRadius: '8px',
                    border: `1px solid ${THEME.actionBorder}`,
                    background: THEME.actionSubtleBg,
                    color: THEME.actionText,
                    cursor: 'pointer',
                  }}
                >
                  Log Out
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleLogin}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '18px', color: THEME.textPrimary }}>
                Sign In to <span style={{ color: THEME.brandAccent }}>MonkeyBrain</span>
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    color: THEME.textSecondary,
                    marginBottom: '6px',
                  }}
                >
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  style={{
                    width: '100%',
                    minHeight: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: `1px solid ${THEME.borderSubtle}`,
                    background: THEME.bgInset,
                    color: THEME.textPrimary,
                    fontSize: '15px',
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    color: THEME.textSecondary,
                    marginBottom: '6px',
                  }}
                >
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  style={{
                    width: '100%',
                    minHeight: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: `1px solid ${THEME.borderSubtle}`,
                    background: THEME.bgInset,
                    color: THEME.textPrimary,
                    fontSize: '15px',
                  }}
                />
              </div>
              <button
                type="submit"
                style={{
                  minHeight: '44px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: THEME.actionPrimary,
                  color: THEME.textPrimary,
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Sign In &amp; Save Server Token
              </button>
            </form>
          )}

          {/* Server Document Inspector & Management */}
          {auth.authenticated && (
            <>
              <hr style={sectionDividerStyle} />
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowServerDbInspector((s) => !s)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: THEME.textPrimary,
                    fontSize: '17px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span>Server Documents ({visibleDbDocs.length})</span>
                  <span style={{ fontSize: '13px', color: THEME.textMuted }}>
                    {showServerDbInspector ? '▲' : '▼'}
                  </span>
                </button>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {visibleDbDocs.length > 0 &&
                    (confirmDeleteAll ? (
                      <>
                        <button
                          type="button"
                          onClick={handleDeleteVisibleDocs}
                          style={{
                            height: '36px',
                            padding: '0 12px',
                            fontSize: '13px',
                            fontWeight: 700,
                            borderRadius: '8px',
                            border: 'none',
                            background: THEME.actionPrimary,
                            color: THEME.textPrimary,
                            cursor: 'pointer',
                          }}
                        >
                          Confirm ({visibleDbDocs.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteAll(false)}
                          style={{
                            height: '36px',
                            padding: '0 10px',
                            fontSize: '13px',
                            fontWeight: 600,
                            borderRadius: '8px',
                            border: `1px solid ${THEME.borderSubtle}`,
                            background: THEME.bgCardInner,
                            color: THEME.textSecondary,
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteAll(true)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          height: '36px',
                          padding: '0 12px',
                          fontSize: '14px',
                          fontWeight: 600,
                          borderRadius: '8px',
                          border: `1px solid ${THEME.actionBorder}`,
                          background: THEME.actionSubtleBg,
                          color: THEME.actionText,
                          cursor: 'pointer',
                        }}
                      >
                        <Icons.Trash color={THEME.actionHover} size={14} />
                        {rawDbScope === 'tab' ? 'Clear Tab Script' : 'Clear All'}
                      </button>
                    ))}
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteAll(false);
                      fetchRawDbDocuments(rawDbSkipDecrypt);
                    }}
                    title="Refresh Server Documents"
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      border: `1px solid ${THEME.borderSubtle}`,
                      background: THEME.bgElevated,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Icons.Refresh color={THEME.brandAccent} size={16} />
                  </button>
                </div>
              </div>

              {showServerDbInspector && (
                <>
                  {/* Scope Filter Toggle */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: '8px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDeleteAll(false);
                        setRawDbScope('tab');
                      }}
                      style={{
                        minHeight: '38px',
                        padding: '0 10px',
                        fontSize: '14px',
                        fontWeight: rawDbScope === 'tab' ? 700 : 600,
                        borderRadius: '8px',
                        border:
                          rawDbScope === 'tab'
                            ? `1px solid ${THEME.borderStrong}`
                            : `1px solid ${THEME.borderSubtle}`,
                        background:
                          rawDbScope === 'tab' ? THEME.bgSecondary : THEME.bgCardInner,
                        color:
                          rawDbScope === 'tab' ? THEME.softHighlight : THEME.textSecondary,
                        cursor: 'pointer',
                      }}
                    >
                      This Tab&apos;s Script ({matchingPatchesForTab.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDeleteAll(false);
                        setRawDbScope('all');
                      }}
                      style={{
                        minHeight: '38px',
                        padding: '0 10px',
                        fontSize: '14px',
                        fontWeight: rawDbScope === 'all' ? 700 : 600,
                        borderRadius: '8px',
                        border:
                          rawDbScope === 'all'
                            ? `1px solid ${THEME.borderStrong}`
                            : `1px solid ${THEME.borderSubtle}`,
                        background:
                          rawDbScope === 'all' ? THEME.bgSecondary : THEME.bgCardInner,
                        color:
                          rawDbScope === 'all' ? THEME.softHighlight : THEME.textSecondary,
                        cursor: 'pointer',
                      }}
                    >
                      All Saved Data ({rawDbDocs.length})
                    </button>
                  </div>

                  {/* Ciphertext vs Decrypted View */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: '8px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setRawDbSkipDecrypt(true);
                        fetchRawDbDocuments(true);
                      }}
                      style={{
                        minHeight: '38px',
                        padding: '0 10px',
                        fontSize: '13px',
                        fontWeight: rawDbSkipDecrypt ? 700 : 600,
                        borderRadius: '8px',
                        border: rawDbSkipDecrypt
                          ? `1px solid ${THEME.borderStrong}`
                          : `1px solid ${THEME.borderSubtle}`,
                        background: rawDbSkipDecrypt ? THEME.bgSecondary : THEME.bgCardInner,
                        color: rawDbSkipDecrypt ? THEME.softHighlight : THEME.textSecondary,
                        cursor: 'pointer',
                      }}
                    >
                      Raw Server Payload
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRawDbSkipDecrypt(false);
                        fetchRawDbDocuments(false);
                      }}
                      style={{
                        minHeight: '38px',
                        padding: '0 10px',
                        fontSize: '13px',
                        fontWeight: !rawDbSkipDecrypt ? 700 : 600,
                        borderRadius: '8px',
                        border: !rawDbSkipDecrypt
                          ? `1px solid ${THEME.borderStrong}`
                          : `1px solid ${THEME.borderSubtle}`,
                        background: !rawDbSkipDecrypt ? THEME.bgSecondary : THEME.bgCardInner,
                        color: !rawDbSkipDecrypt ? THEME.softHighlight : THEME.textSecondary,
                        cursor: 'pointer',
                      }}
                    >
                      Decrypted SDK View
                    </button>
                  </div>

                  {rawDbLoading ? (
                    <div style={{ fontSize: '14px', color: THEME.textSecondary, padding: '8px 0' }}>
                      Fetching documents from {auth.serverUrl}...
                    </div>
                  ) : visibleDbDocs.length === 0 ? (
                    <div style={{ fontSize: '14px', color: THEME.textSecondary, padding: '8px 0' }}>
                      {rawDbScope === 'tab'
                        ? matchingPatchesForTab.length === 0
                          ? 'No scripts match this tab URL. Switch to "All Saved Data" to view all server documents.'
                          : `No saved documents for ${matchingPatchesForTab.map((p) => p.id).join(', ')} yet.`
                        : `No documents stored on ${auth.serverUrl}.`}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {visibleDbDocs.map((doc) => {
                        const isEncryptedRow =
                          doc?.data?.__mb_enc === 'v1' ||
                          String(doc?.namespace || '').startsWith('enc-ns:');
                        return (
                          <div
                            key={doc.id}
                            style={{
                              background: THEME.bgCardInner,
                              border: `1px solid ${THEME.borderSubtle}`,
                              borderRadius: '10px',
                              padding: '12px 14px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '8px',
                              }}
                            >
                              <code
                                style={{
                                  fontSize: '13px',
                                  fontWeight: 700,
                                  color: THEME.softHighlight,
                                  wordBreak: 'break-all',
                                }}
                              >
                                {doc.namespace} :: {doc.key || '(no key)'}
                              </code>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  flexShrink: 0,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: '13px',
                                    padding: '2px 8px',
                                    borderRadius: '99px',
                                    background: isEncryptedRow
                                      ? THEME.actionSubtleBg
                                      : THEME.bgSecondary,
                                    color: isEncryptedRow
                                      ? THEME.actionText
                                      : THEME.softHighlight,
                                    fontWeight: 600,
                                  }}
                                >
                                  {isEncryptedRow ? 'Encrypted' : 'Plaintext'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSingleDoc(doc.id)}
                                  title="Delete document"
                                  style={{
                                    width: '30px',
                                    height: '30px',
                                    borderRadius: '6px',
                                    border: `1px solid ${THEME.borderSubtle}`,
                                    background: THEME.bgElevated,
                                    color: THEME.actionHover,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  <Icons.Trash color={THEME.actionHover} size={14} />
                                </button>
                              </div>
                            </div>

                            {doc.resources && doc.resources.length > 0 && (
                              <div
                                style={{
                                  fontSize: '13px',
                                  color: THEME.textMuted,
                                  wordBreak: 'break-all',
                                }}
                              >
                                Resources:{' '}
                                <code style={{ color: THEME.textSecondary }}>
                                  {JSON.stringify(doc.resources)}
                                </code>
                              </div>
                            )}

                            <pre
                              style={{
                                margin: 0,
                                padding: '10px',
                                borderRadius: '8px',
                                background: THEME.bgCanvas,
                                border: `1px solid ${THEME.borderSubtle}`,
                                color: THEME.textPrimary,
                                fontSize: '13px',
                                overflowX: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                                maxHeight: '180px',
                                overflowY: 'auto',
                              }}
                            >
                              {JSON.stringify(doc.data, null, 2)}
                            </pre>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

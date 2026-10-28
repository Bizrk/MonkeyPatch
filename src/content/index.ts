import { patches, buildProfile } from 'virtual:patch-registry';
import { createPatchContext } from '../sdk';
import { patchMatchesUrl } from '../core/urlMatcher';
import {
  isExtensionContextValid,
  isInvalidatedContextError,
  sendBackgroundMessage,
} from '../core/messaging';
import {
  applyQuickCssRules,
  openElementTweakerModal,
  setupQuickToolsListeners,
  showPageToast,
  startInteractiveElementPicker,
  syncQuickCssRulesFromBackground,
} from './quickTools';
import type {
  BadgeOptions,
  CleanupFn,
  MonkeyPatchDefinition,
  PanelActionHandler,
  PatchBadgeController,
  PatchPanelController,
  PatchPanelView,
} from '../sdk/types';

interface PatchBadgeState {
  text: string;
  numericValue: number | null;
  backgroundColor?: string;
  textColor?: string;
}

interface RunningPatchInstance {
  patch: MonkeyPatchDefinition;
  cleanups: CleanupFn[];
  panelView: PatchPanelView | null;
  badgeState: PatchBadgeState | null;
  actionHandlers: PanelActionHandler[];
}

const activeInstances = new Map<string, RunningPatchInstance>();
let disabledPatchIds = new Set<string>();
let lastUrl = window.location.href;
let instanceDisposed = false;
let spaIntervalId: number | null = null;
let spaObserver: MutationObserver | null = null;
let spaUrlHandler: (() => void) | null = null;

function disposeCurrentContentInstance() {
  if (instanceDisposed) return;
  instanceDisposed = true;

  if (spaIntervalId !== null) {
    window.clearInterval(spaIntervalId);
    spaIntervalId = null;
  }
  if (spaObserver) {
    spaObserver.disconnect();
    spaObserver = null;
  }
  if (spaUrlHandler) {
    window.removeEventListener('popstate', spaUrlHandler);
    window.removeEventListener('hashchange', spaUrlHandler);
    spaUrlHandler = null;
  }

  for (const [, instance] of Array.from(activeInstances.entries())) {
    for (const fn of instance.cleanups.reverse()) {
      try {
        fn();
      } catch {
        // Ignore cleanup errors during context disposal
      }
    }
  }
  activeInstances.clear();
}

function notifySidePanelUpdated() {
  if (instanceDisposed || !isExtensionContextValid() || !chrome.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage(
      {
        type: 'MB_CONTENT_PANEL_UPDATED',
        url: window.location.href,
      },
      () => {
        void chrome.runtime?.lastError;
      }
    );
  } catch {
    // Side panel may not be open or context invalidated; ignore
  }
}

function syncTabBadgeToBackground() {
  if (instanceDisposed || !isExtensionContextValid()) return;
  const badges = Array.from(activeInstances.values())
    .map((i) => i.badgeState)
    .filter((b): b is PatchBadgeState => b !== null && b.text !== '');

  if (badges.length === 0) {
    sendBackgroundMessage('MB_UPDATE_TAB_BADGE', { text: '' }).catch(() => {});
    return;
  }

  const allNumeric = badges.every((b) => b.numericValue !== null);
  let finalText = '';
  if (allNumeric) {
    const sum = badges.reduce((acc, b) => acc + (b.numericValue || 0), 0);
    finalText = sum > 0 ? (sum > 999 ? '999+' : String(sum)) : '';
  } else {
    finalText = badges[badges.length - 1].text;
  }

  const lastBadge = badges[badges.length - 1];
  sendBackgroundMessage('MB_UPDATE_TAB_BADGE', {
    text: finalText,
    backgroundColor: lastBadge.backgroundColor || '#F43F5E',
    textColor: lastBadge.textColor || '#FFFBEB',
  }).catch(() => {});
}

async function syncDisabledPatchesFromBackground() {
  try {
    const res = await sendBackgroundMessage<{ disabledPatchIds: string[] }>('MB_GET_PATCH_SETTINGS');
    if (res && Array.isArray(res.disabledPatchIds)) {
      disabledPatchIds = new Set(res.disabledPatchIds);
    }
  } catch {
    // Default to empty set if background is unavailable
  }
}

async function cleanupPatchInstance(patchId: string) {
  const existing = activeInstances.get(patchId);
  if (!existing) return;

  for (const fn of existing.cleanups.reverse()) {
    try {
      fn();
    } catch (err) {
      console.warn(`[MonkeyPatch::${patchId}] Cleanup error:`, err);
    }
  }
  activeInstances.delete(patchId);
  syncTabBadgeToBackground();
  notifySidePanelUpdated();
}

async function evaluateAndRunPatches(isSpaNavigation = false) {
  if (instanceDisposed || !isExtensionContextValid()) {
    disposeCurrentContentInstance();
    return;
  }
  const currentUrl = window.location.href;
  applyQuickCssRules();

  // 1. Clean up any running patches that are now disabled, no longer match, or need to re-run on SPA navigation
  for (const [patchId, instance] of Array.from(activeInstances.entries())) {
    const isDisabled = disabledPatchIds.has(patchId);
    const stillMatches = patchMatchesUrl(instance.patch.matches, currentUrl);
    const shouldReRun = instance.patch.runOnSpaNavigation !== false;

    if (isDisabled || !stillMatches || (isSpaNavigation && shouldReRun)) {
      await cleanupPatchInstance(patchId);
    }
  }

  // 2. Start all enabled patches matching the current URL (isolated per patch so one failure never breaks others)
  for (const patch of patches) {
    if (disabledPatchIds.has(patch.id)) {
      continue;
    }

    if (activeInstances.has(patch.id)) {
      continue;
    }

    if (!patchMatchesUrl(patch.matches, currentUrl)) {
      continue;
    }

    const cleanups: CleanupFn[] = [];
    const actionHandlers: PanelActionHandler[] = [];
    const instance: RunningPatchInstance = {
      patch,
      cleanups,
      panelView: null,
      badgeState: null,
      actionHandlers,
    };
    activeInstances.set(patch.id, instance);

    const panelController: PatchPanelController = {
      set(view: PatchPanelView) {
        if (!activeInstances.has(patch.id)) return;
        instance.panelView = view;
        notifySidePanelUpdated();
      },
      clear() {
        if (!activeInstances.has(patch.id)) return;
        instance.panelView = null;
        notifySidePanelUpdated();
      },
      onAction(handler: PanelActionHandler) {
        actionHandlers.push(handler);
      },
    };

    const badgeController: PatchBadgeController = {
      set(value: number | string, options?: BadgeOptions) {
        if (!activeInstances.has(patch.id)) return;
        if (value === '' || value === 0 || value === '0' || value === null || value === undefined) {
          instance.badgeState = null;
        } else if (typeof value === 'number') {
          instance.badgeState = {
            text: value > 999 ? '999+' : String(value),
            numericValue: value,
            backgroundColor: options?.backgroundColor,
            textColor: options?.textColor,
          };
        } else {
          const trimmed = String(value).trim();
          const parsedNum = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
          instance.badgeState = {
            text: trimmed,
            numericValue: parsedNum,
            backgroundColor: options?.backgroundColor,
            textColor: options?.textColor,
          };
        }
        syncTabBadgeToBackground();
        notifySidePanelUpdated();
      },
      clear() {
        if (!activeInstances.has(patch.id)) return;
        instance.badgeState = null;
        syncTabBadgeToBackground();
        notifySidePanelUpdated();
      },
    };

    const ctx = createPatchContext(
      patch.id,
      (fn) => {
        cleanups.push(fn);
      },
      undefined,
      panelController,
      badgeController
    );

    Promise.resolve()
      .then(() => patch.run(ctx))
      .then((returnedCleanup) => {
        if (typeof returnedCleanup === 'function') {
          cleanups.push(returnedCleanup);
        }
        notifySidePanelUpdated();
      })
      .catch((err) => {
        if (isInvalidatedContextError(err) || !isExtensionContextValid()) {
          disposeCurrentContentInstance();
          return;
        }
        console.error(`[MonkeyPatch::${patch.id}] Unhandled error during run():`, err);
        ctx.log.error(`Unhandled error during run(): ${err?.message || String(err)}`);
      });
  }

  syncTabBadgeToBackground();
  notifySidePanelUpdated();
}

function setupSpaNavigationObserver() {
  const checkUrlChange = () => {
    if (instanceDisposed || !isExtensionContextValid()) {
      disposeCurrentContentInstance();
      return;
    }
    const nowUrl = window.location.href;
    if (nowUrl !== lastUrl) {
      lastUrl = nowUrl;
      evaluateAndRunPatches(true);
    }
  };

  spaUrlHandler = checkUrlChange;
  window.addEventListener('popstate', checkUrlChange);
  window.addEventListener('hashchange', checkUrlChange);

  spaObserver = new MutationObserver(() => {
    if (instanceDisposed || !isExtensionContextValid()) {
      disposeCurrentContentInstance();
      return;
    }
    if (window.location.href !== lastUrl) {
      checkUrlChange();
    }
  });

  if (document.documentElement) {
    spaObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  spaIntervalId = window.setInterval(checkUrlChange, 750);
}

interface ContentInstanceController {
  isContextValid: () => boolean;
  dispose: () => void;
}

const existingController = (window as any).__MP_CONTENT_CONTROLLER__ as
  | ContentInstanceController
  | undefined;

if (existingController && !existingController.isContextValid()) {
  try {
    existingController.dispose();
  } catch {
    // Ignore errors disposing stale content instance
  }
  delete (window as any).__MP_CONTENT_CONTROLLER__;
  delete (window as any).__MP_CONTENT_INITIALIZED__;
}

// Guard against duplicate execution if programmatically injected while current extension context is still valid
if (!(window as any).__MP_CONTENT_CONTROLLER__) {
  const controller: ContentInstanceController = {
    isContextValid: () => !instanceDisposed && isExtensionContextValid(),
    dispose: disposeCurrentContentInstance,
  };
  (window as any).__MP_CONTENT_CONTROLLER__ = controller;
  (window as any).__MP_CONTENT_INITIALIZED__ = true;
  setupQuickToolsListeners();

  // Initial execution: load disabled patch IDs from background, then evaluate & run
  const initialReadyPromise = syncDisabledPatchesFromBackground().then(async () => {
    await evaluateAndRunPatches(false);
    setupSpaNavigationObserver();
  });

  // Allow sidebar/popup to query which patches match/run on the current tab, and dispatch panel actions
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'MB_TAB_PATCH_STATUS') {
        initialReadyPromise
          .then(() => new Promise((r) => setTimeout(r, 25)))
          .then(() => {
            const currentUrl = window.location.href;
            const activeList = Array.from(activeInstances.values()).map((i) => ({
              id: i.patch.id,
              name: i.patch.name,
              description: i.patch.description || '',
              usesPanel: Boolean(i.patch.usesPanel || i.panelView !== null),
              badgeText: i.badgeState?.text || '',
            }));
            const panelViews = Array.from(activeInstances.values())
              .filter((i) => i.panelView !== null)
              .map((i) => ({
                patchId: i.patch.id,
                patchName: i.patch.name,
                view: i.panelView as PatchPanelView,
              }));
            const matchingList = patches
              .filter((p) => patchMatchesUrl(p.matches, currentUrl))
              .map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description || '',
                usesPanel: Boolean(p.usesPanel),
                enabled: !disabledPatchIds.has(p.id),
                running: activeInstances.has(p.id),
              }));
            sendResponse({
              ok: true,
              url: currentUrl,
              buildProfile,
              registeredCount: patches.length,
              activePatches: activeList,
              matchingPatches: matchingList,
              panelViews,
            });
          });
        return true;
      }

      if (msg?.type === 'MB_PANEL_DISPATCH_ACTION') {
        const targetPatchId = String(msg.patchId || '');
        const actionId = String(msg.actionId || '');
        const payload = msg.payload || {};
        const instance = activeInstances.get(targetPatchId);
        if (!instance) {
          sendResponse({ ok: false, error: `Patch "${targetPatchId}" is not running on this tab.` });
          return false;
        }

        Promise.all(instance.actionHandlers.map((fn) => Promise.resolve(fn(actionId, payload))))
          .then(() => {
            sendResponse({ ok: true });
          })
          .catch((err) => {
            sendResponse({ ok: false, error: err?.message || String(err) });
          });
        return true;
      }

      if (msg?.type === 'MB_PATCH_STATES_CHANGED') {
        if (Array.isArray(msg.disabledPatchIds)) {
          disabledPatchIds = new Set(msg.disabledPatchIds);
        }
        evaluateAndRunPatches(false);
        sendResponse({ ok: true });
        return false;
      }

      if (msg?.type === 'MB_SERVER_CHANGED') {
        syncQuickCssRulesFromBackground(true);
        evaluateAndRunPatches(true);
        sendResponse({ ok: true });
        return false;
      }

      if (msg?.type === 'MB_QUICK_RULES_UPDATED') {
        if (Array.isArray(msg.rules)) {
          applyQuickCssRules(msg.rules);
        }
        sendResponse({ ok: true });
        return false;
      }

      if (msg?.type === 'MB_OPEN_ELEMENT_TWEAKER') {
        openElementTweakerModal();
        sendResponse({ ok: true });
        return false;
      }

      if (msg?.type === 'MB_START_ELEMENT_PICKER') {
        startInteractiveElementPicker();
        sendResponse({ ok: true });
        return false;
      }

      if (msg?.type === 'MB_SHOW_TOAST') {
        showPageToast(String(msg.message || ''), msg.tone === 'error' ? 'error' : 'default');
        sendResponse({ ok: true });
        return false;
      }
    });
  }
}

import { matchesUrlPattern } from '../core/urlMatcher';
import { sendBackgroundMessage, type QuickCssRule } from '../core/messaging';

const QUICK_RULES_STYLE_ID = 'mp-quick-css-rules';
const PREVIEW_STYLE_ID = 'mp-quick-css-preview';
const TWEAKER_MODAL_ID = 'mp-element-tweaker-modal';
const PICKER_OVERLAY_ID = 'mp-element-picker-highlight';
const TOAST_ID = 'mp-page-toast';

let cachedQuickRules: QuickCssRule[] = [];
let lastRightClickedElement: Element | null = null;
let pickerActive = false;

export function showPageToast(message: string, tone: 'default' | 'error' = 'default') {
  document.getElementById(TOAST_ID)?.remove();

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '22px',
    right: '22px',
    zIndex: '2147483647',
    background: '#1A1102',
    color: tone === 'error' ? '#FFA9C8' : '#FFFAE9',
    border: tone === 'error' ? '1px solid #AD175C' : '1px solid rgba(250, 204, 21, 0.55)',
    borderLeft: '4px solid #DB2777',
    borderRadius: '10px',
    padding: '12px 16px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    fontWeight: '600',
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.65)',
    pointerEvents: 'none',
    transition: 'opacity 0.2s ease',
  });

  (document.body || document.documentElement).appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 220);
  }, 2600);
}

export function applyQuickCssRules(rules: QuickCssRule[] = cachedQuickRules) {
  cachedQuickRules = rules;
  const currentUrl = window.location.href;
  const matching = rules.filter(
    (r) => r.enabled && r.css && matchesUrlPattern(currentUrl, r.matchPattern)
  );

  let styleEl = document.getElementById(QUICK_RULES_STYLE_ID) as HTMLStyleElement | null;
  if (matching.length === 0) {
    styleEl?.remove();
    return;
  }

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = QUICK_RULES_STYLE_ID;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  styleEl.textContent = matching
    .map((r) => `/* MonkeyPatch Quick Rule: ${r.name} (${r.id}) */\n${r.css}`)
    .join('\n\n');
}

export async function syncQuickCssRulesFromBackground(syncFromServer = true) {
  try {
    const res = await sendBackgroundMessage<{ rules: QuickCssRule[] }>('MB_GET_QUICK_RULES', {
      syncFromServer,
    });
    if (res && Array.isArray(res.rules)) {
      applyQuickCssRules(res.rules);
    }
  } catch {
    // Ignore if background unavailable
  }
}

function setLivePreviewCss(cssText: string | null) {
  let previewEl = document.getElementById(PREVIEW_STYLE_ID) as HTMLStyleElement | null;
  if (!cssText) {
    previewEl?.remove();
    return;
  }
  if (!previewEl) {
    previewEl = document.createElement('style');
    previewEl.id = PREVIEW_STYLE_ID;
    (document.head || document.documentElement).appendChild(previewEl);
  }
  previewEl.textContent = cssText;
}

function escapeCssIdentifier(ident: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(ident);
  }
  return ident.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

export function buildSmartSelector(el: Element | null): string {
  if (!el || el === document.documentElement || el === document.body) {
    return 'body';
  }

  const tag = el.tagName.toLowerCase();

  if (el.id && !/^\d/.test(el.id) && el.id.length < 48) {
    return `${tag}#${escapeCssIdentifier(el.id)}`;
  }

  const validClasses = Array.from(el.classList).filter(
    (c) =>
      c &&
      c.length < 40 &&
      !/^(hover|active|focus|selected|open|js-|is-|has-)/i.test(c) &&
      !/[:[\]/]/.test(c)
  );

  if (validClasses.length > 0) {
    const classPart = validClasses
      .slice(0, 2)
      .map((c) => `.${escapeCssIdentifier(c)}`)
      .join('');
    const candidate = `${tag}${classPart}`;
    try {
      if (document.querySelectorAll(candidate).length === 1) {
        return candidate;
      }
    } catch {
      // Fallback
    }
    if (el.parentElement && el.parentElement !== document.body) {
      const parentTag = el.parentElement.tagName.toLowerCase();
      const parentClasses = Array.from(el.parentElement.classList)
        .filter((c) => c && c.length < 35 && !/[:[\]/]/.test(c))
        .slice(0, 1)
        .map((c) => `.${escapeCssIdentifier(c)}`)
        .join('');
      return `${parentTag}${parentClasses} > ${candidate}`;
    }
    return candidate;
  }

  // Fallback with nth-of-type if needed
  if (el.parentElement) {
    const siblings = Array.from(el.parentElement.children).filter(
      (child) => child.tagName === el.tagName
    );
    if (siblings.length > 1) {
      const idx = siblings.indexOf(el) + 1;
      const parentSel =
        el.parentElement !== document.body ? `${buildSmartSelector(el.parentElement)} > ` : '';
      return `${parentSel}${tag}:nth-of-type(${idx})`;
    }
  }

  return tag;
}

function drawHighlightBox(targetEl: Element | null) {
  let box = document.getElementById(PICKER_OVERLAY_ID) as HTMLDivElement | null;
  if (!targetEl) {
    box?.remove();
    return;
  }

  const rect = targetEl.getBoundingClientRect();
  if (!box) {
    box = document.createElement('div');
    box.id = PICKER_OVERLAY_ID;
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: '2147483645',
      border: '2px solid #F43F5E',
      background: 'rgba(244, 63, 94, 0.14)',
      borderRadius: '4px',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      transition: 'all 0.08s ease-out',
    });
    (document.body || document.documentElement).appendChild(box);
  }

  Object.assign(box.style, {
    top: `${Math.max(0, rect.top)}px`,
    left: `${Math.max(0, rect.left)}px`,
    width: `${Math.max(4, rect.width)}px`,
    height: `${Math.max(4, rect.height)}px`,
  });
}

export function openElementTweakerModal(initialElement?: Element | null) {
  document.getElementById(TWEAKER_MODAL_ID)?.remove();

  let currentEl: Element | null =
    initialElement || lastRightClickedElement || document.body;
  let currentSelector = buildSmartSelector(currentEl);
  const defaultPattern = `${window.location.origin}/*`;
  let currentDeclarations = 'display: block !important;';

  const buildFullCss = (sel: string, decls: string) =>
    `${sel.trim()} {\n  ${decls.trim()}\n}`;

  drawHighlightBox(currentEl);
  setLivePreviewCss(buildFullCss(currentSelector, currentDeclarations));

  const modal = document.createElement('div');
  modal.id = TWEAKER_MODAL_ID;
  Object.assign(modal.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    width: '400px',
    maxWidth: 'calc(100vw - 32px)',
    zIndex: '2147483646',
    background: '#1A1102',
    color: '#FFFAE9',
    border: '1px solid rgba(91, 75, 30, 0.7)',
    borderRadius: '12px',
    padding: '16px 18px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    boxShadow: '0 14px 36px rgba(0, 0, 0, 0.75)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  });

  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(91,75,30,0.5);padding-bottom:10px;">
      <div style="font-weight:700;font-size:17px;color:#FFFAE9;">🎯 MonkeyPatch Element Tweaker</div>
      <button id="mp-tweak-close" type="button" style="background:transparent;border:none;color:#E2D7BD;cursor:pointer;font-size:16px;font-weight:700;padding:4px 8px;">✕</button>
    </div>

    <div style="display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <label style="font-size:13px;font-weight:600;color:#E2D7BD;">Target CSS Selector</label>
        <button id="mp-tweak-parent" type="button" style="background:#271800;border:1px solid rgba(91,75,30,0.65);color:#FFE04B;border-radius:6px;padding:4px 10px;font-size:13px;font-weight:600;cursor:pointer;">⬆️ Select Parent</button>
      </div>
      <input id="mp-tweak-selector" type="text" style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid rgba(91,75,30,0.6);background:#0B0700;color:#FFE04B;font-family:monospace;font-size:13px;" />
    </div>

    <div style="display:flex;flex-direction:column;gap:6px;">
      <label style="font-size:13px;font-weight:600;color:#E2D7BD;">Quick Presets (Live Preview)</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        <button data-preset="display: none !important;" type="button" style="padding:8px 10px;border-radius:8px;border:1px solid #AD175C;background:#3B0018;color:#FFA9C8;font-size:13px;font-weight:600;cursor:pointer;">🚫 Hide Element</button>
        <button data-preset="display: block !important;" type="button" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(91,75,30,0.6);background:#271800;color:#FFFAE9;font-size:13px;font-weight:600;cursor:pointer;">📦 Force Block</button>
        <button data-preset="width: 100% !important; max-width: none !important;" type="button" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(91,75,30,0.6);background:#271800;color:#FFFAE9;font-size:13px;font-weight:600;cursor:pointer;">↔️ Full Width</button>
        <button data-preset="overflow: auto !important; pointer-events: auto !important; filter: none !important;" type="button" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(91,75,30,0.6);background:#271800;color:#FFFAE9;font-size:13px;font-weight:600;cursor:pointer;">🔓 Unblur / Unlock</button>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:6px;">
      <label style="font-size:13px;font-weight:600;color:#E2D7BD;">CSS Rule (Editable)</label>
      <textarea id="mp-tweak-css" rows="3" style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid rgba(91,75,30,0.6);background:#0B0700;color:#FFFAE9;font-family:monospace;font-size:13px;resize:vertical;"></textarea>
    </div>

    <div style="display:flex;flex-direction:column;gap:6px;">
      <label style="font-size:13px;font-weight:600;color:#E2D7BD;">URL Match Pattern</label>
      <input id="mp-tweak-pattern" type="text" style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid rgba(91,75,30,0.6);background:#0B0700;color:#FFFAE9;font-family:monospace;font-size:13px;" />
    </div>

    <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:8px;border-top:1px solid rgba(91,75,30,0.5);">
      <button id="mp-tweak-cancel" type="button" style="min-height:38px;padding:0 14px;border-radius:8px;border:1px solid rgba(91,75,30,0.6);background:#271800;color:#E2D7BD;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>
      <button id="mp-tweak-save" type="button" style="min-height:38px;padding:0 16px;border-radius:8px;border:none;background:#DB2777;color:#FFFAE9;font-size:14px;font-weight:700;cursor:pointer;">Save &amp; Sync Rule</button>
    </div>
  `;

  (document.body || document.documentElement).appendChild(modal);

  const selectorInput = modal.querySelector('#mp-tweak-selector') as HTMLInputElement;
  const cssTextarea = modal.querySelector('#mp-tweak-css') as HTMLTextAreaElement;
  const patternInput = modal.querySelector('#mp-tweak-pattern') as HTMLInputElement;

  selectorInput.value = currentSelector;
  cssTextarea.value = buildFullCss(currentSelector, currentDeclarations);
  patternInput.value = defaultPattern;

  const cleanupModal = () => {
    setLivePreviewCss(null);
    drawHighlightBox(null);
    modal.remove();
  };

  modal.querySelector('#mp-tweak-close')?.addEventListener('click', cleanupModal);
  modal.querySelector('#mp-tweak-cancel')?.addEventListener('click', cleanupModal);

  modal.querySelector('#mp-tweak-parent')?.addEventListener('click', () => {
    if (currentEl && currentEl.parentElement && currentEl.parentElement !== document.documentElement) {
      currentEl = currentEl.parentElement;
      currentSelector = buildSmartSelector(currentEl);
      selectorInput.value = currentSelector;
      cssTextarea.value = buildFullCss(currentSelector, currentDeclarations);
      drawHighlightBox(currentEl);
      setLivePreviewCss(cssTextarea.value);
    }
  });

  selectorInput.addEventListener('input', () => {
    currentSelector = selectorInput.value.trim() || 'body';
    cssTextarea.value = buildFullCss(currentSelector, currentDeclarations);
    setLivePreviewCss(cssTextarea.value);
  });

  cssTextarea.addEventListener('input', () => {
    setLivePreviewCss(cssTextarea.value);
  });

  modal.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset') || '';
      currentDeclarations = preset;
      cssTextarea.value = buildFullCss(currentSelector, currentDeclarations);
      setLivePreviewCss(cssTextarea.value);
    });
  });

  modal.querySelector('#mp-tweak-save')?.addEventListener('click', async () => {
    const finalSelector = selectorInput.value.trim();
    const finalCss = cssTextarea.value.trim();
    const finalPattern = patternInput.value.trim() || defaultPattern;
    if (!finalCss) return;

    const ruleId = `css-${window.location.hostname.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`;
    const ruleName = `${finalSelector || 'Custom CSS'} on ${window.location.hostname}`;

    try {
      await sendBackgroundMessage('MB_SAVE_QUICK_RULE', {
        rule: {
          id: ruleId,
          name: ruleName,
          matchPattern: finalPattern,
          selector: finalSelector,
          css: finalCss,
          enabled: true,
        },
      });
      cleanupModal();
      showPageToast('🎯 CSS Rule saved & synced to MonkeyBrain ✓');
    } catch (err: any) {
      showPageToast(`⚠️ Failed to save rule: ${err?.message || 'Error'}`, 'error');
    }
  });
}

export function startInteractiveElementPicker() {
  if (pickerActive) return;
  pickerActive = true;
  showPageToast('🎯 Hover any element and click to tweak/hide it (Esc to cancel)');

  let hoveredEl: Element | null = null;

  const onMouseMove = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target || target.id === PICKER_OVERLAY_ID || target.id === TOAST_ID) return;
    hoveredEl = target;
    drawHighlightBox(hoveredEl);
  };

  const stopPicker = () => {
    pickerActive = false;
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    drawHighlightBox(null);
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const chosen = hoveredEl || (e.target as Element | null);
    stopPicker();
    if (chosen) {
      openElementTweakerModal(chosen);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      stopPicker();
      showPageToast('Element picker cancelled.');
    }
  };

  window.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
}

export function setupQuickToolsListeners() {
  window.addEventListener(
    'contextmenu',
    (e) => {
      if (e.target instanceof Element) {
        lastRightClickedElement = e.target;
      }
    },
    true
  );

  syncQuickCssRulesFromBackground(true);
}

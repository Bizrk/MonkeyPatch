import type { MonkeyBrainDocument, PatchContext, PatchStore } from '../../../src/sdk/types';
import { extractDemoPageMetadata } from './extractor';
import stylesText from './styles.css?inline';

export interface DemoNoteData {
  title: string;
  content: string;
  pageUrl: string;
  pageHeading: string;
}

export function mountDemoNotesPanel(ctx: PatchContext, store: PatchStore): () => void {
  const existingHost = document.getElementById('monkeypatch-demo-host');
  if (existingHost) {
    existingHost.remove();
  }

  const host = document.createElement('div');
  host.id = 'monkeypatch-demo-host';

  const styleEl = document.createElement('style');
  styleEl.textContent = stylesText;
  host.appendChild(styleEl);

  const panel = document.createElement('div');
  panel.className = 'mp-demo-panel';
  host.appendChild(panel);
  document.body.appendChild(host);

  let activeTab: 'url' | 'domain' = 'url';
  let minimized = false;
  let editingKey: string | null = null;
  let titleValue = '';
  let contentValue = '';
  let notes: MonkeyBrainDocument<DemoNoteData>[] = [];
  let errorMsg: string | null = null;
  let loading = false;

  function syncSidebarPanel() {
    const meta = extractDemoPageMetadata();
    ctx.badge.set(notes.length);
    ctx.panel.set({
      title: '🧠 Demo Notes',
      badge: `${notes.length} notes`,
      subtitle: activeTab === 'url' ? `Page: ${meta.cleanUrl}` : `Domain: ${meta.domain}`,
      status: errorMsg || (loading ? 'Loading...' : `Synced with MonkeyBrain`),
      sections: [
        {
          type: 'form',
          title: 'ADD NOTE FROM SIDEBAR',
          actionId: 'add-note',
          submitLabel: 'Save Note',
          fields: [
            { name: 'title', placeholder: 'Note title...' },
            { name: 'content', type: 'textarea', placeholder: 'Write a note for this URL...' },
          ],
        },
        {
          type: 'list',
          title: activeTab === 'url' ? 'NOTES FOR THIS URL' : `NOTES FOR ${meta.domain.toUpperCase()}`,
          emptyText: 'No notes saved yet.',
          items: notes.map((n) => ({
            id: n.key || n.id,
            title: n.data?.title || '(Untitled)',
            subtitle: n.data?.content || '',
            badge: new Date(n.updatedAt).toLocaleTimeString(),
            actionId: 'delete-note',
            actionLabel: 'Delete',
          })),
        },
      ],
      actions: [
        {
          id: 'switch-scope',
          label: activeTab === 'url' ? 'Show Domain Notes' : 'Show Page Notes',
          variant: 'secondary',
        },
        {
          id: 'refresh',
          label: 'Refresh',
          variant: 'primary',
        },
      ],
    });
  }

  ctx.panel.onAction(async (actionId, payload) => {
    if (actionId === 'refresh') {
      await loadNotes();
    } else if (actionId === 'switch-scope') {
      activeTab = activeTab === 'url' ? 'domain' : 'url';
      await loadNotes();
    } else if (actionId === 'add-note' && payload) {
      titleValue = String(payload.title || '');
      contentValue = String(payload.content || '');
      await saveNote();
    } else if (actionId === 'delete-note' && payload?.itemId) {
      await removeNote(String(payload.itemId));
    }
  });

  async function loadNotes() {
    loading = true;
    errorMsg = null;
    render();

    const meta = extractDemoPageMetadata();
    try {
      const targetResource = activeTab === 'url' ? meta.urlResource : meta.domainResource;
      notes = await store.query<DemoNoteData>({
        type: 'note',
        resource: targetResource,
        sortBy: 'updatedAt',
        sortDirection: 'desc',
      });
    } catch (err: any) {
      errorMsg = err?.message || 'Failed to load notes.';
    } finally {
      loading = false;
      render();
      syncSidebarPanel();
    }
  }

  async function saveNote() {
    if (!titleValue.trim() && !contentValue.trim()) return;
    errorMsg = null;
    const meta = extractDemoPageMetadata();
    const noteKey = editingKey || `note-${Date.now()}`;

    try {
      await store.set<DemoNoteData>(
        noteKey,
        {
          title: titleValue.trim() || meta.heading,
          content: contentValue.trim(),
          pageUrl: meta.cleanUrl,
          pageHeading: meta.heading,
        },
        {
          type: 'note',
          resources: [meta.urlResource, meta.domainResource],
        }
      );

      ctx.log.info(`Saved note ${noteKey} for ${meta.cleanUrl}`);
      editingKey = null;
      titleValue = '';
      contentValue = '';
      await loadNotes();
    } catch (err: any) {
      errorMsg = err?.message || 'Could not save note.';
      render();
    }
  }

  async function removeNote(keyOrId: string) {
    try {
      await store.delete(keyOrId);
      if (editingKey === keyOrId) {
        editingKey = null;
        titleValue = '';
        contentValue = '';
      }
      await loadNotes();
    } catch (err: any) {
      errorMsg = err?.message || 'Could not delete note.';
      render();
    }
  }

  function render() {
    const meta = extractDemoPageMetadata();
    panel.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'mp-demo-header';
    header.innerHTML = `
      <span class="mp-demo-title">🧠 Demo Notes Patch</span>
      <span style="font-size:11px;color:#94a3b8;">${minimized ? '▲ Expand' : '▼ Minimize'}</span>
    `;
    header.addEventListener('click', () => {
      minimized = !minimized;
      render();
    });
    panel.appendChild(header);

    if (minimized) return;

    const body = document.createElement('div');
    body.className = 'mp-demo-body';

    // Tabs (Current URL vs Current Domain)
    const tabs = document.createElement('div');
    tabs.className = 'mp-demo-tabs';

    const tabUrl = document.createElement('button');
    tabUrl.className = `mp-demo-tab ${activeTab === 'url' ? 'active' : ''}`;
    tabUrl.textContent = 'This Page URL';
    tabUrl.addEventListener('click', () => {
      activeTab = 'url';
      loadNotes();
    });

    const tabDomain = document.createElement('button');
    tabDomain.className = `mp-demo-tab ${activeTab === 'domain' ? 'active' : ''}`;
    tabDomain.textContent = `Domain (${meta.domain})`;
    tabDomain.addEventListener('click', () => {
      activeTab = 'domain';
      loadNotes();
    });

    tabs.appendChild(tabUrl);
    tabs.appendChild(tabDomain);
    body.appendChild(tabs);

    // Error alert
    if (errorMsg) {
      const errBox = document.createElement('div');
      errBox.style.cssText =
        'padding:6px 8px;border-radius:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#fca5a5;font-size:11px;';
      errBox.textContent = errorMsg;
      body.appendChild(errBox);
    }

    // Form
    const form = document.createElement('div');
    form.className = 'mp-demo-form';

    const titleInput = document.createElement('input');
    titleInput.className = 'mp-demo-input';
    titleInput.placeholder = 'Note title...';
    titleInput.value = titleValue;
    titleInput.addEventListener('input', (e) => {
      titleValue = (e.target as HTMLInputElement).value;
    });

    const contentArea = document.createElement('textarea');
    contentArea.className = 'mp-demo-textarea';
    contentArea.rows = 2;
    contentArea.placeholder = 'Write a note for this URL...';
    contentArea.value = contentValue;
    contentArea.addEventListener('input', (e) => {
      contentValue = (e.target as HTMLTextAreaElement).value;
    });

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'mp-demo-btn';
    saveBtn.style.flex = '1';
    saveBtn.textContent = editingKey ? 'Update Note' : 'Save Note';
    saveBtn.addEventListener('click', saveNote);
    btnRow.appendChild(saveBtn);

    if (editingKey) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'mp-demo-btn mp-demo-btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        editingKey = null;
        titleValue = '';
        contentValue = '';
        render();
      });
      btnRow.appendChild(cancelBtn);
    }

    form.appendChild(titleInput);
    form.appendChild(contentArea);
    form.appendChild(btnRow);
    body.appendChild(form);

    // Notes list
    const listWrap = document.createElement('div');
    listWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:4px;';

    if (loading) {
      listWrap.innerHTML = '<div style="color:#94a3b8;font-size:12px;">Loading notes...</div>';
    } else if (notes.length === 0) {
      listWrap.innerHTML = `<div style="color:#94a3b8;font-size:12px;">No notes found for ${
        activeTab === 'url' ? 'this URL' : 'this domain'
      }.</div>`;
    } else {
      for (const item of notes) {
        const card = document.createElement('div');
        card.className = 'mp-demo-note-item';

        const titleRow = document.createElement('div');
        titleRow.className = 'mp-demo-note-title';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = item.data?.title || '(Untitled)';

        const actions = document.createElement('div');
        actions.className = 'mp-demo-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'mp-demo-link-btn';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => {
          editingKey = item.key || item.id;
          titleValue = item.data?.title || '';
          contentValue = item.data?.content || '';
          render();
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'mp-demo-link-btn danger';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => {
          removeNote(item.key || item.id);
        });

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        titleRow.appendChild(titleSpan);
        titleRow.appendChild(actions);

        const textDiv = document.createElement('div');
        textDiv.className = 'mp-demo-note-text';
        textDiv.textContent = item.data?.content || '';

        const metaDiv = document.createElement('div');
        metaDiv.className = 'mp-demo-note-meta';
        metaDiv.innerHTML = `
          <span>${new Date(item.updatedAt).toLocaleTimeString()}</span>
          <span title="${item.data?.pageUrl || ''}">${item.key || ''}</span>
        `;

        card.appendChild(titleRow);
        card.appendChild(textDiv);
        card.appendChild(metaDiv);
        listWrap.appendChild(card);
      }
    }

    body.appendChild(listWrap);
    panel.appendChild(body);
  }

  loadNotes();

  return () => {
    ctx.badge.clear();
    ctx.panel.clear();
    host.remove();
  };
}

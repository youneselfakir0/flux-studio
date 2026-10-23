/**
 * Flux Studio v2 — Prompt Studio
 * Gestion des templates textuels : création, édition, recherche,
 * et injection directe dans le Mode App.
 *
 * Persistance : localStorage (clé `flux_studio_prompts`) via core/state.js:persisted.
 * Bus        : Events.prompt -> prompt:inject  (le Mode App s'abonne)
 *                           -> prompt:saved
 *              Events.ui     -> ui:toast, ui:switch-view
 */

import { Signal, persisted } from '../../core/state.js';
import { Events } from '../../core/events.js';

// Le contenu interpolé provient de la saisie utilisateur (persistée dans son
// propre localStorage) : on échappe systématiquement via esc() avant tout
// innerHTML. Aucune donnée distante n'entre dans ces templates.
const esc = (s) => String(s == null ? "" : s)
  .replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const DEFAULT_TEMPLATES = [
  {
    id: 'tpl-portrait-realiste',
    title: 'Portrait réaliste',
    positive: 'a beautiful woman, professional studio portrait, soft Rembrandt lighting, detailed skin texture, 85mm f/1.4, shallow depth of field',
    negative: 'blurry, deformed, low quality, watermark, extra fingers',
    tags: ['realistic', 'portrait'],
  },
  {
    id: 'tpl-cyberpunk-neon',
    title: 'Cyberpunk néon',
    positive: 'cyberpunk woman, rain-soaked street, neon signs, cinematic rim light, reflective puddles, blade runner aesthetic, 35mm',
    negative: 'daylight, flat lighting, cartoon',
    tags: ['cyberpunk', 'neon', 'cinematic'],
  },
  {
    id: 'tpl-flux-klein-rapide',
    title: 'FLUX.2 Klein — rapide',
    positive: 'masterpiece, best quality, ultra detailed, (photorealistic:1.2), dramatic lighting',
    negative: 'worst quality, low quality, blurry',
    tags: ['flux', 'klein', 'fast'],
  },
];

export class PromptTab {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;

    this.templates = persisted('flux_studio_prompts', DEFAULT_TEMPLATES);
    this.searchQuery = new Signal('');
    this.selectedId = new Signal(null);

    this.init();
    this.bindEvents();
    this.renderList();
  }

  init() {
    this.container.classList.add('prompt-studio');
    this.container.innerHTML = `
      <div class="view-head">
        <h1>Prompt Studio</h1>
        <p>Templates textuels réutilisables. « Injecter » alimente directement le Mode App.</p>
      </div>

      <div class="filters">
        <input class="chip" id="prompt-search" style="min-width:280px"
               placeholder="Rechercher un template, un mot-clé…" autocomplete="off">
        <div class="spacer"></div>
        <span class="faint" id="prompt-count">0 template</span>
        <button class="btn primary" id="btn-new-prompt">+ Nouveau template</button>
      </div>

      <div class="split">
        <div class="prompt-list-panel">
          <div class="prompt-list" id="prompt-list"></div>
        </div>
        <div class="prompt-editor-panel">
          <div class="panel" id="editor-pane"></div>
        </div>
      </div>
    `;

    this.listEl = this.container.querySelector('#prompt-list');
    this.editorEl = this.container.querySelector('#editor-pane');
    this.searchInput = this.container.querySelector('#prompt-search');
    this.countEl = this.container.querySelector('#prompt-count');
    this.emptyEditor();
  }

  bindEvents() {
    let t = null;
    this.searchInput.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        this.searchQuery.value = e.target.value.trim().toLowerCase();
        this.renderList();
      }, 120);
    });

    this.container.querySelector('#btn-new-prompt').addEventListener('click', () => this.createNew());

    this.listEl.addEventListener('click', (e) => {
      const item = e.target.closest('.prompt-item');
      if (!item) return;
      if (e.target.closest('[data-action="inject"]')) this.inject(item.dataset.id);
      else this.select(item.dataset.id);
    });
  }

  /* ---------------- CRUD ---------------- */

  createNew() {
    const tpl = {
      id: 'tpl-' + Date.now().toString(36),
      title: 'Nouveau template',
      positive: '',
      negative: '',
      tags: [],
      createdAt: Date.now(),
    };
    this.templates.value = [...this.templates.value, tpl];
    this.searchQuery.value = '';
    this.searchInput.value = '';
    this.select(tpl.id);
    Events.prompt.emit('prompt:saved', { count: this.templates.value.length });
  }

  select(id) {
    this.selectedId.value = id;
    this.renderList();
    this.renderEditor();
  }

  save() {
    const id = this.selectedId.value;
    if (!id) return;
    const title = this.editorEl.querySelector('#edit-title').value.trim() || 'Sans titre';
    const positive = this.editorEl.querySelector('#edit-positive').value;
    const negative = this.editorEl.querySelector('#edit-negative').value;
    const tags = this.editorEl.querySelector('#edit-tags').value
      .split(',').map(s => s.trim()).filter(Boolean);

    this.templates.value = this.templates.value.map(t =>
      t.id === id ? { ...t, title, positive, negative, tags, updatedAt: Date.now() } : t);

    Events.prompt.emit('prompt:saved', { count: this.templates.value.length });
    Events.ui.emit('ui:toast', { message: `Template « ${title} » enregistré ✓`, type: 'success' });
    this.renderList();
  }

  remove(id) {
    const tpl = this.templates.value.find(t => t.id === id);
    this.templates.value = this.templates.value.filter(t => t.id !== id);
    if (this.selectedId.value === id) this.selectedId.value = null;
    Events.ui.emit('ui:toast', { message: `Template « ${tpl?.title || id} » supprimé`, type: 'info' });
    this.renderList();
    this.emptyEditor();
  }

  async copyPositive() {
    const tpl = this.templates.value.find(t => t.id === this.selectedId.value);
    if (!tpl) return;
    try {
      await navigator.clipboard.writeText(tpl.positive);
      Events.ui.emit('ui:toast', { message: 'Prompt positif copié ✓', type: 'success' });
    } catch {
      Events.ui.emit('ui:toast', { message: 'Copie refusée par le navigateur', type: 'error' });
    }
  }

  /**
   * Injecte le template dans le Mode App puis bascule dessus.
   * Le shell (main.js) s'abonne à `prompt:inject` et remplit #appPrompt / #appNeg.
   */
  inject(id) {
    const tpl = this.templates.value.find(t => t.id === id);
    if (!tpl) return;
    Events.prompt.emit('prompt:inject', { positive: tpl.positive, negative: tpl.negative });
    Events.ui.emit('ui:toast', { message: `« ${tpl.title} » injecté dans le Mode App`, type: 'success' });
    Events.ui.emit('ui:switch-view', { view: 'app' });
  }

  /* ---------------- Rendu ---------------- */

  filtered() {
    const q = this.searchQuery.value;
    if (!q) return this.templates.value;
    return this.templates.value.filter(t =>
      (t.title || '').toLowerCase().includes(q) ||
      (t.positive || '').toLowerCase().includes(q) ||
      (t.tags || []).some(tag => String(tag).toLowerCase().includes(q))
    );
  }

  emptyEditor() {
    this.editorEl.innerHTML = `
      <div class="empty">
        <div class="big">✦</div>
        <b>Aucun template sélectionné</b>
        <div class="mt">Choisis un template à gauche, ou crée-en un nouveau.</div>
      </div>`;
  }

  renderList() {
    const rows = this.filtered();
    this.countEl.textContent = `${rows.length} template${rows.length > 1 ? 's' : ''}`;

    if (!rows.length) {
      this.listEl.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <div class="big">✦</div>
          <b>Aucun template</b>
          <div class="mt">Ajuste la recherche ou crée un template.</div>
        </div>`;
      return;
    }

    const sel = this.selectedId.value;
    this.listEl.innerHTML = rows.map(t => `
      <article class="prompt-item ${t.id === sel ? 'active' : ''}" data-id="${esc(t.id)}">
        <div class="prompt-item-head">
          <b>${esc(t.title)}</b>
          <button class="btn sm ghost" data-action="inject"
                  title="Injecter dans le Mode App">Injecter</button>
        </div>
        <div class="prompt-preview">${esc((t.positive || '').slice(0, 90)) || '<i>vide</i>'}</div>
        ${t.tags?.length ? `<div class="prompt-tags">${t.tags.map(tag =>
          `<span class="chip sm">${esc(tag)}</span>`).join('')}</div>` : ''}
      </article>
    `).join('');
  }

  renderEditor() {
    const t = this.templates.value.find(x => x.id === this.selectedId.value);
    if (!t) { this.emptyEditor(); return; }

    this.editorEl.innerHTML = `
      <div class="editor-form">
        <div class="field">
          <label>Titre du template</label>
          <input type="text" id="edit-title" value="${esc(t.title)}">
        </div>
        <div class="field">
          <label>Prompt positif</label>
          <textarea id="edit-positive" rows="6"
            placeholder="a beautiful woman, soft studio light, 85mm…">${esc(t.positive)}</textarea>
        </div>
        <div class="field">
          <label>Prompt négatif</label>
          <textarea id="edit-negative" rows="3"
            placeholder="blurry, deformed, low quality…">${esc(t.negative)}</textarea>
        </div>
        <div class="field">
          <label>Tags <span class="faint">(séparés par des virgules)</span></label>
          <input type="text" id="edit-tags" value="${esc((t.tags || []).join(', '))}">
        </div>
        <div class="editor-actions">
          <button class="btn ghost" id="btn-save">💾 Enregistrer</button>
          <button class="btn ghost" id="btn-copy">Copier le positif</button>
          <span class="spacer"></span>
          <button class="btn danger" id="btn-delete">Supprimer</button>
          <button class="btn primary" id="btn-inject">Injecter dans le Mode App</button>
        </div>
      </div>
    `;

    this.editorEl.querySelector('#btn-save').onclick = () => this.save();
    this.editorEl.querySelector('#btn-copy').onclick = () => this.copyPositive();
    this.editorEl.querySelector('#btn-delete').onclick = () => {
      if (confirm(`Supprimer « ${t.title} » ?`)) this.remove(t.id);
    };
    this.editorEl.querySelector('#btn-inject').onclick = () => this.inject(t.id);
  }
}

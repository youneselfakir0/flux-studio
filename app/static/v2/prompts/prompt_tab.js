/**
 * Flux Studio v2 — Prompt Studio
 */
import { Signal, persisted } from '../../core/state.js';
import { Events } from '../../core/events.js';

const esc = (s) => String(s == null ? "" : s)
  .replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const DEFAULT_TEMPLATES = [
  { id: 'tpl-portrait-realiste', title: 'Portrait réaliste', positive: 'a beautiful woman, professional studio portrait, soft Rembrandt lighting, detailed skin texture, 85mm f/1.4, shallow depth of field', negative: 'blurry, deformed, low quality, watermark, extra fingers', tags: ['realistic', 'portrait'] },
  { id: 'tpl-cyberpunk-neon', title: 'Cyberpunk néon', positive: 'cyberpunk woman, rain-soaked street, neon signs, cinematic rim light, reflective puddles, blade runner aesthetic, 35mm', negative: 'daylight, flat lighting, cartoon', tags: ['cyberpunk', 'neon', 'cinematic'] },
  { id: 'tpl-flux-klein-rapide', title: 'FLUX.2 Klein — rapide', positive: 'masterpiece, best quality, ultra detailed, (photorealistic:1.2), dramatic lighting', negative: 'worst quality, low quality, blurry', tags: ['flux', 'klein', 'fast'] },
];

const DEFAULT_NEGATIVE = 'blurry, deformed, low quality, bad anatomy, extra fingers, watermark, text, logo, (worst quality:1.4)';

export class PromptTab {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.templates = persisted('flux_studio_prompts', DEFAULT_TEMPLATES);
    this.searchQuery = new Signal('');
    this.selectedId = new Signal(null);
    this.loras = [];
    this.loraQuery = new Signal('');
    this.selectedLoras = new Set();
    this.genTheme = new Signal('');
    this.genResult = new Signal(null);
    this.init();
    this.bindEvents();
    this.renderList();
    this.loadLoras();
  }

  init() {
    this.container.classList.add('prompt-studio');
    this.container.innerHTML = '<div class="view-head"><h1>Prompt Studio</h1><p>Templates textuels réutilisables.</p></div>'
      + '<div class="filters"><input class="chip" id="prompt-search" style="min-width:280px" placeholder="Rechercher…" autocomplete="off"><div class="spacer"></div><span class="faint" id="prompt-count">0 template</span><button class="btn primary" id="btn-new-prompt">+ Nouveau template</button></div>'
      + '<div class="split"><div class="prompt-list-panel"><div class="prompt-list" id="prompt-list"></div></div><div class="prompt-editor-panel"><div class="panel" id="editor-pane"></div></div></div>'
      + '<div class="gen-panel panel"><div class="gen-head"><h2>Générateur de prompts</h2><span class="faint">LoRAs + thème libre</span></div>'
      + '<div class="gen-body"><div class="gen-col"><label class="gen-label">LoRAs à combiner</label><input class="chip" id="gen-lora-search" style="width:100%" placeholder="Filtrer…" autocomplete="off"><div class="gen-lora-list" id="gen-lora-list"><div class="empty"><div class="mt">Chargement…</div></div></div><div class="gen-selected" id="gen-selected"></div></div>'
      + '<div class="gen-col"><label class="gen-label">Thème / mots-clés</label><input type="text" id="gen-theme" placeholder="ex. portrait cinématique"><label class="gen-label">Base modèle</label><select id="gen-base"><option value="">Toutes</option></select>'
      + '<div class="editor-actions" style="margin-top:12px"><button class="btn primary" id="btn-gen">Générer</button><button class="btn ghost" id="btn-gen-clear">Effacer</button></div>'
      + '<div class="gen-result" id="gen-result" hidden><label class="gen-label">Prompt positif</label><textarea id="gen-positive" rows="5" readonly></textarea><label class="gen-label">Prompt négatif</label><textarea id="gen-negative" rows="3" readonly></textarea><div class="editor-actions"><button class="btn ghost" id="btn-gen-copy">Copier</button><button class="btn primary" id="btn-gen-inject">Injecter</button><button class="btn ghost" id="btn-gen-save">Enregistrer</button></div></div>'
      + '<div class="gen-empty" id="gen-empty"><div class="big">✦</div><b>Aucun LoRA sélectionné</b><div class="mt">Choisis un LoRA ou un thème.</div></div></div></div></div>';

    this.listEl = this.container.querySelector('#prompt-list');
    this.editorEl = this.container.querySelector('#editor-pane');
    this.searchInput = this.container.querySelector('#prompt-search');
    this.countEl = this.container.querySelector('#prompt-count');
    this.loraSearch = this.container.querySelector('#gen-lora-search');
    this.loraList = this.container.querySelector('#gen-lora-list');
    this.selectedEl = this.container.querySelector('#gen-selected');
    this.themeInput = this.container.querySelector('#gen-theme');
    this.baseSelect = this.container.querySelector('#gen-base');
    this.resultBox = this.container.querySelector('#gen-result');
    this.emptyBox = this.container.querySelector('#gen-empty');
    this.positiveOut = this.container.querySelector('#gen-positive');
    this.negativeOut = this.container.querySelector('#gen-negative');
    this.emptyEditor();
  }

  bindEvents() {
    let t = null;
    this.searchInput.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { this.searchQuery.value = e.target.value.trim().toLowerCase(); this.renderList(); }, 120);
    });
    this.container.querySelector('#btn-new-prompt').addEventListener('click', () => this.createNew());
    this.listEl.addEventListener('click', (e) => {
      const item = e.target.closest('.prompt-item');
      if (!item) return;
      if (e.target.closest('[data-action="inject"]')) this.inject(item.dataset.id);
      else this.select(item.dataset.id);
    });
    this.loraSearch.addEventListener('input', () => this.renderLoraPicker());
    this.themeInput.addEventListener('input', (e) => { this.genTheme.value = e.target.value; });
    this.baseSelect.addEventListener('change', () => this.renderLoraPicker());
    this.container.querySelector('#btn-gen').addEventListener('click', () => this.generate());
    this.container.querySelector('#btn-gen-clear').addEventListener('click', () => this.clearSelection());
    this.container.querySelector('#btn-gen-copy').addEventListener('click', () => this.copyGenerated());
    this.container.querySelector('#btn-gen-inject').addEventListener('click', () => this.injectGenerated());
    this.container.querySelector('#btn-gen-save').addEventListener('click', () => this.saveGeneratedAsTemplate());
  }

  createNew() {
    const tpl = { id: 'tpl-' + Date.now().toString(36), title: 'Nouveau template', positive: '', negative: '', tags: [], createdAt: Date.now() };
    this.templates.value = [...this.templates.value, tpl];
    this.searchQuery.value = '';
    this.searchInput.value = '';
    this.select(tpl.id);
    Events.prompt.emit('prompt:saved', { count: this.templates.value.length });
  }

  select(id) { this.selectedId.value = id; this.renderList(); this.renderEditor(); }

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
    Events.ui.emit('ui:toast', { message: 'Template enregistre', type: 'success' });
    this.renderList();
  }

  remove(id) {
    const tpl = this.templates.value.find(t => t.id === id);
    this.templates.value = this.templates.value.filter(t => t.id !== id);
    if (this.selectedId.value === id) this.selectedId.value = null;
    Events.ui.emit('ui:toast', { message: 'Template supprime', type: 'info' });
    this.renderList();
    this.emptyEditor();
  }

  async copyPositive() {
    const tpl = this.templates.value.find(t => t.id === this.selectedId.value);
    if (!tpl) return;
    try { await navigator.clipboard.writeText(tpl.positive); Events.ui.emit('ui:toast', { message: 'Copie OK', type: 'success' }); }
    catch { Events.ui.emit('ui:toast', { message: 'Copie refusee', type: 'error' }); }
  }

  inject(id) {
    const tpl = this.templates.value.find(t => t.id === id);
    if (!tpl) return;
    Events.prompt.emit('prompt:inject', { positive: tpl.positive, negative: tpl.negative });
    Events.ui.emit('ui:toast', { message: 'Injecte dans le Mode App', type: 'success' });
    Events.ui.emit('ui:switch-view', { view: 'app' });
  }

  async loadLoras() {
    try {
      const r = await fetch('/api/lora-index');
      const j = await r.json();
      this.loras = j.items || [];
      this.populateBaseSelect();
      this.renderLoraPicker();
    } catch (e) {
      this.loraList.innerHTML = '<div class="empty"><div class="mt">Index LoRA indisponible.</div></div>';
    }
  }

  populateBaseSelect() {
    const bases = [...new Set(this.loras.map(l => l.base).filter(Boolean))].sort();
    for (const b of bases) {
      const opt = document.createElement('option');
      opt.value = b; opt.textContent = b;
      this.baseSelect.appendChild(opt);
    }
  }

  filteredLoras() {
    const q = this.loraQuery.value.toLowerCase().trim();
    const base = this.baseSelect.value;
    return this.loras.filter(l => {
      if (base && l.base !== base) return false;
      if (!q) return true;
      const hay = [l.display, l.name, l.trigger, ...(l.triggers || []), ...(l.tags || [])].join(' ').toLowerCase();
      return hay.includes(q);
    }).slice(0, 60);
  }

  renderLoraPicker() {
    this.loraQuery.value = this.loraSearch.value.trim().toLowerCase();
    const rows = this.filteredLoras();
    if (!rows.length) { this.loraList.innerHTML = '<div class="empty"><div class="mt">Aucun LoRA.</div></div>'; return; }
    this.loraList.innerHTML = rows.map(l => {
      const sel = this.selectedLoras.has(l.name);
      const trig = (l.triggers && l.triggers.length) ? l.triggers[0] : (l.trigger || '');
      return '<label class="gen-lora-row ' + (sel ? 'sel' : '') + '">'
        + '<input type="checkbox" data-name="' + esc(l.name) + '" ' + (sel ? 'checked' : '') + '>'
        + '<span class="gen-lora-name">' + esc(l.display || l.name) + '</span>'
        + (trig ? ' <span class="gen-lora-trig">' + esc(trig) + '</span>' : '')
        + '</label>';
    }).join('');
    this.loraList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => this.toggleLora(cb.dataset.name, cb.checked));
    });
    this.renderSelectedChips();
  }

  toggleLora(name, on) {
    if (on) this.selectedLoras.add(name); else this.selectedLoras.delete(name);
    this.renderLoraPicker();
  }

  clearSelection() {
    this.selectedLoras.clear();
    this.themeInput.value = '';
    this.genTheme.value = '';
    this.resultBox.hidden = true;
    this.emptyBox.hidden = false;
    this.renderLoraPicker();
  }

  generate() {
    const selected = this.loras.filter(l => this.selectedLoras.has(l.name));
    const theme = this.themeInput.value.trim();
    if (!selected.length && !theme) {
      Events.ui.emit('ui:toast', { message: 'Selectionne un LoRA ou un theme', type: 'info' });
      return;
    }
    const triggers = [];
    const seen = new Set();
    for (const l of selected) {
      const ts = (l.triggers && l.triggers.length) ? l.triggers : (l.trigger ? [l.trigger] : []);
      for (const t of ts) {
        const k = String(t).trim().toLowerCase();
        if (k && !seen.has(k)) { seen.add(k); triggers.push(t.trim()); }
      }
    }
    let tags = [];
    if (selected.length === 1) tags = [...(selected[0].tags || [])];
    else if (selected.length > 1) {
      const sets = selected.map(l => new Set((l.tags || []).map(t => String(t).toLowerCase())));
      tags = [...sets[0]].filter(t => sets.every(s => s.has(t)));
    }
    const parts = [];
    if (theme) parts.push(theme);
    parts.push(...triggers);
    if (tags.length) parts.push(...tags.map(t => '(' + t + ':1.1)'));
    const finalParts = [];
    const seenP = new Set();
    for (const p of parts) {
      const k = String(p).trim().toLowerCase();
      if (k && !seenP.has(k)) { seenP.add(k); finalParts.push(p.trim()); }
    }
    const positive = finalParts.join(', ');
    const negative = DEFAULT_NEGATIVE;
    this.genResult.value = { positive, negative };
    this.positiveOut.value = positive;
    this.negativeOut.value = negative;
    this.resultBox.hidden = false;
    this.emptyBox.hidden = true;
    Events.ui.emit('ui:toast', { message: 'Prompt genere (' + selected.length + ' LoRA) OK', type: 'success' });
  }

  renderSelectedChips() {
    if (!this.selectedLoras.size) { this.selectedEl.innerHTML = ''; return; }
    const names = [...this.selectedLoras];
    this.selectedEl.innerHTML = names.map(n => {
      const l = this.loras.find(x => x.name === n);
      return '<span class="chip sm gen-chip" data-name="' + esc(n) + '">' + esc(l && l.display || n) + ' <button data-rm="' + esc(n) + '" aria-label="retirer">x</button></span>';
    }).join('');
    this.selectedEl.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); this.toggleLora(b.dataset.rm, false); });
    });
  }

  async copyGenerated() {
    const r = this.genResult.value;
    if (!r) return;
    try { await navigator.clipboard.writeText(r.positive); Events.ui.emit('ui:toast', { message: 'Copie OK', type: 'success' }); }
    catch { Events.ui.emit('ui:toast', { message: 'Copie refusee', type: 'error' }); }
  }

  injectGenerated() {
    const r = this.genResult.value;
    if (!r) return;
    Events.prompt.emit('prompt:inject', { positive: r.positive, negative: r.negative });
    Events.ui.emit('ui:toast', { message: 'Prompt genere injecte', type: 'success' });
    Events.ui.emit('ui:switch-view', { view: 'app' });
  }

  saveGeneratedAsTemplate() {
    const r = this.genResult.value;
    if (!r) return;
    const tpl = { id: 'tpl-' + Date.now().toString(36), title: 'Prompt genere', positive: r.positive, negative: r.negative, tags: ['generated'], createdAt: Date.now() };
    this.templates.value = [...this.templates.value, tpl];
    Events.prompt.emit('prompt:saved', { count: this.templates.value.length });
    Events.ui.emit('ui:toast', { message: 'Enregistre comme template', type: 'success' });
    this.renderList();
  }

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
    this.editorEl.innerHTML = '<div class="empty"><div class="big">+</div><b>Aucun template selectionne</b><div class="mt">Choisis un template a gauche.</div></div>';
  }

  renderList() {
    const rows = this.filtered();
    this.countEl.textContent = rows.length + ' template' + (rows.length > 1 ? 's' : '');
    if (!rows.length) {
      this.listEl.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="big">+</div><b>Aucun template</b></div>';
      return;
    }
    const sel = this.selectedId.value;
    this.listEl.innerHTML = rows.map(t => '<article class="prompt-item ' + (t.id === sel ? 'active' : '') + '" data-id="' + esc(t.id) + '"><div class="prompt-item-head"><b>' + esc(t.title) + '</b><button class="btn sm ghost" data-action="inject">Injecter</button></div><div class="prompt-preview">' + esc((t.positive || '').slice(0, 90)) + '</div></article>').join('');
  }

  renderEditor() {
    const t = this.templates.value.find(x => x.id === this.selectedId.value);
    if (!t) { this.emptyEditor(); return; }
    this.editorEl.innerHTML = '<div class="editor-form"><div class="field"><label>Titre</label><input type="text" id="edit-title" value="' + esc(t.title) + '"></div>'
      + '<div class="field"><label>Prompt positif</label><textarea id="edit-positive" rows="6">' + esc(t.positive) + '</textarea></div>'
      + '<div class="field"><label>Prompt negatif</label><textarea id="edit-negative" rows="3">' + esc(t.negative) + '</textarea></div>'
      + '<div class="field"><label>Tags</label><input type="text" id="edit-tags" value="' + esc((t.tags || []).join(', ')) + '"></div>'
      + '<div class="editor-actions"><button class="btn ghost" id="btn-save">Enregistrer</button><button class="btn ghost" id="btn-copy">Copier</button><span class="spacer"></span><button class="btn danger" id="btn-delete">Supprimer</button><button class="btn primary" id="btn-inject">Injecter</button></div></div>';
    this.editorEl.querySelector('#btn-save').onclick = () => this.save();
    this.editorEl.querySelector('#btn-copy').onclick = () => this.copyPositive();
    this.editorEl.querySelector('#btn-delete').onclick = () => { if (confirm('Supprimer ?')) this.remove(t.id); };
    this.editorEl.querySelector('#btn-inject').onclick = () => this.inject(t.id);
  }
}

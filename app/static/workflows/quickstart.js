/**
 * Flux Studio v2 — Panneau « Workflows prêts à l'emploi »
 * Une carte = un modèle installé. Un clic = graphe complet câblé.
 */

import { WorkflowCatalog, checkAvailable } from './catalog.js';
import { applyCatalogWorkflow, setModels, primeModels } from './builder.js';
import { graph } from '../editor/graph.js';
import { Events } from '../core/events.js';

export class QuickStartPanel {
  constructor(container, deps = {}) {
    this.container = container;
    this.deps = deps;
    this.filter = 'all';
    this.models = {};
    this.el = null;
  }

  init() {
    this.container.className = 'quickstart';
    this.container.innerHTML = `
      <div class="qs-head">
        <h3>Workflows prêts à l'emploi</h3>
        <div class="qs-filters" id="qsFilters"></div>
      </div>
      <div class="qs-list" id="qsList"></div>
    `;
    this.listEl = this.container.querySelector('#qsList');
    this.filtersEl = this.container.querySelector('#qsFilters');
    this.renderFilters();
    this.render();
  }

  async loadModels() {
    try {
      const r = await fetch('/api/comfyui/models');
      this.models = await r.json();
      // Alimente le builder : les noms de fichiers seront alors convertis
      // dans le format EXACT attendu par ComfyUI (separateurs "\" sous
      // Windows), sinon /prompt les refuse.
      setModels(this.models);
      this.render();
    } catch (e) {
      console.warn('[quickstart] catalogue indisponible', e);
    }
  }

  get modelsList() {
    return Object.keys(this.models);
  }

  renderFilters() {
    const models = [...new Set(WorkflowCatalog.map(w => w.model))];
    this.filtersEl.innerHTML = ['all', ...models].map(m =>
      `<button class="qs-chip ${this.filter === m ? 'on' : ''}" data-f="${esc(m)}">${m === 'all' ? 'Tout' : esc(m)}</button>`
    ).join('');
    this.filtersEl.querySelectorAll('.qs-chip').forEach(b => {
      b.onclick = () => { this.filter = b.dataset.f; this.renderFilters(); this.render(); };
    });
  }

  render() {
    const list = this.filter === 'all'
      ? WorkflowCatalog
      : WorkflowCatalog.filter(w => w.model === this.filter);

    this.listEl.innerHTML = list.map(w => {
      const chk = checkAvailable(w, this.models);
      return `
        <div class="qs-card ${chk.ok ? '' : 'unavailable'}" data-id="${w.id}">
          <div class="qs-icon">${w.icon || '◈'}</div>
          <div class="qs-body">
            <div class="qs-name">
              ${esc(w.name)}
              ${w.tested ? '<span class="qs-badge ok" title="Testé et validé de bout en bout">✓ testé</span>' : ''}
              ${w.slow ? `<span class="qs-badge slow" title="L'encodeur de texte domine le temps de calcul">⏱ ${esc(w.eta || 'lent')}</span>` : ''}
              ${chk.ok ? '' : '<span class="qs-badge warn" title="Fichier manquant">fichier manquant</span>'}
            </div>
            <div class="qs-desc">${esc(w.desc)}</div>
            <div class="qs-meta">
              ${w.size && w.size !== 'auto' ? `<span>${esc(w.size)}</span>` : ''}
              ${w.steps ? `<span>${w.steps} steps</span>` : ''}
              ${w.cfg !== undefined ? `<span>CFG ${w.cfg}</span>` : ''}
              ${(w.loras || []).length ? `<span>${w.loras.length} LoRA</span>` : ''}
            </div>
            ${chk.missing.length ? `<div class="qs-missing">${chk.missing.map(m => esc(m)).join('<br>')}</div>` : ''}
          </div>
          <button class="btn primary sm qs-apply" data-id="${w.id}" ${chk.ok ? '' : 'disabled'}>
            Appliquer
          </button>
        </div>
      `;
    }).join('');

    this.listEl.querySelectorAll('.qs-apply').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.apply(btn.dataset.id);
      };
    });
    this.listEl.querySelectorAll('.qs-card').forEach(card => {
      card.onclick = () => this.apply(card.dataset.id);
    });
  }

  apply(id) {
    try {
      const res = applyCatalogWorkflow(id);
      // Rafraichit l'editeur
      Events.graph.emit('graph:loaded', {});
      const v = graph.validate();
      const wf = WorkflowCatalog.find(w => w.id === id);
      const msg = `${wf.name} appliqué — ${res.nodes} nœuds, ${res.edges} liens`
        + (v.valid ? '' : ` ⚠ ${v.errors.length} problème(s)`);
      if (this.deps.toast) this.deps.toast(msg, v.valid ? 'info' : 'error');
      // Centre la vue
      Events.canvas.emit('canvas:fit');
      return res;
    } catch (e) {
      if (this.deps.toast) this.deps.toast('Erreur : ' + e.message, 'error');
      throw e;
    }
  }

  destroy() {
    this.container.innerHTML = '';
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function createQuickStart(container, deps) {
  const p = new QuickStartPanel(container, deps);
  p.init();
  p.loadModels();
  return p;
}
/**
 * Flux Studio v2 — Interface de la palette de mots-clés (Ctrl+K)
 */

import { LoraIndex, searchLoras, applyLora, writeTrigger, currentGraphBase } from './palette.js';
import { Events } from '../core/events.js';

export class LoraPalette {
  constructor() {
    this.el = null;
    this.query = '';
    this.base = 'auto';
    this.selected = 0;
    this.results = [];
    this.showIncompatible = false;
  }

  async open() {
    await LoraIndex.load();
    this.build();
    this.el.style.display = 'flex';
    this.input.focus();
    this.input.value = '';
    this.query = '';
    this.base = currentGraphBase() || 'auto';
    this.run();
  }

  close() {
    if (this.el) this.el.style.display = 'none';
  }

  build() {
    if (this.el) return;
    const wrap = document.createElement('div');
    wrap.className = 'lora-palette';
    wrap.setAttribute('role','dialog');
    wrap.setAttribute('aria-modal','true');
    wrap.setAttribute('aria-label','Palette LoRA');
    wrap.style.display = 'none';
    wrap.innerHTML = `
      <div class="lp-scrim"></div>
      <div class="lp-box">
        <div class="lp-input-row">
          <span class="lp-icon">✦</span>
          <input class="lp-input" placeholder="Tape un mot : vantablack, lingerie, skin, realiste…"
                 autocomplete="off" spellcheck="false">
          <span class="lp-count"></span>
        </div>
        <div class="lp-bases"></div>
        <div class="lp-results"></div>
        <div class="lp-foot">
          <span><kbd>↑↓</kbd> naviguer</span>
          <span><kbd>↵</kbd> poser le LoRA + écrire le trigger</span>
          <span><kbd>Échap</kbd> fermer</span>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    this.el = wrap;
    this.input = wrap.querySelector('.lp-input');
    this.resultsEl = wrap.querySelector('.lp-results');
    this.countEl = wrap.querySelector('.lp-count');
    this.basesEl = wrap.querySelector('.lp-bases');

    wrap.querySelector('.lp-scrim').onclick = () => this.close();
    this.input.oninput = () => { this.query = this.input.value; this.selected = 0; this.run(); };
    this.input.onkeydown = (e) => this.onKey(e);
  }

  run() {
    const baseFilter = this.base === 'auto' ? currentGraphBase() : (this.base === 'all' ? null : this.base);
    this.results = searchLoras(this.query, { base: baseFilter, limit: 50, showIncompatible: this.showIncompatible });
    this.renderBases(baseFilter);
    this.renderResults();
  }

  renderBases(activeBase) {
    const counts = new Map();
    for (const i of LoraIndex.items) {
      const b = i.base || 'Inconnu';
      counts.set(b, (counts.get(b) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

    // [cle, libelle, effectif]
    const rows = [['auto', '◎ Compatible avec le modèle',
      activeBase ? (counts.get(activeBase) || 0) : LoraIndex.items.length]];
    for (const [base, n] of top) rows.push([base, base || 'Inconnu', n]);

    this.basesEl.innerHTML = rows.map(([key, label, n]) => `
      <button class="lp-base ${this.base === key ? 'on' : ''}" data-b="${esc(key)}">
        ${esc(label)} <span>${n}</span>
      </button>`).join('') +
      `<button class="lp-base lp-toggle-incompat ${this.showIncompatible ? 'on' : ''}" data-action="toggle-incompat">
        ${this.showIncompatible ? '✓' : '⚠'} Incompatibles
      </button>`;
    this.basesEl.querySelectorAll('.lp-base').forEach(el => {
      if (el.dataset.action === 'toggle-incompat') {
        el.onclick = () => { this.showIncompatible = !this.showIncompatible; this.selected = 0; this.run(); };
      } else {
        el.onclick = () => { this.base = el.dataset.b; this.selected = 0; this.run(); };
      }
    });
  }

  renderResults() {
    const q = this.query.trim();
    this.countEl.textContent = `${this.results.length}`;

    if (!this.results.length) {
      this.resultsEl.innerHTML = `<div class="lp-empty">Aucun LoRA ne correspond à « ${esc(q)} »<br><small>Essaie un mot-clé en anglais, ou browse les compatibles.</small></div>`;
      return;
    }

    this.resultsEl.innerHTML = this.results.map((r, i) => {
      const trig = r.triggers && r.triggers.length
        ? `<span class="lp-trig">${esc(r.triggers.slice(0, 2).join(', '))}</span>`
        : `<span class="lp-trig none">sans trigger</span>`;
      const tags = (r.tags || []).slice(0, 4).map(t => `<span class="lp-tag">${esc(t)}</span>`).join('');
      const prev = r.has_preview
        ? `<img class="lp-prev" loading="lazy" alt="" src="/api/lora-preview?path=${encodeURIComponent(r.webPath || r.path)}">`
        : '';
      return `
        <div class="lp-row ${i === this.selected ? 'sel' : ''}" role="button" tabindex="0" data-i="${i}">
          ${prev}
          <div class="lp-info">
            <div class="lp-name">${esc(r.display || r.name)}</div>
            <div class="lp-sub">${trig}<span class="lp-base-tag">${esc(r.base || '?')}</span>${r._incompatible ? `<span class="lp-warn" title="${esc(r._incompatibleReason)}">⚠️ incompatible</span>` : ''}${tags}</div>
          </div>
          <div class="lp-stat">${r.rating ? '★ ' + r.rating : (r.downloads ? '↓ ' + r.downloads : '')}</div>
        </div>`;
    }).join('');

    this.resultsEl.querySelectorAll('.lp-row').forEach(el => {
      const i = +el.dataset.i;
      el.onmouseenter = () => { this.selected = i; this.syncSel(); };
      el.ondblclick = () => this.commit(i);
      el.onclick = () => { this.selected = i; this.syncSel(); };
    });
    this.syncSel();
  }

  syncSel() {
    this.resultsEl.querySelectorAll('.lp-row').forEach((el, i) =>
      el.classList.toggle('sel', i === this.selected));
    const sel = this.resultsEl.querySelector('.lp-row.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  onKey(e) {
    if (e.key === 'Escape') { this.close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.selected = Math.min(this.selected + 1, this.results.length - 1); this.syncSel(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); this.selected = Math.max(this.selected - 1, 0); this.syncSel(); return; }
    if (e.key === 'Enter') { e.preventDefault(); this.commit(this.selected); }
  }

  commit(i) {
    const r = this.results[i];
    if (!r) return;
    try {
      applyLora(r.path, 0.8);
      let txt = null;
      const trig = (r.triggers && r.triggers[0]) || r.name;
      if (trig) txt = writeTrigger(trig, 0.9);
      const msg = txt
        ? `LoRA posé + « ${trig} » ajouté au prompt`
        : `LoRA posé (pas de trigger connu)`;
      if (window.showToast) window.showToast(msg);
      this.close();
    } catch (err) {
      if (window.showToast) window.showToast(err.message, 'error');
    }
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let instance = null;
export function openLoraPalette() {
  if (!instance) instance = new LoraPalette();
  instance.open();
}
export function initLoraPalette() {
  if (!instance) instance = new LoraPalette();
  return instance;
}


document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const el = document.querySelector('.lora-palette');
    if (el && el.style.display !== 'none') { el.style.display = 'none'; }
  }
});

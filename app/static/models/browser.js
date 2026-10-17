/**
 * Flux Studio v2 — Models Browser
 * Local models scanner, Civitai search, one-click install to ComfyUI
 */

import { Signal, effect, derived } from '../core/state.js';
import { bus, Events } from '../core/events.js';
import { api } from '../core/api.js';

export class ModelBrowser {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    
    this.localModels = new Signal([]);
    this.civitaiResults = new Signal([]);
    this.selected = new Signal(new Set());
    this.loading = new Signal(false);
    this.activeTab = new Signal('installed'); // installed, search, downloads
    let savedM = {};
    try { savedM = JSON.parse(localStorage.getItem('filter:models') || '{}'); } catch (e) {}
    this.filters = new Signal({
      type: savedM.type || '',
      base: savedM.base || '',
      search: savedM.search || '',
    });
    this.downloads = new Signal([]);
    
    this.init();
    this.bindEvents();
    this.loadLocal();
  }

  init() {
    this.container.className = 'model-browser';
    this.container.innerHTML = `
      <div class="model-browser-tabs">
        <button class="tab-btn active" data-tab="installed">📦 Installed</button>
        <button class="tab-btn" data-tab="search">🔍 Search Civitai</button>
        <button class="tab-btn" data-tab="downloads">⬇ Downloads</button>
      </div>
      
      <div class="model-browser-panels">
        <!-- Installed Tab -->
        <div class="panel" data-panel="installed">
          <div class="model-filters">
            <input type="text" class="filter-input" placeholder="Filter installed models..." data-filter="search">
            <select class="filter-select" data-filter="type">
              <option value="">All Types</option>
              <option value="LORA">LoRA</option>
              <option value="Checkpoint">Checkpoint</option>
              <option value="VAE">VAE</option>
              <option value="ControlNet">ControlNet</option>
              <option value="Embedding">Embedding</option>
            </select>
            <select class="filter-select" data-filter="base">
              <option value="">All Bases</option>
            </select>
            <button class="btn primary" id="rescanBtn">↻ Rescan</button>
          </div>
          <div class="model-table-container">
            <table class="model-table">
              <thead>
                <tr>
                  <th><input type="checkbox" id="selectAll"></th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Base</th>
                  <th>Size</th>
                  <th>Folder</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="localModelsBody"></tbody>
            </table>
          </div>
        </div>
        
        <!-- Search Tab -->
        <div class="panel" data-panel="search" style="display:none">
          <div class="model-filters">
            <input type="text" class="filter-input" placeholder="Search Civitai (LoRA, checkpoint, workflow...)" id="civSearch">
            <select class="filter-select" id="civType">
              <option value="">All Types</option>
              <option value="LORA">LoRA</option>
              <option value="Checkpoint">Checkpoint</option>
              <option value="Workflows">Workflows</option>
              <option value="ControlNet">ControlNet</option>
              <option value="VAE">VAE</option>
              <option value="Embedding">Embedding</option>
            </select>
            <select class="filter-select" id="civBase">
              <option value="">All Bases</option>
            </select>
            <label class="switch"><input type="checkbox" id="civWomen" checked><span>♀ Women Only</span></label>
            <button class="btn primary" id="civSearchBtn">Search</button>
          </div>
          <div class="civitai-results" id="civResults"></div>
        </div>
        
        <!-- Downloads Tab -->
        <div class="panel" data-panel="downloads" style="display:none">
          <div id="downloadsList"></div>
        </div>
      </div>
    `;
    
    this.tabs = this.container.querySelectorAll('.tab-btn');
    this.panels = this.container.querySelectorAll('.panel');
    this.localBody = this.container.querySelector('#localModelsBody');
    this.civResults = this.container.querySelector('#civResults');
    this.downloadsList = this.container.querySelector('#downloadsList');
    this.rescanBtn = this.container.querySelector('#rescanBtn');
    this.civSearchBtn = this.container.querySelector('#civSearchBtn');
    this.civSearchInput = this.container.querySelector('#civSearch');
    
    // Base filter options
    this.baseSelect = this.container.querySelector('[data-filter="base"]');
  }

  bindEvents() {
    // Tabs
    this.tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab.value = btn.dataset.tab;
        this.tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === this.activeTab.value));
        this.panels.forEach(p => p.style.display = p.dataset.panel === this.activeTab.value ? 'block' : 'none');
      });
    });
    
    // Filters
    this.container.querySelectorAll('[data-filter]').forEach(el => {
      el.addEventListener('input', e => {
        const f = this.filters.value;
        f[e.target.dataset.filter] = e.target.value;
        this.filters.value = { ...f };
        try { localStorage.setItem('filter:models', JSON.stringify(this.filters.value)); } catch (e) {}
        this.renderLocal();
      });
    });
    
    // Rescan
    this.rescanBtn.addEventListener('click', () => this.loadLocal(true));
    
    // Civitai search
    this.civSearchBtn.addEventListener('click', () => this.searchCivitai());
    this.civSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.searchCivitai();
    });
    
    // Select all
    this.container.querySelector('#selectAll').addEventListener('change', e => {
      const checked = e.target.checked;
      this.localModels.value.forEach(m => {
        const sel = new Set(this.selected.value);
        if (checked) sel.add(m.id); else sel.delete(m.id);
        this.selected.value = sel;
      });
    });
    
    // Downloads polling
    this.startDownloadPolling();
    
    // Events
    Events.models.on('models:install', (info) => this.installModel(info));
  }

  async loadLocal(force = false) {
    this.loading.value = true;
    try {
      const res = await api.comfy.local(force);
      // Le serveur retourne {checkpoints, loras, vae, clip, ...}
      // On aplatit en un seul tableau avec model_type
      const all = [];
      for (const [type, items] of Object.entries(res)) {
        if (Array.isArray(items)) {
          for (const m of items) {
            all.push({ ...m, model_type: m.model_type || type });
          }
        }
      }
      this.localModels.value = all;
      this.updateBaseFilter();
      this.renderLocal();
    } catch (e) {
      console.error('Load local error:', e);
    } finally {
      this.loading.value = false;
    }
  }

  updateBaseFilter() {
    const bases = [...new Set(this.localModels.value.map(m => m.base_model).filter(Boolean))].sort();
    this.baseSelect.innerHTML = '<option value="">All Bases</option>' + 
      bases.map(b => `<option value="${b}">${b}</option>`).join('');
  }

  renderLocal() {
    const filter = this.filters.value;
    let models = this.localModels.value;
    
    if (filter.search) {
      const s = filter.search.toLowerCase();
      models = models.filter(m => 
        m.name.toLowerCase().includes(s) ||
        m.type.toLowerCase().includes(s) ||
        m.base_model.toLowerCase().includes(s)
      );
    }
    if (filter.type) models = models.filter(m => m.type === filter.type);
    if (filter.base) models = models.filter(m => m.base_model === filter.base);
    
    this.localBody.innerHTML = models.map(m => `
      <tr data-id="${m.id}" class="${this.selected.value.has(m.id) ? 'selected' : ''}">
        <td><input type="checkbox" ${this.selected.value.has(m.id) ? 'checked' : ''}></td>
        <td>
          <div class="model-name-cell">
            <span class="model-type-badge ${m.type.toLowerCase()}">${m.type}</span>
            ${m.name}
            ${m.base_model ? `<span class="base-badge">${m.base_model}</span>` : ''}
          </div>
        </td>
        <td>${m.type}</td>
        <td>${m.base_model || '—'}</td>
        <td>${this.formatSize(m.size_bytes)}</td>
        <td>${m.folder || '—'}</td>
        <td>
          <button class="btn ghost sm" data-action="open-folder" data-path="${m.path}">📁</button>
          <button class="btn ghost sm" data-action="delete" data-id="${m.id}">🗑</button>
        </td>
      </tr>
    `).join('');
    
    // Bind actions
    this.localBody.querySelectorAll('[data-action="open-folder"]').forEach(btn => {
      btn.onclick = () => this.openFolder(btn.dataset.path);
    });
    this.localBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.onclick = () => this.deleteModel(btn.dataset.id);
    });
    this.localBody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        const id = tr.dataset.id;
        const sel = new Set(this.selected.value);
        if (sel.has(id)) sel.delete(id); else sel.add(id);
        this.selected.value = sel;
      });
    });
  }

  async searchCivitai() {
    const q = this.civSearchInput.value.trim();
    const type = this.container.querySelector('#civType').value;
    const base = this.container.querySelector('#civBase').value;
    const women = this.container.querySelector('#civWomen').checked;
    
    this.loading.value = true;
    this.civResults.innerHTML = '<div class="loading">Searching Civitai…</div>';
    
    try {
      const params = { q, limit: 30 };
      if (type) params.type = type;
      if (base) params.base = base;
      if (women) params.men = '0';
      
      const res = await api.comfy.search(params);
      this.civitaiResults.value = res.items || res || [];
      this.renderCivitaiResults();
    } catch (e) {
      this.civResults.innerHTML = `<div class="error">Search failed: ${e.message}</div>`;
    } finally {
      this.loading.value = false;
    }
  }

  renderCivitaiResults() {
    this.civResults.innerHTML = this.civitaiResults.value.map(m => `
      <div class="civitai-result">
        <div class="civitai-thumb">
          ${m.thumbnail ? `<img loading="lazy" src="/api/proxy?url=${encodeURIComponent(m.thumbnail)}" alt="">` : '<div class="placeholder">▣</div>'}
        </div>
        <div class="civitai-info">
          <h4>${m.name}</h4>
          <div class="civitai-meta">
            <span class="badge">${m.type}</span>
            <span>${(m.baseModels || []).join(', ')}</span>
            <span>${(m.downloads || 0).toLocaleString()} dl</span>
          </div>
          <div class="civitai-versions">
            ${(m.versions || []).slice(0, 3).map(v => `
              <div class="version-row">
                <span>${v.name}</span>
                <span>${v.baseModel || ''}</span>
                ${(v.files || []).slice(0, 2).map(f => `
                  <button class="btn sm" data-action="download" data-model="${m.id}" data-version="${v.id}" data-file="${f.id}">
                    ⬇ ${f.name} (${this.formatSize(f.sizeKB * 1024)})
                  </button>
                `).join('')}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `).join('');
    
    // Bind download buttons
    this.civResults.querySelectorAll('[data-action="download"]').forEach(btn => {
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'Downloading…';
        try {
          await api.comfy.download({
            model_id: +btn.dataset.model,
            version_id: +btn.dataset.version,
            file_id: +btn.dataset.file,
          });
          this.showToast('Download started');
          this.loadDownloads();
        } catch (e) {
          this.showToast('Download failed: ' + e.message, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = '⬇ Download';
        }
      };
    });
  }

  async loadDownloads() {
    try {
      const list = await api.comfy.downloads();
      this.downloads.value = list;
      this.renderDownloads();
    } catch (e) {
      console.error('Load downloads error:', e);
    }
  }

  renderDownloads() {
    this.downloadsList.innerHTML = this.downloads.value.length ? this.downloads.value.map(d => `
      <div class="download-item ${d.status}">
        <div class="dl-info">
          <strong>${d.name || d.filename || d.id}</strong>
          <span class="badge ${this.getStatusClass(d.status)}">${this.getStatusLabel(d.status)}</span>
        </div>
        <div class="dl-progress">
          <div class="progress-bar"><div style="width:${d.total_bytes ? Math.round(100 * d.downloaded_bytes / d.total_bytes) : 0}%"></div></div>
          <span>${this.formatSize(d.downloaded_bytes)} / ${this.formatSize(d.total_bytes)}</span>
        </div>
        ${d.error ? `<div class="dl-error">${d.error}</div>` : ''}
      </div>
    `).join('') : '<div class="empty">No active downloads</div>';
  }

  getStatusClass(s) {
    const map = { completed: 'none', done: 'none', downloading: 'soft', pending: 'soft', error: 'x' };
    return map[s] || 'soft';
  }

  getStatusLabel(s) {
    const map = { completed: 'Done', done: 'Done', downloading: 'Downloading', pending: 'Pending', queued: 'Queued', error: 'Error' };
    return map[s] || s;
  }

  async installModel(info) {
    // Called from Civitai search or manual
    this.showToast('Installing…');
    // Implementation depends on ComfyUI API
  }

  async deleteModel(id) {
    if (!confirm('Supprimer ce modèle ?')) return;
    const model = this.localModels.value.find(m => m.filepath === id);
    if (!model) return;
    try {
      const r = await fetch('/api/comfyui/delete-model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath: model.filepath })
      }).then(r => r.json());
      if (r.ok) {
        this.showToast('Modèle supprimé');
        this.loadLocal(true);
      } else {
        this.showToast('Erreur : ' + (r.error || 'inconnue'), 'error');
      }
    } catch (e) {
      this.showToast('Erreur : ' + e.message, 'error');
    }
  }

  async openFolder(path) {
    try {
      const r = await fetch('/api/comfyui/open-folder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: path })
      }).then(r => r.json());
      if (!r.ok) this.showToast('Erreur : ' + (r.error || 'inconnue'), 'error');
    } catch (e) {
      this.showToast('Erreur : ' + e.message, 'error');
    }
  }

  startDownloadPolling() {
    setInterval(() => {
      if (this.activeTab.value === 'downloads') this.loadDownloads();
    }, 3000);
  }

  formatSize(bytes) {
    if (!bytes) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(i ? 1 : 0) + ' ' + units[i];
  }

  showToast(msg, type = 'info') {
    if (window.showToast) window.showToast(msg, type);
  }

  destroy() {
    this.container.innerHTML = '';
  }
}

export function createModelBrowser(container, options) {
  return new ModelBrowser(container, options);
}
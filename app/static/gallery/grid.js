/**
 * Flux Studio v2 — Gallery Module
 * Masonry grid, virtual scroll, fullscreen viewer, batch queue, favorites
 */

import { Signal, effect, derived } from '../core/state.js';
import { bus, Events } from '../core/events.js';
import { api } from '../core/api.js';
import { images, queueHistory } from '../core/storage.js';
import { graph, graphToComfyUI } from '../editor/graph.js';
import { WorkflowCatalog } from '../workflows/catalog.js';
import { applyCatalogWorkflow, setModels, primeModels } from '../workflows/builder.js';

const fmtBytes = (b) => { b = +b || 0; const u = ["o", "Ko", "Mo", "Go", "To"]; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + " " + u[i]; };

export class Gallery {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    
    this.items = new Signal([]);
    this.filtered = new Signal([]);
    this.selected = new Signal(new Set());
    this.viewMode = new Signal('grid'); // grid, list
    this.sortBy = new Signal('createdAt'); // createdAt, size, model
    this.sortDir = new Signal('desc');
    this.page = new Signal(0);
    this.pageSize = 48;
    this.loading = new Signal(false);
    this.hasMore = new Signal(true);
    let savedF = {};
    try { savedF = JSON.parse(localStorage.getItem('filter:gallery') || '{}'); } catch (e) {}
    this.filters = new Signal({
      baseModel: savedF.baseModel || '',
      favorite: savedF.favorite || false,
      nsfw: savedF.nsfw || false,
      modelId: savedF.modelId || '',
    });
    
    this.viewer = null;
    this.queue = null;
    
    this.init();
    this.bindEvents();
    this.load();
  }

  init() {
    this.container.className = 'gallery';
    this.container.innerHTML = `
      <div class="gallery-toolbar">
        <div class="gallery-filters">
          <select class="filter-select" data-filter="baseModel">
            <option value="">All Bases</option>
          </select>
          <select class="filter-select" data-filter="modelId">
            <option value="">All Models</option>
          </select>
          <label class="filter-toggle"><input type="checkbox" data-filter="favorite"> ★ Favorites</label>
          <label class="filter-toggle"><input type="checkbox" data-filter="nsfw"> NSFW</label>
        </div>
        <div class="gallery-sort">
          <select class="sort-select" data-sort="sortBy">
            <option value="createdAt">Date</option>
            <option value="size">Size</option>
            <option value="model">Model</option>
          </select>
          <button class="btn ghost sm" data-sort="dir" title="Toggle sort direction">⬇</button>
          <select class="view-select" data-view="mode">
            <option value="grid">Grid</option>
            <option value="list">List</option>
          </select>
        </div>
      </div>
      <div class="gallery-grid"></div>
      <div class="gallery-load-more">
        <button class="btn primary" id="loadMoreBtn">Load More</button>
      </div>
    `;
    
    this.gridEl = this.container.querySelector('.gallery-grid');
    this.loadMoreBtn = this.container.querySelector('#loadMoreBtn');
    this.baseModelSelect = this.container.querySelector('[data-filter="baseModel"]');
    this.modelIdSelect = this.container.querySelector('[data-filter="modelId"]');
  }

  bindEvents() {
    // Filters
    this.container.querySelectorAll('.filter-select').forEach(sel => {
      sel.addEventListener('change', e => {
        const f = this.filters.value;
        f[e.target.dataset.filter] = e.target.value;
        this.filters.value = { ...f };
        try { localStorage.setItem('filter:gallery', JSON.stringify(this.filters.value)); } catch (e) {}
        this.page.value = 0;
        this.load();
      });
    });
    
    this.container.querySelectorAll('.filter-toggle input').forEach(cb => {
      cb.addEventListener('change', e => {
        const f = this.filters.value;
        f[e.target.dataset.filter] = e.target.checked;
        this.filters.value = { ...f };
        try { localStorage.setItem('filter:gallery', JSON.stringify(this.filters.value)); } catch (e) {}
        this.page.value = 0;
        this.load();
      });
    });
    
    // Sort
    this.container.querySelector('[data-sort="sortBy"]').addEventListener('change', e => {
      this.sortBy.value = e.target.value;
      this.render();
    });
    
    this.container.querySelector('[data-sort="dir"]').addEventListener('click', () => {
      this.sortDir.value = this.sortDir.value === 'asc' ? 'desc' : 'asc';
      this.render();
    });
    
    // View mode
    this.container.querySelector('[data-view="mode"]').addEventListener('change', e => {
      this.viewMode.value = e.target.value;
      this.render();
    });
    
    // Load more
    this.loadMoreBtn.addEventListener('click', () => {
      this.page.value++;
      this.load(true);
    });
    
    // Selection
    this.gridEl.addEventListener('click', e => {
      const item = e.target.closest('.gallery-item');
      if (!item) return;
      
      const id = item.dataset.id;
      const shift = e.shiftKey;
      const ctrl = e.ctrlKey || e.metaKey;
      
      if (shift) {
        // Range selection - would need ordered list
      } else if (ctrl) {
        const sel = new Set(this.selected.value);
        if (sel.has(id)) sel.delete(id); else sel.add(id);
        this.selected.value = sel;
      } else {
        this.selected.value = new Set([id]);
      }
      
      this.renderSelection();
    });
    
    // Double click to view
    this.gridEl.addEventListener('dblclick', e => {
      const item = e.target.closest('.gallery-item');
      if (item) this.openViewer(item.dataset.id);
    });
    
    // Keyboard
    window.addEventListener('keydown', e => {
      if (this.container.contains(document.activeElement) || e.target.tagName === 'INPUT') return;
      
      if (e.key === 'Escape') {
        this.selected.value.clear();
        this.renderSelection();
      } else if (e.key === 'Enter' && this.selected.value.size === 1) {
        this.openViewer(Array.from(this.selected.value)[0]);
      } else if (e.key === 'Delete') {
        this.deleteSelected();
      }
    });
    
    // Events
    Events.gallery.on('gallery:refresh', () => this.load());
    Events.gallery.on('gallery:add', (item) => this.addItem(item));
  }

  async load(append = false) {
    if (this.loading.value) return;
    this.loading.value = true;
    this.loadMoreBtn.disabled = true;
    this.loadMoreBtn.textContent = 'Loading…';
    
    try {
      const filter = this.filters.value;
      const params = {
        limit: this.pageSize,
        offset: this.page.value * this.pageSize,
      };
      
      if (filter.baseModel) params.base_model = filter.baseModel;
      if (filter.nsfw) params.nsfw_max = '1'; // Only safe
      
      // Load from IndexedDB first (local)
      const local = await images.list({ 
        baseModel: filter.baseModel || undefined,
        favorite: filter.favorite || undefined,
        limit: this.pageSize,
      });
      
      // Also load from API if needed
      let apiItems = [];
      try {
        const res = await api.images(params);
        apiItems = res.items || res || [];
      } catch {}
      
      // Merge and deduplicate
      const all = [...local, ...apiItems];
      const seen = new Set();
      const unique = all.filter(i => {
        const key = i.civitai_image_id || i.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      
      // Apply client-side filters
      let filtered = unique.filter(i => {
        if (filter.favorite && !i.favorite) return false;
        if (filter.modelId && i.model_id !== filter.modelId) return false;
        return true;
      });
      
      // Sort
      filtered.sort((a, b) => {
        const dir = this.sortDir.value === 'asc' ? 1 : -1;
        let av = a[this.sortBy.value] || 0;
        let bv = b[this.sortBy.value] || 0;
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
        return (av > bv ? 1 : -1) * dir;
      });
      
      if (append) {
        this.items.value = [...this.items.value, ...filtered];
      } else {
        this.items.value = filtered;
      }
      
      this.hasMore.value = filtered.length >= this.pageSize;
      this.render();
      
      // Update filter options
      this.updateFilterOptions();
      
    } catch (e) {
      console.error('Gallery load error:', e);
    } finally {
      this.loading.value = false;
      this.loadMoreBtn.disabled = !this.hasMore.value;
      this.loadMoreBtn.textContent = this.hasMore.value ? 'Load More' : 'No more results';
    }
  }

  updateFilterOptions() {
    const items = this.items.value;
    const bases = [...new Set(items.map(i => i.base_model).filter(Boolean))].sort();
    const models = [...new Set(items.map(i => i.model_name).filter(Boolean))].sort();
    
    this.baseModelSelect.innerHTML = '<option value="">All Bases</option>' + 
      bases.map(b => `<option value="${b}">${b}</option>`).join('');
    this.modelIdSelect.innerHTML = '<option value="">All Models</option>' + 
      models.map(m => `<option value="${m}">${m}</option>`).join('');
  }

  render() {
    const items = this.items.value;
    const mode = this.viewMode.value;
    
    this.gridEl.className = 'gallery-grid ' + mode;
    this.gridEl.innerHTML = items.map(item => this.renderItem(item)).join('');
    
    this.renderSelection();
    this.updateLoadMoreBtn();
  }

  renderItem(item) {
    const id = item.civitai_image_id || item.id;
    const selected = this.selected.value.has(id);
    const favorite = item.favorite;
    const nsfw = item.nsfw_level > 1;
    const thumb = item.url ? `/api/proxy?url=${encodeURIComponent(item.url)}` : '';
    
    return `
      <div class="gallery-item ${selected ? 'selected' : ''} ${nsfw ? 'nsfw' : ''}" data-id="${id}" tabindex="0">
        <div class="gallery-thumb">
          ${thumb ? `<img loading="lazy" src="${thumb}" alt="">` : '<div class="placeholder">▣</div>'}
          ${nsfw ? '<span class="nsfw-badge">NSFW</span>' : ''}
          <button class="fav-btn ${favorite ? 'active' : ''}" data-action="favorite" title="Toggle favorite">★</button>
          <button class="queue-btn" data-action="queue" title="Add to queue">➕</button>
        </div>
        <div class="gallery-meta">
          <div class="gallery-title">${item.model_name || 'Unknown'}</div>
          <div class="gallery-details">
            <span>${item.base_model || ''}</span>
            <span>${item.width || '?'}×${item.height || '?'}</span>
            <span>${item.sampler || ''}</span>
          </div>
        </div>
      </div>
    `;
  }

  renderSelection() {
    this.gridEl.querySelectorAll('.gallery-item').forEach(item => {
      const id = item.dataset.id;
      item.classList.toggle('selected', this.selected.value.has(id));
    });
  }

  updateLoadMoreBtn() {
    this.loadMoreBtn.style.display = this.hasMore.value ? 'block' : 'none';
  }

  async openViewer(id) {
    const item = this.items.value.find(i => (i.civitai_image_id || i.id) === id);
    if (!item) return;
    
    if (!this.viewer) {
      this.viewer = new GalleryViewer(document.body);
    }
    await this.viewer.open(item, this.items.value);
  }

  async addToQueue(id) {
    const item = this.items.value.find(i => (i.civitai_image_id || i.id) === id);
    if (!item) return;
    
    if (!this.queue) {
      this.queue = new GalleryQueue(document.body);
    }
    this.queue.add(item);
  }

  async toggleFavorite(id) {
    const item = this.items.value.find(i => (i.civitai_image_id || i.id) === id);
    if (!item) return;
    
    item.favorite = !item.favorite;
    await images.toggleFavorite(id);
    this.render();
  }

  async deleteSelected() {
    const ids = Array.from(this.selected.value);
    for (const id of ids) {
      await images.delete(id);
    }
    this.selected.value.clear();
    this.load();
  }

  addItem(item) {
    const id = item.civitai_image_id || item.id;
    if (!this.items.value.some(i => (i.civitai_image_id || i.id) === id)) {
      this.items.value = [item, ...this.items.value];
      this.render();
    }
  }

  destroy() {
    this.container.innerHTML = '';
    if (this.viewer) this.viewer.destroy();
    if (this.queue) this.queue.destroy();
  }
}

/**
 * Fullscreen Image Viewer
 */
export class GalleryViewer {
  constructor(container) {
    this.container = container;
    this.currentIndex = 0;
    this.items = [];
    this.el = null;
  }

  async open(items, allItems) {
    this.items = allItems;
    this.currentIndex = allItems.findIndex(i => (i.civitai_image_id || i.id) === (items.civitai_image_id || items.id));
    
    this.el = document.createElement('div');
    this.el.className = 'gallery-viewer';
    this.el.innerHTML = `
      <div class="viewer-overlay"></div>
      <div class="viewer-container">
        <button class="viewer-close">✕</button>
        <button class="viewer-nav prev" title="Previous">‹</button>
        <button class="viewer-nav next" title="Next">›</button>
        <div class="viewer-content"></div>
        <div class="viewer-sidebar">
          <div class="viewer-info"></div>
          <div class="viewer-actions">
            <button class="btn primary" data-action="queue">Add to Queue</button>
            <button class="btn ghost" data-action="favorite">★ Favorite</button>
            <button class="btn ghost" data-action="copy-prompt">Copy Prompt</button>
            <button class="btn ghost" data-action="download">Download</button>
          </div>
        </div>
      </div>
    `;
    
    this.container.appendChild(this.el);
    document.body.style.overflow = 'hidden';
    
    this.bindEvents();
    this.render();
  }

  bindEvents() {
    this.el.querySelector('.viewer-close').onclick = () => this.close();
    this.el.querySelector('.viewer-nav.prev').onclick = () => this.prev();
    this.el.querySelector('.viewer-nav.next').onclick = () => this.next();
    this.el.querySelector('.viewer-overlay').onclick = () => this.close();
    
    this.el.querySelector('[data-action="queue"]').onclick = () => this.addToQueue();
    this.el.querySelector('[data-action="favorite"]').onclick = () => this.toggleFavorite();
    this.el.querySelector('[data-action="copy-prompt"]').onclick = () => this.copyPrompt();
    this.el.querySelector('[data-action="download"]').onclick = () => this.download();
    
    // Keyboard
    this.keyHandler = e => {
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowLeft') this.prev();
      else if (e.key === 'ArrowRight') this.next();
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  render() {
    const item = this.items[this.currentIndex];
    if (!item) return;
    
    const thumb = item.url ? `/api/proxy?url=${encodeURIComponent(item.url)}` : '';
    const content = this.el.querySelector('.viewer-content');
    content.innerHTML = thumb ? `<img src="${thumb}" alt="">` : '<div class="placeholder">▣</div>';
    
    const info = this.el.querySelector('.viewer-info');
    info.innerHTML = `
      <h4>${item.model_name || 'Unknown'}</h4>
      <div class="meta-grid">
        <div><strong>Base:</strong> ${item.base_model || '?'}</div>
        <div><strong>Type:</strong> ${item.type || '?'}</div>
        <div><strong>Resolution:</strong> ${item.width || '?'}×${item.height || '?'}</div>
        <div><strong>Sampler:</strong> ${item.sampler || '?'}</div>
        <div><strong>Steps:</strong> ${item.steps || '?'}</div>
        <div><strong>CFG:</strong> ${item.cfg_scale || '?'}</div>
        <div><strong>Seed:</strong> ${item.seed || '?'}</div>
        <div><strong>NSFW:</strong> ${item.nsfw_level || 1}</div>
      </div>
      <div class="prompt-section">
        <strong>Positive:</strong>
        <pre>${item.positive_prompt || '—'}</pre>
        <strong>Negative:</strong>
        <pre>${item.negative_prompt || '—'}</pre>
      </div>
    `;
    
    // Update favorite button
    const favBtn = this.el.querySelector('[data-action="favorite"]');
    favBtn.textContent = item.favorite ? '★ Favorited' : '★ Favorite';
    favBtn.classList.toggle('active', item.favorite);
  }

  prev() {
    this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
    this.render();
  }

  next() {
    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    this.render();
  }

  async addToQueue() {
    const item = this.items[this.currentIndex];
    // Trigger queue
    Events.gallery.emit('gallery:queue-add', item);
  }

  async toggleFavorite() {
    const item = this.items[this.currentIndex];
    item.favorite = !item.favorite;
    await images.toggleFavorite(item.civitai_image_id || item.id);
    this.render();
  }

  copyPrompt() {
    const item = this.items[this.currentIndex];
    const text = `Positive: ${item.positive_prompt}\n\nNegative: ${item.negative_prompt}`;
    navigator.clipboard.writeText(text);
    this.showToast('Prompt copied');
  }

  download() {
    const item = this.items[this.currentIndex];
    if (item.url) {
      const a = document.createElement('a');
      a.href = `/api/proxy?url=${encodeURIComponent(item.url)}`;
      a.download = `${item.model_name || 'image'}.png`;
      a.click();
    }
  }

  close() {
    if (this.el) {
      this.el.remove();
      this.el = null;
      document.body.style.overflow = '';
      document.removeEventListener('keydown', this.keyHandler);
    }
  }

  destroy() {
    this.close();
  }

  showToast(msg) {
    if (window.showToast) window.showToast(msg);
  }
}

/**
 * Batch Generation Queue
 */
export class GalleryQueue {
  constructor(container) {
    this.container = container;
    this.items = new Signal([]);
    this.processing = new Signal(false);
    this.currentIndex = 0;
    this.el = null;
  }

  add(item) {
    this.items.value = [...this.items.value, { ...item, status: 'pending', progress: 0 }];
    if (!this.el) this.open();
    else this.render();
  }

  open() {
    this.el = document.createElement('div');
    this.el.className = 'gallery-queue-modal';
    this.el.innerHTML = `
      <div class="queue-overlay"></div>
      <div class="queue-panel">
        <div class="queue-header">
          <h3>Generation Queue</h3>
          <button class="queue-close">✕</button>
        </div>
        <div class="queue-list"></div>
        <div class="queue-footer">
          <button class="btn primary" id="queueStart">Start Queue</button>
          <button class="btn ghost" id="queueClear">Clear Done</button>
        </div>
      </div>
    `;
    
    this.container.appendChild(this.el);
    document.body.style.overflow = 'hidden';
    
    this.el.querySelector('.queue-close').onclick = () => this.close();
    this.el.querySelector('.queue-overlay').onclick = () => this.close();
    this.el.querySelector('#queueStart').onclick = () => this.start();
    this.el.querySelector('#queueClear').onclick = () => this.clearDone();
    
    this.render();
  }

  render() {
    if (!this.el) return;
    
    const list = this.el.querySelector('.queue-list');
    list.innerHTML = this.items.value.map((item, i) => `
      <div class="queue-item ${item.status}">
        <div class="queue-thumb">
          ${item.url ? `<img src="/api/proxy?url=${encodeURIComponent(item.url)}" alt="">` : '<div class="placeholder">▣</div>'}
        </div>
        <div class="queue-info">
          <div class="queue-title">${item.model_name || 'Unknown'}</div>
          <div class="queue-status">${item.status} ${item.progress ? `${Math.round(item.progress)}%` : ''}</div>
          ${item.status === 'running' ? `<div class="queue-progress"><div style="width:${item.progress}%"></div></div>` : ''}
        </div>
        <div class="queue-actions">
          ${item.status === 'pending' ? `<button class="btn ghost sm" data-action="remove" data-index="${i}">Remove</button>` : ''}
          ${item.status === 'error' ? `<button class="btn ghost sm" data-action="retry" data-index="${i}">Retry</button>` : ''}
        </div>
      </div>
    `).join('');
    
    list.querySelectorAll('[data-action="remove"]').forEach(btn => {
      btn.onclick = () => this.removeItem(+btn.dataset.index);
    });
    list.querySelectorAll('[data-action="retry"]').forEach(btn => {
      btn.onclick = () => this.retryItem(+btn.dataset.index);
    });
  }

  async start() {
    if (this.processing.value) return;
    this.processing.value = true;

    // S'assurer que le catalogue de modèles est chargé (resolveModelName)
    await primeModels().catch(() => {});

    for (let i = 0; i < this.items.value.length; i++) {
      const item = this.items.value[i];
      if (item.status !== 'pending') continue;

      this.currentIndex = i;
      item.status = 'running';
      item.progress = 0;
      this.render();

      try {
        const prompt = this.buildPrompt(item);
        if (!prompt) throw new Error('Modèle non supporté');

        // Vérifier la compatibilité AVANT de pousser dans la file
        const v = await fetch('/api/comfyui/validate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        }).then(r => r.json());
        if (!v.valid) {
          throw new Error((v.messages || []).join(' · ') || 'Graphe refusé par ComfyUI');
        }

        // Exécution réelle
        const run = await fetch('/api/comfyui/run', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        }).then(r => r.json());
        if (!run.ok) throw new Error(run.error || 'Échec ComfyUI');

        // Polling de l'historique pour la progression
        const pid = run.prompt_id;
        let done = false;
        for (let t = 0; t < 240; t++) {  // max 4 min
          await new Promise(r => setTimeout(r, 1000));
          const h = await fetch('/api/comfyui/history').then(r => r.json());
          const entry = h[pid];
          if (entry) {
            const st = entry.status || {};
            if (st.completed === true || st.status_str === 'error') {
              done = true;
              if (st.status_str === 'error') {
                item.status = 'error';
                item.error = (st.errors || [])[0] || 'Erreur ComfyUI';
              } else {
                item.status = 'done';
                item.progress = 100;
                // Récupérer l'URL de l'image générée
                const outputs = (entry.outputs || {});
                for (const nid of Object.keys(outputs)) {
                  const imgs = outputs[nid].images;
                  if (imgs && imgs.length) {
                    item.url = `/api/comfyui/image?filename=${encodeURIComponent(imgs[0].filename)}&subfolder=${encodeURIComponent(imgs[0].subfolder || '')}&type=${imgs[0].type || 'output'}`;
                    break;
                  }
                }
              }
              break;
            }
          }
          // Progression approximative (pas de % réel dans ComfyUI)
          item.progress = Math.min(95, item.progress + 2);
          this.render();
        }
        if (!done) {
          item.status = 'error';
          item.error = 'Délai dépassé (4 min)';
        }
      } catch (e) {
        item.status = 'error';
        item.error = e.message;
      }
      this.render();
    }

    this.processing.value = false;
  }

  /**
   * Construit un graphe ComfyUI depuis un item Civitai.
   * Utilise le catalogue de workflows pour le modèle de base,
   * puis injecte le prompt de l'item.
   */
  buildPrompt(item) {
    const model = (item.model_name || '').toLowerCase();
    let wfId = null;

    // Mapper le modèle Civitai vers un workflow du catalogue
    if (model.includes('flux.2') || model.includes('klein')) wfId = 'flux2-klein';
    else if (model.includes('flux.1') || model.includes('flux1')) wfId = 'flux1-dev';
    else if (model.includes('sdxl') || model.includes('sd_xl')) wfId = 'sdxl-base';
    else if (model.includes('sd 1.5') || model.includes('sd1.5') || model.includes('v1-5')) wfId = 'sd15-base';
    else if (model.includes('ltx') || model.includes('video')) wfId = 'ltx-video';
    else if (model.includes('z-image') || model.includes('zimage')) wfId = 'z-image';
    else if (model.includes('qwen')) wfId = 'qwen-image';

    if (!wfId) return null;

    // Construire le graphe via le catalogue
    const wf = WorkflowCatalog.find(w => w.id === wfId);
    if (!wf) return null;

    // Construire le graphe dans l'éditeur temporaire
    // On utilise applyCatalogWorkflow qui construit dans le graphe global
    // Puis on exporte et on modifie le prompt
    try {
      applyCatalogWorkflow(wfId);
      const prompt = graphToComfyUI(graph);

      // Injecter le prompt de l'item
      for (const nid of Object.keys(prompt)) {
        const n = prompt[nid];
        if (n.class_type === 'CLIPTextEncode') {
          // Premier CLIPTextEncode = positif, second = négatif
          if (!n.inputs.text || n.inputs.text === wf.prompt || n.inputs.text === (wf.graph && wf.graph.prompt)) {
            n.inputs.text = item.positive_prompt || wf.prompt || 'a beautiful woman';
          } else {
            n.inputs.text = item.negative_prompt || wf.negative || 'blurry, low quality';
          }
        }
      }

      return prompt;
    } catch (e) {
      console.error('[gallery] buildPrompt:', e);
      return null;
    }
  }

  removeItem(index) {
    this.items.value.splice(index, 1);
    this.items.value = [...this.items.value];
    this.render();
  }

  retryItem(index) {
    const item = this.items.value[index];
    if (item) {
      item.status = 'pending';
      item.error = null;
      this.render();
    }
  }

  clearDone() {
    this.items.value = this.items.value.filter(i => i.status !== 'done');
    this.render();
  }

  close() {
    if (this.el) {
      this.el.remove();
      this.el = null;
      document.body.style.overflow = '';
    }
  }

  destroy() {
    this.close();
  }
}

export function createGallery(container, options) {
  return new Gallery(container, options);
}

export function createViewer(container) {
  return new GalleryViewer(container);
}

export function createQueue(container) {
  return new GalleryQueue(container);
}
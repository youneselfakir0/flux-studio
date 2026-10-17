/**
 * Flux Studio v2 — Node Palette
 * Searchable, categorized node palette with favorites and drag-to-canvas
 */

import { Signal, effect, derived } from '../core/state.js';
import { bus, Events } from '../core/events.js';
import { NodeRegistry, NodeCategories, getCategories } from '../nodes/registry.js';
import { onModelsReady } from '../nodes/catalog.js';
import { graph } from './graph.js';

export class Palette {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    
    this.search = new Signal('');
    this.activeCategory = new Signal('all');
    this.expandedCategories = new Signal({});
    this.favorites = new Signal([]);
    this.dragging = new Signal(null);
    
    // Load favorites from localStorage
    try {
      const favs = JSON.parse(localStorage.getItem('fs:palette_favorites') || '[]');
      this.favorites.value = favs;
    } catch {}
    
    // Persist favorites
    effect(() => {
      localStorage.setItem('fs:palette_favorites', JSON.stringify(this.favorites.value));
    });
    
    this.init();
    this.bindEvents();
  }

  init() {
    this.container.className = 'node-palette';
    this.container.innerHTML = `
      <div class="palette-header">
        <h3>Nodes</h3>
        <input type="text" class="palette-search" placeholder="Search nodes...">
      </div>
      <div class="palette-categories"></div>
      <div class="palette-content"></div>
    `;
    
    this.searchInput = this.container.querySelector('.palette-search');
    this.categoriesEl = this.container.querySelector('.palette-categories');
    this.contentEl = this.container.querySelector('.palette-content');
    
    this.renderCategories();
    this.renderContent();
  }

  bindEvents() {
    // Search
    this.searchInput.addEventListener('input', e => {
      this.search.value = e.target.value.toLowerCase();
      this.renderContent();
    });
    
    // Category clicks
    this.categoriesEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-category]');
      if (!btn) return;
      const cat = btn.dataset.category;
      this.activeCategory.value = cat;
      this.renderCategories();
      this.renderContent();
    });
    
    // Drag from palette to canvas
    this.contentEl.addEventListener('mousedown', e => {
      const item = e.target.closest('.palette-item');
      if (!item) return;
      
      const type = item.dataset.type;
      this.dragging.value = { type, startX: e.clientX, startY: e.clientY };
      item.classList.add('dragging');
      
      const onMove = e => {
        if (!this.dragging.value) return;
        // Could show ghost preview here
      };
      
      const onUp = e => {
        if (!this.dragging.value) return;
        
        // Check if dropped on canvas
        const canvas = document.querySelector('.graph-canvas');
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right &&
              e.clientY >= rect.top && e.clientY <= rect.bottom) {
            // Calculate position in graph coordinates
            const vp = graph.viewport ? graph.viewport.value : { x: 0, y: 0, zoom: 1 };
            const x = (e.clientX - rect.left - vp.x) / vp.zoom;
            const y = (e.clientY - rect.top - vp.y) / vp.zoom;
            graph.addNode(this.dragging.value.type, { x, y });
          }
        }
        
        item.classList.remove('dragging');
        this.dragging.value = null;
        
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  renderCategories() {
    const cats = getCategories();
    const allCount = cats.reduce((sum, c) => sum + c.count, 0);
    
    this.categoriesEl.innerHTML = `
      <button class="palette-category-btn ${this.activeCategory.value === 'all' ? 'active' : ''}" data-category="all">
        All <span class="count">${allCount}</span>
      </button>
      <button class="palette-category-btn ${this.activeCategory.value === 'favorites' ? 'active' : ''}" data-category="favorites">
        ★ Favorites <span class="count">${this.favorites.value.length}</span>
      </button>
      ${cats.map(c => `
        <button class="palette-category-btn ${this.activeCategory.value === c.name ? 'active' : ''}" data-category="${c.name}">
          ${c.name} <span class="count">${c.count}</span>
        </button>
      `).join('')}
    `;
  }

  getFilteredNodes() {
    const search = this.search.value;
    const cat = this.activeCategory.value;
    
    const STUDIO_ONLY = new Set(['Reroute', 'PrimitiveNode']);
    let nodes = NodeRegistry.filter(n => !STUDIO_ONLY.has(n.type));
    
    if (cat === 'favorites') {
      nodes = nodes.filter(n => this.favorites.value.includes(n.type));
    } else if (cat !== 'all') {
      nodes = nodes.filter(n => n.category === cat);
    }
    
    if (search) {
      nodes = nodes.filter(n => 
        n.type.toLowerCase().includes(search) ||
        n.title.toLowerCase().includes(search) ||
        n.description.toLowerCase().includes(search) ||
        (n.widgets || []).some(w => w.name.toLowerCase().includes(search) || (w.label || '').toLowerCase().includes(search))
      );
    }
    
    return nodes;
  }

  renderContent() {
    // Les widgets "dynamic" ont besoin du catalogue : on s'y abonne UNE seule fois
    if (!this._catalogHooked) {
      this._catalogHooked = true;
      onModelsReady(() => this.renderContent());
    }
    const nodes = this.getFilteredNodes();
    const cat = this.activeCategory.value;
    
    if (cat === 'favorites' || cat === 'all' || !cat) {
      // Flat list for favorites and all
      this.contentEl.innerHTML = nodes.map(n => this.renderItem(n)).join('');
    } else {
      // Grouped by category
      this.contentEl.innerHTML = `
        <div class="palette-group">
          ${nodes.map(n => this.renderItem(n)).join('')}
        </div>
      `;
    }
    
    // Bind item events
    this.contentEl.querySelectorAll('.palette-item').forEach(item => {
      const type = item.dataset.type;
      const isFav = this.favorites.value.includes(type);
      
      // Favorite toggle
      const favBtn = item.querySelector('.fav-btn');
      if (favBtn) {
        favBtn.addEventListener('click', e => {
          e.stopPropagation();
          this.toggleFavorite(type);
        });
      }
      
      // Click to add (alternative to drag)
      item.addEventListener('click', e => {
        if (e.target.closest('.fav-btn')) return;
        const vp = graph.viewport ? graph.viewport.value : { x: 0, y: 0, zoom: 1 };
        graph.addNode(type, { x: 100, y: 100 });
      });
    });
  }

  renderItem(node) {
    const isFav = this.favorites.value.includes(node.type);
    return `
      <div class="palette-item" data-type="${node.type}" title="${node.description || ''}">
        <span class="fav-btn ${isFav ? 'active' : ''}" title="Toggle favorite">★</span>
        <span class="node-type">${node.type}</span>
        <span class="node-title">${node.title}</span>
        <span class="node-category">${node.category}</span>
      </div>
    `;
  }

  toggleFavorite(type) {
    const favs = [...this.favorites.value];
    const idx = favs.indexOf(type);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(type);
    this.favorites.value = favs;
    this.renderContent();
    if (this.activeCategory.value === 'favorites') this.renderCategories();
  }

  destroy() {
    this.container.innerHTML = '';
  }
}

export function createPalette(container, options) {
  return new Palette(container, options);
}
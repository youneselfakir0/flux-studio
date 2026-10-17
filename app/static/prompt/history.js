/**
 * Flux Studio v2 — Prompt History & Templates
 * Local storage for prompt history, variants, favorites, collections
 */

import { Signal, effect } from '../core/state.js';
import { Events } from '../core/events.js';

export class PromptHistory {
  constructor(options = {}) {
    this.options = { maxHistory: 200, ...options };
    
    this.entries = new Signal([]);
    this.favorites = new Signal(new Set());
    this.collections = new Signal({}); // name -> { name, prompts: [], color }
    this.currentCollection = new Signal('default');
    this.search = new Signal('');
    
    this.load();
  }

  load() {
    try {
      const data = JSON.parse(localStorage.getItem('fs:prompt_history') || '{}');
      this.entries.value = data.entries || [];
      this.favorites.value = new Set(data.favorites || []);
      this.collections.value = data.collections || { default: { name: 'Default', prompts: [], color: '#7c5cff' } };
      this.currentCollection.value = data.currentCollection || 'default';
    } catch {}
  }

  save() {
    try {
      localStorage.setItem('fs:prompt_history', JSON.stringify({
        entries: this.entries.value,
        favorites: Array.from(this.favorites.value),
        collections: this.collections.value,
        currentCollection: this.currentCollection.value,
      }));
    } catch {}
  }

  add(promptData) {
    const entry = {
      id: crypto.randomUUID(),
      positive: promptData.positive || '',
      negative: promptData.negative || '',
      model: promptData.model || '',
      params: promptData.params || {},
      images: promptData.images || [],
      tags: promptData.tags || [],
      collection: this.currentCollection.value,
      favorite: false,
      timestamp: Date.now(),
    };
    
    this.entries.value = [entry, ...this.entries.value].slice(0, this.options.maxHistory);
    this.save();
    return entry;
  }

  remove(id) {
    this.entries.value = this.entries.value.filter(e => e.id !== id);
    this.favorites.value.delete(id);
    this.save();
  }

  toggleFavorite(id) {
    const favs = new Set(this.favorites.value);
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    this.favorites.value = favs;
    this.save();
  }

  duplicate(id) {
    const entry = this.entries.value.find(e => e.id === id);
    if (!entry) return;
    const newEntry = { ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
    this.entries.value = [newEntry, ...this.entries.value];
    this.save();
    return newEntry;
  }

  // Collections
  createCollection(name, color = '#7c5cff') {
    const id = name.toLowerCase().replace(/\s+/g, '-');
    if (this.collections.value[id]) return false;
    
    this.collections.value = {
      ...this.collections.value,
      [id]: { name, prompts: [], color },
    };
    this.save();
    return id;
  }

  deleteCollection(id) {
    if (id === 'default') return false;
    const cols = { ...this.collections.value };
    delete cols[id];
    this.collections.value = cols;
    // Move prompts to default
    this.entries.value = this.entries.value.map(e => 
      e.collection === id ? { ...e, collection: 'default' } : e
    );
    this.save();
  }

  setCollection(id) {
    if (this.collections.value[id]) {
      this.currentCollection.value = id;
      this.save();
    }
  }

  addToCollection(entryId, collectionId) {
    const entry = this.entries.value.find(e => e.id === entryId);
    if (entry && this.collections.value[collectionId]) {
      entry.collection = collectionId;
      this.save();
    }
  }

  getCollection(id) {
    return this.collections.value[id];
  }

  getAllCollections() {
    return Object.values(this.collections.value);
  }

  // Search & Filter
  getFiltered() {
    const search = this.search.value.toLowerCase();
    return this.entries.value.filter(e => {
      if (search && !e.positive.toLowerCase().includes(search) && 
          !e.negative.toLowerCase().includes(search) &&
          !e.tags.some(t => t.toLowerCase().includes(search))) {
        return false;
      }
      return true;
    });
  }

  getByCollection(collectionId) {
    return this.entries.value.filter(e => e.collection === collectionId);
  }

  getFavorites() {
    return this.entries.value.filter(e => this.favorites.value.has(e.id));
  }

  getRecent(limit = 20) {
    return this.entries.value.slice(0, limit);
  }

  // Export/Import
  export() {
    return JSON.stringify({
      entries: this.entries.value,
      favorites: Array.from(this.favorites.value),
      collections: this.collections.value,
    }, null, 2);
  }

  async import(json) {
    try {
      const data = JSON.parse(json);
      if (data.entries) this.entries.value = [...data.entries, ...this.entries.value];
      if (data.favorites) this.favorites.value = new Set(data.favorites);
      if (data.collections) this.collections.value = { ...this.collections.value, ...data.collections };
      this.save();
      return true;
    } catch {
      return false;
    }
  }

  // Clear
  clear() {
    this.entries.value = [];
    this.favorites.value.clear();
    this.collections.value = { default: { name: 'Default', prompts: [], color: '#7c5cff' } };
    this.currentCollection.value = 'default';
    this.save();
  }

  // Effect to auto-save
  init() {
    effect(() => {
      this.save();
    });
  }
}

export function createPromptHistory(options) {
  return new PromptHistory(options);
}
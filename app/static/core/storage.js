/**
 * Flux Studio v2 — Storage Layer
 * localStorage (prefs, UI state) + IndexedDB (workflows, images, large blobs)
 */

const DB_NAME = 'flux-studio';
const DB_VERSION = 2;
const STORES = {
  workflows: { key: 'id', indexes: ['name', 'updatedAt', 'tags'] },
  images: { key: 'id', indexes: ['modelId', 'baseModel', 'createdAt', 'favorite'] },
  prompts: { key: 'id', indexes: ['text', 'model', 'createdAt'] },
  templates: { key: 'id', indexes: ['category', 'model'] },
  queueHistory: { key: 'id', indexes: ['status', 'startedAt'] },
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      Object.entries(STORES).forEach(([name, cfg]) => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: cfg.key, autoIncrement: true });
          cfg.indexes.forEach(idx => store.createIndex(idx, idx, { unique: false }));
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Wrap an IDBRequest in a promise
function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function store(name) {
  const db = await openDB();
  return db.transaction(name, 'readwrite').objectStore(name);
}

async function roStore(name) {
  const db = await openDB();
  return db.transaction(name, 'readonly').objectStore(name);
}

// --- Generic CRUD ---
export const idb = {
  add: async (s, data) => req((await store(s)).add(data)),
  put: async (s, data) => req((await store(s)).put(data)),
  get: async (s, key) => req((await roStore(s)).get(key)),
  getAll: async (s) => req((await roStore(s)).getAll()),
  delete: async (s, key) => req((await store(s)).delete(key)),
  clear: async (s) => req((await store(s)).clear()),
  index: async (s, idx, value) => req((await roStore(s)).index(idx).getAll(value)),
  cursor: async (s, fn, dir = 'next') => {
    const st = await roStore(s);
    return new Promise((resolve, reject) => {
      const r = st.openCursor(null, dir);
      r.onsuccess = e => { const c = e.target.result; if (c) { fn(c.value); c.continue(); } else resolve(); };
      r.onerror = () => reject(r.error);
    });
  },
};

// --- Workflows ---
export const workflows = {
  save: (wf) => idb.put('workflows', { ...wf, updatedAt: Date.now() }),
  load: (id) => idb.get('workflows', id),
  list: () => idb.getAll('workflows'),
  search: (query) => idb.getAll('workflows').then(all =>
    all.filter(w => w.name.toLowerCase().includes(query.toLowerCase())
      || (w.tags || []).some(t => t.toLowerCase().includes(query.toLowerCase())))),
  byTag: (tag) => idb.index('workflows', 'tags', tag),
  delete: (id) => idb.delete('workflows', id),
  export: async (id) => {
    const wf = await idb.get('workflows', id);
    return JSON.stringify(wf, null, 2);
  },
  import: async (json) => {
    const wf = JSON.parse(json);
    delete wf.id; // new ID
    return idb.put('workflows', { ...wf, updatedAt: Date.now() });
  },
};

// --- Images ---
export const images = {
  save: (img) => idb.put('images', { ...img, savedAt: Date.now() }),
  get: (id) => idb.get('images', id),
  list: (opts = {}) => idb.getAll('images').then(all => {
    let res = all;
    if (opts.baseModel) res = res.filter(i => i.baseModel === opts.baseModel);
    if (opts.favorite) res = res.filter(i => i.favorite);
    if (opts.modelId) res = res.filter(i => i.modelId === opts.modelId);
    res.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (opts.limit) res = res.slice(0, opts.limit);
    return res;
  }),
  toggleFavorite: async (id) => {
    const img = await idb.get('images', id);
    if (img) { img.favorite = !img.favorite; await idb.put('images', img); }
  },
  delete: (id) => idb.delete('images', id),
};

// --- Prompts ---
export const prompts = {
  save: (p) => idb.put('prompts', { ...p, savedAt: Date.now() }),
  list: () => idb.getAll('prompts'),
  recent: (n = 20) => idb.getAll('prompts').then(all => all.sort((a,b) => (b.savedAt||0)-(a.savedAt||0)).slice(0,n)),
};

// --- Templates ---
export const templates = {
  save: (t) => idb.put('templates', { ...t, updatedAt: Date.now() }),
  list: () => idb.getAll('templates'),
  byCategory: (cat) => idb.index('templates', 'category', cat),
  byModel: (model) => idb.index('templates', 'model', model),
  seedDefaults: async () => {
    const count = await idb.getAll('templates').then(a => a.length);
    if (count > 0) return;
    const defaults = [
      { id: 'flux-txt2img', name: 'Flux txt2img', category: 'flux', model: 'Flux', workflow: fluxTxt2Img() },
      { id: 'flux-img2img', name: 'Flux img2img', category: 'flux', model: 'Flux', workflow: fluxImg2Img() },
      { id: 'flux-inpaint', name: 'Flux Inpaint', category: 'flux', model: 'Flux', workflow: fluxInpaint() },
      { id: 'sdxl-txt2img', name: 'SDXL txt2img', category: 'sdxl', model: 'SDXL', workflow: sdxlTxt2Img() },
      { id: 'sdxl-img2img', name: 'SDXL img2img', category: 'sdxl', model: 'SDXL', workflow: sdxlImg2Img() },
      { id: 'sd15-txt2img', name: 'SD 1.5 txt2img', category: 'sd15', model: 'SD 1.5', workflow: sd15Txt2Img() },
      { id: 'upscale', name: 'Upscale 4x', category: 'utils', model: 'Any', workflow: upscaleWorkflow() },
      { id: 'controlnet-canny', name: 'ControlNet Canny', category: 'controlnet', model: 'SDXL', workflow: controlnetCanny() },
    ];
    for (const t of defaults) await idb.put('templates', t);
  },
};

// --- Queue History ---
export const queueHistory = {
  add: (item) => idb.put('queueHistory', { ...item, id: item.id || crypto.randomUUID(), startedAt: Date.now() }),
  list: (limit = 50) => idb.getAll('queueHistory').then(a => a.sort((a,b)=>b.startedAt-a.startedAt).slice(0,limit)),
  clear: () => idb.clear('queueHistory'),
};

// --- localStorage helpers (prefs, UI state) ---
export const prefs = {
  get: (key, def) => { try { return JSON.parse(localStorage.getItem('fs:' + key)); } catch { return def; } },
  set: (key, val) => { try { localStorage.setItem('fs:' + key, JSON.stringify(val)); } catch {} },
  delete: (key) => localStorage.removeItem('fs:' + key),
  all: () => {
    const res = {};
    for (let i=0; i<localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('fs:')) res[k.slice(3)] = JSON.parse(localStorage.getItem(k));
    }
    return res;
  },
};

// --- Init ---
export async function initStorage() {
  await openDB();
  await templates.seedDefaults();
  console.log('[Storage] IndexedDB ready');
}

// --- Default workflow templates ---
function fluxTxt2Img() { return { nodes: [], edges: [], meta: { name: 'Flux txt2img', model: 'Flux', description: 'Basic Flux text-to-image' } }; }
function fluxImg2Img() { return { nodes: [], edges: [], meta: { name: 'Flux img2img', model: 'Flux', description: 'Flux image-to-image' } }; }
function fluxInpaint() { return { nodes: [], edges: [], meta: { name: 'Flux Inpaint', model: 'Flux', description: 'Flux inpainting with mask' } }; }
function sdxlTxt2Img() { return { nodes: [], edges: [], meta: { name: 'SDXL txt2img', model: 'SDXL', description: 'SDXL text-to-image' } }; }
function sdxlImg2Img() { return { nodes: [], edges: [], meta: { name: 'SDXL img2img', model: 'SDXL', description: 'SDXL image-to-image' } }; }
function sd15Txt2Img() { return { nodes: [], edges: [], meta: { name: 'SD 1.5 txt2img', model: 'SD 1.5', description: 'SD 1.5 text-to-image' } }; }
function upscaleWorkflow() { return { nodes: [], edges: [], meta: { name: 'Upscale 4x', model: 'Any', description: '4x upscale with ESRGAN/4x-UltraSharp' } }; }
function controlnetCanny() { return { nodes: [], edges: [], meta: { name: 'ControlNet Canny', model: 'SDXL', description: 'SDXL + ControlNet Canny' } }; }
/**
 * Flux Studio v2 — API Client + SSE Queue
 * Centralized HTTP + Server-Sent Events for real-time queue
 */

const BASE = '';

async function request(path, opts = {}) {
  const url = BASE + path;
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${res.statusText}: ${err}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export const api = {
  // Prompts
  images: (params) => request('/api/images?' + new URLSearchParams(params).toString()),
  image: (id) => request('/api/image?id=' + encodeURIComponent(id)),
  stats: () => request('/api/stats'),
  categories: () => request('/api/categories'),

  // ComfyUI
  comfy: {
    profile: () => request('/api/comfyui/profile'),
    local: (force) => request('/api/comfyui/local' + (force ? '?force=1' : '')),
    search: (params) => request('/api/comfyui/search?' + new URLSearchParams(params).toString()),
    download: (body) => request('/api/comfyui/download', { method: 'POST', body }),
    downloads: () => request('/api/comfyui/downloads'),
    describe: (file, model) => {
      const fd = new FormData();
      fd.append('file', file);
      const url = '/api/comfyui/describe' + (model ? '?model=' + encodeURIComponent(model) : '');
      return fetch(BASE + url, { method: 'POST', body: fd }).then(r => r.json());
    },
    saveWorkflow: (name, workflow) => request('/api/comfyui/save_workflow', { method: 'POST', body: { name, workflow } }),
    generate: (body) => request('/api/comfyui/generate', { method: 'POST', body }),
    ollama: () => request('/api/comfyui/ollama'),
  },

  // Proxy
  proxy: (url) => BASE + '/api/proxy?url=' + encodeURIComponent(url),

  // Raw fetch
  raw: request,
};

/**
 * Polling de la file ComfyUI.
 *
 * La route SSE /api/comfyui/queue/stream n'existe pas (ComfyUI ne pousse
 * pas d'événements). On poll /api/comfyui/queue + /api/comfyui/history
 * toutes les 2 secondes.
 */
export async function pollComfyQueue() {
  try {
    const [q, h] = await Promise.all([
      fetch('/api/comfyui/queue').then(r => r.json()),
      fetch('/api/comfyui/history').then(r => r.json())
    ]);
    return {
      running: q.running || [],
      pending: q.pending || [],
      history: h
    };
  } catch (e) {
    return { running: [], pending: [], history: {}, error: e.message };
  }
}

/**
 * WebSocket vers ComfyUI /ws. Cote client, pas de proxy necessaire
 * (ComfyUI autorise cross-origin pour 127.0.0.1). Reconnexion auto.
 *
 * Usage :
 *   const ws = new ComfyWS();
 *   ws.on('progress', (d) => console.log('etape', d.value, '/', d.max));
 *   ws.connect();
 */
export class ComfyWS {
  constructor() {
    this._client_id = Math.random().toString(36).slice(2);
    this._ws = null;
    this._handlers = new Map();
    this._reconnect = true;
    this._retry = 2000;
  }
  _emit(ev, data) {
    (this._handlers.get(ev) || []).forEach(h => h(data));
  }
  on(ev, fn) {
    if (!this._handlers.has(ev)) this._handlers.set(ev, []);
    this._handlers.get(ev).push(fn);
  }
  connect() {
    if (this._ws) return;
    try {
      this._ws = new WebSocket(`ws://127.0.0.1:8188/ws?client_id=${this._client_id}`);
      this._ws.onopen = () => this._emit('open', null);
      this._ws.onclose = () => {
        this._ws = null;
        if (this._reconnect) setTimeout(() => this.connect(), this._retry);
      };
      this._ws.onerror = (e) => this._emit('error', e);
      this._ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          this._emit(d.type || 'message', d);
        } catch { this._emit('message', e.data); }
      };
    } catch (e) { this._emit('error', e); }
  }
  disconnect() { this._reconnect = false; if (this._ws) { this._ws.close(); this._ws = null; } }
}
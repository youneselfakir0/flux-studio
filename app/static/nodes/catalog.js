/**
 * Flux Studio v2 — Catalogue dynamique des widgets
 * Récupère les noms de fichiers réellement installés via /api/comfyui/models
 * et les injecte dans les widgets de type "dynamic".
 */

const cache = { models: null, fetched: false };
const listeners = new Set();

async function fetchModels(force = false) {
  if (cache.models && !force) return cache.models;
  try {
    const r = await fetch('/api/comfyui/models');
    const j = await r.json();
    cache.models = j;
  } catch (e) {
    cache.models = {};
  }
  cache.fetched = true;
  listeners.forEach(fn => fn(cache.models));
  return cache.models;
}

export function listFor(source) {
  const m = cache.models || {};
  return m[source] || [];
}

export function onModelsReady(fn) {
  listeners.add(fn);
  if (cache.fetched) fn(cache.models);
  return () => listeners.delete(fn);
}

export async function initCatalog() {
  await fetchModels(true);
  return cache.models;
}

/** Rend un <select> pour un widget dynamique, ou un <input> en secours. */
export function renderDynamicWidget(widgetDef, currentValue, onChange) {
  const opts = listFor(widgetDef.source);
  if (!opts.length) {
    // Pas de cache : on propose un input texte pour rester utilisable
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'widget-input';
    input.value = currentValue ?? widgetDef.default ?? '';
    input.placeholder = widgetDef.placeholder || (widgetDef.source ? `nom du fichier…` : '');
    input.addEventListener('change', () => onChange(input.value));
    return input;
  }
  const sel = document.createElement('select');
  sel.className = 'widget-input';
  const cur = currentValue ?? widgetDef.default;
  if (cur && !opts.includes(cur)) {
    const o = document.createElement('option');
    o.value = cur; o.textContent = cur + ' (absent)';
    sel.appendChild(o);
  }
  opts.forEach(name => {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  });
  sel.value = cur ?? opts[0];
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
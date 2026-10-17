/**
 * Flux Studio v2 — Palette de mots-clés (Ctrl+K)
 *
 * Concept : « un LoRA n'est pas un fichier à choisir, c'est un mot à taper ».
 * L'utilisateur tape un mot ; le système trouve le LoRA (par trigger, nom,
 * tag, description), crée le nÅ“ud LoraLoader, le câble, et écrit le trigger
 * dans le prompt. Un Entrée = trois actions.
 */

import { graph } from '../editor/graph.js';
import { Events } from '../core/events.js';

/* ============================ Index ============================ */

const Index = {
  items: [],
  byTrigger: new Map(),
  byBase: new Map(),
  loaded: false,
  loading: null,

  async load() {
    if (this.loaded) return this;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const r = await fetch('/api/lora-index');
        const j = await r.json();
        this.items = j.items || [];
        this.stats = j.stats || {};
        this.byTrigger = new Map();
        this.byBase = new Map();

        // Pré-normalise UNE fois : la recherche ne fait ensuite que des
        // String.includes, ce qui la passe de ~4 ms à <0,5 ms sur 475 items.
        for (const it of this.items) {
          it._nn = norm(it.name);
          it._nt = (it.triggers || []).map(norm).filter(Boolean);
          it._ng = (it.tags || []).map(norm).filter(Boolean);
          // Mots-clés fusionnés (triggers + tags) pour les rangs 3 et 4
          it._nw = it._nt.concat(it._ng);

          for (const t of it._nt) {
            if (!this.byTrigger.has(t)) this.byTrigger.set(t, []);
            this.byTrigger.get(t).push(it);
          }
          const b = it.base || 'Inconnu';
          if (!this.byBase.has(b)) this.byBase.set(b, []);
          this.byBase.get(b).push(it);
        }
        this.loaded = true;
        // Emission separee du try : un handler qui throw ne doit pas
        // invalider un index correctement charge.
        try { Events.lora.emit('indexed', this.items); } catch (e) { console.warn(e); }
      } catch (e) {
        // Ne PAS vider this.items si le fetch a reussi puis qu'une erreur
        // plus tard a interrompu le traitement.
        if (!this.items.length) {
          console.warn('[lora-index] indisponible', e);
          this.items = [];
        } else {
          console.warn('[lora-index] index charge mais post-traitement incomplet', e);
          this.loaded = true;
        }
      }
      return this;
    })();
    return this.loading;
  },
};

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // retire les diacritiques
    .replace(/[^a-z0-9]+/g, '');
}

/* ============================ Recherche ============================ */

/**
 * Recherche à la frappe, sans debounce (475 éléments = gratuit).
 *
 * Classement déterministe (rang = plus petit gagne) :
 *   0  trigger exact
 *   1  préfixe du nom
 *   2  sous-chaîne du nom
 *   3  préfixe d'un trigger ou d'un tag
 *   4  sous-chaîne d'un trigger, d'un tag ou de la description
 *
 * ⚠ Le test « le trigger existe-t-il ? » doit porter sur L'ITEM, pas sur
 * l'index global : sinon tous les LoRA sans correspondance passent au rang 0
 * et noient les vrais résultats sous le tri par popularité.
 */
/* ---------- Compatibilité base ---------- */

/**
 * Normalise un nom de base modèle pour comparaison.
 * "Flux.1 D", "Flux 1", "flux1" → "flux1"
 */
export function normBase(b) {
  return String(b || '').toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^flux2/, 'flux2')
    .replace(/^flux1/, 'flux1');
}

/**
 * Teste si un LoRA est compatible avec la base active du graphe.
 * Tolérant : "Flux.1 D" matche "Flux 1", "SDXL" matche "SDXL 1.0".
 */
export function isBaseCompatible(loraBase, graphBase) {
  const a = normBase(loraBase);
  const b = normBase(graphBase);
  if (!a || !b) return true;          // inconnu → on laisse passer
  if (a === b) return true;
  // préfixe commun d'au moins 4 chars (flux1, sdxl, sd15, qwen…)
  const min = Math.min(a.length, b.length);
  let common = 0;
  for (let i = 0; i < min; i++) {
    if (a[i] === b[i]) common++; else break;
  }
  return common >= 4;
}

export function searchLoras(query, { base = null, limit = 50, showIncompatible = false } = {}) {
  const q = norm(query);
  let pool = Index.items;
  if (base && base !== 'auto' && base !== 'all') {
    pool = pool.filter(i => i.base === base);
  }

  // Filtre de compatibilité automatique quand base = auto/all/null
  const graphBase = (base === 'auto' || base === null || base === 'all' || !base)
    ? currentGraphBase() : null;
  if (graphBase && !showIncompatible && (base === 'auto' || base === null || base === 'all' || !base)) {
    pool = pool.filter(i => isBaseCompatible(i.base, graphBase));
  }

  // Marque les incompatibles pour l'UI (quand showIncompatible)
  const markIncompatible = (item) => {
    if (graphBase && !isBaseCompatible(item.base, graphBase)) {
      item._incompatible = true;
      item._incompatibleReason = `Attendu ${graphBase}, LoRA ${item.base || '?'}`;
    } else {
      item._incompatible = false;
    }
    return item;
  };

  if (!q) {
    // Pas de requête : les plus populaires d'abord
    return pool.slice().sort((a, b) =>
      (b.rating || 0) - (a.rating || 0) || (b.downloads || 0) - (a.downloads || 0)
    ).slice(0, limit).map(markIncompatible);
  }

  // Index rapide : les items ayant ce trigger exact, par leur chemin unique.
  const exact = Index.byTrigger.get(q);
  const exactPaths = exact ? new Set(exact.map(i => i.path)) : null;

  const scored = [];
  for (const it of pool) {
    let rank = 99;

    // 0. trigger exact
    if (exactPaths ? exactPaths.has(it.path) : it._nt.includes(q)) {
      rank = 0;
    }
    // 1. préfixe du nom
    if (rank > 1 && it._nn.startsWith(q)) rank = 1;
    // 2. sous-chaîne du nom
    if (rank > 2 && it._nn.includes(q)) rank = 2;

    if (rank > 2) {
      // 3. préfixe d'un trigger ou d'un tag
      for (const w of it._nw) {
        if (w.startsWith(q)) { rank = 3; break; }
      }
      // 4. sous-chaîne d'un trigger / tag
      if (rank > 4) {
        for (const w of it._nw) {
          if (w.includes(q)) { rank = 4; break; }
        }
      }
      // 5. description / tags Civitai
      if (rank > 5 && it.hay && it.hay.includes(q)) rank = 5;
    }

    if (rank < 99) scored.push({ it, rank });
  }

  scored.sort((a, b) =>
    a.rank - b.rank ||
    (b.it.rating || 0) - (a.it.rating || 0) ||
    (b.it.downloads || 0) - (a.it.downloads || 0) ||
    a.it.name.localeCompare(b.it.name)
  );
  return scored.slice(0, limit).map(s => markIncompatible(s.it));
}

/** Base compatible avec le modèle currently chargé dans le graphe. */
/**
 * Suggère les LoRA les plus pertinents pour un prompt donné.
 * Score = base match + chevauchement triggers/tags/nom.
 */
export function suggestLoras(prompt, { base = null, limit = 6 } = {}) {
  const graphBase = base || currentGraphBase();
  const words = (prompt || "").toLowerCase().split(/[^a-z0-9àâäéèêëïîôöùûüç]+/).filter(w => w.length >= 3);
  const wordSet = new Set(words);

  const normBase = (b) => (b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const gBase = normBase(graphBase);

  const items = (LoraIndex && LoraIndex.items) ? LoraIndex.items : [];
  const scored = items.map(l => {
    let score = 0;
    // base match
    if (gBase && normBase(l.base_model) === gBase) score += 12;
    else if (gBase && normBase(l.base_model).includes(gBase.slice(0, 5))) score += 4;
    // triggers
    const triggers = (l.triggers || []).join(" ").toLowerCase();
    for (const w of wordSet) if (triggers.includes(w)) score += 3;
    // tags
    const tags = (l.tags || []).join(" ").toLowerCase();
    for (const w of wordSet) if (tags.includes(w)) score += 1;
    // name
    const name = (l.name || "").toLowerCase();
    for (const w of wordSet) if (name.includes(w)) score += 2;
    // preview bonus
    if (l.preview) score += 1;
    return { ...l, score };
  }).filter(l => l.score > 0).sort((a,b) => b.score - a.score);

  return scored.slice(0, limit);
}

export function currentGraphBase() {
  for (const n of graph.getAllNodes()) {
    if (n.type === 'UNETLoader') {
      const name = String(n.getWidget('unet_name') || '').toLowerCase();
      if (name.includes('klein')) return 'Flux.2 Klein 4B-base';
      if (name.includes('z_image') || name.includes('zimage')) return 'ZImageTurbo';
      if (name.includes('qwen')) return 'Qwen';
      return 'Flux.1 D';
    }
    if (n.type === 'CheckpointLoaderSimple') {
      const name = String(n.getWidget('ckpt_name') || '').toLowerCase();
      if (name.includes('xl')) return 'SDXL';
      if (name.includes('v1-5') || name.includes('sd15')) return 'SD 1.5';
      return null;
    }
  }
  return null;
}

/* ============================ Application ============================ */

/**
 * Insère un LoRA dans le graphe et l'écrit dans le prompt.
 * Renvoie les infos de ce qui a été fait.
 */
export function applyLora(loraPath, strength = 0.8) {
  const nodes = graph.getAllNodes();
  const sampler = nodes.find(n => n.type === 'KSampler' || n.type === 'SamplerCustom' || n.type === 'KSamplerAdvanced');
  const encoders = nodes.filter(n => n.type === 'CLIPTextEncode' || n.type === 'CLIPTextEncodeFlux');
  if (!sampler || !encoders.length) {
    throw new Error('Ouvre d’abord un workflow (il faut un sampler + un encodeur)');
  }

  // Réutilise un LoraLoader existant pour empiler les forces
  let lora = nodes.find(n => n.type === 'LoraLoader');
  if (!lora) {
    const base = sampler.position.value;
    lora = graph.addNode('LoraLoader', { x: base.x - 280, y: base.y + 200 });
  }
  lora.setWidget('lora_name', loraPath);
  lora.setWidget('strength_model', strength);
  lora.setWidget('strength_clip', strength);

  // Intercepte MODEL et CLIP comme dans builder.js
  const modelConn = takeSource(sampler, 'model');
  const clipConn = encoders.length ? takeSource(encoders[0], 'clip') : null;

  if (modelConn) {
    graph.connect(modelConn.nodeId, modelConn.outputName, lora.id, 'model');
    graph.connect(lora.id, 'MODEL', sampler.id, 'model');
  }
  if (clipConn) {
    graph.connect(clipConn.nodeId, clipConn.outputName, lora.id, 'clip');
    encoders.forEach(e => graph.connect(lora.id, 'CLIP', e.id, 'clip'));
  }

  Events.graph.emit('graph:loaded', {});
  Events.canvas.emit('canvas:fit');
  return { lora: loraPath, strength };
}

function takeSource(node, input) {
  const port = node.inputs.get(input);
  if (!port || !port.connections.size) return null;
  const c = [...port.connections][0];
  port.connections.delete(c);
  graph.edges.delete(`${c.nodeId}:${c.outputName}->${node.id}:${input}`);
  return c;
}

/** Écrit le trigger dans le prompt du premier encodeur. */
export function writeTrigger(text, weight = 0.9) {
  const enc = graph.getAllNodes().find(n => n.type === 'CLIPTextEncode' || n.type === 'CLIPTextEncodeFlux');
  if (!enc) return null;
  const target = enc.type === 'CLIPTextEncodeFlux' ? 'clip_l' : 'text';
  const cur = String(enc.getWidget(target) || '');
  const tag = `<lora:${text}:${weight}>`;
  if (cur.includes(tag)) return cur;
  const next = cur.trim() ? `${cur}, ${tag}` : tag;
  enc.setWidget(target, next);
  return next;
}

export { Index as LoraIndex };

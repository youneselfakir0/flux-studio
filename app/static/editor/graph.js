/**
 * Flux Studio v2 — Graph Engine
 * Topological sort, cycle detection, validation, VRAM estimation, execution
 */

import { Signal, derived, effect, batch } from '../core/state.js';
import { bus, Events } from '../core/events.js';
import { createNode } from '../nodes/base.js';
import { getNode, getNodesByCategory, NodeCategories } from '../nodes/registry.js';

export class Graph {
  constructor() {
    this.nodes = new Map(); // id -> Node
    this.edges = new Map(); // edgeId -> { source, sourceOutput, target, targetInput }
    this.selected = new Set();
    this.clipboard = null;
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 50;
    
    // Execution state
    this.executing = new Signal(false);
    this.executionOrder = [];
    this.results = new Map();
    
    // Auto-save
    this.dirty = new Signal(false);
    this.lastSaved = null;
  }

  // --- Node Management ---
  addNode(type, position = { x: 100, y: 100 }, id = null) {
    const node = createNode(type, id, position);
    this.nodes.set(node.id, node);
    this._recordHistory();
    Events.graph.emit('graph:node-add', { node: node.id, type });
    this.dirty.value = true;
    return node;
  }

  removeNode(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    // Remove all connected edges
    this.edges.forEach((edge, edgeId) => {
      if (edge.source === id || edge.target === id) {
        this.edges.delete(edgeId);
      }
    });
    node.inputs.forEach((data, name) => data.connections.clear());
    node.outputs.forEach((data, name) => data.connections.clear());
    this.nodes.delete(id);
    this.selected.delete(id);
    this._recordHistory();
    Events.graph.emit('graph:node-remove', { nodeId: id });
    this.dirty.value = true;
  }

  getNode(id) { return this.nodes.get(id); }
  getAllNodes() { return Array.from(this.nodes.values()); }
  getSelectedNodes() { return Array.from(this.selected).map(id => this.nodes.get(id)).filter(Boolean); }

  clear() {
    this.nodes.clear();
    this.edges.clear();
    this.selected.clear();
    this.results.clear();
    this.dirty.value = true;
    this._recordHistory();
    Events.graph.emit('graph:loaded', {});
  }

  // --- Edge Management ---
  connect(sourceId, sourceOutput, targetId, targetInput) {
    const source = this.nodes.get(sourceId);
    const target = this.nodes.get(targetId);
    if (!source || !target) return false;
    
    const outPort = source.getOutput(sourceOutput);
    const inPort = target.getInput(targetInput);
    if (!outPort || !inPort) return false;
    
    // Controle de compatibilite de type.
    // Les types ComfyUI sont en majuscules (MODEL, CONDITIONING…) ; certains
    // ports sont declares avec un nom d'entree en minuscules. On compare donc
    // sans tenir compte de la casse pour eviter des faux positifs.
    const outT = String(outPort.type || '').toUpperCase();
    const inT = String(inPort.type || '').toUpperCase();
    if (outT !== '*' && inT !== '*' && outT !== inT) {
      console.warn(`Type mismatch: ${outPort.type} -> ${inPort.type}`);
      // Allow but warn
    }
    
    // Disconnect existing connections on input (single connection per input)
    inPort.connections.forEach(c => this.disconnect(c.nodeId, c.outputName, targetId, targetInput));
    
    const edgeId = `${sourceId}:${sourceOutput}->${targetId}:${targetInput}`;
    this.edges.set(edgeId, { source: sourceId, sourceOutput, target: targetId, targetInput });
    source.connectOutput(sourceOutput, targetId, targetInput);
    target.connectInput(targetInput, sourceId, sourceOutput);
    
    this._recordHistory();
    Events.graph.emit('graph:connect', { edgeId, source: sourceId, sourceOutput, target: targetId, targetInput });
    this.dirty.value = true;
    return true;
  }

  disconnect(sourceId, sourceOutput, targetId, targetInput) {
    const edgeId = `${sourceId}:${sourceOutput}->${targetId}:${targetInput}`;
    if (!this.edges.has(edgeId)) return false;
    
    const source = this.nodes.get(sourceId);
    const target = this.nodes.get(targetId);
    if (source) source.disconnectOutput(sourceOutput, targetId, targetInput);
    if (target) target.disconnectInput(targetInput, sourceId, sourceOutput);
    
    this.edges.delete(edgeId);
    this._recordHistory();
    Events.graph.emit('graph:disconnect', { edgeId, source: sourceId, sourceOutput, target: targetId, targetInput });
    return true;
  }

  getEdges() { return Array.from(this.edges.values()); }
  getNodeEdges(nodeId) {
    return this.getEdges().filter(e => e.source === nodeId || e.target === nodeId);
  }

  // --- Selection ---
  select(id, multi = false) {
    if (!multi) this.selected.clear();
    if (this.nodes.has(id)) {
      this.selected.add(id);
      Events.graph.emit('graph:select', { nodeId: id, multi });
    }
  }

  deselect(id) {
    this.selected.delete(id);
    Events.graph.emit('graph:deselect', { nodeId: id });
  }

  selectAll() {
    this.nodes.forEach((_, id) => this.selected.add(id));
    Events.graph.emit('graph:select-all', {});
  }

  clearSelection() {
    this.selected.clear();
    Events.graph.emit('graph:clear-selection', {});
  }

  // --- Topological Sort & Execution ---
  topologicalSort() {
    const visited = new Set();
    const temp = new Set();
    const order = [];
    const nodeMap = this.nodes;

    const visit = (nodeId) => {
      if (temp.has(nodeId)) throw new Error('Cycle detected in graph');
      if (visited.has(nodeId)) return;
      temp.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (node) {
        node.inputs.forEach((data) => {
          data.connections.forEach(c => visit(c.nodeId));
        });
      }

      temp.delete(nodeId);
      visited.add(nodeId);
      order.push(nodeId);
    };

    this.getAllNodes().forEach(n => visit(n.id));
    this.executionOrder = order;
    return order;
  }

  validate() {
    const errors = [];
    const warnings = [];

    for (const node of this.nodes.values()) {
      const def = getNode(node.type);
      if (!def) {
        errors.push({ nodeId: node.id, type: 'unknown-node', message: `Type de nœud inconnu : ${node.type}` });
        continue;
      }
      // Entrees declarees dans le registre
      for (const inp of def.inputs || []) {
        const name = (typeof inp === 'string') ? inp : inp.name;
        const data = node.inputs.get(name);
        if (!data) continue;
        if (!data.connections.size) {
          // Un widget du meme nom compte comme une valeur fournie
          const hasWidget = node.widgets.has(name);
          if (!hasWidget) {
            errors.push({
              nodeId: node.id, type: 'missing-input', input: name,
              message: `${node.title} : entrée « ${name} » non connectée`,
            });
          }
        }
      }
      // Widgets obligatoires declares sans valeur
      for (const w of def.widgets || []) {
        if (!w.required) continue;
        const v = node.widgets.get(w.name);
        if (v === null || v === undefined || v === '') {
          warnings.push({
            nodeId: node.id, type: 'empty-widget', input: w.name,
            message: `${node.title} : « ${w.label || w.name} » vide`,
          });
        }
      }
    }

    // Cycles
    try { this.topologicalSort(); }
    catch (e) { errors.push({ type: 'cycle', message: e.message }); }

    // Aucun noeud terminal (SaveImage / PreviewImage)
    const hasSink = [...this.nodes.values()].some(n => getNode(n.type)?.output_node);
    if (!hasSink && this.nodes.size) {
      errors.push({ type: 'no-sink', message: 'Aucune sortie (aucun nœud SaveImage / PreviewImage)' });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Execute le graphe via ComfyUI.
   * 1. validate      -> refuse cycles / entrees requises non connectees
   * 2. graphToComfyUI-> convertit en JSON ComfyUI ({ "1": {class_type, inputs} })
   * 3. POST /run     -> { prompt_id }
   * 4. poll /history -> pending -> done | error
   * 5. emet graph:executed avec la liste des images produites
   */
  async execute(inputs = {}) {
    if (this.executing.value) return { ok: false, error: 'Deja en cours' };
    this.executing.value = true;
    this.results.clear();

    const allNodes = this.getAllNodes();
    allNodes.forEach(n => { n.executing.value = false; n.error.value = null; });
    this.lastRun = null;

    try {
      // 1. Validation
      const v = this.validate();
      if (!v.valid) {
        const msg = v.errors.map(e => e.message).join(' · ');
        return { ok: false, error: `Graphe invalide : ${msg}`, validation: v };
      }

      // 2. Conversion
      const prompt = graphToComfyUI(this, inputs);

      // 3. Envoi
      let run;
      try {
        const r = await fetch('/api/comfyui/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        run = await r.json();
      } catch (e) {
        return { ok: false, error: 'Serveur Flux Studio injoignable' };
      }

      if (!run.ok) {
        // Erreur de validation ComfyUI : la montrer nodale
        const detail = (run.messages && run.messages.length)
          ? run.messages.join(' | ')
          : (run.error || 'ComfyUI a refuse le workflow');
        // Marquer les noeuds fautifs
        Object.keys(run.node_errors || {}).forEach(comfyId => {
          const node = [...this.nodes.values()].find(n => comfyIdToNodeId(this, comfyId) === n.id);
          if (node) { node.error.value = (run.node_errors[comfyId].errors || []).map(e => e.message).join(', '); }
        });
        return { ok: false, error: detail, node_errors: run.node_errors };
      }

      const promptId = run.prompt_id;
      Events.graph.emit('graph:submitted', { promptId, prompt });

      // 4. Suivi
      const started = Date.now();
      const TIMEOUT_MS = 15 * 60 * 1000;
      let consecutiveFailures = 0;
      let delay = 1200;
      for (;;) {
        if (Date.now() - started > TIMEOUT_MS) {
          return { ok: false, error: 'Delai depasse (15 min)', promptId,
                   status: 'timed_out' };
        }
        let h;
        try {
          const res = await fetch(`/api/comfyui/history?id=${encodeURIComponent(promptId)}`);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          h = await res.json();
          consecutiveFailures = 0;
        } catch (e) {
          consecutiveFailures++;
          if (consecutiveFailures >= 5) {
            return { ok: false, error: 'Connexion perdue avec ComfyUI', promptId,
                     status: 'unknown' };
          }
          await new Promise(r => setTimeout(r, delay));
          delay = Math.min(delay * 2, 5000);
          continue;
        }

        const st = h.status;
        if (st === 'succeeded' || st === 'done') {
          this.lastRun = { promptId, images: h.images || [] };
          Events.graph.emit('graph:executed', { promptId, images: h.images || [] });
          return { ok: true, promptId, images: h.images || [], status: 'succeeded' };
        }
        if (st === 'failed' || st === 'error') {
          return { ok: false, error: h.error || 'Erreur ComfyUI', node: h.node,
                   promptId, status: 'failed' };
        }
        if (st === 'unknown') {
          return { ok: false, error: h.error || 'Statut inconnu', promptId,
                   status: 'unknown' };
        }
        // queued / running / pending : continuer avec backoff leger
        await new Promise(r => setTimeout(r, delay));
        delay = 1200;
      }
    } finally {
      this.executing.value = false;
    }
  }

  // --- VRAM Estimation ---
  estimateVRAM() {
    let vram = 0;
    const breakdown = {};
    
    this.nodes.forEach(node => {
      const def = getNode(node.type);
      let nodeVRAM = 0;
      
      // Base model VRAM estimates (rough)
      if (def.category === NodeCategories.loaders) {
        if (node.type === 'CheckpointLoaderSimple') nodeVRAM = 12000; // ~12GB for Flux/SDXL
        else if (node.type === 'VAELoader') nodeVRAM = 500;
        else if (node.type === 'DualCLIPLoader') nodeVRAM = 1500;
        else if (node.type === 'LoraLoader') nodeVRAM = 500;
      } else if (def.category === NodeCategories.sampling) {
        nodeVRAM = 2000; // KSampler working memory
      } else if (def.category === NodeCategories.latent) {
        const w = node.getWidget('width') || 1024;
        const h = node.getWidget('height') || 1024;
        const b = node.getWidget('batch_size') || 1;
        nodeVRAM = Math.ceil((w * h * b * 4 * 1.5) / 1024 / 1024); // MB, rough
      }
      
      if (nodeVRAM > 0) {
        breakdown[node.id] = { type: node.type, title: node.title, vram: nodeVRAM };
        vram += nodeVRAM;
      }
    });
    
    return { totalMB: vram, breakdown };
  }

  // --- History / Undo ---
  _recordHistory() {
    if (this._restoring) return;   // ne pas empiler pendant un undo/redo/restore
    const state = this.toJSON();
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(state);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
      if (this.historyIndex > 0) this.historyIndex--;
    } else {
      this.historyIndex++;
    }
  }

  undo() {
    if (this.historyIndex <= 0) return false;
    this.historyIndex--;
    this._restoring = true;
    this.fromJSON(this.history[this.historyIndex], false);
    this._restoring = false;
    return true;
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return false;
    this.historyIndex++;
    this._restoring = true;
    this.fromJSON(this.history[this.historyIndex], false);
    this._restoring = false;
    return true;
  }

  // --- Serialization ---
  toJSON() {
    return {
      nodes: this.getAllNodes().map(n => n.toJSON()),
      edges: this.getEdges(),
      viewport: { x: 0, y: 0, zoom: 1 },
      meta: { createdAt: Date.now(), version: '2.0' },
    };
  }

  fromJSON(json, recordHistory = true) {
    this._restoring = true;
    batch(() => {
      this.nodes.clear();
      this.edges.clear();
      this.selected.clear();
      
      // Create nodes first
      const nodeMap = new Map();
      json.nodes.forEach(n => {
        const node = createNode(n.type, n.id, n.position);
        if (n.widgets) Object.entries(n.widgets).forEach(([k, v]) => node.widgets.set(k, v));
        nodeMap.set(n.id, node);
        this.nodes.set(n.id, node);
      });
      
      // Restore edges
      json.edges.forEach(e => {
        const source = nodeMap.get(e.source);
        const target = nodeMap.get(e.target);
        if (source && target) {
          source.connectOutput(e.sourceOutput, e.target, e.targetInput);
          target.connectInput(e.targetInput, e.source, e.sourceOutput);
          this.edges.set(`${e.source}:${e.sourceOutput}->${e.target}:${e.targetInput}`, e);
        }
      });
    });
    this.dirty.value = false;
    this._restoring = false;
    if (recordHistory) this._recordHistory();
    Events.graph.emit('graph:loaded', {});
  }

  // --- Utility ---
  autoLayout(direction = 'horizontal', spacing = 300) {
    const order = this.topologicalSort();
    let x = 100, y = 100;
    
    order.forEach((nodeId, i) => {
      const node = this.nodes.get(nodeId);
      if (direction === 'horizontal') {
        node.position.value = { x, y: 100 + (i % 5) * 200 };
        x += spacing;
      } else {
        node.position.value = { x: 100 + (i % 5) * 300, y };
        y += spacing;
      }
    });
    this.dirty.value = true;
    Events.graph.emit('graph:auto-layout', {});
  }

  centerView() {
    const nodes = this.getAllNodes();
    if (nodes.length === 0) return { x: 0, y: 0, zoom: 1 };
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const p = n.position.value;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + n.size.width);
      maxY = Math.max(maxY, p.y + n.size.height);
    });
    
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      zoom: 1,
    };
  }
}

/* ============================ Conversion ComfyUI ============================ */

// Memoire nodeId <-> comfyId pour pouvoir relier les erreurs aux noeuds
let _comfyIdMap = new WeakMap();

export function comfyIdToNodeId(g, comfyId) {
  const m = _comfyIdMap.get(g);
  if (!m) return null;
  for (const [nodeId, cid] of m) if (cid === comfyId) return nodeId;
  return null;
}

/**
 * Convertit le graphe interne en JSON ComfyUI : { "1": { class_type, inputs } }
 *
 * Pieges ComfyUI geres ici :
 *  - les connexions sont des INDEX numeriques ["4", 0], jamais des noms
 *  - toutes les sorties sont indexees dans l'ordre du registre (OUTPUT_NODE exclu)
 *  - un noeud sans sortie doit quand meme etre inclus (SaveImage)
 *  - les widgets non connectes sont des valeurs litterales
 */
export function graphToComfyUI(g, overrides = {}) {
  const allNodes = g.getAllNodes();
  // Les noeuds "studio_only" (Reroute, PrimitiveNode) n'existent pas dans
  // ComfyUI : on les exclut du prompt et on resout leurs liens.
  const nodes = allNodes.filter(n => !(getNode(n.type) || {}).studio_only);
  const prompt = {};
  const idMap = new Map();
  let i = 1;
  nodes.forEach(n => idMap.set(n.id, String(i++)));
  _comfyIdMap.set(g, idMap);

  // Remonte une connexion a travers les Reroute jusqu'a un noeud reel.
  // Retourne null si la chaine ne mène nulle part.
  function resolveSource(nodeId, outputName, depth = 0) {
    if (depth > 32) return null;                 // garde-fou anti-boucle
    const src = g.getNode(nodeId);
    if (!src) return null;
    const def = getNode(src.type);
    if (!def || !def.studio_only) return { src, outputName };
    if (src.type === 'PrimitiveNode') return { src, literal: src.getWidget('value') };
    // Reroute : on suit son unique entree
    for (const [, port] of src.inputs) {
      if (!port.connections.size) continue;
      const c = [...port.connections][0];
      return resolveSource(c.nodeId, outputName, depth + 1);
    }
    return null;
  }

  for (const node of nodes) {
    const def = getNode(node.type);
    const inputs = {};

    // 1. Widgets -> litteraux.
    //    On envoie MÊME les chaines vides : ComfyUI valide la presence des
    //    entrees required et repond "Required input is missing" si le champ
    //    est absent. Seuls les boutons sont sans valeur sur le fil.
    //    (exemple reel : un prompt negatif vide sur CLIPTextEncode)
    node.widgets.forEach((v, name) => {
      const w = def && (def.widgets || []).find(x => x.name === name);
      if (w && (w.type === 'button' || w.type === 'file' && !v)) return;
      if (v === null || v === undefined) return;
      inputs[name] = v;
    });
    Object.assign(inputs, (overrides && overrides[node.id]) || {});

    // 2. Connexions -> [sourceComfyId, outputIndex] sous le VRAI nom ComfyUI
    node.inputs.forEach((data, name) => {
      if (!data.connections.size) return;
      const c = [...data.connections][0];
      const res = resolveSource(c.nodeId, c.outputName);
      if (!res) return;

      // PrimitiveNode : on inline la constante
      if ('literal' in res) {
        const raw = res.src.getWidget('value');
        const kind = String(res.src.getWidget('type') || 'INT').toUpperCase();
        let v = raw;
        if (kind === 'INT') v = parseInt(raw, 10) || 0;
        else if (kind === 'FLOAT') v = parseFloat(raw) || 0;
        else if (kind === 'BOOLEAN') v = !!raw;
        else v = String(raw == null ? '' : raw);
        inputs[inputKey(node, def, name, data.type)] = v;
        return;
      }

      const srcDef = getNode(res.src.type);
      const outs = (srcDef && srcDef.outputs) || [];
      const idx = outs.findIndex(o => (typeof o === 'string' ? o : o.name) === res.outputName);
      inputs[inputKey(node, def, name, data.type)] = [idMap.get(res.src.id), idx >= 0 ? idx : 0];
    });

    prompt[idMap.get(node.id)] = { class_type: node.type, inputs };
  }
  return prompt;
}

/**
 * Resout le vrai nom d'entree attendu par ComfyUI.
 *
 * Depuis la refonte du registre, `def.inputs` contient deja les noms EXACTS
 * de ComfyUI (minuscules : model, clip, latent_image…). Ce fallback ne sert
 * plus qu'a la compatibilite avec des workflows enregistres avant la refonte,
 * ou le registre declarait des ports par TYPE ("CLIP", "MODEL", "LATENT").
 */
function inputKey(node, def, name, type) {
  const declared = (def && def.inputs) || [];
  const names = declared.map(d => (typeof d === 'string' ? d : d.name));

  // Cas nominal : le registre declare le vrai nom -> on ne touche a rien.
  if (names.includes(name)) return name;

  // Compatibilite : port de type ("MODEL") -> nom ComfyUI ("model").
  const SPECIAL = {
    MODEL: 'model',
    CLIP: 'clip',
    VAE: 'vae',
    IMAGE: 'image',
    SAMPLER: 'sampler',
    SIGMAS: 'sigmas',
    NOISE: 'noise',
    GUIDER: 'guider',
    CONTROL_NET: 'control_net',
    UPSCALE_MODEL: 'upscale_model',
    LATENT: 'latent_image',
  };
  if (SPECIAL[name]) return SPECIAL[name];

  // CONDITIONING est ambigu : positive ou negative selon sa position.
  if (name === 'CONDITIONING') {
    return names.filter(n => n === 'CONDITIONING').indexOf(name) === 0 ? 'positive' : 'negative';
  }

  // Dernier recours : correspondance insensible a la casse.
  const ci = names.find(n => String(n).toLowerCase() === String(name).toLowerCase());
  return ci || String(name).toLowerCase();
}

export const graph = new Graph();
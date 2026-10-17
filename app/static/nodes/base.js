/**
 * Flux Studio v2 — Node Base Class
 * Handles rendering, connections, serialization, widget management
 */

import { Signal, effect } from '../core/state.js';
import { bus, Events } from '../core/events.js';
import { getNode } from './registry.js';

export class Node {
  constructor(def, id = null, position = { x: 100, y: 100 }) {
    this.def = def;
    this.id = id || crypto.randomUUID();
    this.type = def.type;
    this.title = def.title;
    this.category = def.category;
    this.position = new Signal(position);
    this.size = { width: 280, height: 'auto' };
    this.selected = new Signal(false);
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };

    // Input/output ports with values
    this.inputs = new Map();
    this.outputs = new Map();
    def.inputs.forEach((inp, i) => {
      // Normalise ['MODEL','CLIP'] et [{name,type}]
      const inpName = (typeof inp === 'string') ? inp : (inp.name || `input_${i}`);
      const inpType = (typeof inp === 'string') ? inp : (inp.type || '*');
      this.inputs.set(inpName, {
        name: inpName,
        type: inpType,
        connections: new Set(), // set of { nodeId, outputName }
        value: null,
        widget: null, // for inline widgets
      });
    });
    def.outputs.forEach((out, i) => {
      // Le registre declare les sorties soit comme ['MODEL','CLIP','VAE'] (noms)
      // soit comme [{name:'MODEL', type:'MODEL'}]. On normalise les deux formes.
      const outName = (typeof out === 'string') ? out : (out.name || out.type || `output_${i}`);
      const outType = (typeof out === 'string') ? out : (out.type || '*');
      this.outputs.set(outName, {
        name: outName,
        type: outType,
        connections: new Set(), // set of { nodeId, inputName }
        value: null,
      });
    });

    // Widget values
    this.widgets = new Map();
    (def.widgets || []).forEach(w => {
      this.widgets.set(w.name, w.default ?? null);
    });

    // Execution state
    this.executing = new Signal(false);
    this.error = new Signal(null);
    this.lastOutput = null;
  }

  // --- Port management ---
  getInput(name) { return this.inputs.get(name); }
  getOutput(name) { return this.outputs.get(name); }

  connectInput(inputName, sourceNodeId, sourceOutputName) {
    const inp = this.inputs.get(inputName);
    if (!inp) return false;
    inp.connections.add({ nodeId: sourceNodeId, outputName: sourceOutputName });
    Events.graph.emit('graph:connect', { target: this.id, targetInput: inputName, source: sourceNodeId, sourceOutput: sourceOutputName });
    return true;
  }

  disconnectInput(inputName, sourceNodeId, sourceOutputName) {
    const inp = this.inputs.get(inputName);
    if (!inp) return false;
    for (const c of inp.connections) {
      if (c.nodeId === sourceNodeId && c.outputName === sourceOutputName) {
        inp.connections.delete(c);
        Events.graph.emit('graph:disconnect', { target: this.id, targetInput: inputName, source: sourceNodeId, sourceOutput: sourceOutputName });
        return true;
      }
    }
    return false;
  }

  connectOutput(outputName, targetNodeId, targetInputName) {
    const out = this.outputs.get(outputName);
    if (!out) return false;
    out.connections.add({ nodeId: targetNodeId, inputName: targetInputName });
    return true;
  }

  disconnectOutput(outputName, targetNodeId, targetInputName) {
    const out = this.outputs.get(outputName);
    if (!out) return false;
    for (const c of out.connections) {
      if (c.nodeId === targetNodeId && c.inputName === targetInputName) {
        out.connections.delete(c);
        return true;
      }
    }
    return false;
  }

  // --- Widget management ---
  getWidget(name) { return this.widgets.get(name); }
  setWidget(name, value) {
    const def = this.def.widgets?.find(w => w.name === name);
    if (def) {
      // Validate
      if (def.type === 'int' || def.type === 'float') {
        value = Math.max(def.min ?? -Infinity, Math.min(def.max ?? Infinity, Number(value)));
      }
    }
    this.widgets.set(name, value);
    Events.graph.emit('graph:widget-change', { nodeId: this.id, widget: name, value });
  }

  // --- Serialization ---
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      title: this.title,
      position: this.position.value,
      widgets: Object.fromEntries(this.widgets),
      inputs: Object.fromEntries(
        Array.from(this.inputs.entries()).map(([name, data]) => [
          name,
          { connections: Array.from(data.connections).map(c => ({ nodeId: c.nodeId, outputName: c.outputName })) }
        ])
      ),
    };
  }

  static fromJSON(json, def) {
    const node = new Node(def, json.id, json.position);
    if (json.widgets) {
      Object.entries(json.widgets).forEach(([k, v]) => node.widgets.set(k, v));
    }
    if (json.inputs) {
      Object.entries(json.inputs).forEach(([name, data]) => {
        const inp = node.inputs.get(name);
        if (inp && data.connections) {
          data.connections.forEach(c => inp.connections.add(c));
        }
      });
    }
    return node;
  }

  // --- Execution ---
  async execute(inputs) {
    this.executing.value = true;
    this.error.value = null;
    try {
      // Override in subclasses
      this.lastOutput = await this._execute(inputs);
      return this.lastOutput;
    } catch (e) {
      this.error.value = e.message;
      throw e;
    } finally {
      this.executing.value = false;
    }
  }

  async _execute(inputs) {
    // Base implementation - override in specific nodes
    return {};
  }

  // --- UI Helpers ---
  getInputPortPosition(name) {
    const index = Array.from(this.inputs.keys()).indexOf(name);
    const x = this.position.value.x;
    const y = this.position.value.y + 40 + index * 36;
    return { x, y };
  }

  getOutputPortPosition(name) {
    const index = Array.from(this.outputs.keys()).indexOf(name);
    const x = this.position.value.x + this.size.width;
    const y = this.position.value.y + 40 + index * 36;
    return { x, y };
  }
}

// Factory for creating nodes from registry
export function createNode(type, id, position) {
  const def = getNode(type);
  if (!def) throw new Error(`Unknown node type: ${type}`);
  return new Node(def, id, position);
}
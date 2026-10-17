/**
 * Flux Studio v2 — Workflow Library
 * Save, load, version, export/import, share user workflows
 */

import { Signal, effect } from '../core/state.js';
import { bus, Events } from '../core/events.js';
import { graph } from '../editor/graph.js';
import { workflows as wfStore } from '../core/storage.js';

export class WorkflowLibrary {
  constructor(options = {}) {
    this.options = { ...options };
    
    this.workflows = new Signal([]);
    this.currentId = new Signal(null);
    this.selected = new Signal(null);
    this.search = new Signal('');
    this.versions = new Signal([]); // version history for current workflow
    
    this.init();
    this.bindEvents();
  }

  init() {
    this.loadWorkflows();
  }

  bindEvents() {
    // React to graph changes
    let saveTimeout;
    Events.graph.on('graph:loaded', () => this.loadVersions());
  }

  async loadWorkflows() {
    try {
      const list = await wfStore.list();
      this.workflows.value = list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (e) {
      console.error('Load workflows error:', e);
      this.workflows.value = [];
    }
  }

  async save(name, metadata = {}) {
    const data = graph.toJSON();
    const existing = this.currentId.value ? await wfStore.load(this.currentId.value) : null;
    
    const id = this.currentId.value || crypto.randomUUID();
    
    const wf = {
      ...data,
      id,
      name: name || existing?.name || 'Untitled Workflow',
      description: metadata.description || existing?.description || '',
      tags: metadata.tags || existing?.tags || [],
      model: metadata.model || existing?.model || '',
      meta: {
        ...data.meta,
        ...metadata,
        version: (existing?.version || 0) + 1,
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    };
    
    await wfStore.save(wf);
    this.currentId.value = id;
    await this.loadWorkflows();
    await this.loadVersions();
    
    if (window.showToast) window.showToast(`Workflow saved: ${wf.name}`);
    Events.workflow.emit('workflow:saved', wf);
    return wf;
  }

  async load(id) {
    try {
      const wf = await wfStore.load(id);
      if (wf) {
        graph.fromJSON(wf);
        this.currentId.value = id;
        this.selected.value = id;
        if (window.showToast) window.showToast(`Loaded: ${wf.name}`);
        Events.workflow.emit('workflow:loaded', wf);
      }
      return wf;
    } catch (e) {
      console.error('Load workflow error:', e);
    }
  }

  async loadVersions() {
    const id = this.currentId.value;
    if (!id) return;
    
    // Get version history from storage
    try {
      const all = await wfStore.list();
      const current = await wfStore.load(id);
      const versions = all
        .filter(w => w.name === current?.name)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      this.versions.value = versions;
    } catch {
      this.versions.value = [];
    }
  }

  async rename(newName) {
    const id = this.currentId.value;
    if (!id) return;
    
    const wf = await wfStore.load(id);
    if (wf) {
      wf.name = newName;
      wf.updatedAt = Date.now();
      await wfStore.save(wf);
      await this.loadWorkflows();
      if (window.showToast) window.showToast(`Renamed to: ${newName}`);
    }
  }

  async delete(id) {
    if (!confirm('Delete this workflow?')) return;
    
    await wfStore.delete(id);
    if (this.currentId.value === id) this.currentId.value = null;
    await this.loadWorkflows();
    if (window.showToast) window.showToast('Workflow deleted');
  }

  async duplicate(id) {
    const wf = await wfStore.load(id);
    if (!wf) return;
    
    const newWf = { ...wf, id: crypto.randomUUID(), name: `${wf.name} (copy)`, updatedAt: Date.now() };
    await wfStore.save(newWf);
    await this.loadWorkflows();
    if (window.showToast) window.showToast('Workflow duplicated');
  }

  async export(id) {
    const wf = await wfStore.load(id);
    if (!wf) return;
    
    const json = JSON.stringify(wf, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `${wf.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    
    if (window.showToast) window.showToast('Workflow exported');
  }

  async importFile(file) {
    return new Promise(async (resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const json = e.target.result;
            const wf = await wfStore.import(json);
            await this.loadWorkflows();
            if (wf) await this.load(wf.id);
            if (window.showToast) window.showToast('Workflow imported');
            resolve(wf);
          } catch (err) {
            reject(err);
          }
        };
        reader.readAsText(file);
      } catch (e) {
        reject(e);
      }
    });
  }

  // Auto-save periodically
  startAutoSave(intervalMs = 30000) {
    this.autoSaveTimer = setInterval(async () => {
      if (this.currentId.value && graph.dirty.value) {
        await this.save();
      }
    }, intervalMs);
  }

  stopAutoSave() {
    if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
  }

  // Get filtered workflows
  getFiltered() {
    const search = this.search.value.toLowerCase();
    if (!search) return this.workflows.value;
    
    return this.workflows.value.filter(w => {
      return w.name.toLowerCase().includes(search) ||
        (w.description || '').toLowerCase().includes(search) ||
        (w.tags || []).some(t => t.toLowerCase().includes(search)) ||
        (w.model || '').toLowerCase().includes(search);
    });
  }

  // Get workflow stats
  getStats() {
    const all = this.workflows.value;
    return {
      total: all.length,
      byModel: all.reduce((acc, w) => {
        const m = w.model || 'unknown';
        acc[m] = (acc[m] || 0) + 1;
        return acc;
      }, {}),
      recent: all.filter(w => (w.updatedAt || 0) > Date.now() - 7 * 24 * 60 * 60 * 1000).length,
    };
  }

  // Validation
  async validate(id) {
    const wf = await wfStore.load(id);
    if (!wf) return { valid: false, error: 'Workflow not found' };
    
    try {
      graph.fromJSON(wf);
      const result = graph.validate();
      return result;
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }

  // Share (export as ComfyUI workflow format)
  async exportComfyUI(id) {
    const wf = await wfStore.load(id);
    if (!wf) return;
    
    // Convert internal graph to ComfyUI API format
    const comfyWorkflow = {};
    
    wf.nodes.forEach(node => {
      const comfyNode = {
        class_type: node.type,
        inputs: {},
      };
      
      // Add widget values
      if (node.widgets) {
        Object.entries(node.widgets).forEach(([k, v]) => {
          comfyNode.inputs[k] = v;
        });
      }
      
      // Add connections
      if (node.inputs) {
        Object.entries(node.inputs).forEach(([name, data]) => {
          if (data.connections && data.connections.length > 0) {
            const conn = data.connections[0];
            comfyNode.inputs[name] = [conn.nodeId, 0]; // ComfyUI format: [node_id, output_index]
          }
        });
      }
      
      comfyWorkflow[node.id] = comfyNode;
    });
    
    const blob = new Blob([JSON.stringify(comfyWorkflow, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `${wf.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_comfyui.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    
    if (window.showToast) window.showToast('Exported as ComfyUI workflow');
  }
}

export function createWorkflowLibrary(options) {
  return new WorkflowLibrary(options);
}
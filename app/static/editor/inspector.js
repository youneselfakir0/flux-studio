/**
 * Flux Studio v2 — Inspector Panel
 * Right sidebar for node properties, widget editing, execution controls
 */

import { Signal, effect, derived } from '../core/state.js';
import { bus, Events } from '../core/events.js';
import { graph } from './graph.js';
import { getNode } from '../nodes/registry.js';
import { renderDynamicWidget, onModelsReady, listFor } from '../nodes/catalog.js';

export class Inspector {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    
    this.selectedNode = new Signal(null);
    this.showCode = new Signal(false);
    
    this.init();
    this.bindEvents();
  }

  init() {
    this.container.className = 'node-inspector';
    this.container.innerHTML = `
      <div class="inspector-header">
        <h3>Inspector</h3>
        <div class="inspector-actions">
          <button class="btn ghost sm" id="inspector-code" title="View JSON">⌘</button>
          <button class="btn ghost sm" id="inspector-execute" title="Execute Graph">▶</button>
        </div>
      </div>
      <div class="inspector-content">
        <div class="inspector-empty">Select a node to inspect</div>
      </div>
    `;
    
    this.contentEl = this.container.querySelector('.inspector-content');
    this.codeBtn = this.container.querySelector('#inspector-code');
    this.execBtn = this.container.querySelector('#inspector-execute');
  }

  bindEvents() {
    // Graph selection
    Events.graph.on('graph:select', ({ nodeId }) => {
      this.selectedNode.value = graph.getNode(nodeId);
    });
    
    Events.graph.on('graph:deselect', ({ nodeId }) => {
      if (this.selectedNode.value?.id === nodeId) {
        this.selectedNode.value = null;
      }
    });
    
    Events.graph.on('graph:clear-selection', () => {
      this.selectedNode.value = null;
    });
    
    // Code view
    this.codeBtn.addEventListener('click', () => {
      this.showCode.value = !this.showCode.value;
      this.render();
    });
    
    // Execute
    this.execBtn.addEventListener('click', async () => {
      if (!graph.getAllNodes().length) return;
      this.execBtn.disabled = true;
      this.execBtn.textContent = '⏳';
      try {
        await graph.execute();
        this.showToast('Execution complete');
      } catch (e) {
        this.showToast('Execution failed: ' + e.message, 'error');
      } finally {
        this.execBtn.disabled = false;
        this.execBtn.textContent = '▶';
      }
    });
    
    // React to selection
    effect(() => {
      this.render();
    });

    // Quand le catalogue de fichiers arrive, re-rendre les widgets dynamiques
    onModelsReady(() => {
      if (this.selectedNode.value) this.render();
    });
  }

  render() {
    const node = this.selectedNode.value;
    
    if (!node) {
      this.contentEl.innerHTML = `
        <div class="inspector-empty">Select a node to inspect</div>
      `;
      return;
    }
    
    if (this.showCode.value) {
      this.renderCodeView(node);
      return;
    }
    
    const def = getNode(node.type);
    this.contentEl.innerHTML = `
      <div class="inspector-section">
        <div class="inspector-node-header">
          <span class="node-type-badge">${node.type}</span>
          <h4>${node.title}</h4>
        </div>
        <p class="inspector-description">${def?.description || 'No description'}</p>
        
        ${this.renderWidgets(node, def)}
        
        <div class="inspector-divider"></div>
        
        ${this.renderConnections(node)}
        
        <div class="inspector-divider"></div>
        
        ${this.renderExecution(node)}
      </div>
    `;
    
    this.bindWidgetEvents(node);
  }

  renderWidgets(node, def) {
    const widgets = def?.widgets || [];
    if (!widgets.length) return '';
    
    return `
      <div class="inspector-section">
        <h5>Parameters</h5>
        <div class="inspector-widgets">
          ${widgets.map(w => this.renderWidget(node, w)).join('')}
        </div>
      </div>
    `;
  }

  renderWidget(node, widget) {
    const value = node.getWidget(widget.name) ?? widget.default ?? '';
    const id = `widget-${node.id}-${widget.name}`;
    
    let inputHtml = '';
    switch (widget.type) {
      case 'dynamic': {
        // Rendu en <select> a partir des fichiers reels, si le catalogue est charge
        const opts = listFor(widget.source);
        if (opts.length) {
          inputHtml = `
            <select id="${id}" data-dyn="${esc(widget.source)}" class="widget-input">
              ${opts.map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
            </select>
          `;
        } else {
          inputHtml = `<input type="text" id="${id}" data-dyn="${esc(widget.source)}" class="widget-input"
            value="${esc(value)}" placeholder="nom du fichier…">`;
        }
        break;
      }
      case 'int':
      case 'float':
        inputHtml = `
          <input type="number" id="${id}" 
            min="${widget.min ?? ''}" 
            max="${widget.max ?? ''}" 
            step="${widget.step || (widget.type === 'float' ? 0.01 : 1)}"
            value="${value}"
            class="widget-input">
        `;
        break;
      case 'combo':
        const options = typeof widget.options === 'function' 
          ? widget.options() 
          : widget.options;
        inputHtml = `
          <select id="${id}" class="widget-input">
            ${options.map(opt => `<option value="${opt}" ${opt === value ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>
        `;
        break;
      case 'boolean':
        inputHtml = `
          <label class="widget-checkbox">
            <input type="checkbox" id="${id}" ${value ? 'checked' : ''}>
            <span>${widget.label || widget.name}</span>
          </label>
        `;
        break;
      case 'textarea':
        inputHtml = `
          <textarea id="${id}" class="widget-input" rows="${widget.rows || 3}" placeholder="${widget.placeholder || ''}">${value}</textarea>
        `;
        break;
      case 'button': {
        // Boutons geres par leur widget associe (ex. upload) -> rendu vide ici
        return '';
      }
      case 'text':
      default:
        inputHtml = `
          <input type="text" id="${id}" class="widget-input" 
            value="${value}" placeholder="${widget.placeholder || ''}">
        `;
        break;
      case 'file': {
        // Upload vers ComfyUI via /api/comfyui/upload-image
        inputHtml = `
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" id="${id}" class="widget-input" value="${value}" readonly placeholder="Aucun fichier">
            <button class="btn ghost sm" data-action="upload-file" data-target="${id}">⬆ Upload</button>
            <input type="file" id="${id}-file" accept="image/*" style="display:none">
          </div>
        `;
        break;
      }
    }
    
    return `
      <div class="widget-row" data-widget="${widget.name}">
        <label for="${id}" class="widget-label">${widget.label || widget.name}</label>
        ${inputHtml}
        ${widget.description ? `<span class="widget-help">${widget.description}</span>` : ''}
      </div>
    `;
  }

  renderConnections(node) {
    const inputs = Array.from(node.inputs.entries()).map(([name, data]) => ({
      name, type: data.type, connected: data.connections.size > 0,
      connections: Array.from(data.connections)
    }));
    
    const outputs = Array.from(node.outputs.entries()).map(([name, data]) => ({
      name, type: data.type, connected: data.connections.size > 0,
      connections: Array.from(data.connections)
    }));
    
    if (!inputs.length && !outputs.length) return '';
    
    return `
      <div class="inspector-section">
        <h5>Connections</h5>
        ${inputs.length ? `
          <div class="inspector-connections">
            <h6>Inputs</h6>
            ${inputs.map(i => `
              <div class="conn-row ${i.connected ? 'connected' : ''}">
                <span class="conn-name">${i.name}</span>
                <span class="conn-type">${i.type}</span>
                ${i.connected ? `
                  <span class="conn-source">${i.connections.map(c => `${c.nodeId.slice(0,8)}:${c.outputName}`).join(', ')}</span>
                ` : '<span class="conn-empty">Not connected</span>'}
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${outputs.length ? `
          <div class="inspector-connections">
            <h6>Outputs</h6>
            ${outputs.map(o => `
              <div class="conn-row ${o.connected ? 'connected' : ''}">
                <span class="conn-name">${o.name}</span>
                <span class="conn-type">${o.type}</span>
                ${o.connected ? `
                  <span class="conn-target">${o.connections.map(c => `${c.nodeId.slice(0,8)}:${c.inputName}`).join(', ')}</span>
                ` : '<span class="conn-empty">Not connected</span>'}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  renderExecution(node) {
    return `
      <div class="inspector-section">
        <h5>Execution</h5>
        <div class="exec-controls">
          <button class="btn primary sm" data-action="exec-node" ${node.executing.value ? 'disabled' : ''}>
            ${node.executing.value ? '⏳ Running...' : '▶ Execute Node'}
          </button>
          <button class="btn ghost sm" data-action="exec-graph">▶ Execute All</button>
        </div>
        ${node.error.value ? `
          <div class="exec-error">${node.error.value}</div>
        ` : ''}
        ${node.lastOutput ? `
          <details class="exec-output">
            <summary>Last Output</summary>
            <pre>${JSON.stringify(node.lastOutput, null, 2).slice(0, 500)}</pre>
          </details>
        ` : ''}
      </div>
    `;
  }

  renderCodeView(node) {
    this.contentEl.innerHTML = `
      <div class="inspector-code">
        <div class="code-header">
          <h4>Node JSON</h4>
          <button class="btn ghost sm" data-action="copy-json">Copy</button>
        </div>
        <pre>${JSON.stringify(node.toJSON(), null, 2)}</pre>
      </div>
    `;
    
    this.contentEl.querySelector('[data-action="copy-json"]').onclick = () => {
      navigator.clipboard.writeText(JSON.stringify(node.toJSON(), null, 2));
      this.showToast('Copied to clipboard');
    };
  }

  bindWidgetEvents(node) {
    // Widget inputs
    this.contentEl.querySelectorAll('.widget-input').forEach(input => {
      const widgetName = input.closest('[data-widget]')?.dataset.widget;
      if (!widgetName) return;
      
      input.addEventListener('change', () => {
        let value = input.type === 'checkbox' ? input.checked : input.value;
        if (input.type === 'number') value = Number(value);
        node.setWidget(widgetName, value);
      });
      
      input.addEventListener('input', () => {
        // Live update for sliders/text
        let value = input.type === 'checkbox' ? input.checked : input.value;
        if (input.type === 'number') value = Number(value);
        node.setWidget(widgetName, value);
      });
    });
    
    // Upload de fichier pour widget type 'file'
    this.contentEl.querySelectorAll('[data-action="upload-file"]').forEach(btn => {
      const targetId = btn.dataset.target;
      const targetInput = document.getElementById(targetId);
      const fileInput = document.getElementById(targetId + '-file');
      if (!fileInput) return;
      btn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        btn.disabled = true; btn.textContent = '⏳';
        try {
          const fd = new FormData();
          fd.append('image', f, f.name);
          const r = await fetch('/api/comfyui/upload-image', { method: 'POST', body: fd });
          const j = await r.json();
          if (j.error) throw new Error(j.error);
          const name = j.name || f.name;
          if (targetInput) { targetInput.value = name; }
          const widgetName = targetInput?.closest('[data-widget]')?.dataset.widget;
          if (widgetName) node.setWidget(widgetName, name);
          this.showToast('Image envoyée : ' + name);
        } catch (e) { this.showToast('Upload échoué : ' + e.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = '⬆ Upload'; fileInput.value = ''; }
      });
    });

    // Execute node
    this.contentEl.querySelector('[data-action="exec-node"]')?.addEventListener('click', async () => {
      const btn = this.contentEl.querySelector('[data-action="exec-node"]');
      btn.disabled = true;
      btn.textContent = '⏳';
      try {
        await node.execute({});
        this.showToast(`${node.title} executed`);
        this.render();
      } catch (e) {
        this.showToast('Error: ' + e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '▶ Execute Node';
      }
    });
    
    // Copy JSON
    this.contentEl.querySelector('[data-action="copy-json"]')?.addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(node.toJSON(), null, 2));
      this.showToast('Copied');
    });
  }

  showToast(msg, type = 'info') {
    // Use global toast if available
    if (window.showToast) window.showToast(msg, type);
    else console.log('[Inspector]', msg);
  }

  destroy() {
    this.container.innerHTML = '';
  }
}

export function createInspector(container, options) {
  return new Inspector(container, options);
}
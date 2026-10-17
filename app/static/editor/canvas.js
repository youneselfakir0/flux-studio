/**
 * Flux Studio v2 — Canvas Editor
 * Visual node graph with pan/zoom, Bezier connections, minimap, auto-layout
 */

import { Signal, effect, derived } from '../core/state.js';
import { bus, Events } from '../core/events.js';
import { graph } from './graph.js';
import { getNode } from '../nodes/registry.js';
import { renderDynamicWidget, onModelsReady } from '../nodes/catalog.js';

const PORT_RADIUS = 8;
const NODE_HEADER_H = 36;
const NODE_MIN_W = 240;
const GRID_SIZE = 24;

export class Canvas {
  constructor(container, options = {}) {
    this.container = container;
    this.options = { 
      minimap: true, 
      grid: true,
      snapToGrid: true,
      ...options 
    };
    
    // Viewport state
    this.viewport = new Signal({ x: 0, y: 0, zoom: 1 });
    this.hoveredNode = new Signal(null);
    this.hoveredPort = new Signal(null);
    this.connecting = new Signal(null); // { nodeId, portName, isOutput, startPos }
    this.dragging = new Signal(false);
    this.dragStart = { x: 0, y: 0 };
    this.selectionBox = new Signal(null); // { x, y, w, h }
    
    // DOM
    this.canvas = null;
    this.ctx = null;
    this.minimapCanvas = null;
    this.minimapCtx = null;
    this.nodesLayer = null;
    this.edgesLayer = null;
    
    // Performance
    this.frameId = null;
    this.dirty = true;
    this.nodeElements = new Map(); // nodeId -> HTMLElement
    
    this.init();
    this.bindEvents();
    this.startRenderLoop();
  }

  init() {
    // Main canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'graph-canvas';
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = 0;
    this.canvas.style.left = 0;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none'; // Let node elements handle clicks
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Nodes layer (HTML elements for widgets)
    this.nodesLayer = document.createElement('div');
    this.nodesLayer.className = 'graph-nodes-layer';
    this.nodesLayer.style.position = 'absolute';
    this.nodesLayer.style.top = 0;
    this.nodesLayer.style.left = 0;
    this.nodesLayer.style.width = '100%';
    this.nodesLayer.style.height = '100%';
    this.nodesLayer.style.pointerEvents = 'auto';
    this.container.appendChild(this.nodesLayer);

    // Minimap
    if (this.options.minimap) {
      this.minimapCanvas = document.createElement('canvas');
      this.minimapCanvas.className = 'graph-minimap';
      this.minimapCanvas.style.position = 'absolute';
      this.minimapCanvas.style.bottom = '20px';
      this.minimapCanvas.style.right = '20px';
      this.minimapCanvas.width = 240;
      this.minimapCanvas.height = 160;
      this.minimapCanvas.style.border = '1px solid var(--line)';
      this.minimapCanvas.style.borderRadius = 'var(--r-md)';
      this.minimapCanvas.style.background = 'var(--bg)';
      this.minimapCanvas.style.boxShadow = 'var(--shadow-2)';
      this.container.appendChild(this.minimapCanvas);
      this.minimapCtx = this.minimapCanvas.getContext('2d');
    }

    this.resize();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.dirty = true;
  }

  bindEvents() {
    // Pan
    let panning = false, panStart = { x: 0, y: 0 }, viewportStart = { x: 0, y: 0 };
    
    this.container.addEventListener('mousedown', e => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        panning = true;
        panStart = { x: e.clientX, y: e.clientY };
        viewportStart = { ...this.viewport.value };
        this.container.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', e => {
      if (!panning) return;
      const dx = (e.clientX - panStart.x) / this.viewport.value.zoom;
      const dy = (e.clientY - panStart.y) / this.viewport.value.zoom;
      this.viewport.value = { 
        x: viewportStart.x - dx, 
        y: viewportStart.y - dy, 
        zoom: this.viewport.value.zoom 
      };
      this.dirty = true;
    });

    window.addEventListener('mouseup', () => {
      if (panning) {
        panning = false;
        this.container.style.cursor = '';
      }
    });

    // Zoom
    this.container.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = this.container.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - this.viewport.value.x) / this.viewport.value.zoom;
      const mouseY = (e.clientY - rect.top - this.viewport.value.y) / this.viewport.value.zoom;
      
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(3, this.viewport.value.zoom * zoomFactor));
      
      this.viewport.value = {
        x: e.clientX - rect.left - mouseX * newZoom,
        y: e.clientY - rect.top - mouseY * newZoom,
        zoom: newZoom,
      };
      this.dirty = true;
    }, { passive: false });

    // Selection box
    this.container.addEventListener('mousedown', e => {
      if (e.button === 0 && !e.altKey && e.target === this.container) {
        this.dragging.value = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.selectionBox.value = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
      }
    });

    window.addEventListener('mousemove', e => {
      if (!this.dragging.value || !this.selectionBox.value) return;
      const sb = this.selectionBox.value;
      sb.w = e.clientX - sb.x;
      sb.h = e.clientY - sb.y;
      this.selectionBox.value = { ...sb };
    });

    window.addEventListener('mouseup', e => {
      if (this.dragging.value && this.selectionBox.value) {
        this.handleSelectionBox(this.selectionBox.value);
        this.dragging.value = false;
        this.selectionBox.value = null;
      }
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        graph.getSelectedNodes().forEach(n => graph.removeNode(n.id));
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        graph.selectAll();
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        if (e.shiftKey) graph.redo(); else graph.undo();
      } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
        graph.redo();
      } else if (e.key === ' ') {
        e.preventDefault();
        this.container.style.cursor = 'grab';
      }
    });

    window.addEventListener('keyup', e => {
      if (e.key === ' ') this.container.style.cursor = '';
    });

    // Graph events
    Events.graph.on('graph:node-add', () => this.rebuildNodes());
    Events.graph.on('graph:node-remove', () => this.rebuildNodes());
    Events.graph.on('graph:connect', () => this.dirty = true);
    Events.graph.on('graph:disconnect', () => this.dirty = true);
    Events.graph.on('graph:loaded', () => this.rebuildNodes());
    Events.graph.on('graph:auto-layout', () => this.rebuildNodes());

    // Demande de recadrage (appliqué un workflow)
    Events.canvas.on('canvas:fit', () => this.fitView());
  }

  handleSelectionBox(box) {
    const vp = this.viewport.value;
    const left = Math.min(box.x, box.x + box.w);
    const right = Math.max(box.x, box.x + box.w);
    const top = Math.min(box.y, box.y + box.h);
    const bottom = Math.max(box.y, box.y + box.h);
    
    graph.getAllNodes().forEach(node => {
      const pos = node.position.value;
      const nodeLeft = pos.x * vp.zoom + vp.x;
      const nodeRight = nodeLeft + node.size.width * vp.zoom;
      const nodeTop = pos.y * vp.zoom + vp.y;
      const nodeBottom = nodeTop + (node.size.height || 200) * vp.zoom;
      
      const intersects = !(nodeRight < left || nodeLeft > right || nodeBottom < top || nodeTop > bottom);
      if (intersects) graph.select(node.id, true);
    });
  }

  // --- Node Element Management ---
  rebuildNodes() {
    // Remove old
    this.nodeElements.forEach(el => el.remove());
    this.nodeElements.clear();
    
    // Create new
    graph.getAllNodes().forEach(node => {
      const el = this.createNodeElement(node);
      this.nodesLayer.appendChild(el);
      this.nodeElements.set(node.id, el);
    });
    this.dirty = true;
  }

  createNodeElement(node) {
    const def = getNode(node.type);
    const el = document.createElement('div');
    el.className = 'graph-node';
    el.dataset.nodeId = node.id;
    el.style.position = 'absolute';
    el.style.transformOrigin = '0 0';
    
    // Apply transform from viewport + node position
    const updateTransform = () => {
      const vp = this.viewport.value;
      const pos = node.position.value;
      el.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${vp.zoom})`;
      el.style.transformOrigin = '0 0';
    };
    
    // React to position/zoom changes
    effect(() => {
      const pos = node.position.value;
      const vp = this.viewport.value;
      updateTransform();
    });
    
    // Selection
    effect(() => {
      el.classList.toggle('selected', graph.selected.has(node.id));
    });
    
    // Execution state
    effect(() => {
      el.classList.toggle('executing', node.executing.value);
      el.classList.toggle('error', !!node.error.value);
    });
    
    // Header
    const header = document.createElement('div');
    header.className = 'node-header';
    header.draggable = true;
    
    const title = document.createElement('span');
    title.className = 'node-title';
    title.textContent = node.title;
    header.appendChild(title);
    
    const badge = document.createElement('span');
    badge.className = 'node-badge';
    badge.textContent = node.type;
    header.appendChild(badge);
    
    el.appendChild(header);
    
    // Ports container
    const portsContainer = document.createElement('div');
    portsContainer.className = 'node-ports';
    
    // Inputs
    const inputsCol = document.createElement('div');
    inputsCol.className = 'node-inputs';
    node.inputs.forEach((data, name) => {
      const port = this.createPort(name, data, true, node);
      inputsCol.appendChild(port);
    });
    portsContainer.appendChild(inputsCol);
    
    // Body (widgets)
    const body = document.createElement('div');
    body.className = 'node-body';
    (def.widgets || []).forEach(w => {
      const widget = this.createWidget(node, w);
      if (widget) body.appendChild(widget);
    });
    portsContainer.appendChild(body);
    
    // Outputs
    const outputsCol = document.createElement('div');
    outputsCol.className = 'node-outputs';
    node.outputs.forEach((data, name) => {
      const port = this.createPort(name, data, false, node);
      outputsCol.appendChild(port);
    });
    portsContainer.appendChild(outputsCol);
    
    el.appendChild(portsContainer);
    
    // Drag header
    header.addEventListener('mousedown', e => {
      if (e.target !== header && e.target !== title && e.target !== badge) return;
      const startPos = { x: e.clientX, y: e.clientY };
      const startNodePos = { ...node.position.value };
      
      const onMove = e => {
        const dx = (e.clientX - startPos.x) / this.viewport.value.zoom;
        const dy = (e.clientY - startPos.y) / this.viewport.value.zoom;
        if (this.options.snapToGrid) {
          node.position.value = {
            x: Math.round((startNodePos.x + dx) / GRID_SIZE) * GRID_SIZE,
            y: Math.round((startNodePos.y + dy) / GRID_SIZE) * GRID_SIZE,
          };
        } else {
          node.position.value = { x: startNodePos.x + dx, y: startNodePos.y + dy };
        }
      };
      
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
    
    // Click to select
    el.addEventListener('click', e => {
      if (e.target.closest('.node-port, .node-widget')) return;
      graph.select(node.id, e.shiftKey || e.ctrlKey || e.metaKey);
      e.stopPropagation();
    });
    
    // Context menu
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      graph.select(node.id);
      this.showContextMenu(e.clientX, e.clientY, node);
    });
    
    return el;
  }

  createPort(name, data, isInput, node) {
    const port = document.createElement('div');
    port.className = `node-port ${isInput ? 'input' : 'output'} ${data.type}`;
    port.dataset.portName = name;
    port.dataset.isInput = isInput;
    
    const dot = document.createElement('span');
    dot.className = 'port-dot';
    port.appendChild(dot);
    
    const label = document.createElement('span');
    label.className = 'port-label';
    label.textContent = name;
    port.appendChild(label);
    
    if (isInput) {
      port.style.order = 1;
      port.appendChild(dot);
      port.appendChild(label);
    } else {
      port.style.order = 3;
      port.appendChild(label);
      port.appendChild(dot);
    }
    
    // Connection drag
    port.addEventListener('mousedown', e => {
      e.stopPropagation();
      this.startConnection(node.id, name, !isInput, e);
    });
    
    // Hover
    port.addEventListener('mouseenter', () => {
      this.hoveredPort.value = { nodeId: node.id, portName: name, isInput };
      this.dirty = true;
    });
    port.addEventListener('mouseleave', () => {
      if (this.hoveredPort.value?.nodeId === node.id && this.hoveredPort.value?.portName === name) {
        this.hoveredPort.value = null;
        this.dirty = true;
      }
    });
    
    return port;
  }

  createWidget(node, widgetDef) {
    const container = document.createElement('div');
    container.className = 'node-widget';
    container.dataset.widgetName = widgetDef.name;
    
    const label = document.createElement('label');
    label.textContent = widgetDef.label || widgetDef.name;
    container.appendChild(label);
    
    let input;
    switch (widgetDef.type) {
      case 'dynamic':
        input = renderDynamicWidget(widgetDef, node.getWidget(widgetDef.name),
          (v) => node.setWidget(widgetDef.name, v));
        break;
      case 'int':
      case 'float':
        input = document.createElement('input');
        input.type = 'number';
        input.min = widgetDef.min ?? '';
        input.max = widgetDef.max ?? '';
        input.step = widgetDef.step || (widgetDef.type === 'float' ? 0.01 : 1);
        input.value = node.getWidget(widgetDef.name) ?? widgetDef.default ?? '';
        input.addEventListener('change', () => node.setWidget(widgetDef.name, Number(input.value)));
        break;
      case 'combo':
        input = document.createElement('select');
        const options = typeof widgetDef.options === 'function' ? widgetDef.options() : widgetDef.options;
        options.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          input.appendChild(o);
        });
        input.value = node.getWidget(widgetDef.name) ?? widgetDef.default ?? '';
        input.addEventListener('change', () => node.setWidget(widgetDef.name, input.value));
        break;
      case 'boolean':
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = node.getWidget(widgetDef.name) ?? widgetDef.default ?? false;
        input.addEventListener('change', () => node.setWidget(widgetDef.name, input.checked));
        break;
      case 'textarea':
        input = document.createElement('textarea');
        input.value = node.getWidget(widgetDef.name) ?? widgetDef.default ?? '';
        input.placeholder = widgetDef.placeholder || '';
        input.rows = widgetDef.rows || 3;
        input.addEventListener('input', () => node.setWidget(widgetDef.name, input.value));
        break;
      case 'text':
      default:
        input = document.createElement('input');
        input.type = 'text';
        input.value = node.getWidget(widgetDef.name) ?? widgetDef.default ?? '';
        input.placeholder = widgetDef.placeholder || '';
        input.addEventListener('input', () => node.setWidget(widgetDef.name, input.value));
    }
    
    if (input) {
      input.className = 'widget-input';
      container.appendChild(input);
    }
    
    return container;
  }

  // --- Connection handling ---
  startConnection(nodeId, portName, isOutput, e) {
    const node = graph.getNode(nodeId);
    if (!node) return;
    
    const rect = this.container.getBoundingClientRect();
    const vp = this.viewport.value;
    const startPos = {
      x: (e.clientX - rect.left - vp.x) / vp.zoom,
      y: (e.clientY - rect.top - vp.y) / vp.zoom,
    };
    
    this.connecting.value = { nodeId, portName, isOutput, startPos };
    this.dirty = true;
    
    const onMove = e => {
      if (!this.connecting.value) return;
      const rect = this.container.getBoundingClientRect();
      const vp = this.viewport.value;
      this.connecting.value = {
        ...this.connecting.value,
        currentPos: {
          x: (e.clientX - rect.left - vp.x) / vp.zoom,
          y: (e.clientY - rect.top - vp.y) / vp.zoom,
        }
      };
      this.dirty = true;
    };
    
    const onUp = e => {
      if (!this.connecting.value) return;
      
      // Check if dropped on a compatible port
      const targetPort = this.hoveredPort.value;
      if (targetPort && targetPort.isInput !== this.connecting.value.isOutput) {
        const sourceNodeId = this.connecting.value.isOutput ? this.connecting.value.nodeId : targetPort.nodeId;
        const sourcePortName = this.connecting.value.isOutput ? this.connecting.value.portName : targetPort.portName;
        const targetNodeId = this.connecting.value.isOutput ? targetPort.nodeId : this.connecting.value.nodeId;
        const targetPortName = this.connecting.value.isOutput ? targetPort.portName : this.connecting.value.portName;
        
        graph.connect(sourceNodeId, sourcePortName, targetNodeId, targetPortName);
      }
      
      this.connecting.value = null;
      this.hoveredPort.value = null;
      this.dirty = true;
      
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // --- Context Menu ---
  showContextMenu(x, y, node) {
    const existing = document.querySelector('.node-context-menu');
    if (existing) existing.remove();
    
    const menu = document.createElement('div');
    menu.className = 'node-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.zIndex = 1000;
    menu.innerHTML = `
      <button data-action="duplicate">Duplicate</button>
      <button data-action="delete">Delete</button>
      <hr>
      <button data-action="copy">Copy</button>
      <button data-action="paste">Paste</button>
    `;
    
    menu.querySelector('[data-action="duplicate"]').onclick = () => {
      const newNode = graph.addNode(node.type, { x: node.position.value.x + 40, y: node.position.value.y + 40 });
      node.widgets.forEach((v, k) => newNode.setWidget(k, v));
      menu.remove();
    };
    
    menu.querySelector('[data-action="delete"]').onclick = () => {
      graph.removeNode(node.id);
      menu.remove();
    };
    
    menu.querySelector('[data-action="copy"]').onclick = () => {
      graph.clipboard = node.toJSON();
      menu.remove();
    };
    
    menu.querySelector('[data-action="paste"]').onclick = () => {
      if (graph.clipboard) {
        const pos = { x: node.position.value.x + 40, y: node.position.value.y + 40 };
        const newNode = graph.addNode(graph.clipboard.type, pos);
        graph.clipboard.widgets && Object.entries(graph.clipboard.widgets).forEach(([k, v]) => newNode.setWidget(k, v));
      }
      menu.remove();
    };
    
    document.body.appendChild(menu);
    const close = () => { menu.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  // --- Render Loop ---
  startRenderLoop() {
    const render = () => {
      this.render();
      this.frameId = requestAnimationFrame(render);
    };
    render();
  }

  render() {
    if (!this.dirty) return;
    this.dirty = false;
    
    const { width, height } = this.container.getBoundingClientRect();
    const vp = this.viewport.value;
    
    // Clear
    this.ctx.clearRect(0, 0, width, height);
    
    // Grid
    if (this.options.grid) this.drawGrid(width, height, vp);
    
    // Edges
    this.drawEdges(vp);
    
    // Connection in progress
    if (this.connecting.value) this.drawConnection(vp);
    
    // Selection box
    if (this.selectionBox.value) this.drawSelectionBox();
    
    // Minimap
    if (this.minimapCtx) this.renderMinimap();
  }

  drawGrid(width, height, vp) {
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    this.ctx.lineWidth = 1;
    
    const gridSize = GRID_SIZE * vp.zoom;
    const startX = -(vp.x % gridSize);
    const startY = -(vp.y % gridSize);
    
    for (let x = startX; x < width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();
    }
    for (let y = startY; y < height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawEdges(vp) {
    this.ctx.save();
    this.ctx.lineWidth = 2;
    
    graph.getEdges().forEach(edge => {
      const source = graph.getNode(edge.source);
      const target = graph.getNode(edge.target);
      if (!source || !target) return;
      
      const sourcePort = source.getOutput(edge.sourceOutput);
      const targetPort = target.getInput(edge.targetInput);
      if (!sourcePort || !targetPort) return;
      
      const sp = source.getOutputPortPosition(edge.sourceOutput);
      const tp = target.getInputPortPosition(edge.targetInput);
      
      const sx = sp.x * vp.zoom + vp.x;
      const sy = sp.y * vp.zoom + vp.y;
      const tx = tp.x * vp.zoom + vp.x;
      const ty = tp.y * vp.zoom + vp.y;
      
      // Color by type
      const colors = { '*': '#7c5cff', 'MODEL': '#00f0ff', 'CLIP': '#10b981', 'VAE': '#f59e0b', 'CONDITIONING': '#e11d48', 'LATENT': '#7c5cff', 'IMAGE': '#4edea3', 'CONTROL_NET': '#8b5cf6', 'UPSCALE_MODEL': '#f97316', 'MASK': '#6366f1' };
      const color = colors[sourcePort.type] || '#7c5cff';
      
      this.ctx.strokeStyle = color;
      this.ctx.beginPath();
      this.ctx.moveTo(sx, sy);
      
      // Bezier curve
      const cp1x = sx + (tx - sx) * 0.4;
      const cp1y = sy;
      const cp2x = sx + (tx - sx) * 0.6;
      const cp2y = ty;
      this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tx, ty);
      this.ctx.stroke();
      
      // Arrow head
      const angle = Math.atan2(ty - cp2y, tx - cp2x);
      const headLen = 10;
      this.ctx.beginPath();
      this.ctx.moveTo(tx, ty);
      this.ctx.lineTo(tx - headLen * Math.cos(angle - Math.PI / 6), ty - headLen * Math.sin(angle - Math.PI / 6));
      this.ctx.lineTo(tx - headLen * Math.cos(angle + Math.PI / 6), ty - headLen * Math.sin(angle + Math.PI / 6));
      this.ctx.closePath();
      this.ctx.fillStyle = color;
      this.ctx.fill();
    });
    
    this.ctx.restore();
  }

  drawConnection(vp) {
    const c = this.connecting.value;
    if (!c || !c.currentPos) return;
    
    const node = graph.getNode(c.nodeId);
    if (!node) return;
    
    const port = c.isOutput ? node.getOutput(c.portName) : node.getInput(c.portName);
    const pos = c.isOutput ? node.getOutputPortPosition(c.portName) : node.getInputPortPosition(c.portName);
    
    const sx = pos.x * vp.zoom + vp.x;
    const sy = pos.y * vp.zoom + vp.y;
    const tx = c.currentPos.x * vp.zoom + vp.x;
    const ty = c.currentPos.y * vp.zoom + vp.y;
    
    this.ctx.save();
    this.ctx.strokeStyle = '#7c5cff';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(sx, sy);
    const cp1x = sx + (tx - sx) * 0.4;
    const cp1y = sy;
    const cp2x = sx + (tx - sx) * 0.6;
    const cp2y = ty;
    this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tx, ty);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawSelectionBox() {
    const box = this.selectionBox.value;
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(124, 92, 255, 0.8)';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 4]);
    this.ctx.strokeRect(box.x, box.y, box.w, box.h);
    this.ctx.fillStyle = 'rgba(124, 92, 255, 0.1)';
    this.ctx.fillRect(box.x, box.y, box.w, box.h);
    this.ctx.restore();
  }

  renderMinimap() {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, w, h);
    
    // Nodes
    const nodes = graph.getAllNodes();
    if (nodes.length === 0) return;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const p = n.position.value;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + n.size.width);
      maxY = Math.max(maxY, p.y + (n.size.height || 200));
    });
    
    const scaleX = w / (maxX - minX + 200);
    const scaleY = h / (maxY - minY + 200);
    const scale = Math.min(scaleX, scaleY) * 0.9;
    const offsetX = (w - (maxX - minX) * scale) / 2 - minX * scale;
    const offsetY = (h - (maxY - minY) * scale) / 2 - minY * scale;
    
    // Viewport rect
    const vp = this.viewport.value;
    const vpRect = {
      x: (vp.x * -1) * scale + offsetX,
      y: (vp.y * -1) * scale + offsetY,
      w: (this.container.clientWidth / vp.zoom) * scale,
      h: (this.container.clientHeight / vp.zoom) * scale,
    };
    
    // Draw nodes
    nodes.forEach(n => {
      const p = n.position.value;
      const x = p.x * scale + offsetX;
      const y = p.y * scale + offsetY;
      const sw = n.size.width * scale;
      const sh = (n.size.height || 200) * scale;
      
      ctx.fillStyle = graph.selected.has(n.id) ? '#7c5cff' : '#2c2f34';
      ctx.fillRect(x, y, Math.max(2, sw), Math.max(2, sh));
    });
    
    // Draw viewport
    ctx.strokeStyle = '#7c5cff';
    ctx.lineWidth = 2;
    ctx.strokeRect(vpRect.x, vpRect.y, vpRect.w, vpRect.h);
    
    // Click on minimap to navigate
    this.minimapCanvas.onclick = e => {
      const rect = this.minimapCanvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - offsetX) / scale;
      const my = (e.clientY - rect.top - offsetY) / scale;
      this.viewport.value = {
        x: -mx * vp.zoom + this.container.clientWidth / 2,
        y: -my * vp.zoom + this.container.clientHeight / 2,
        zoom: vp.zoom,
      };
      this.dirty = true;
    };
  }

  /** Recadre la vue pour faire tenir tous les nœuds. */
  fitView() {
    const nodes = graph.getAllNodes();
    if (!nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const p = n.position.value;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + n.size.width);
      maxY = Math.max(maxY, p.y + 280);
    });
    const rect = this.container.getBoundingClientRect();
    const pad = 60;
    const w = Math.max(1, maxX - minX + pad * 2);
    const h = Math.max(1, maxY - minY + pad * 2);
    const zoom = Math.min(rect.width / w, rect.height / h, 1.6);
    this.viewport.value = {
      x: rect.width / 2 - ((minX + maxX) / 2) * zoom,
      y: rect.height / 2 - ((minY + maxY) / 2) * zoom,
      zoom,
    };
    this.dirty = true;
    this.rebuildNodes();
  }

  destroy() {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.canvas.remove();
    this.nodesLayer.remove();
    if (this.minimapCanvas) this.minimapCanvas.remove();
  }
}

export function createCanvas(container, options) {
  return new Canvas(container, options);
}
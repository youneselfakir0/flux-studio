/**
 * Flux Studio v2 — Minimap
 * Overview navigation for large graphs
 */

import { Signal, effect } from '../core/state.js';
import { graph } from './graph.js';

export class Minimap {
  constructor(container, canvas, options = {}) {
    this.container = container;
    this.canvas = canvas; // Main canvas for coordination
    this.options = options;
    
    this.canvasEl = null;
    this.ctx = null;
    this.dragging = false;
    
    this.init();
    this.bindEvents();
  }

  init() {
    this.container.className = 'graph-minimap';
    this.container.innerHTML = '<canvas></canvas>';
    
    this.canvasEl = this.container.querySelector('canvas');
    this.ctx = this.canvasEl.getContext('2d');
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvasEl.width = rect.width * dpr;
    this.canvasEl.height = rect.height * dpr;
    this.canvasEl.style.width = rect.width + 'px';
    this.canvasEl.style.height = rect.height + 'px';
    this.ctx.scale(dpr, dpr);
  }

  bindEvents() {
    // Click to navigate
    this.canvasEl.addEventListener('click', e => {
      const rect = this.canvasEl.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.navigateTo(mx, my);
    });
    
    // Drag viewport
    this.canvasEl.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.dragViewport(e);
    });
    
    window.addEventListener('mousemove', e => {
      if (!this.dragging) return;
      this.dragViewport(e);
    });
    
    window.addEventListener('mouseup', () => {
      this.dragging = false;
    });
  }

  dragViewport(e) {
    const rect = this.canvasEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    this.navigateTo(mx, my);
  }

  navigateTo(mx, my) {
    const { width, height } = this.getGraphBounds();
    const scaleX = this.canvasEl.width / width;
    const scaleY = this.canvasEl.height / height;
    const scale = Math.min(scaleX, scaleY) * 0.9;
    
    const graphX = (mx / scale) - width / 2;
    const graphY = (my / scale) - height / 2;
    
    if (this.canvas && this.canvas.viewport) {
      this.canvas.viewport.value = {
        x: -graphX * this.canvas.viewport.value.zoom + this.canvas.container.clientWidth / 2,
        y: -graphY * this.canvas.viewport.value.zoom + this.canvas.container.clientHeight / 2,
        zoom: this.canvas.viewport.value.zoom,
      };
    }
  }

  getGraphBounds() {
    const nodes = graph.getAllNodes();
    if (nodes.length === 0) return { width: 1000, height: 1000 };
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const p = n.position.value;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + n.size.width);
      maxY = Math.max(maxY, p.y + (n.size.height || 200));
    });
    
    return {
      width: maxX - minX + 200,
      height: maxY - minY + 200,
      minX, minY, maxX, maxY,
    };
  }

  render() {
    if (!this.ctx) return;
    
    const { width, height, minX, minY } = this.getGraphBounds();
    const cw = this.canvasEl.width / (window.devicePixelRatio || 1);
    const ch = this.canvasEl.height / (window.devicePixelRatio || 1);
    
    const scaleX = cw / width;
    const scaleY = ch / height;
    const scale = Math.min(scaleX, scaleY) * 0.9;
    const offsetX = (cw - width * scale) / 2 - minX * scale;
    const offsetY = (ch - height * scale) / 2 - minY * scale;
    
    // Clear
    this.ctx.clearRect(0, 0, cw, ch);
    this.ctx.fillStyle = '#0b0d10';
    this.ctx.fillRect(0, 0, cw, ch);
    
    // Nodes
    const nodes = graph.getAllNodes();
    nodes.forEach(n => {
      const p = n.position.value;
      const x = p.x * scale + offsetX;
      const y = p.y * scale + offsetY;
      const w = Math.max(3, n.size.width * scale);
      const h = Math.max(3, (n.size.height || 200) * scale);
      
      this.ctx.fillStyle = graph.selected.has(n.id) ? '#7c5cff' : '#2c2f34';
      this.ctx.fillRect(x, y, w, h);
      
      // Executing indicator
      if (n.executing.value) {
        this.ctx.strokeStyle = '#00f0ff';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
      }
    });
    
    // Edges
    this.ctx.strokeStyle = 'rgba(124, 92, 255, 0.3)';
    this.ctx.lineWidth = 1;
    graph.getEdges().forEach(edge => {
      const source = graph.getNode(edge.source);
      const target = graph.getNode(edge.target);
      if (!source || !target) return;
      
      const sp = source.getOutputPortPosition(edge.sourceOutput);
      const tp = target.getInputPortPosition(edge.targetInput);
      
      const sx = sp.x * scale + offsetX;
      const sy = sp.y * scale + offsetY;
      const tx = tp.x * scale + offsetX;
      const ty = tp.y * scale + offsetY;
      
      this.ctx.beginPath();
      this.ctx.moveTo(sx, sy);
      this.ctx.lineTo(tx, ty);
      this.ctx.stroke();
    });
    
    // Viewport rect
    if (this.canvas && this.canvas.viewport) {
      const vp = this.canvas.viewport.value;
      const vpRect = {
        x: (vp.x * -1) * scale + offsetX,
        y: (vp.y * -1) * scale + offsetY,
        w: (this.canvas.container.clientWidth / vp.zoom) * scale,
        h: (this.canvas.container.clientHeight / vp.zoom) * scale,
      };
      
      this.ctx.strokeStyle = '#7c5cff';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(vpRect.x, vpRect.y, vpRect.w, vpRect.h);
    }
  }

  destroy() {
    this.container.innerHTML = '';
  }
}

export function createMinimap(container, canvas, options) {
  return new Minimap(container, canvas, options);
}
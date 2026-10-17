/**
 * Flux Studio v2 — Canvas 2D Editor (Inpaint / Outpaint)
 * Brush, eraser, mask tools, layer support, preview
 */

import { Signal, effect, derived } from '../core/state.js';
import { bus, Events } from '../core/events.js';

export class Canvas2D {
  constructor(container, options = {}) {
    this.container = container;
    this.options = { 
      mode: 'inpaint', // inpaint, outpaint
      brushSize: 50,
      brushOpacity: 1,
      brushHardness: 0.5,
      tool: 'brush', // brush, eraser, fill, select, move, hand
      showMask: true,
      ...options 
    };
    
    this.image = null; // HTMLImageElement
    this.maskCanvas = null; // mask layer
    this.layers = new Signal([]);
    this.activeLayer = new Signal(0);
    this.zoom = new Signal(1);
    this.pan = new Signal({ x: 0, y: 0 });
    this.history = [];
    this.historyIndex = -1;
    this.drawing = false;
    this.lastPoint = null;
    
    this.init();
    this.bindEvents();
  }

  init() {
    this.container.className = 'canvas2d-editor';
    this.container.innerHTML = `
      <div class="canvas2d-toolbar">
        <div class="tool-group">
          <button class="tool-btn active" data-tool="brush" title="Brush (B)">✏️</button>
          <button class="tool-btn" data-tool="eraser" title="Eraser (E)">🧽</button>
          <button class="tool-btn" data-tool="fill" title="Fill (F)">⬛</button>
          <button class="tool-btn" data-tool="select" title="Select (V)">⬚</button>
          <button class="tool-btn" data-tool="hand" title="Pan (H)">✋</button>
        </div>
        <div class="tool-group">
          <input type="range" id="brushSize" min="1" max="500" value="50" title="Brush Size">
          <input type="range" id="brushOpacity" min="0" max="1" step="0.05" value="1" title="Brush Opacity">
        </div>
        <div class="tool-group">
          <button class="tool-btn" id="undoBtn" title="Undo (Ctrl+Z)">↶</button>
          <button class="tool-btn" id="redoBtn" title="Redo (Ctrl+Shift+Z)">↷</button>
        </div>
        <div class="tool-group">
          <button class="tool-btn" id="maskInvert" title="Invert Mask">⇅</button>
          <button class="tool-btn" id="maskClear" title="Clear Mask">🗑</button>
          <button class="tool-btn active" id="maskVisible" title="Show Mask">👁</button>
        </div>
        <div class="tool-group">
          <button class="btn ghost sm" id="exportBtn">💾 Export Mask</button>
          <button class="btn primary sm" id="applyBtn">Apply → Workflow</button>
        </div>
      </div>
      <div class="canvas2d-container">
        <canvas class="canvas2d-main"></canvas>
        <canvas class="canvas2d-mask-overlay"></canvas>
      </div>
      <div class="canvas2d-status">
        <span id="coordDisplay">0, 0</span>
        <span id="zoomDisplay">100%</span>
      </div>
    `;
    
    this.mainCanvas = this.container.querySelector('.canvas2d-main');
    this.overlayCanvas = this.container.querySelector('.canvas2d-mask-overlay');
    this.mainCtx = this.mainCanvas.getContext('2d');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    
    this.brushSizeInput = this.container.querySelector('#brushSize');
    this.brushOpacityInput = this.container.querySelector('#brushOpacity');
    this.coordDisplay = this.container.querySelector('#coordDisplay');
    this.zoomDisplay = this.container.querySelector('#zoomDisplay');
  }

  bindEvents() {
    // Tools
    this.container.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.options.tool = btn.dataset.tool;
        this.container.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.updateCursor();
      });
    });
    
    // Brush controls
    this.brushSizeInput.addEventListener('input', e => {
      this.options.brushSize = +e.target.value;
    });
    this.brushOpacityInput.addEventListener('input', e => {
      this.options.brushOpacity = +e.target.value;
    });
    
    // Undo/Redo
    this.container.querySelector('#undoBtn').addEventListener('click', () => this.undo());
    this.container.querySelector('#redoBtn').addEventListener('click', () => this.redo());
    
    // Mask controls
    this.container.querySelector('#maskInvert').addEventListener('click', () => this.invertMask());
    this.container.querySelector('#maskClear').addEventListener('click', () => this.clearMask());
    this.container.querySelector('#maskVisible').addEventListener('click', (e) => {
      this.options.showMask = !this.options.showMask;
      e.currentTarget.classList.toggle('active', this.options.showMask);
      this.render();
    });
    
    // Export
    this.container.querySelector('#exportBtn').addEventListener('click', () => this.exportMask());
    
    // Apply
    this.container.querySelector('#applyBtn').addEventListener('click', () => this.applyToWorkflow());
    
    // Drawing
    this.overlayCanvas.addEventListener('mousedown', (e) => {
      if (this.options.tool === 'hand') return;
      this.startDrawing(e);
    });
    this.overlayCanvas.addEventListener('mousemove', (e) => {
      this.updateCoords(e);
      if (this.drawing) this.draw(e);
    });
    window.addEventListener('mouseup', () => this.stopDrawing());
    
    // Zoom
    this.overlayCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom.value = Math.max(0.1, Math.min(5, this.zoom.value * delta));
      this.zoomDisplay.textContent = Math.round(this.zoom.value * 100) + '%';
      this.render();
    }, { passive: false });
    
    // Pan (with hand tool or middle click)
    let panning = false, panStart = { x: 0, y: 0 };
    this.overlayCanvas.addEventListener('mousedown', (e) => {
      if (this.options.tool === 'hand' || e.button === 1) {
        panning = true;
        panStart = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!panning) return;
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      this.pan.value = { x: this.pan.value.x + dx, y: this.pan.value.y + dy };
      panStart = { x: e.clientX, y: e.clientY };
      this.render();
    });
    window.addEventListener('mouseup', () => { panning = false; });
    
    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (!this.container.contains(document.activeElement) && e.target.tagName !== 'CANVAS') return;
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo(); else this.undo();
      } else if (e.key === 'b') this.setTool('brush');
      else if (e.key === 'e') this.setTool('eraser');
      else if (e.key === 'f') this.setTool('fill');
      else if (e.key === 'v') this.setTool('select');
      else if (e.key === 'h') this.setTool('hand');
      else if (e.key === '[') {
        this.options.brushSize = Math.max(1, this.options.brushSize - 5);
        this.brushSizeInput.value = this.options.brushSize;
      } else if (e.key === ']') {
        this.options.brushSize = Math.min(500, this.options.brushSize + 5);
        this.brushSizeInput.value = this.options.brushSize;
      }
    });
    
    // Resize
    window.addEventListener('resize', () => this.resize());
  }

  setTool(tool) {
    this.options.tool = tool;
    this.container.querySelectorAll('[data-tool]').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    this.updateCursor();
  }

  updateCursor() {
    const cursors = { brush: 'crosshair', eraser: 'crosshair', fill: 'cell', select: 'crosshair', hand: 'grab' };
    this.overlayCanvas.style.cursor = cursors[this.options.tool] || 'crosshair';
  }

  resize() {
    const rect = this.container.querySelector('.canvas2d-container').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    [this.mainCanvas, this.overlayCanvas].forEach(canvas => {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
    });
    
    this.mainCtx.scale(dpr, dpr);
    this.overlayCtx.scale(dpr, dpr);
    this.render();
  }

  async loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.image = img;
        this.canvasWidth = img.naturalWidth;
        this.canvasHeight = img.naturalHeight;
        this.initMaskCanvas();
        this.resize();
        this.render();
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  initMaskCanvas() {
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.canvasWidth;
    this.maskCanvas.height = this.canvasHeight;
    this.maskCtx = this.maskCanvas.getContext('2d');
    // Mask starts transparent (nothing selected)
    this.maskCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
  }

  getPointerPos(e) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    const zoom = this.zoom.value;
    const pan = this.pan.value;
    
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;
    
    return { x, y };
  }

  updateCoords(e) {
    const pos = this.getPointerPos(e);
    this.coordDisplay.textContent = `${Math.round(pos.x)}, ${Math.round(pos.y)}`;
  }

  startDrawing(e) {
    this.drawing = true;
    const pos = this.getPointerPos(e);
    this.lastPoint = pos;
    
    if (this.options.tool === 'fill') {
      this.fillAt(pos.x, pos.y);
      this.drawing = false;
      this.saveHistory();
      return;
    }
    
    this.drawDot(pos.x, pos.y);
  }

  draw(e) {
    const pos = this.getPointerPos(e);
    
    if (this.options.tool === 'brush' || this.options.tool === 'eraser') {
      this.drawLine(this.lastPoint.x, this.lastPoint.y, pos.x, pos.y);
      this.lastPoint = pos;
      this.render();
    }
  }

  stopDrawing() {
    if (this.drawing) {
      this.drawing = false;
      this.saveHistory();
    }
  }

  drawDot(x, y) {
    const ctx = this.maskCtx;
    const size = this.options.brushSize;
    const opacity = this.options.brushOpacity;
    
    if (this.options.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${opacity})`;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(255,0,0,${opacity})`;
    }
    
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  drawLine(x1, y1, x2, y2) {
    const ctx = this.maskCtx;
    const size = this.options.brushSize;
    const opacity = this.options.brushOpacity;
    
    if (this.options.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = `rgba(0,0,0,${opacity})`;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = `rgba(255,0,0,${opacity})`;
    }
    
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  fillAt(x, y) {
    // Simple flood fill on the mask
    const ctx = this.maskCtx;
    const imageData = ctx.getImageData(0, 0, this.canvasWidth, this.canvasHeight);
    const data = imageData.data;
    const w = this.canvasWidth, h = this.canvasHeight;
    
    const startX = Math.floor(x), startY = Math.floor(y);
    const startIdx = (startY * w + startX) * 4;
    const targetR = data[startIdx];
    const targetG = data[startIdx + 1];
    const targetB = data[startIdx + 2];
    const targetA = data[startIdx + 3];
    
    if (targetA > 0) return; // Already filled
    
    const stack = [[startX, startY]];
    const visited = new Uint8Array(w * h);
    
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
      const idx = cy * w + cx;
      if (visited[idx]) continue;
      
      const di = idx * 4;
      if (data[di + 3] !== targetA) continue;
      
      visited[idx] = 1;
      data[di] = 255;
      data[di + 1] = 0;
      data[di + 2] = 0;
      data[di + 3] = 255;
      
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    
    ctx.putImageData(imageData, 0, 0);
    this.render();
  }

  invertMask() {
    const ctx = this.maskCtx;
    const imageData = ctx.getImageData(0, 0, this.canvasWidth, this.canvasHeight);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
      data[i + 3] = 255 - data[i + 3];
    }
    
    ctx.putImageData(imageData, 0, 0);
    this.saveHistory();
    this.render();
  }

  clearMask() {
    this.maskCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    this.saveHistory();
    this.render();
  }

  render() {
    if (!this.image || !this.maskCanvas) return;
    
    const ctx = this.mainCtx;
    const overlayCtx = this.overlayCtx;
    const rect = this.container.querySelector('.canvas2d-container').getBoundingClientRect();
    const zoom = this.zoom.value;
    const pan = this.pan.value;
    
    ctx.clearRect(0, 0, rect.width, rect.height);
    overlayCtx.clearRect(0, 0, rect.width, rect.height);
    
    // Center image
    const imgW = this.canvasWidth * zoom;
    const imgH = this.canvasHeight * zoom;
    const x = (rect.width - imgW) / 2 + pan.x;
    const y = (rect.height - imgH) / 2 + pan.y;
    
    // Draw main image
    ctx.drawImage(this.image, x, y, imgW, imgH);
    
    // Draw mask overlay
    if (this.options.showMask) {
      overlayCtx.globalAlpha = 0.5;
      overlayCtx.drawImage(this.maskCanvas, x, y, imgW, imgH);
      overlayCtx.globalAlpha = 1;
    }
    
    // Draw brush cursor
    if (this.drawing && (this.options.tool === 'brush' || this.options.tool === 'eraser')) {
      const pos = this.getPointerPos(this.lastEvent);
      if (pos) {
        overlayCtx.strokeStyle = '#fff';
        overlayCtx.lineWidth = 1;
        overlayCtx.beginPath();
        overlayCtx.arc(pos.x * zoom + x - imgW / 2, pos.y * zoom + y - imgH / 2, this.options.brushSize * zoom / 2, 0, Math.PI * 2);
        overlayCtx.stroke();
      }
    }
    
    // Grid overlay for outpaint mode
    if (this.options.mode === 'outpaint') {
      overlayCtx.strokeStyle = 'rgba(124, 92, 255, 0.3)';
      overlayCtx.lineWidth = 1;
      overlayCtx.setLineDash([4, 4]);
      overlayCtx.strokeRect(x, y, imgW, imgH);
      overlayCtx.setLineDash([]);
    }
  }

  saveHistory() {
    if (!this.maskCanvas) return;
    
    const snapshot = document.createElement('canvas');
    snapshot.width = this.maskCanvas.width;
    snapshot.height = this.maskCanvas.height;
    snapshot.getContext('2d').drawImage(this.maskCanvas, 0, 0);
    
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snapshot);
    if (this.history.length > 50) this.history.shift();
    else this.historyIndex++;
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    const snapshot = this.history[this.historyIndex];
    if (snapshot && this.maskCtx) {
      this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      this.maskCtx.drawImage(snapshot, 0, 0);
      this.render();
    }
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    const snapshot = this.history[this.historyIndex];
    if (snapshot && this.maskCtx) {
      this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      this.maskCtx.drawImage(snapshot, 0, 0);
      this.render();
    }
  }

  exportMask() {
    if (!this.maskCanvas) return;
    const link = document.createElement('a');
    link.download = 'mask.png';
    link.href = this.maskCanvas.toDataURL('image/png');
    link.click();
  }

  getMaskDataURL() {
    return this.maskCanvas ? this.maskCanvas.toDataURL('image/png') : null;
  }

  applyToWorkflow() {
    const maskData = this.getMaskDataURL();
    if (!maskData) return;
    
    // Emit event with mask for workflow to consume
    Events.canvas2d.emit('canvas2d:apply', {
      mask: maskData,
      image: this.image?.src,
      width: this.canvasWidth,
      height: this.canvasHeight,
    });
    
    if (window.showToast) window.showToast('Mask applied to workflow');
  }

  destroy() {
    this.container.innerHTML = '';
  }
}

export function createCanvas2D(container, options) {
  return new Canvas2D(container, options);
}
/**
 * Flux Studio v2 — Event Bus
 * Lightweight pub/sub with namespaces, once, off
 */

export class EventBus {
  constructor() {
    this._events = new Map(); // event -> Set(handler)
    this._once = new Map();   // event -> Set(handler)
  }

  on(event, handler) {
    if (!this._events.has(event)) this._events.set(event, new Set());
    this._events.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      handler(...args);
    };
    if (!this._once.has(event)) this._once.set(event, new Set());
    this._once.get(event).add(wrapper);
    return this.on(event, wrapper);
  }

  off(event, handler) {
    const set = this._events.get(event);
    if (set) set.delete(handler);
    const onceSet = this._once.get(event);
    if (onceSet) onceSet.delete(handler);
  }

  emit(event, ...args) {
    const set = this._events.get(event);
    if (set) set.forEach(h => { try { h(...args); } catch (e) { console.error('Event handler error:', e); } });
    const onceSet = this._once.get(event);
    if (onceSet) onceSet.forEach(h => { try { h(...args); } catch (e) { console.error('Once handler error:', e); } });
  }

  offAll(event) {
    if (event) { this._events.delete(event); this._once.delete(event); }
    else { this._events.clear(); this._once.clear(); }
  }

  listenerCount(event) {
    return (this._events.get(event)?.size || 0) + (this._once.get(event)?.size || 0);
  }
}

export const bus = new EventBus();

// Convenience: namespaced events
export function namespace(ns) {
  return {
    on: (event, h) => bus.on(ns + ':' + event, h),
    once: (event, h) => bus.once(ns + ':' + event, h),
    off: (event, h) => bus.off(ns + ':' + event, h),
    emit: (event, ...args) => bus.emit(ns + ':' + event, ...args),
  };
}

// Common namespaces
export const Events = {
  graph: namespace('graph'),      // graph:node-add, graph:node-remove, graph:connect, graph:execute
  canvas: namespace('canvas'),    // canvas:pan, canvas:zoom, canvas:select, canvas:deselect
  palette: namespace('palette'),  // palette:search, palette:drag-start
  inspector: namespace('inspector'), // inspector:show, inspector:hide
  gallery: namespace('gallery'),  // gallery:select, gallery:load-more, gallery:favorite
  queue: namespace('queue'),      // queue:add, queue:progress, queue:done, queue:error
  models: namespace('models'),    // models:install, models:scan, models:refresh
  prompt: namespace('prompt'),    // prompt:enhance, prompt:apply, prompt:save
  canvas2d: namespace('canvas2d'), // canvas2d:mask-change, canvas2d:tool-change
  workflow: namespace('workflow'), // workflow:save, workflow:load, workflow:validate
  ui: namespace('ui'),            // ui:toast, ui:modal-open, ui:modal-close
  lora: namespace('lora'),        // lora:indexed, lora:applied, lora:trigger-written
};
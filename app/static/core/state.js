/**
 * Flux Studio v2 — Reactive State Store
 * Signals-like reactivity, zero dependencies.
 * Usage:
 *   import { Signal, derived, effect, batch } from '../core/state.js';
 *   const count = new Signal(0);
 *   const doubled = derived(() => count.value * 2);
 *   effect(() => console.log('count changed:', count.value));
 *   batch(() => { count.value = 1; count.value = 2; });
 */

let currentEffect = null;

export class Signal {
  constructor(initial) {
    this._value = initial;
    this._subs = new Set();
    this._version = 0;
  }

  get value() {
    if (currentEffect) this._subs.add(currentEffect);
    return this._value;
  }

  set value(v) {
    if (Object.is(this._value, v)) return;
    this._value = v;
    this._version++;
    this._subs.forEach(fn => fn());
  }

  peek() { return this._value; }
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  toString() { return String(this._value); }
}

export function effect(fn) {
  const wrapped = () => {
    const prev = currentEffect;
    currentEffect = wrapped;
    try { fn(); } finally { currentEffect = prev; }
  };
  wrapped();
  return () => { /* unsubscribe not tracked */ };
}

export function derived(fn) {
  const s = new Signal(undefined);
  effect(() => { s.value = fn(); });
  return s;
}

export function computed(fn) { return derived(fn); }

export function batch(fn) {
  const prev = currentEffect;
  currentEffect = null;
  try { fn(); } finally { currentEffect = prev; }
}

// Persisted state helpers
export function persisted(key, initial) {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(key)); } catch {}
  const s = new Signal(stored ?? initial);
  effect(() => {
    try { localStorage.setItem(key, JSON.stringify(s.value)); } catch {}
  });
  return s;
}

export function persistedObject(key, initial) {
  return persisted(key, initial);
}
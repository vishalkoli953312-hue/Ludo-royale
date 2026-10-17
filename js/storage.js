// localStorage wrapper that never throws (private mode / quota / disabled storage).

export class MemoryStorage {
  constructor() { this.m = new Map(); this.persistent = false; }
  get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  set(k, v) { this.m.set(k, String(v)); }
  remove(k) { this.m.delete(k); }
}

export function createStorage() {
  try {
    const probe = '__ludo_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return {
      persistent: true,
      get: (k) => { try { return window.localStorage.getItem(k); } catch { return null; } },
      set: (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* quota */ } },
      remove: (k) => { try { window.localStorage.removeItem(k); } catch { /* ignore */ } },
    };
  } catch {
    return new MemoryStorage();
  }
}

export function readJSON(store, key, fallback) {
  try {
    const raw = store.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
export function writeJSON(store, key, value) { store.set(key, JSON.stringify(value)); }

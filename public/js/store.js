// Everything the app remembers lives in localStorage on the user's device (no accounts, no server state).
const PREFIX = 'rh:';

export const DEFAULT_SETTINGS = {
  gatewayUrl: '',
  gatewayToken: '',
  edge: true, // fetch FlixHub through the Pages edge proxy when no gateway is set
  providers: { 'bdix-df': true, 'bdix-cf': true, 'bdix-fh': true, fendrix: true, hexion: true },
  compat: false, // true = only the file types the original extension accepted (mkv/mp4/avi)
  subLangs: ['en'],
  autoSubs: true,
  subStyle: { size: 100, color: '#ffffff', bg: 'shadow', bottom: 6 },
  autoNext: true,
  preferCompatible: true, // pick the best source the browser can most likely play
};

const MAX_HISTORY = 40;
const MAX_PROGRESS = 300;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

export function createStore(storage) {
  let st = storage;
  if (!st) { try { st = globalThis.localStorage; st.getItem('x'); } catch { st = memoryStorage(); } }
  const listeners = new Set();
  const read = (key, fallback) => { try { const v = st.getItem(PREFIX + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } };
  const write = (key, value) => { try { st.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage full or blocked: keep running */ } listeners.forEach((fn) => fn(key)); };
  const merge = (base, over) => {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' ? { ...base[k], ...v } : v;
    return out;
  };

  return {
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    // ---- settings ----
    settings: () => merge(DEFAULT_SETTINGS, read('settings', {})),
    saveSettings(patch) { const next = merge(this.settings(), patch); write('settings', next); return next; },
    resetSettings() { write('settings', {}); },
    // ---- watch progress ----
    progress: (key) => read('progress', {})[key] || null,
    saveProgress(key, pos, dur) {
      const all = read('progress', {});
      all[key] = { pos: Math.floor(pos), dur: Math.floor(dur), ts: Date.now() };
      const keys = Object.keys(all);
      if (keys.length > MAX_PROGRESS) keys.sort((a, b) => all[a].ts - all[b].ts).slice(0, keys.length - MAX_PROGRESS).forEach((k) => delete all[k]);
      write('progress', all);
    },
    clearProgress(key) { const all = read('progress', {}); delete all[key]; write('progress', all); },
    clearAllProgress() { write('progress', {}); },
    clearHistory() { write('history', []); },
    /** resume only if meaningfully into the video and not near the end */
    resumePoint(key) {
      const p = this.progress(key);
      if (!p || !p.dur) return 0;
      return p.pos > 30 && p.pos < p.dur * 0.93 ? p.pos : 0;
    },
    // ---- history (continue watching) ----
    history: () => read('history', []),
    pushHistory(entry) {
      const rest = this.history().filter((h) => !(h.type === entry.type && h.id === entry.id));
      write('history', [{ ...entry, ts: Date.now() }, ...rest].slice(0, MAX_HISTORY));
    },
    removeHistory(type, id) { write('history', this.history().filter((h) => !(h.type === type && h.id === id))); },
    // ---- My List ----
    list: () => read('list', []),
    inList(type, id) { return this.list().some((x) => x.type === type && x.id === id); },
    toggleList(item) {
      const has = this.inList(item.type, item.id);
      write('list', has ? this.list().filter((x) => !(x.type === item.type && x.id === item.id)) : [{ type: item.type, id: item.id, title: item.title, year: item.year, poster: item.poster, rating: item.rating }, ...this.list()]);
      return !has;
    },
  };
}

export const store = createStore();

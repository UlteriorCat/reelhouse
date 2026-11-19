// The library document that is kept on the device and, for signed-in users, synced to their account.
// Merging two copies must never lose a change and never bring back something that was removed, whatever order
// devices sync in. Every item carries the time it last changed (`ts`); a removal is recorded as a tombstone with
// its own time. The newest of item vs. tombstone wins (last-writer-wins per item). merge() is pure, commutative
// and idempotent (tested), so devices converge.

export const DOC_VERSION = 1;
export const LIMITS = { history: 40, tombstones: 500, progress: 300, lists: 50, listItems: 500, listName: 60 };
export const DEFAULT_LIST = 'default';
/** Settings that follow the account. The gateway address/token are per device (and the token is a secret). */
export const SYNCED_SETTINGS = ['providers', 'compat', 'subLangs', 'autoSubs', 'subStyle', 'autoNext', 'preferCompatible'];

export const itemKey = (type, id) => `${type}:${id}`;
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
/** Own keys that are safe to copy into a plain object (never __proto__ & co., whatever a stored document says). */
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const entries = (v) => Object.entries(obj(v)).filter(([k]) => !BAD_KEYS.has(k));
const num = (v) => (Number.isFinite(v) ? v : 0);

export function emptyDoc() {
  return { v: DOC_VERSION, history: {}, historyDel: {}, lists: {}, listsDel: {}, progress: {}, settings: { ts: 0, value: {} } };
}

/** Keep the `n` entries with the largest ts. */
function newest(map, n, tsOf = (v) => num(v && v.ts)) {
  const keys = Object.keys(map);
  if (keys.length <= n) return map;
  const out = {};
  for (const k of keys.sort((a, b) => tsOf(map[b]) - tsOf(map[a]) || (a < b ? -1 : 1)).slice(0, n)) out[k] = map[k];
  return out;
}

/** Tombstones: newest time per key. */
function mergeDel(a, b) {
  const out = {};
  for (const [k, t] of entries(a)) out[k] = num(t);
  for (const [k, t] of entries((b))) if (!(k in out) || num(t) > out[k]) out[k] = num(t); // absent OR newer: same result in either order
  return newest(out, LIMITS.tombstones, (t) => num(t));
}

/** Items: newest ts per key, dropped when a tombstone is at least as new. Ties broken by JSON so both sides agree. */
function mergeItems(a, b, del) {
  const out = {};
  for (const src of [obj(a), obj(b)]) {
    for (const [k, v] of Object.entries(src)) {
      if (!v || typeof v !== 'object') continue;
      const cur = out[k];
      if (!cur || num(v.ts) > num(cur.ts) || (num(v.ts) === num(cur.ts) && JSON.stringify(v) > JSON.stringify(cur))) out[k] = v;
    }
  }
  for (const k of Object.keys(out)) if (Object.prototype.hasOwnProperty.call(del, k) && num(del[k]) >= num(out[k].ts)) delete out[k]; // only a real tombstone removes
  return out;
}

function mergeList(a, b) {
  // list metadata (name) is last-writer-wins on `nameTs`; `ts` is the last change of any kind (for list deletion)
  const meta = num(b.nameTs) > num(a.nameTs) || (num(b.nameTs) === num(a.nameTs) && String(b.name) > String(a.name)) ? b : a;
  const itemsDel = mergeDel(a.itemsDel, b.itemsDel);
  const items = newest(mergeItems(a.items, b.items, itemsDel), LIMITS.listItems);
  return { id: a.id || b.id, name: String(meta.name || 'List').slice(0, LIMITS.listName), nameTs: num(meta.nameTs), created: Math.min(...[num(a.created), num(b.created)].filter(Boolean), Number.MAX_SAFE_INTEGER) % Number.MAX_SAFE_INTEGER, ts: Math.max(num(a.ts), num(b.ts)), items, itemsDel };
}

export function merge(x, y) {
  const a = normalize(x);
  const b = normalize(y);
  const historyDel = mergeDel(a.historyDel, b.historyDel);
  const history = newest(mergeItems(a.history, b.history, historyDel), LIMITS.history);
  const listsDel = mergeDel(a.listsDel, b.listsDel);
  delete listsDel[DEFAULT_LIST]; // the default list cannot be deleted
  const lists = {};
  for (const id of new Set([...Object.keys(a.lists), ...Object.keys(b.lists)])) {
    const l = a.lists[id] && b.lists[id] ? mergeList(a.lists[id], b.lists[id]) : mergeList(a.lists[id] || b.lists[id], a.lists[id] || b.lists[id]);
    if (Object.prototype.hasOwnProperty.call(listsDel, id) && num(listsDel[id]) >= l.ts) continue; // deleted after its last change
    lists[id] = l;
  }
  const progress = newest(mergeItems(a.progress, b.progress, {}), LIMITS.progress);
  const settings = num(b.settings.ts) > num(a.settings.ts) || (num(b.settings.ts) === num(a.settings.ts) && JSON.stringify(b.settings.value) > JSON.stringify(a.settings.value)) ? b.settings : a.settings;
  return { v: DOC_VERSION, history, historyDel, lists: newest(lists, LIMITS.lists), listsDel, progress, settings };
}

/** Accepts anything (old or hostile data) and returns a well-formed document. */
export function normalize(d) {
  const doc = obj(d);
  const out = emptyDoc();
  for (const [k, v] of entries((doc.history))) if (v && typeof v === 'object' && (v.type === 'movie' || v.type === 'tv')) out.history[k] = v;
  out.historyDel = Object.fromEntries(entries(doc.historyDel));
  for (const [id, l] of entries((doc.lists))) {
    if (!l || typeof l !== 'object') continue;
    out.lists[id] = { id, name: String(l.name || 'List').slice(0, LIMITS.listName), nameTs: num(l.nameTs), created: num(l.created), ts: num(l.ts), items: Object.fromEntries(entries(l.items)), itemsDel: Object.fromEntries(entries(l.itemsDel)) };
  }
  out.listsDel = Object.fromEntries(entries(doc.listsDel));
  for (const [k, v] of entries((doc.progress))) if (v && typeof v === 'object' && Number.isFinite(v.pos) && Number.isFinite(v.dur)) out.progress[k] = v;
  const s = obj(doc.settings);
  const value = {};
  for (const k of SYNCED_SETTINGS) if (k in obj(s.value)) value[k] = s.value[k];
  out.settings = { ts: num(s.ts), value };
  return out;
}

/** Same content? (order-independent) */
export function sameDoc(a, b) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  return JSON.stringify(canon(normalize(a))) === JSON.stringify(canon(normalize(b)));
}

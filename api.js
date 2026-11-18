// Client for our own /api/* endpoints (see lib/api.js). Responses are cached in memory; the home page is also kept in
// localStorage so a repeat visit paints instantly (stale-while-revalidate).
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const mem = new Map();
const inflight = new Map();

async function getJson(path, { signal, ttl = 5 * 60_000 } = {}) {
  const hit = mem.get(path);
  if (hit && hit.exp > Date.now()) return hit.data;
  if (inflight.has(path) && !signal) return inflight.get(path);
  const p = (async () => {
    let res;
    try { res = await fetch(path, { signal }); } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new ApiError(0, 'offline', 'Could not reach the server. Check your connection.');
    }
    let body = null;
    try { body = await res.json(); } catch (e) {
      if (e && e.name === 'AbortError') throw e; // navigated away mid-download: must not look like an empty success
      if (res.ok) throw new ApiError(res.status, 'bad_response', 'The server sent an unreadable response.');
      /* non-JSON error page: fall through to the status-based error below */
    }
    if (!res.ok) throw new ApiError(res.status, (body && body.error) || 'error', (body && body.message) || `Request failed (${res.status})`);
    mem.set(path, { data: body, exp: Date.now() + ttl });
    return body;
  })();
  if (!signal) { inflight.set(path, p); p.finally(() => inflight.delete(path)).catch(() => {}); }
  return p;
}

const q = (o) => new URLSearchParams(o).toString();

export const api = {
  home: (signal) => getJson('/api/home', { signal }),
  title: (type, id, signal) => getJson(`/api/title/${type}/${id}`, { signal, ttl: 30 * 60_000 }),
  season: (id, n, signal) => getJson(`/api/season/${id}/${n}`, { signal, ttl: 30 * 60_000 }),
  search: (text, page = 1, signal) => getJson(`/api/search?${q({ q: text, page })}`, { signal }),
  recs: (type, id, signal) => getJson(`/api/recs/${type}/${id}`, { signal, ttl: 30 * 60_000 }),
  health: (signal) => getJson('/api/health', { signal, ttl: 60_000 }),
};

const HOME_KEY = 'rh:cache:home';
/** Calls onData with cached home data immediately (if any), then with fresh data. Resolves when fresh data arrived. */
export async function homeSWR(onData, signal) {
  try { const c = JSON.parse(localStorage.getItem(HOME_KEY) || 'null'); if (c && c.data && Date.now() - c.ts < 6 * 3600_000) onData(c.data, true); } catch { /* ignore broken cache */ }
  const fresh = await api.home(signal);
  if (!fresh || !Array.isArray(fresh.rows)) throw new ApiError(200, 'bad_response', 'The server sent an unreadable response.');
  try { localStorage.setItem(HOME_KEY, JSON.stringify({ ts: Date.now(), data: fresh })); } catch { /* storage full */ }
  onData(fresh, false);
  return fresh;
}

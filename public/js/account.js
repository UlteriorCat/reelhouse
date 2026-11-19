// Signed-in state and library sync. Everything still works signed out (device only); signed in, the library
// (history, lists, resume positions, synced settings) is merged with the account copy:
//   pull: GET /api/sync -> merge into this device -> push back if this device had something new
//   push: PUT /api/sync with the version last seen; 409 = another device wrote first -> merge its copy -> retry
// Merging is sync-merge.js (removals are tombstones, so they do not come back). Resume positions change every few
// seconds while playing, so a change that only touches them is pushed at most every 30 s.
import { store as defaultStore } from './store.js';
import { sameDoc } from './sync-merge.js';

const PUSH_DELAY = 1500;
const PROGRESS_DELAY = 30000;
const PULL_EVERY = 5 * 60000;

export class AccountError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

export function createAccount({ store = defaultStore, fetchImpl = (...a) => globalThis.fetch(...a), storage = null, delays = {} } = {}) {
  const PUSH = delays.push ?? PUSH_DELAY;
  const PROGRESS = delays.progress ?? PROGRESS_DELAY;
  const ls = storage || (() => { try { return globalThis.localStorage; } catch { return null; } })();
  const state = { enabled: null, user: null, sync: 'idle', lastSync: 0, error: '' };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn({ ...state }); } catch { /* listener bug must not stop sync */ } });
  let version = 0;
  let timer = null;
  let pullTimer = null;
  let running = null;
  let applying = false;
  let dirty = false;
  let offStore = null;

  const vKey = () => 'rh:syncVersion:' + (state.user ? state.user.username.toLowerCase() : '');
  const loadVersion = () => { try { version = Number(JSON.parse(ls.getItem(vKey()) || '0')) || 0; } catch { version = 0; } };
  const saveVersion = () => { try { ls.setItem(vKey(), JSON.stringify(version)); } catch { /* blocked */ } };

  async function api(method, path, body) {
    let res;
    try {
      res = await fetchImpl('/api' + path, { method, credentials: 'same-origin', headers: body === undefined && method === 'GET' ? {} : { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    } catch (e) { throw new AccountError(0, 'offline', 'No connection. Check your internet and try again.'); }
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 409 && data && data.error === 'conflict') return { conflict: true, ...data };
    if (!res.ok) throw new AccountError(res.status, (data && data.error) || 'error', (data && data.message) || `Request failed (${res.status})`);
    return data;
  }

  function setUser(user) {
    stop();
    state.user = user;
    state.sync = 'idle'; state.error = '';
    if (user) { loadVersion(); start(); }
    emit();
  }

  // ---------------- sync engine ----------------
  function apply(doc) {
    applying = true;
    try {
      const before = store.exportDoc();
      const merged = store.importDoc(doc);
      // tell open pages (lists, history, home) that another device changed something
      if (!sameDoc(before, merged) && typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('rh:library-synced'));
      return merged;
    } finally { applying = false; }
  }

  /** One round: pull, merge, push if needed (retrying on conflicts). Concurrent calls share the same run. */
  function syncNow() {
    if (!state.user) return Promise.resolve();
    if (running) { dirty = true; return running; }
    running = (async () => {
      state.sync = 'syncing'; emit();
      try {
        do {
          dirty = false;
          const remote = await api('GET', '/sync');
          version = remote.version;
          let merged = remote.doc ? apply(remote.doc) : store.exportDoc();
          for (let i = 0; i < 5 && (!remote.doc || !sameDoc(merged, remote.doc)); i++) {
            const r = await api('PUT', '/sync', { doc: merged, version });
            if (!r.conflict) { version = r.version; break; }
            version = r.version; // someone else wrote first: take theirs into ours, try again
            merged = apply(r.doc);
            remote.doc = r.doc;
          }
          saveVersion();
        } while (dirty);
        state.sync = 'ok'; state.lastSync = Date.now(); state.error = '';
      } catch (e) {
        if (e.status === 401) { state.sync = 'idle'; running = null; setUser(null); state.error = 'signed_out'; emit(); return; }
        state.sync = 'error'; state.error = e.message;
      } finally { running = null; emit(); }
    })();
    return running;
  }

  function schedule(key) {
    if (applying || !state.user) return;
    const delay = key === 'progress' ? PROGRESS : PUSH;
    if (timer && timer.delay <= delay) return; // a sooner push is already planned
    clearTimeout(timer && timer.id);
    timer = { delay, id: setTimeout(() => { timer = null; syncNow(); }, delay) };
  }
  const onVisible = () => { if (document.visibilityState === 'visible') syncNow(); };
  const onOnline = () => syncNow();
  function start() {
    offStore = store.onChange((key) => { if (['library', 'progress', 'settings'].includes(key)) schedule(key); });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    if (typeof addEventListener === 'function') addEventListener('online', onOnline);
    pullTimer = setInterval(() => syncNow(), PULL_EVERY);
    syncNow();
  }
  function stop() {
    if (offStore) offStore();
    offStore = null;
    clearTimeout(timer && timer.id); timer = null;
    clearInterval(pullTimer); pullTimer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    if (typeof removeEventListener === 'function') removeEventListener('online', onOnline);
  }
  /** Push what is pending now (before signing out, or when the page is hidden). */
  async function flush() { if (timer) { clearTimeout(timer.id); timer = null; } if (state.user) await syncNow(); }

  return {
    state: () => ({ ...state }),
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    /** Find out whether accounts exist on this site and who is signed in. */
    async init() {
      try { const r = await api('GET', '/auth/me'); state.enabled = true; setUser(r.user); } catch (e) { state.enabled = e.code === 'accounts_not_configured' ? false : state.enabled; emit(); }
      return { ...state };
    },
    async signIn(username, password) { const r = await api('POST', '/auth/login', { username, password }); state.enabled = true; setUser(r.user); await syncNow(); return r.user; },
    async signUp(username, password, invite) { const r = await api('POST', '/auth/signup', { username, password, invite }); state.enabled = true; setUser(r.user); await syncNow(); return r.user; },
    /** Sign out. `keepData: false` (default) removes the account's data from this device afterwards. */
    async signOut({ keepData = false } = {}) {
      try { await flush(); } catch { /* best effort: the server copy is at most a few seconds old */ }
      stop();
      try { await api('POST', '/auth/logout'); } catch { /* session may already be gone */ }
      const name = state.user && state.user.username;
      state.user = null; state.sync = 'idle';
      if (!keepData) store.clearAccountData();
      try { if (name) ls.removeItem('rh:syncVersion:' + name.toLowerCase()); } catch { /* blocked */ }
      emit();
    },
    changePassword: (current, next) => api('POST', '/auth/password', { current, next }),
    async deleteAccount(password) { await api('POST', '/auth/delete', { password }); stop(); state.user = null; store.clearAccountData(); emit(); },
    syncNow,
    flush,
    /** Stop timers and listeners (tests; the page keeps one for its lifetime). */
    destroy: stop,
    admin: {
      users: () => api('GET', '/admin/users'),
      removeUser: (id) => api('DELETE', `/admin/users/${id}`),
      resetPassword: (id) => api('POST', `/admin/users/${id}/reset`),
      invites: () => api('GET', '/admin/invites'),
      createInvite: (opts) => api('POST', '/admin/invites', opts),
      disableInvite: (id) => api('POST', `/admin/invites/${id}/disable`),
    },
  };
}

export const account = createAccount();

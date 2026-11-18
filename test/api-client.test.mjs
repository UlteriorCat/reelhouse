import test from 'node:test';
import assert from 'node:assert/strict';

// api.js reads globalThis.fetch lazily, so each test installs its own.
const load = async () => (await import('../public/js/api.js?' + Math.random()));
const res = (body, status = 200, extra = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, ...extra });

test('api client: returns JSON, caches successes in memory', async () => {
  let n = 0; globalThis.fetch = async () => { n++; return res({ a: 1 }); };
  const { api } = await load();
  assert.deepEqual(await api.health(), { a: 1 }); await api.health();
  assert.equal(n, 1, 'second call served from memory');
});

test('api client: server error JSON becomes ApiError(status, code, message)', async () => {
  globalThis.fetch = async () => res({ error: 'tmdb_not_configured', message: 'set the key' }, 501);
  const { api, ApiError } = await load();
  await assert.rejects(api.home(), (e) => e instanceof ApiError && e.status === 501 && e.code === 'tmdb_not_configured' && e.message === 'set the key');
});

test('api client: non-JSON error page and offline are reported, not swallowed', async () => {
  const { api, ApiError } = await load();
  globalThis.fetch = async () => res('<html>Bad gateway</html>', 502);
  await assert.rejects(api.home(), (e) => e instanceof ApiError && e.status === 502);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api.search('x'), (e) => e instanceof ApiError && e.code === 'offline');
});

test('REGRESSION: 200 with an unreadable body is an error and is never cached as null', async () => {
  let n = 0; globalThis.fetch = async () => { n++; return n === 1 ? res('not json at all', 200) : res({ ok: 1 }); };
  const { api, ApiError } = await load();
  await assert.rejects(api.title('movie', 1), (e) => e instanceof ApiError && e.code === 'bad_response');
  assert.deepEqual(await api.title('movie', 1), { ok: 1 }, 'the failure was not cached');
});

test('REGRESSION: aborting while the body downloads rejects with AbortError (does not resolve null)', async () => {
  const ctrl = new AbortController();
  globalThis.fetch = async (url, { signal }) => {
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"rows":')); signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); } });
    return new Response(stream, { status: 200 });
  };
  const { api } = await load();
  const p = api.home(ctrl.signal);
  setTimeout(() => ctrl.abort(), 20);
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('homeSWR: paints cached data first, then fresh data; rejects malformed payloads', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  store.set('rh:cache:home', JSON.stringify({ ts: Date.now(), data: { rows: [{ id: 'old' }] } }));
  globalThis.fetch = async () => res({ rows: [{ id: 'new' }], hero: null });
  const { homeSWR } = await load();
  const seen = []; await homeSWR((d, cached) => seen.push([d.rows[0].id, cached]));
  assert.deepEqual(seen, [['old', true], ['new', false]]);
  globalThis.fetch = async () => res({ nope: 1 });
  const { homeSWR: again } = await load();
  await assert.rejects(again(() => {}), /unreadable/);
});

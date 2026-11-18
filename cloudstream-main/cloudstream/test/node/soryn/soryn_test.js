'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..', '..');
const shimDir = path.join(root, 'shared/src/soryn/main/assets/shim');
const assetDir = path.join(root, 'soryn/src/main/assets/soryn');
const SHIMS = ['shim-common.js', 'contract-soryn.js'].map(f => [f, fs.readFileSync(path.join(shimDir, f), 'utf8')]);
const source = JSON.parse(fs.readFileSync(path.join(assetDir, 'source.json'), 'utf8'));

const HOME = '<div class="tray-wrapper"><h2 class="tray-title">Trending</h2><div data-post="111"></div><div data-post="222"></div></div>';
const POST_MOVIE = { title: 'Movie X', desc: 'plot', year: '2020', runtime: '1h 40m', match: '98% match', episodes: [], season: [], cast: 'A, B', suggest: [{ id: '333', t: 'Rel' }] };
const POST_SERIES = { title: 'Show Y', desc: 'plot', year: '2021', episodes: [{ id: '501', ep: 'E1', s: 'S1', t: 'Pilot', time: '45m' }], season: [{ id: '9', s: '1' }] };

function respond(url) {
  if (/verify\.php/.test(url)) return { status: 302, headers: { 'set-cookie': 't_hash_t=COOKIE123; path=/' }, body: '' };
  if (/mobile\/home/.test(url)) return { status: 200, body: HOME };
  if (/search\.php/.test(url)) return { status: 200, body: JSON.stringify({ searchResult: [{ id: '777', t: 'Found' }] }) };
  if (/post\.php\?id=1\b|post\.php\?id=111/.test(url)) return { status: 200, body: JSON.stringify(POST_MOVIE) };
  if (/post\.php\?id=2/.test(url)) return { status: 200, body: JSON.stringify(POST_SERIES) };
  if (/checknewtv\.php/.test(url)) return { status: 200, body: JSON.stringify({ domain: 'https://api.example', url: 'https://api.example' }) };
  return { status: 404, body: '{}' };
}

function run(file, variant, fn, arg, cache) {
  return new Promise((resolve) => {
    const queue = [];
    let inflight = 0, finished = false, result = null;
    const timers = new Map();
    const manifest = Object.assign({}, source.config, variant.config, { id: variant.id, baseUrl: source.baseUrl });
    const calls = [];
    const host = {
      meta: () => JSON.stringify({ id: variant.id }),
      settings: () => JSON.stringify({ manifest, cache: cache || {} }),
      fetch: (id, url, method, headersJson, body, hasBody, follow) => {
        JSON.parse(headersJson);
        calls.push(url);
        inflight++;
        const r = respond(url);
        queue.push(() => {
          inflight--;
          const b = Buffer.from(r.body, 'utf8');
          ctx.__onFetch(id, JSON.stringify({ status: r.status, statusText: '', url, headers: r.headers || {}, b64: b.toString('base64'), charset: 'utf-8', truncated: false }));
        });
      },
      decode: (b64) => Buffer.from(b64, 'base64').toString('utf8'),
      encodeUtf8: (s) => Buffer.from(s, 'utf8').toString('base64'),
      arrayBuffer: () => { throw new Error('force JS fallback'); },
      timer: (id, ms) => { timers.set(id, Date.now() + ms); queue.push(() => {}); },
      clearTimer: (id) => timers.delete(id),
      done: (json) => { if (!finished) { finished = true; result = json; } },
    };
    const ctx = vm.createContext({ Host: host });
    vm.runInContext('delete this.Promise', ctx);
    for (const [n, c] of SHIMS) vm.runInContext(c, ctx, { filename: n });
    vm.runInContext('delete this.Host', ctx);
    vm.runInContext('(function(){\n' + fs.readFileSync(path.join(assetDir, file), 'utf8') + '\n}).call(this);', ctx, { filename: file });
    ctx.__call('run', JSON.stringify({ fn, arg: arg === undefined ? null : arg }));
    const t0 = Date.now();
    (function pump() {
      ctx.__drainMicrotasks();
      while (queue.length) { queue.shift()(); ctx.__drainMicrotasks(); }
      for (const [id, at] of [...timers]) if (at <= Date.now()) { timers.delete(id); ctx.__onTimer(id); ctx.__drainMicrotasks(); }
      if (finished || Date.now() - t0 > 5000 || (!queue.length && !inflight && !timers.size)) {
        return resolve({ result: result && JSON.parse(result), calls });
      }
      setTimeout(pump, 1);
    })();
  });
}

(async () => {
  const nf = source.variants.find(v => v.id === 'netflix');
  const sw = source.variants.find(v => v.id === 'starwars');

  let r = await run('catalog.js', nf, 'getHome');
  assert(r.result && r.result.res.success, 'getHome failed: ' + JSON.stringify(r.result));
  assert(r.result.res.data.Trending.length === 2, 'home trays');
  assert(r.result.cache.t_hash_t && r.result.cache.t_hash_t.v === 'COOKIE123', 'cookie cached');

  r = await run('catalog.js', nf, 'getHome', undefined, { t_hash_t: { v: 'CACHED', t: Date.now() } });
  assert(!r.calls.some(u => /verify\.php/.test(u)), 'cached cookie must skip verify.php');

  r = await run('catalog.js', nf, 'search', 'found');
  assert(r.result.res.success && r.result.res.data[0].title === 'Found', 'search');

  r = await run('catalog.js', sw, 'search', 'x');
  assert(r.result.res.success && r.result.res.data.length === 0, 'studio variants have no search');

  r = await run('catalog.js', nf, 'load', 'https://net52.cc/post?id=111&ott=nf');
  assert(r.result.res.success && r.result.res.data.type === 'movie' && r.result.res.data.episodes.length === 1, 'load movie');
  assert(r.result.res.data.cast.length === 2 && r.result.res.data.recommendations.length === 1, 'cast/recs');

  r = await run('catalog.js', nf, 'load', 'https://net52.cc/post?id=222&ott=nf');
  assert(r.result.res.success && r.result.res.data.type === 'series' && r.result.res.data.episodes[0].season === 1, 'load series');

  r = await run('stream.js', nf, 'loadStreams', 'https://net52.cc/watch?id=111&ott=nf');
  assert(r.result && r.result.res && r.result.res.success === false && r.result.res.errorCode, 'stream failure surfaces as errorCode, not a hang');

  r = await run('catalog.js', nf, 'titles', JSON.stringify(['111', '222']));
  assert(r.result.res.success, 'titles failed: ' + JSON.stringify(r.result));
  assert(r.result.res.data['111'] === 'Movie X' && r.result.res.data['222'] === 'Show Y', 'titles resolved: ' + JSON.stringify(r.result.res.data));
  assert(r.calls.filter(u => /verify\.php/.test(u)).length === 1, 'one cookie fetch for the whole title batch');

  r = await run('catalog.js', nf, 'titles', '[]');
  assert(r.result.res.success && Object.keys(r.result.res.data).length === 0 && r.calls.length === 0, 'empty batch makes no requests');

  const bad = await run('catalog.js', nf, 'nope');
  assert(bad.result.res.success === false, 'unknown fn fails cleanly');

  console.log('soryn shim OK');
})().catch(e => { console.error(e); process.exit(1); });

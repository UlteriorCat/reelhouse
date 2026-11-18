'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..', '..');
const shimDir = path.join(root, 'shared/src/eclipsia/main/assets/shim');
const scraperDirs = fs.readdirSync(path.join(root, 'eclipsia')).sort()
  .map(d => path.join(root, 'eclipsia', d, 'src/main/assets/scrapers'))
  .filter(d => fs.existsSync(d));
const SHIMS = ['shim-common.js', 'contract-scraper.js'].map(f => [f, fs.readFileSync(path.join(shimDir, f), 'utf8')]);

const MODES = {
  'all-404':  () => ({ status: 404, body: '' }),
  'all-empty-html': () => ({ status: 200, body: '<html><body></body></html>' }),
  'all-empty-json': () => ({ status: 200, body: '{}' }),
  'tmdb-ish': (url) => /themoviedb/.test(url)
      ? { status: 200, body: JSON.stringify({ id: 1, title: 'X', name: 'X', original_title: 'X', release_date: '2020-01-01', first_air_date: '2020-01-01', imdb_id: 'tt0000001', external_ids: { imdb_id: 'tt0000001' }, results: [], seasons: [] }) }
      : { status: 200, body: '' },
  'network-fail': () => ({ status: 0, body: '' }),
};

function runOne(file, mode, call, usePolyfill) {
  return new Promise((resolve) => {
    const queue = [];
    let inflight = 0, finished = false, result = null;
    const timers = new Map();
    let timerSeq = 0;
    const t0 = Date.now();
    const respond = MODES[mode];

    const host = {
      meta: () => JSON.stringify({ id: path.basename(file, '.js') }),
      settings: () => '{}',
      tmdbKey: () => 'KEY',
      fetch: (id, url, method, headersJson, body, hasBody, follow) => {
        JSON.parse(headersJson);
        inflight++;
        const r = respond(url);
        queue.push(() => {
          inflight--;
          const b = Buffer.from(r.body, 'utf8');
          ctx.__onFetch(id, JSON.stringify({ status: r.status, statusText: '', url, headers: { 'content-type': 'text/html' }, b64: b.toString('base64'), charset: 'utf-8', truncated: false }));
        });
      },
      decode: (b64, cs) => Buffer.from(b64, 'base64').toString(/latin|8859/i.test(cs) ? 'latin1' : 'utf8'),
      encodeUtf8: (s) => Buffer.from(s, 'utf8').toString('base64'),
      arrayBuffer: () => { throw new Error('force JS fallback'); },
      timer: (id, ms) => { timers.set(id, Date.now() + ms); queue.push(() => {}); },
      clearTimer: (id) => timers.delete(id),
      done: (json) => { if (!finished) { finished = true; result = json; } },
    };

    const sandbox = { Host: host };
    const ctx = vm.createContext(sandbox);
    if (usePolyfill) vm.runInContext('delete this.Promise', ctx);
    try {
      for (const [n, c] of SHIMS) vm.runInContext(c, ctx, { filename: n });
      vm.runInContext('delete this.Host', ctx);
      vm.runInContext('(function(){\n' + fs.readFileSync(file, 'utf8') + '\n}).call(this);', ctx, { filename: file });
      vm.runInContext('__call(' + JSON.stringify(call.mode) + ',' + JSON.stringify(call.args) + ')', ctx);
    } catch (e) {
      return resolve({ ok: false, err: 'setup: ' + (e && e.message) });
    }

    const step = () => {
      try { ctx.__drainMicrotasks(); } catch (e) { return resolve({ ok: false, err: 'drain: ' + e.message }); }
      if (finished) return resolve({ ok: true, json: result, ms: Date.now() - t0, native: !usePolyfill });
      if (Date.now() - t0 > 20000) return resolve({ ok: false, err: 'timeout' });
      for (const [id, at] of [...timers]) if (at <= Date.now()) { timers.delete(id); ctx.__onTimer(id); }
      const task = queue.shift();
      if (task) { task(); return setImmediate(step); }
      if (inflight === 0 && timers.size === 0) {
        return setImmediate(() => {
          if (finished) return step();
          if (!queue.length && inflight === 0 && timers.size === 0) return resolve({ ok: false, err: 'never settled' });
          step();
        });
      }
      setTimeout(step, 1);
    };
    setImmediate(step);
  });
}

(async () => {
  const files = [];
  scraperDirs.forEach(d => fs.readdirSync(d).filter(f => f.endsWith('.js')).sort().forEach(f => files.push(path.join(d, f))));
  let bad = 0, runs = 0;
  const calls = [
    { mode: 'run', args: JSON.stringify({ tmdbId: '603', mediaType: 'movie', season: null, episode: null }) },
    { mode: 'run', args: JSON.stringify({ tmdbId: '1399', mediaType: 'tv', season: 1, episode: 2 }) },
    { mode: 'settings', args: '{}' },
  ];
  for (const f of files) {
    for (const mode of Object.keys(MODES)) {
      for (const call of calls) {
        for (const poly of [false, true]) {
          if (poly && mode !== 'tmdb-ish') continue;
          const r = await runOne(f, mode, call, poly);
          runs++;
          let good = r.ok;
          if (good) { try { good = Array.isArray(JSON.parse(r.json)); } catch (e) { good = false; } }
          if (!good) { bad++; console.log('FAIL', path.relative(root, f), mode, call.mode, poly ? 'polyfill' : 'native', JSON.stringify(r).slice(0, 200)); }
        }
      }
    }
  }
  console.log(`${files.length} providers, ${runs} runs, ${bad} failures`);
  process.exit(bad ? 1 : 0);
})();

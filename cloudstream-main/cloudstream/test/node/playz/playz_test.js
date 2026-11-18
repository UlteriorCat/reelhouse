'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const fixtures = require('./fixtures');

const root = path.resolve(__dirname, '..', '..', '..');
const shimDir = path.join(root, 'shared/src/playz/main/assets/shim');
const assetDir = path.join(root, 'playz/src/main/assets/playz');
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const SHIMS = [['shim-common.js', read(shimDir, 'shim-common.js')], ['contract-playz.js', read(shimDir, 'contract-playz.js')], ['core.js', read(assetDir, 'core.js')]];
const source = JSON.parse(read(assetDir, 'source.json'));

function run(file, fn, arg, opts) {
  const o = Object.assign({ route: fixtures.makeRoute(), tz: 0, cache: {}, native: false }, opts);
  return new Promise((resolve) => {
    const queue = [];
    const timers = new Map();
    const calls = [];
    let inflight = 0;
    let finished = false;
    let result = null;
    const manifest = Object.assign({}, source.config, { id: source.id, baseUrl: source.baseUrl });
    const host = {
      meta: () => JSON.stringify({ id: source.id }),
      settings: () => JSON.stringify({ manifest, cache: o.cache }),
      tzOffset: () => o.tz,
      fetch: (id, url, method, headersJson, body, hasBody) => {
        JSON.parse(headersJson);
        calls.push(url);
        inflight++;
        const r = o.route(url, method, hasBody ? body : null);
        queue.push(() => {
          inflight--;
          const buf = Buffer.from(r.body, 'utf8');
          ctx.__onFetch(id, JSON.stringify({ status: r.status, statusText: '', url, headers: {}, b64: buf.toString('base64'), charset: 'utf-8', truncated: false }));
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
    if (!o.native) vm.runInContext('delete this.Promise', ctx);
    for (const s of SHIMS) vm.runInContext(s[1], ctx, { filename: s[0] });
    vm.runInContext('delete this.Host', ctx);
    vm.runInContext('(function(){\n' + read(assetDir, file) + '\n}).call(this);', ctx, { filename: file });
    ctx.__call('run', JSON.stringify({ fn, arg: arg === undefined ? null : arg }));
    const t0 = Date.now();
    let idle = 0;
    (function pump() {
      ctx.__drainMicrotasks();
      while (queue.length) { queue.shift()(); ctx.__drainMicrotasks(); }
      for (const e of Array.from(timers)) {
        if (e[1] <= Date.now()) { timers.delete(e[0]); ctx.__onTimer(e[0]); ctx.__drainMicrotasks(); }
      }
      idle = !queue.length && !inflight && !timers.size ? idle + 1 : 0;
      if (finished || Date.now() - t0 > 8000 || idle > 3) {
        return resolve({ result: result && JSON.parse(result), calls });
      }
      setTimeout(pump, 1);
    })();
  });
}

const ok = (r, msg) => assert(r.result && r.result.res && r.result.res.success === true, msg + ': ' + JSON.stringify(r.result));
const poster = (item) => JSON.parse(decodeURIComponent(item.posterUrl.replace(/^playz-poster:/, '')));

async function suite(native) {
  const tag = native ? '[native] ' : '[polyfill] ';
  const base = { native };

  for (const layout of Object.keys(fixtures.layouts)) {
    const r = await run('catalog.js', 'getHome', undefined, Object.assign({}, base, { route: fixtures.makeRoute({ layout }) }));
    ok(r, tag + 'getHome ' + layout);
    assert(Object.keys(r.result.res.data).length >= 3, tag + 'rows decrypted via ' + layout);
  }

  let r = await run('catalog.js', 'getHome', undefined, base);
  ok(r, tag + 'getHome');
  const home = r.result.res.data;
  const keys = Object.keys(home);
  assert.deepStrictEqual(keys, ['Live Now', 'Cricket', 'Football', 'Basketball'], tag + 'row order ' + keys);
  assert(!home.Hidden, tag + 'visible:false dropped');
  assert.strictEqual(home['Live Now'].length, 1);
  const liveItem = home['Live Now'][0];
  assert.strictEqual(liveItem.title, ' ');
  assert.strictEqual(liveItem.type, 'livestream');
  assert(/^playz-poster:/.test(liveItem.posterUrl));
  const lp = poster(liveItem);
  assert.strictEqual(lp.status, 'LIVE');
  assert.strictEqual(lp.category, 'Cricket');
  assert.strictEqual(lp.teamA, 'India');
  assert.strictEqual(lp.teamB, 'Australia');
  assert.strictEqual(lp.time, '');
  ['eventName', 'flagA', 'flagB', 'logo'].forEach((k) => assert(k in lp, tag + 'poster field ' + k));
  assert.strictEqual(poster(home.Football[0]).status, 'UPCOMING');
  assert(poster(home.Football[0]).time.length > 0, tag + 'upcoming has time');
  assert.strictEqual(poster(home.Basketball[0]).status, 'ENDED');
  const meta = JSON.parse(liveItem.url);
  assert.strictEqual(meta.slug, 'ind-aus');
  assert.strictEqual(meta.title, 'India vs Australia');
  assert(r.result.cache.events_data, tag + 'events cached');

  r = await run('catalog.js', 'getHome', undefined, Object.assign({}, base, { cache: { events_data: { v: JSON.parse(JSON.stringify(fixtures.events)), t: Date.now() } }, route: () => ({ status: 500, body: '' }) }));
  ok(r, tag + 'getHome from cache');
  assert.strictEqual(r.calls.length, 0, tag + 'cache hit makes no requests');

  r = await run('catalog.js', 'search', 'india', base);
  ok(r, tag + 'search');
  assert.strictEqual(r.result.res.data.length, 1);
  assert.strictEqual(r.result.res.data[0].title, ' ');
  assert.strictEqual(poster(r.result.res.data[0]).teamA, 'India');

  r = await run('catalog.js', 'search', 'zzzz-none', base);
  ok(r, tag + 'search none');
  assert.strictEqual(r.result.res.data.length, 0);

  r = await run('catalog.js', 'search', '', base);
  ok(r, tag + 'search empty');
  assert.strictEqual(r.result.res.data.length, 3);

  r = await run('catalog.js', 'load', liveItem.url, base);
  ok(r, tag + 'load');
  const item = r.result.res.data;
  assert.strictEqual(item.title, 'India vs Australia');
  assert.strictEqual(item.episodes.length, 1);
  assert.strictEqual(item.episodes[0].name, 'Watch Live');
  assert(/^playz-poster:/.test(item.posterUrl));
  assert(/Category: Cricket/.test(item.description));
  assert(/Available Servers: 2/.test(item.description));
  assert.strictEqual(r.calls.length, 0, tag + 'load is offline');

  const fixed = JSON.stringify({ title: 'T', category: 'Cricket', teamAName: 'A', teamBName: 'B', date: '15/3/2031', time: '14:30:00', endDate: '15/3/2031', endTime: '20:00:00', linksPath: 'x.txt', slug: 'x' });
  const labels = [[0, '15 Mar, 2:30 PM • UTC'], [330, '15 Mar, 8:00 PM • UTC+5:30'], [-240, '15 Mar, 10:30 AM • UTC-4']];
  for (const l of labels) {
    r = await run('catalog.js', 'load', fixed, Object.assign({}, base, { tz: l[0] }));
    ok(r, tag + 'load tz');
    assert(r.result.res.data.description.indexOf('Time: ' + l[1]) !== -1, tag + 'tz ' + l[0] + ' got ' + r.result.res.data.description);
    assert.strictEqual(poster(r.result.res.data).time, l[1]);
  }

  r = await run('catalog.js', 'load', '', base);
  assert.strictEqual(r.result.res.success, false);
  assert.strictEqual(r.result.res.errorCode, 'INVALID_INPUT');
  r = await run('catalog.js', 'load', '{bad', base);
  assert.strictEqual(r.result.res.success, false);
  assert.strictEqual(r.result.res.errorCode, 'PARSE_ERROR');

  r = await run('stream.js', 'loadStreams', liveItem.url, base);
  ok(r, tag + 'loadStreams');
  const list = r.result.res.data;
  const by = (name) => list.filter((s) => s.name === name);
  const main = by('Main HD')[0];
  assert(main, tag + 'main stream');
  assert.strictEqual(main.url, 'https://livevideos.cricbuzz.com/a/master.m3u8');
  assert.strictEqual(main.headers['User-Agent'], 'TestUA');
  assert.strictEqual(main.headers.Referer, 'https://ref.example/');
  assert.strictEqual(main.type, 'hls');
  const q720 = by('Main HD 720p')[0];
  const q360 = by('Main HD 360p')[0];
  assert(q720 && q360, tag + 'variants ' + list.map((s) => s.name));
  assert.strictEqual(q720.quality, 720);
  assert.strictEqual(q360.quality, 360);
  assert.strictEqual(q720.url, 'https://livevideos.cricbuzz.com/a/720/index.m3u8');
  assert.strictEqual(q360.url, 'https://livevideos.cricbuzz.com/a/360/index.m3u8');
  assert.strictEqual(q720.headers.Referer, 'https://ref.example/');
  const drm = by('DRM')[0];
  assert.strictEqual(drm.drmType, 'clearkey');
  assert.strictEqual(drm.drmKid, '0123456789abcdef0123456789abcdef');
  assert.strictEqual(drm.drmKey, 'fedcba9876543210fedcba9876543210');
  assert.strictEqual(drm.type, 'dash');
  const wv = by('WV')[0];
  assert.strictEqual(wv.drmType, 'widevine');
  assert.strictEqual(wv.licenseUrl, 'https://lic.example/widevine');
  assert.strictEqual(wv.type, 'dash');
  const tok = by('Tok')[0];
  assert.strictEqual(tok.url, 'https://tok.example/live.m3u8');
  assert.strictEqual(tok.headers.Cookie, 'abc');
  assert.strictEqual(tok.type, 'hls');
  assert.strictEqual(list.length, 6, tag + 'stream count ' + list.map((s) => s.name));
  const names = list.map((s) => s.name);
  assert.deepStrictEqual(names, ['DRM', 'WV', 'Main HD 720p', 'Main HD 360p', 'Main HD', 'Tok']);

  r = await run('stream.js', 'loadStreams', JSON.stringify({ slug: 'empty', linksPath: 'empty.txt' }), base);
  assert.strictEqual(r.result.res.success, false);
  assert.strictEqual(r.result.res.errorCode, 'EMPTY_RESULT');

  r = await run('stream.js', 'loadStreams', JSON.stringify({ title: 'x' }), base);
  assert.strictEqual(r.result.res.success, false);
  assert.strictEqual(r.result.res.errorCode, 'PARSE_ERROR');

  r = await run('stream.js', 'loadStreams', 'nope', base);
  assert.strictEqual(r.result.res.success, false);
  assert(r.result.res.errorCode, tag + 'bad json has code');

  r = await run('stream.js', 'loadStreams', JSON.stringify({ slug: 'missing' }), base);
  assert.strictEqual(r.result.res.success, false);
  assert.strictEqual(r.result.res.errorCode, 'EMPTY_RESULT');

  r = await run('catalog.js', 'getHome', undefined, Object.assign({}, base, { route: fixtures.makeRoute({ dead: ['tourniquest.site'] }) }));
  ok(r, tag + 'failover from 404');
  assert.strictEqual(r.result.cache.active_base_url.v, 'https://adsflw.xyz');

  r = await run('catalog.js', 'getHome', undefined, Object.assign({}, base, { route: fixtures.makeRoute({ garbage: ['tourniquest.site'] }) }));
  ok(r, tag + 'failover from garbage');
  assert.strictEqual(r.result.cache.active_base_url.v, 'https://adsflw.xyz');

  r = await run('catalog.js', 'getHome', undefined, Object.assign({}, base, { route: fixtures.makeRoute({ dead: ['tourniquest.site', 'adsflw.xyz'], remote: 'https://third.example' }) }));
  ok(r, tag + 'failover to remote config host');
  assert.strictEqual(r.result.cache.active_base_url.v, 'https://third.example');

  r = await run('catalog.js', 'getHome', undefined, Object.assign({}, base, { route: () => ({ status: 404, body: '' }) }));
  assert.strictEqual(r.result.res.success, false);
  assert.strictEqual(r.result.res.errorCode, 'SITE_OFFLINE');

  r = await run('catalog.js', 'getHome', undefined, Object.assign({}, base, { route: fixtures.makeRoute({ eventsBody: [] }) }));
  assert.strictEqual(r.result.res.success, false);
  assert.strictEqual(r.result.res.errorCode, 'SITE_OFFLINE');

  r = await run('catalog.js', 'getHome', undefined, Object.assign({}, base, { route: () => ({ status: 200, body: 'garbage' }) }));
  assert.strictEqual(r.result.res.success, false);
  assert(r.result.res.errorCode);

  r = await run('catalog.js', 'nope', undefined, base);
  assert.strictEqual(r.result.res.success, false);
  assert.strictEqual(r.result.res.errorCode, 'NO_FUNCTION');
}

function urlOracle() {
  const ctx = vm.createContext({ Host: { settings: () => '{}', tzOffset: () => 0, timer() {}, clearTimer() {}, fetch() {}, done() {}, decode: () => '', encodeUtf8: () => '', arrayBuffer() { throw new Error('x'); } } });
  SHIMS.forEach((s) => vm.runInContext(s[1], ctx, { filename: s[0] }));
  const core = ctx.PlayzCore;
  const table = [
    ['https://a.example/x/y/master.m3u8', '720/index.m3u8'],
    ['https://a.example/x/y/master.m3u8', '/abs/p.m3u8'],
    ['https://a.example/x/y/master.m3u8', '../up/p.m3u8'],
    ['https://a.example/x/y/master.m3u8', '../../../over/p.m3u8'],
    ['https://a.example/x/y/master.m3u8', '//other.example/z.m3u8'],
    ['https://a.example/x/y/master.m3u8', 'https://b.example/q.m3u8?t=1'],
    ['https://a.example/x/y/master.m3u8?k=1', '?t=2'],
    ['https://a.example/x/y/master.m3u8?k=1', '#frag'],
    ['https://a.example/x/y/master.m3u8', './same/p.m3u8?a=b#c'],
    ['https://a.example:8443/x/', 'p.m3u8'],
    ['http://a.example', 'p.m3u8'],
    ['https://a.example/x/y/', 'a/./b/../c.m3u8'],
  ];
  table.forEach((row) => {
    assert.strictEqual(core.resolveUrl(row[1], row[0]), new URL(row[1], row[0]).href, 'resolve ' + row.join(' + '));
  });
  assert.strictEqual(core.hostOf('https://Sub.Example.com:99/p?q'), new URL('https://Sub.Example.com:99/p?q').hostname);
  assert.strictEqual(core.hostOf('not a url'), '');
}

(async () => {
  urlOracle();
  await suite(false);
  await suite(true);
})().catch((e) => { setImmediate(() => { throw e; }); });

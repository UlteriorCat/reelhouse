// Dry-run harness: executes the REAL shim-common.js + contract-scraper.js + scraper in a vm
// context, exactly in the order RhinoEngine does, with a fake Host that records every request.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.EXT_REPO || '/home/claude/repo/cloudstream';
const SHIMS = [
  ROOT + '/shared/src/eclipsia/main/assets/shim/shim-common.js',
  ROOT + '/shared/src/eclipsia/main/assets/shim/contract-scraper.js',
];
const SCRAPERS = ROOT + '/eclipsia/eclipsia-bdix/src/main/assets/scrapers/';
const PLACEHOLDER = '__ECLIPSIA_TMDB_KEY__';

function reply(status, body, extra) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return Object.assign({
    status, statusText: status === 200 ? 'OK' : 'ERR', headers: { 'content-type': 'application/json' },
    b64: Buffer.from(text, 'utf8').toString('base64'), charset: 'utf-8', truncated: false,
  }, extra || {});
}
const FAIL = { status: 0, statusText: 'request failed', headers: {}, b64: '', charset: 'utf-8', truncated: false };

async function run(scraperId, args, router) {
  const log = [];
  let doneResolve; const done = new Promise(r => (doneResolve = r));
  const ctx = vm.createContext({});
  const g = vm.runInContext('this', ctx);
  g.Host = {
    meta: () => JSON.stringify({ id: scraperId }),
    settings: () => '{}',
    tmdbKey: () => PLACEHOLDER,
    fetch: (id, url, method, headersJson, bodyB64, hasBody, follow, creds) => {
      const body = hasBody ? Buffer.from(bodyB64, 'base64').toString('utf8') : null;
      const rec = { method, url, headers: JSON.parse(headersJson), body, follow, credentials: creds };
      log.push(rec);
      const r = router(rec) || reply(404, 'not found');
      setImmediate(() => g.__onFetch(id, JSON.stringify(Object.assign({ url }, r))));
    },
    decode: (b64, cs) => Buffer.from(b64, 'base64').toString('utf8'),
    encodeUtf8: s => Buffer.from(s, 'utf8').toString('base64'),
    arrayBuffer: b64 => { const b = Buffer.from(b64, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
    timer: (id, ms) => setTimeout(() => g.__onTimer(id), ms),
    clearTimer: () => {},
    done: out => doneResolve(out),
  };
  for (const s of SHIMS) vm.runInContext(fs.readFileSync(s, 'utf8'), ctx, { filename: s });
  delete g.Host;
  const code = fs.readFileSync(SCRAPERS + scraperId + '.js', 'utf8');
  vm.runInContext('(function(){\n' + code + '\n}).call(this);', ctx, { filename: scraperId });
  g.__call('run', JSON.stringify(args));
  const out = await Promise.race([done, new Promise(r => setTimeout(() => r('TIMEOUT'), 5000))]);
  return { requests: log, output: out === 'TIMEOUT' ? out : JSON.parse(out) };
}

module.exports = { run, reply, FAIL, PLACEHOLDER };

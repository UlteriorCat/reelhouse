'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const shim = fs.readFileSync(path.resolve(__dirname, '../../../shared/src/eclipsia/main/assets/shim/shim-common.js'), 'utf8');

function makeContext(respond) {
  const bodies = [];
  const host = {
    fetch: (id, url, method, headersJson, body, hasBody, follow) => {
      bodies.push({ url, method, headers: JSON.parse(headersJson), body: hasBody ? Buffer.from(body, 'base64').toString('utf8') : null });
      const r = respond(url);
      setImmediate(() => ctx.__onFetch(id, JSON.stringify({
        status: r.status, statusText: '', url, headers: { 'content-type': 'text/plain', 'x-a': '1' },
        b64: Buffer.from(r.body, 'utf8').toString('base64'), charset: 'utf-8', truncated: false
      })));
    },
    decode: (b64) => Buffer.from(b64, 'base64').toString('utf8'),
    encodeUtf8: (s) => Buffer.from(s, 'utf8').toString('base64'),
    arrayBuffer: () => { throw new Error('fallback'); },
    timer: () => {},
    clearTimer: () => {},
    done: () => {},
  };
  const ctx = vm.createContext({ Host: host, setImmediate });
  vm.runInContext(shim, ctx);
  return { ctx, bodies };
}

(async () => {
  const { ctx, bodies } = makeContext(() => ({ status: 200, body: '{"a":1}' }));

  const P = vm.runInContext('URLSearchParams', ctx);
  const p = new P('?a=1&b=x+y&a=2&c=%E2%9C%93&d');
  assert.strictEqual(p.get('a'), '1');
  assert.deepStrictEqual(Array.from(p.getAll('a')), ['1', '2']);
  assert.strictEqual(p.get('b'), 'x y');
  assert.strictEqual(p.get('c'), '✓');
  assert.strictEqual(p.get('d'), '');
  assert.strictEqual(p.get('missing'), null);
  assert.strictEqual(p.has('d'), true);
  p.set('a', '9');
  assert.strictEqual(p.toString(), 'a=9&b=x+y&c=%E2%9C%93&d=');
  p.append('e', "it's");
  p['delete']('b');
  assert.strictEqual(p.toString(), 'a=9&c=%E2%9C%93&d=&e=it%27s');
  assert.strictEqual(new P({ q: 'a b', r: '1' }).toString(), 'q=a+b&r=1');
  assert.strictEqual(new P(new P('x=1')).toString(), 'x=1');

  const fetchFn = vm.runInContext('fetch', ctx);
  const res = await fetchFn('https://x.example/a', { method: 'POST', body: new P({ k: 'v w' }) });
  assert.strictEqual(bodies[0].body, 'k=v+w');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.headers.has('X-A'), true);
  assert.strictEqual(res.headers.has('x-none'), false);
  const seen = [];
  res.headers.forEach((v, k) => seen.push(k + '=' + v));
  assert.deepStrictEqual(seen.sort(), ['content-type=text/plain', 'x-a=1']);

  const copy = res.clone();
  assert.strictEqual(await res.text(), '{"a":1}');
  assert.strictEqual(await copy.text(), '{"a":1}');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await copy.json())), { a: 1 });

  console.log('shim api ok');
})().catch((e) => { console.error(e); process.exit(1); });

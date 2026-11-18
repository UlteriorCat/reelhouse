import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGateway, classify } from '../gateway/bdix-gateway.mjs';

const FILE = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
let up, upPort, gw, gwPort, seen;

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  up = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() };
      if (req.url === '/api') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ search: [{ href: '/x.mkv' }] })); }
      if (req.url === '/redir') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }); return res.end(); }
      if (req.url === '/big') { res.end(Buffer.alloc(3000)); return; }
      if (req.url.startsWith('/movie.mov')) {
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
        const s = m ? +m[1] : 0, e = m && m[2] ? +m[2] : FILE.length - 1;
        res.writeHead(m ? 206 : 200, { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'content-length': e - s + 1, ...(m ? { 'content-range': `bytes ${s}-${e}/${FILE.length}` } : {}) });
        return res.end(FILE.subarray(s, e + 1));
      }
      res.statusCode = 404; res.end('nf');
    });
  });
  upPort = await listen(up);
  gw = createGateway({ host: '127.0.0.1', token: 'secret', allowPrivate: ['127.0.0.1'], origins: ['https://site.example'], referers: { '127.0.0.1': 'http://ref.test/' }, maxTextResponseBytes: 2000 });
  gwPort = await listen(gw);
});
after(() => { up.close(); gw.close(); });

const G = (p, init) => fetch(`http://127.0.0.1:${gwPort}${p}`, init);
const T = '&k=secret';
const target = (p) => encodeURIComponent(`http://127.0.0.1:${upPort}${p}`);

test('refuses to start on a non-loopback address without a token', () => {
  assert.throws(() => createGateway({ host: '0.0.0.0', token: '' }), /open proxy/);
  assert.doesNotThrow(() => createGateway({ host: '0.0.0.0', token: 'x' }));
});

test('health is public; everything else needs the token', async () => {
  assert.equal((await G('/health')).status, 200);
  assert.equal((await G('/s?u=' + target('/movie.mov'))).status, 401);
  assert.equal((await G('/s?u=' + target('/movie.mov') + '&k=wrong')).status, 401);
  assert.equal((await G('/s?u=' + target('/movie.mov') + T)).status, 200);
});

test('POST /p envelope: forwards method/body/headers, injects UA and per-host Referer, mirrors status + CORS', async () => {
  const r = await G('/p?k=secret', { method: 'POST', headers: { origin: 'https://site.example', 'content-type': 'text/plain' }, body: JSON.stringify({ url: `http://127.0.0.1:${upPort}/api`, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Evil': '1', Cookie: 'a=b' }, body: '{"action":"get"}' }) });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { search: [{ href: '/x.mkv' }] });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://site.example');
  assert.equal(seen.method, 'POST'); assert.equal(seen.body, '{"action":"get"}');
  assert.equal(seen.headers['content-type'], 'application/json'); assert.match(seen.headers['user-agent'], /Chrome\/151/);
  assert.equal(seen.headers.referer, 'http://ref.test/');
  assert.equal(seen.headers['x-evil'], undefined, 'non-allowlisted headers are not forwarded'); assert.equal(seen.headers.cookie, undefined);
  const nf = await G('/p?k=secret', { method: 'POST', body: JSON.stringify({ url: `http://127.0.0.1:${upPort}/missing` }) });
  assert.equal(nf.status, 404, 'upstream status mirrored');
  assert.equal((await G('/p?k=secret', { method: 'POST', body: 'not json' })).status, 400);
  assert.equal((await G('/p?k=secret', { method: 'POST', body: JSON.stringify({ url: `http://127.0.0.1:${upPort}/big` }) })).status, 502, 'text response cap enforced');
});

test('CORS: only the configured origin is echoed; preflight allows private network', async () => {
  const bad = await G('/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await G('/p', { method: 'OPTIONS', headers: { origin: 'https://site.example', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
  assert.match(pre.headers.get('access-control-allow-headers'), /range/);
});

test('GET /s streams with Range -> 206 and exact bytes; normalises octet-stream by extension', async () => {
  const full = await G('/s?u=' + target('/movie.mov') + T);
  assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'video/quicktime');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), FILE);
  const part = await G('/s?u=' + target('/movie.mov') + T, { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), FILE.subarray(100, 200));
  assert.equal(seen.headers.range, 'bytes=100-199'); assert.equal(seen.headers.referer, 'http://ref.test/');
});

test('download mode sets a sanitised Content-Disposition', async () => {
  const r = await G('/s?u=' + target('/movie.mov') + T + '&dl=1&n=' + encodeURIComponent('Bad"Name\r\nX: y é.mov'));
  const cd = r.headers.get('content-disposition');
  assert.match(cd, /^attachment; filename="Bad_Name__X: y _\.mov"; filename\*=UTF-8''/);
  assert.ok(!/[\r\n]/.test(cd)); await r.arrayBuffer();
});

test('SSRF: blocks loopback (not allowlisted), metadata, literal/decimal IPs, IPv6, odd schemes, credentials, redirects into blocked space', async () => {
  const strict = createGateway({ host: '127.0.0.1', token: 'secret', allowPrivate: [] });
  const sp = await listen(strict);
  const S = (u) => fetch(`http://127.0.0.1:${sp}/s?k=secret&u=${encodeURIComponent(u)}`).then((r) => r.status);
  try {
    assert.equal(await S(`http://127.0.0.1:${upPort}/movie.mov`), 403, 'loopback not allowlisted');
    assert.equal(await S('http://2130706433/'), 403, 'decimal form of 127.0.0.1');
    assert.equal(await S('http://0x7f.1/'), 403, 'hex form');
    assert.equal(await S('http://[::1]/'), 403);
    assert.equal(await S('http://[::ffff:127.0.0.1]/'), 403, 'IPv4-mapped IPv6 (URL normalises to hex form)');
    assert.equal(await S('http://[::ffff:169.254.169.254]/'), 403, 'mapped metadata address');
    assert.equal(await S('http://[64:ff9b::a00:1]/'), 403, 'NAT64-embedded private IPv4');
    assert.equal(await S('http://10.0.0.5/'), 403);
    assert.equal(await S('http://192.168.1.1/'), 403);
    assert.equal(await S('http://localhost:1/'), 403, 'hostname resolving to loopback');
    assert.equal(await S('file:///etc/passwd'), 400);
    assert.equal(await S('ftp://example.com/x'), 400);
    assert.equal(await S('http://user:pw@example.com/'), 400);
  } finally { strict.close(); }
  // metadata address can never be allowlisted, even explicitly
  const lax = createGateway({ host: '127.0.0.1', token: 'secret', allowPrivate: ['127.0.0.1', '169.254.169.254'] });
  const lp = await listen(lax);
  try {
    assert.equal(await fetch(`http://127.0.0.1:${lp}/s?k=secret&u=${encodeURIComponent('http://169.254.169.254/latest')}`).then((r) => r.status), 403);
    // allowlisted upstream redirecting to the metadata address is re-validated per hop
    assert.equal(await fetch(`http://127.0.0.1:${lp}/s?k=secret&u=${target('/redir')}`).then((r) => r.status), 403);
  } finally { lax.close(); }
});

test('classify(): address policy matrix', () => {
  const cases = { '8.8.8.8': null, '15.1.1.50': null, '172.16.50.12': 'private', '172.32.0.1': null, '10.1.2.3': 'private', '192.168.0.1': 'private', '100.64.0.1': 'private', '127.0.0.1': 'private', '169.254.169.254': 'never', '0.0.0.0': 'never', '224.0.0.1': 'never', '::1': 'private', 'fd00::1': 'private', 'fe80::1': 'never', '::ffff:10.0.0.1': 'private', '2606:4700::1111': null, '::ffff:7f00:1': 'private', '::ffff:a9fe:a9fe': 'never', '::ffff:808:808': null, '64:ff9b::a00:1': 'private', '2002:a00:1::': 'private', '2002:808:808::': null, '::7f00:1': 'private', '::': 'never' };
  for (const [ip, want] of Object.entries(cases)) assert.equal(classify(ip), want, ip);
});

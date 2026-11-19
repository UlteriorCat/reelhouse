// Fendrix (fn.js) and Hexion (hx.js): parity with the ORIGINAL eclipsia scrapers, executed as-is in a vm sandbox
// against the same mock upstreams, plus the documented deviations. Mock shapes follow what the live services
// returned in Nov 2026 (see docs/IMPLEMENTATION.md section 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { DOMParser } from 'linkedom';
import * as fn from '../public/js/providers/fn.js';
import * as hx from '../public/js/providers/hx.js';
import { aesGcmDecrypt } from '../public/js/providers/aesgcm.js';
import { makeCtx, resolveStreams, PROVIDERS } from '../public/js/providers/index.js';
import { createNet } from '../public/js/net.js';
import { playability, rank } from '../public/js/streams.js';
import { proxyHosts, handleApi } from '../lib/api.js';

const REF = new URL('../cloudstream-main/cloudstream/providers/', import.meta.url);
const TMDB = {
  'movie/27205': { title: 'Inception', release_date: '2010-07-15', imdb_id: 'tt1375666', external_ids: { imdb_id: 'tt1375666' }, runtime: 148 }, // TMDB sends both with append_to_response=external_ids
  'tv/1396': { name: 'Breaking Bad', first_air_date: '2008-01-20', external_ids: { imdb_id: 'tt0903747' }, episode_run_time: [47] },
};
const META = {
  movie: { type: 'movie', tmdbId: '27205', title: 'Inception', year: '2010', imdbId: 'tt1375666' },
  tv: { type: 'tv', tmdbId: '1396', title: 'Breaking Bad', year: '2008', imdbId: 'tt0903747', season: 1, episode: 1 },
};

/** Mock upstream: handler(method, url, bodyBytes) -> {status, body, type} | null. Records requests. */
function upstream(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    url = String(url);
    calls.push({ method, url, headers: init.headers || {}, body: init.body });
    const m = /^https:\/\/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)/.exec(url);
    if (m) return new Response(JSON.stringify(TMDB[m[1] + '/' + m[2]]), { status: 200 });
    const r = await handler(method, url, init.body ? new Uint8Array(init.body) : null);
    if (!r) return new Response('not found', { status: 404 });
    return new Response(r.body, { status: r.status || 200, headers: { 'content-type': r.type || 'text/html' } });
  };
  f.calls = calls;
  return f;
}

/** Runs an original scraper file unchanged; `fetch` is the only host capability it uses. */
async function runReference(file, f, args) {
  const sandbox = { fetch: f, module: { exports: {} }, console, TextDecoder, Uint8Array, ArrayBuffer };
  vm.runInNewContext(readFileSync(new URL(file, REF), 'utf8'), sandbox, { filename: file });
  const out = await sandbox.module.exports.getStreams(...args);
  // JSON round trip: objects built inside the vm carry another realm's prototypes, which deepStrictEqual rejects
  return JSON.parse(JSON.stringify(out)).map((s) => ({ ...s, name: s.name.replace(/[\u200B\uFEFF]/g, '') }));
}
const direct = (f) => createNet(() => ({ edge: false }), f);
const nonTmdb = (calls) => calls.filter((c) => !c.url.includes('themoviedb')).map((c) => `${c.method} ${c.url}`).sort();

// ---------------------------------------------------------------- Fendrix ----
const enc = new TextEncoder();
const b64 = (u8) => Buffer.from(u8).toString('base64');
async function sealedApi({ streams, server = 'Nebula', badTag = false }) {
  const key = webcrypto.getRandomValues(new Uint8Array(32));
  const aad = webcrypto.getRandomValues(new Uint8Array(24));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const k = await webcrypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, k, enc.encode(JSON.stringify({ data: { stream: streams }, status: 200 }))));
  if (badTag) ct[ct.length - 1] ^= 1;
  return { server, key, aad, sealed: new Uint8Array([...iv, ...ct]), request: webcrypto.getRandomValues(new Uint8Array(40)) };
}
const MASTER = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=3840x2160\n2160p/playlist.jpg\n#EXT-X-STREAM-INF:BANDWIDTH=4692000,RESOLUTION=1920x1080,NAME="1080p"\n1080p/playlist.jpg\n#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720\n720p/playlist.jpg\n';
const MASTER_AUDIO = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",URI="audio/en.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=4692000,RESOLUTION=1920x1080,AUDIO="a"\n1080p/playlist.jpg\n';

/** Live-shaped Fendrix upstream: enc-dec session broker, api.wing.st (works), api.shegu.st (530 like today). */
function fendrixUpstream(apis) {
  return upstream(async (method, url, body) => {
    const u = new URL(url);
    if (u.host === 'enc-dec.app' && u.pathname === '/api/enc-cinejoy') {
      const server = new URL(u.searchParams.get('url')).searchParams.get('server');
      const a = apis.find((x) => x.server === server);
      if (!a) return { status: 200, body: JSON.stringify({ status: 500, error: 'no session' }), type: 'application/json' };
      return { status: 200, body: JSON.stringify({ status: 200, result: { data: b64(a.request), state: { responseKey: b64(a.key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), aad: b64(a.aad) } } }), type: 'application/json' };
    }
    if (u.host === 'api.shegu.st') return { status: 530, body: '<html>origin down</html>' };
    if (u.host === 'api.wing.st' && u.pathname === '/g' && method === 'POST') {
      const a = apis.find((x) => body && Buffer.from(body).equals(Buffer.from(x.request)));
      return a ? { status: 200, body: a.sealed, type: 'application/octet-stream' } : { status: 400, body: 'bad session' };
    }
    if (url === 'https://cdn.test/hls/a/master.m3u8') return { status: 200, body: MASTER, type: 'image/jpeg' };
    if (url === 'https://cdn.test/hls/b/master.m3u8') return { status: 200, body: MASTER_AUDIO, type: 'image/jpeg' };
    return null;
  });
}

const FENDRIX_CASES = {
  'hls master: only 2160p/1080p variants, absolute URLs': [{ server: 'Nebula', streams: [{ type: 'hls', id: 'primary', playlist: 'https://cdn.test/hls/a/master.m3u8', captions: [] }] }],
  'hls with audio renditions keeps the master; file qualities keep 2160p/1080p only': [
    { server: 'Nebula', streams: [{ type: 'hls', playlist: 'https://cdn.test/hls/b/master.m3u8', captions: [{ language: 'English', url: 'https://subs.test/en.vtt' }] }] },
    { server: 'Secret', streams: [{ type: 'file', qualities: { '4K': { url: 'https://files.test/a-2160.mp4' }, '1080p': { url: 'https://files.test/a-1080.mp4' }, '720p': { url: 'https://files.test/a-720.mp4' }, auto: { url: 'https://files.test/a.mp4' } } }] },
  ],
};

for (const [title, specs] of Object.entries(FENDRIX_CASES)) {
  for (const kind of ['movie', 'tv']) {
    test(`fendrix parity with original scraper (${kind}): ${title}`, async () => {
      const apis = await Promise.all(specs.map((s) => sealedApi(s)));
      const fRef = fendrixUpstream(apis);
      const ref = await runReference('fendrix.js', fRef, kind === 'movie' ? ['27205', 'movie'] : ['1396', 'tv', 1, 1]);
      const fOur = fendrixUpstream(apis);
      const ours = await fn.search(META[kind], makeCtx(direct(fOur), fn));
      assert.ok(ref.length > 0, 'the fixture produces streams in the original');
      assert.deepEqual(ours.map((s) => [s.url, s.quality]), ref.map((s) => [s.url, s.quality ?? 'auto']), 'same streams, same order');
      assert.deepEqual(nonTmdb(fOur.calls), nonTmdb(fRef.calls), 'same requests apart from the TMDB call the port does not need');
      assert.ok(ours.every((s) => s.direct && s.provider === 'fendrix' && /^Fendrix \((Nebula|Secret)\)$/.test(s.providerName)));
      assert.ok(ours.every((s) => s.filename === (kind === 'movie' ? 'Inception (2010)' : 'Breaking Bad S01E01')), 'named after the title');
      for (const s of ours) assert.equal(s.container, s.url.includes('/hls/') ? 'm3u8' : 'mp4', 'HLS served as .jpg is still known to be HLS');
      assert.ok(ours.filter((s) => s.container === 'm3u8').every((s) => s.needsNativeHls));
    });
  }
}

test('fendrix: captions ride along with the stream; requests carry no forbidden headers and stay simple', async () => {
  const apis = await Promise.all(FENDRIX_CASES['hls with audio renditions keeps the master; file qualities keep 2160p/1080p only'].map((s) => sealedApi(s)));
  const f = fendrixUpstream(apis);
  const ours = await fn.search(META.movie, makeCtx(direct(f), fn));
  const master = ours.find((s) => s.url.endsWith('/b/master.m3u8'));
  assert.deepEqual(master.subtitles, [{ url: 'https://subs.test/en.vtt', lang: 'english', label: 'English' }]);
  for (const c of f.calls) {
    const names = Object.keys(c.headers).map((k) => k.toLowerCase());
    assert.ok(!names.some((n) => ['origin', 'referer', 'user-agent'].includes(n)), `no forbidden header on ${c.url}`);
    if (c.method === 'POST') assert.ok(!names.includes('content-type'), 'no Content-Type: a CORS simple request, no preflight');
  }
});

test('fendrix: the encrypted reply survives as bytes (text decoding would destroy it) and a bad tag yields nothing', async () => {
  const [good] = await Promise.all([sealedApi(FENDRIX_CASES['hls master: only 2160p/1080p variants, absolute URLs'][0])]);
  assert.ok(new TextDecoder().decode(good.sealed).includes('�'), 'the fixture really contains invalid UTF-8, like the live API');
  const ok = await fn.search(META.movie, makeCtx(direct(fendrixUpstream([good])), fn));
  assert.equal(ok.length, 2);
  const bad = await sealedApi({ ...FENDRIX_CASES['hls master: only 2160p/1080p variants, absolute URLs'][0], badTag: true });
  const ctx = makeCtx(direct(fendrixUpstream([bad])), fn);
  assert.deepEqual(await fn.search(META.movie, ctx), []);
});

test('fendrix: a hanging fallback endpoint does not hold back the preferred endpoint\'s answer', async () => {
  const a = await sealedApi(FENDRIX_CASES['hls master: only 2160p/1080p variants, absolute URLs'][0]);
  const up = fendrixUpstream([a]);
  const f = (url, init) => (String(url).startsWith('https://api.shegu.st') ? new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))) : up(url, init));
  const t0 = Date.now();
  const r = await resolveStreams(META.movie, { net: direct(f), enabled: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.id === 'fendrix'])), timeoutMs: 400 });
  assert.equal(r.status.fendrix.state, 'ok', JSON.stringify(r.status));
  assert.equal(r.streams.length, 2);
  assert.ok(Date.now() - t0 < 300, 'answered without waiting for the provider timeout');
});

test('fendrix deviation: an unreadable master playlist (the CDN refuses page origins) still yields the master itself', async () => {
  const a = await sealedApi(FENDRIX_CASES['hls master: only 2160p/1080p variants, absolute URLs'][0]);
  const up = fendrixUpstream([a]);
  const refusing = (url, init) => (String(url).includes('/master.m3u8') ? Promise.resolve(new Response('not found/removed\n', { status: 404 })) : up(url, init));
  const ref = await runReference('fendrix.js', refusing, ['27205', 'movie']);
  assert.deepEqual(ref, [], 'the original drops the stream');
  const ours = await fn.search(META.movie, makeCtx(direct(refusing), fn));
  assert.deepEqual(ours.map((s) => [s.url, s.quality, s.container, s.needsNativeHls]), [['https://cdn.test/hls/a/master.m3u8', 'auto', 'm3u8', true]]);
});

test('fendrix: software AES-GCM fallback (no WebCrypto, e.g. site opened over http) matches WebCrypto', async () => {
  const a = await sealedApi({ streams: [{ type: 'file', qualities: { '1080p': { url: 'https://files.test/x.mp4' } } }] });
  const viaSubtle = await fn.openSealed(a.sealed, a.key, a.aad);
  const viaSoft = await fn.openSealed(a.sealed, a.key, a.aad, { subtle: null });
  assert.equal(viaSoft, viaSubtle);
  assert.match(viaSoft, /files\.test\/x\.mp4/);
  const tampered = a.sealed.slice(); tampered[20] ^= 1;
  assert.throws(() => aesGcmDecrypt(a.key, tampered.slice(0, 12), tampered.slice(12), a.aad), /invalid tag/);
});

test('fendrix: invalid ids / missing episode are rejected without a request', async () => {
  const f = upstream(() => null);
  for (const m of [{ ...META.movie, tmdbId: 'abc' }, { ...META.tv, episode: null }, { ...META.tv, season: 0 }, { ...META.movie, type: 'person' }]) {
    assert.deepEqual(await fn.search(m, makeCtx(direct(f), fn)), []);
  }
  assert.equal(f.calls.length, 0);
});

test('fendrix: goes straight from the browser even when a gateway is configured; media URLs are never proxied', async () => {
  const seen = [];
  const net = createNet(() => ({ gatewayUrl: 'http://127.0.0.1:8787', edge: true }), async (url) => { seen.push(String(url)); return new Response('{}'); });
  await net.request('https://enc-dec.app/api/enc-cinejoy?url=x', { provider: fn });
  assert.equal(seen[0], 'https://enc-dec.app/api/enc-cinejoy?url=x');
  assert.equal(net.mode(fn), 'direct');
  assert.equal(net.mediaUrl({ url: 'https://cdn.test/a.m3u8', direct: true, headers: { Referer: 'x' } }), 'https://cdn.test/a.m3u8');
  assert.match(net.mediaUrl({ url: 'http://172.16.50.12/a.mkv', headers: {} }), /^http:\/\/127\.0\.0\.1:8787\/s\?/, 'BDIX media still uses the gateway');
});

test('playability: Fendrix HLS needs built-in HLS (its CDN rejects page origins); VC-1 is flagged', () => {
  const s = { container: 'm3u8', needsNativeHls: true, info: {} };
  assert.equal(playability(s, { nativeHls: true }).level, 'ok');
  const no = playability(s, { nativeHls: false });
  assert.equal(no.level, 'bad'); assert.match(no.reasons[0], /built-in HLS/);
  assert.equal(playability({ container: 'm3u8', info: {} }, { nativeHls: false }).level, 'ok', 'other HLS sources are unaffected');
  assert.equal(playability({ container: 'mkv', info: { video: 'vc1', audio: [] } }, { mkv: true }).level, 'bad');
  const ranked = rank([{ ...s, height: 2160, provider: 'fendrix' }, { container: 'mp4', height: 720, info: {}, provider: 'bdix-df' }], { nativeHls: false, mkv: true });
  assert.equal(ranked[0].provider, 'bdix-df', 'a stream this browser can play goes first');
});

// ---------------------------------------------------------------- Hexion ----
const B = (s) => Buffer.from(s, 'latin1').toString('base64');
const rot13 = (v) => v.replace(/[a-zA-Z]/g, (c) => String.fromCharCode((c <= 'Z' ? 90 : 122) >= c.charCodeAt(0) + 13 ? c.charCodeAt(0) + 13 : c.charCodeAt(0) - 13));
/** What greenmotors.club serves: the target hidden as b64(b64(rot13(b64({"o": b64(url)})))). */
const wrapper = (target) => `<html><script>var _0x = ['x', 'o', '${B(B(rot13(B(JSON.stringify({ o: B(target) })))))}'];s('o', '${B(B(rot13(B(JSON.stringify({ o: B(target) })))))}');</script></html>`;
const card = (href, title, format, year) => `<a href="${href}" class="movie-card"><div class="movie-card-content"><h3 class="movie-card-title">${title}</h3><p class="movie-card-meta">${year}</p><span class="movie-card-format">${format}</span></div></a>`;
const SEARCH = `<html><body><div class="card-grid">${card('/inception-movie-509/', 'Inception', 'Movies', 2010)}${card('/inception-2-movie-1/', 'Inception Sequel', 'Movies', 2031)}${card('/breaking-bad-series-1385/', 'Breaking Bad', 'Series', 2008)}</div></body></html>`;
const item = (label, links) => `<div class="download-item border rounded-lg overflow-hidden"><div class="file-title">${label}</div>${links.map(([h, t]) => `<a href="${h}" class="btn">${t}</a>`).join('')}</div>`;
const MOVIE_PAGE = `<html><body><h1>Inception (2010)</h1>${[
  item('Inception (2010) 2160p UHD BluRay HEVC DDP 5.1 [30.03 GB]', [['https://greenmotors.club/?id=A1', 'Download HubCloud'], ['https://greenmotors.club/?id=A2', 'Download HubDrive']]),
  item('Inception (2010) 1080p BluRay x264 AAC [6.6 GB]', [['https://greenmotors.club/?id=B2', 'Download HubDrive']]),
  item('Inception (2010) 480p WEB-DL [400 MB]', [['https://greenmotors.club/?id=C1', 'HubCloud']]),
  item('Inception (2010) 720p WEB-DL x264 AAC [2.1 GB]', [['https://greenmotors.club/?id=D1', 'HubCloud']]),
].join('')}</body></html>`;
const ep = (n, links) => `<div class="episode-download-item"><span>Episode-${String(n).padStart(2, '0')}</span>${links.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}</div>`;
const TV_PAGE = `<html><body>
  <div class="episode-item"><h3 class="episode-title">S01 1080p BluRay x264 [8.9 GB]</h3>${ep(1, [['https://greenmotors.club/?id=T1', 'HubCloud']])}${ep(2, [['https://greenmotors.club/?id=T2', 'HubCloud']])}</div>
  <div class="episode-item"><h3 class="episode-title">S02 1080p BluRay x264</h3>${ep(1, [['https://greenmotors.club/?id=T9', 'HubCloud']])}</div>
</body></html>`;
/** gamerxyt.com/hubcloud.php: the file page. `deviation` = today's layout (workers.dev link, <i id="size">). */
const filePage = (name, { r2, pixel, workers, size, legacySize = true }) => `<html><head><title>${name}</title></head><body>
  <div class="card-header text-white bg-primary mb-3">${name}</div>
  ${legacySize ? `<table><tr><td>File Size:</td><td>${size}</td></tr></table>` : `<ul><li>File Size<i id="size">${size}</i></li></ul>`}
  ${r2 ? `<a href="${r2}" class="btn">Download [FSL Server]</a>` : ''}
  ${workers ? `<a href="${workers}" class="btn">Download [FSL Server]</a>` : ''}
  ${pixel ? `<a href="https://pixeldrain.dev/u/${pixel}" class="btn">PixelDrain</a>` : ''}
  <a href="https://pixel.hubcloud.mov/?id=zz" class="btn">Download [PixelServer : 2]</a>
  <a href="https://t.me/hubcloudreport">report</a><a href="https://files.test/archive.zip">zip</a>
</body></html>`;

function hexionUpstream({ deviation = false, wp = false } = {}) {
  const files = {
    A: filePage('Inception.2010.2160p.UHD.BluRay.HEVC.DDP5.1-Grp.mkv', deviation ? { workers: 'https://old-art-db58.terapiyo252.workers.dev/k/1/Inception 2160p.mkv', size: '30.03 GB', legacySize: false } : { r2: 'https://abc.r2.cloudflarestorage.com/hub/aa?X-Amz-Signature=1&amp;x=2', pixel: 'PxA', size: '30.03 GB' }),
    B: filePage('Inception.2010.1080p.BluRay.x264.AAC-Grp.mkv', deviation ? { workers: 'https://dl.example.workers.dev/k/2/Inception.1080p.mkv', size: '6.6 GB', legacySize: false } : { r2: 'https://pub-1.r2.dev/Inception.1080p.mkv', size: '6.6 GB' }),
    D: filePage('Inception.2010.720p.WEB-DL.x264.AAC-Grp.mp4', { r2: 'https://pub-2.r2.dev/Inception.720p.mp4', size: '2.1 GB' }),
    T: filePage('Breaking.Bad.S01E01.1080p.BluRay.x264-Grp.mkv', { r2: 'https://pub-3.r2.dev/bb.s01e01.mkv', pixel: 'PxT', size: '1.1 GB' }),
  };
  return upstream((method, url) => {
    const u = new URL(url);
    if (u.host === '4khdhub.one') {
      if (u.pathname === '/wp-json/wp/v2/posts') return wp ? { status: 200, body: JSON.stringify([{ link: 'https://4khdhub.one/inception-movie-509/' }]), type: 'application/json' } : { status: 404, body: '{"code":"rest_no_route"}' };
      if (u.pathname === '/' && u.searchParams.has('s')) return { body: SEARCH };
      if (u.pathname === '/inception-movie-509/') return { body: MOVIE_PAGE };
      if (u.pathname === '/breaking-bad-series-1385/') return { body: TV_PAGE };
    }
    if (u.host === 'greenmotors.club') {
      const id = u.searchParams.get('id');
      const target = { A1: 'https://hubcloud.mov/drive/aaa', A2: 'https://hubdrive.blog/file/111', B2: 'https://hubdrive.blog/file/222', C1: 'https://hubcloud.mov/drive/ccc', D1: 'https://hubcloud.mov/drive/ddd', T1: 'https://hubcloud.mov/drive/ttt', T2: 'https://hubcloud.mov/drive/t22' }[id];
      return target ? { body: wrapper(target) } : null;
    }
    if (u.host === 'hubdrive.blog') return { body: `<html><a class="btn" href="https://hubcloud.mov/drive/${u.pathname.endsWith('222') ? 'bbb' : 'aaa'}">[HubCloud Server]</a></html>` };
    if (u.host === 'hubcloud.mov' && u.pathname.startsWith('/drive/')) {
      const k = { aaa: 'A', bbb: 'B', ccc: 'C', ddd: 'D', ttt: 'T' }[u.pathname.split('/').pop()];
      return k ? { body: `<html><script>var url = 'https://gamerxyt.com/hubcloud.php?host=hubcloud&amp;id=${k}&amp;token=x';</script></html>` } : null;
    }
    if (u.host === 'gamerxyt.com') return files[u.searchParams.get('id')] ? { body: files[u.searchParams.get('id')] } : null;
    return null;
  });
}

for (const [kind, wp] of [['movie', false], ['movie', true], ['tv', false]]) {
  test(`hexion parity with original scraper (${kind}${wp ? ', found by IMDb id' : ', found by search'})`, async () => {
    const fRef = hexionUpstream({ wp });
    const ref = await runReference('hexion.js', fRef, kind === 'movie' ? ['27205', 'movie'] : ['1396', 'tv', 1, 1]);
    const fOur = hexionUpstream({ wp });
    const ours = await hx.search(META[kind], makeCtx(direct(fOur), hx), { DOMParser });
    assert.ok(ref.length > 0, 'the fixture produces streams in the original');
    assert.deepEqual(ours.map((s) => [s.url, s.quality.toUpperCase()]), ref.map((s) => [s.url, s.quality.split(' ')[0]]), 'same streams, same order');
    assert.deepEqual(nonTmdb(fOur.calls), nonTmdb(fRef.calls), 'same requests apart from the TMDB call');
    for (const [i, s] of ours.entries()) {
      assert.equal(s.providerName, `Hexion (${/pixeldrain/.test(s.url) ? 'PixelDrain' : 'FSL-v2'})`);
      assert.ok(s.direct && s.sizeLabel, 'size shown, file played straight from its host');
      assert.ok(ref[i].name.includes(s.sizeLabel));
    }
    assert.ok(!ours.some((s) => /pixel\.hubcloud|\.zip|t\.me/.test(s.url)), 'interstitials, archives and other links are ignored');
    if (kind === 'movie') {
      assert.ok(!ours.some((s) => s.quality === '480p'), '480p is skipped like the original');
      const r2 = ours.find((s) => s.url.includes('cloudflarestorage'));
      assert.equal(r2.container, 'mkv', 'signed R2 URL without extension: format from the file name');
      assert.equal(r2.filename, 'Inception.2010.2160p.UHD.BluRay.HEVC.DDP5.1-Grp.mkv');
      assert.equal(r2.info.video, 'hevc');
    }
  });
}

test('hexion deviation: current file pages (workers.dev links, <i id="size">) are understood; the original finds nothing', async () => {
  const ref = await runReference('hexion.js', hexionUpstream({ deviation: true }), ['27205', 'movie']);
  const ours = await hx.search(META.movie, makeCtx(direct(hexionUpstream({ deviation: true })), hx), { DOMParser });
  assert.deepEqual(ref.map((s) => s.url), ['https://pub-2.r2.dev/Inception.720p.mp4'], 'the original keeps only the legacy R2 page');
  const w = ours.filter((s) => s.providerName === 'Hexion (FSL)');
  assert.deepEqual(w.map((s) => [s.quality, s.sizeLabel]), [['2160p', '30.03 GB'], ['1080p', '6.6 GB']]);
  assert.equal(w[0].url, 'https://old-art-db58.terapiyo252.workers.dev/k/1/Inception%202160p.mkv', 'spaces encoded like the original');
  assert.equal(ours.length, 3);
});

test('hexion: helpers match the original decoding rules', () => {
  assert.equal(hx.unwrapPayload(wrapper('https://hubcloud.mov/drive/x')), 'https://hubcloud.mov/drive/x');
  assert.equal(hx.unwrapPayload('<html>no payload</html>'), null);
  assert.throws(() => hx.decode64('a'), /base64/);
  assert.equal(hx.rot13('Uryyb'), 'Hello');
  assert.deepEqual(['2160p x265', '4K HDR', 'UHD', 'no marker', '720p'].map(hx.qualityOf), ['2160p', '2160p', '2160p', '1080p', '720p']);
  assert.equal(hx.bestCard(SEARCH, { ...META.movie, title: 'Totally Different' }, { DOMParser }), null, 'weak title match is rejected');
  assert.equal(hx.bestCard(SEARCH, META.movie, { DOMParser }), 'https://4khdhub.one/inception-movie-509/', 'title + year picks the right card');
});

test('cancelling a lookup aborts the public providers too (no swallowed AbortError)', async () => {
  const ctrl = new AbortController();
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
  const only = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.id === 'fendrix' || p.id === 'hexion']));
  const p = resolveStreams(META.movie, { net: direct(hang), enabled: only, signal: ctrl.signal, DOMParser });
  setTimeout(() => ctrl.abort(new DOMException('x', 'AbortError')), 20);
  const r = await p;
  assert.deepEqual(Object.keys(r.status).sort(), ['fendrix', 'hexion']);
  assert.ok(Object.values(r.status).every((s) => s.state === 'cancelled'), JSON.stringify(r.status));
});

test('hexion: cancelling while file pages are still loading reports cancelled, not empty', async () => {
  const up = hexionUpstream();
  const ctrl = new AbortController();
  // everything answers except the final file pages, which hang until the user leaves
  const f = (url, init) => (String(url).includes('gamerxyt.com')
    ? (setTimeout(() => ctrl.abort(new DOMException('x', 'AbortError')), 5), new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))))
    : up(url, init));
  const r = await resolveStreams(META.movie, { net: direct(f), enabled: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.id === 'hexion'])), signal: ctrl.signal, DOMParser });
  assert.ok(up.calls.some((c) => c.url.includes('hubcloud.mov')), 'the chain got as far as HubCloud');
  assert.equal(r.status.hexion.state, 'cancelled');
});

// ---------------------------------------------------------------- edge proxy ----
test('edge proxy allow-list: FlixHub + the Hexion chain, exact names only; Fendrix hosts are not proxied', async () => {
  const hosts = proxyHosts({});
  for (const h of ['flixhub.net', '4khdhub.one', 'greenmotors.club', 'hubdrive.blog', 'hubcloud.mov', 'gamerxyt.com']) assert.ok(hosts.includes(h), h);
  for (const h of ['api.wing.st', 'enc-dec.app', 'cinejoy.pk', 'api.shegu.xyz']) assert.ok(!hosts.includes(h), h + ' is reached directly, not through the edge');
  const up = async () => new Response('<html>ok</html>');
  const call = (u) => handleApi(new Request('http://x.test/api/proxy?u=' + encodeURIComponent(u)), {}, { fetch: up });
  assert.equal((await call('https://gamerxyt.com/hubcloud.php?id=1')).status, 200);
  for (const u of ['https://hubcloud.mov.evil.test/', 'https://evil-hubcloud.mov/', 'https://x.gamerxyt.com/', 'http://hubcloud.mov/', 'https://hubcloud.mov:8443/', 'https://u:p@hubcloud.mov/', 'https://[::1]/', 'https://127.0.0.1/', 'https://enc-dec.app/api/enc-cinejoy']) {
    assert.equal((await call(u)).status, 403, u);
  }
});

// Public online sources in a real browser: Fendrix (encrypted API called directly, HLS from a CDN that rejects any
// page Origin) and Hexion (4kHdHub link chain through the edge proxy, file from a *.workers.dev host).
// No real internet: the browser's requests to the provider hosts are answered here; the CDN is a local server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { video, waitPlaying, text, hasText } from './helpers.mjs';

const ONLY = (id) => JSON.stringify({ providers: { 'bdix-df': false, 'bdix-cf': false, 'bdix-fh': false, fendrix: id === 'fendrix', hexion: id === 'hexion' } });

/** Local stand-in for the Fendrix CDN: HLS named .jpg, served as image/jpeg, and 404 for ANY request with an Origin header. */
function startCdn(dir) {
  const log = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://cdn');
    log.push({ path: u.pathname, origin: req.headers.origin || null });
    const file = path.join(dir, path.normalize(u.pathname.replace(/^\/hls\/e2e\//, '')).replace(/^(\.\.[/\\])+/, ''));
    if (req.headers.origin || !u.pathname.startsWith('/hls/e2e/') || !fs.existsSync(file)) { res.writeHead(404, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }); return res.end('not found/removed\n'); }
    res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'image/jpeg' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ base: `http://127.0.0.1:${server.address().port}`, log, close: () => server.close() })));
}

async function sealedSession(streams) {
  const key = webcrypto.getRandomValues(new Uint8Array(32));
  const aad = webcrypto.getRandomValues(new Uint8Array(24));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const k = await webcrypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, k, new TextEncoder().encode(JSON.stringify({ data: { stream: streams }, status: 200 }))));
  const b64 = (u) => Buffer.from(u).toString('base64');
  return { request: webcrypto.getRandomValues(new Uint8Array(40)), sealed: Buffer.from([...iv, ...ct]), session: { status: 200, result: { data: '', state: { responseKey: b64(key), aad: b64(aad) } } } };
}

/** Answers the Fendrix API hosts in the browser: one sealed session whose stream list points at `playlist`. */
async function mockFendrixApi(page, playlist, seen = []) {
  const s = await sealedSession([{ type: 'hls', id: 'primary', playlist, captions: [] }]);
  s.session.result.data = Buffer.from(s.request).toString('base64');
  const cors = { 'access-control-allow-origin': '*' };
  const prev = page.__intercept;
  page.__intercept = (r, u) => {
    if (u.hostname === 'enc-dec.app') { seen.push('enc-dec'); r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(s.session) }); return true; }
    if (u.hostname === 'api.wing.st') { seen.push('wing'); r.respond({ status: 200, contentType: 'application/octet-stream', headers: cors, body: s.sealed }); return true; }
    if (u.hostname === 'api.shegu.st') { r.respond({ status: 502, contentType: 'text/html', body: 'origin down' }); return true; }
    return prev ? prev(r, u) : false;
  };
  page.__ignoreErrors = /api\.shegu\.st|^Failed to load resource: net::ERR_FAILED$/;
  return seen;
}
/** Make Chromium report no built-in HLS, like Firefox (the app and the player both decide by canPlayType). */
const withoutNativeHls = (page) => page.evaluateOnNewDocument(() => {
  const orig = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (t) { return /mpegurl/i.test(t) ? '' : orig.call(this, t); };
});

export async function steps4(ctx) {
  const { step, assert, b, bdix, app, open, waitFor, shot, MEDIA_DIR, startGateway } = ctx;

  await step('fendrix: encrypted lookup straight from the browser (even with a gateway set); HLS from a CDN that refuses page origins plays through built-in HLS', async () => {
    const cdn = await startCdn(path.join(MEDIA_DIR, 'hls'));
    const s = await sealedSession([{ type: 'hls', id: 'primary', playlist: cdn.base + '/hls/e2e/master.m3u8', captions: [] }]);
    s.session.result.data = Buffer.from(s.request).toString('base64');
    const seen = [];
    const page = await b.newPage({ width: 1280, height: 800, label: 'fendrix' });
    // like the live fallback endpoint (530 without CORS headers), api.shegu.st fails here; Chrome logs that, nothing else
    page.__ignoreErrors = /api\.shegu\.st|^Failed to load resource: net::ERR_FAILED$/;
    const cors = { 'access-control-allow-origin': '*' };
    page.__intercept = (r, u) => {
      if (u.hostname === 'enc-dec.app') { seen.push(`GET enc-dec ${new URL(u.searchParams.get('url')).searchParams.get('server')}`); r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(s.session) }); return true; }
      if (u.hostname === 'api.wing.st') { seen.push(`${r.method()} wing ${r.headers()['content-type'] || 'no content-type'}`); r.respond({ status: 200, contentType: 'application/octet-stream', headers: cors, body: s.sealed }); return true; }
      if (u.hostname === 'api.shegu.st') { r.respond({ status: 502, contentType: 'text/html', body: 'origin down' }); return true; } // live answers 530; CDP cannot send that code
      if (u.hostname === '127.0.0.1' && u.port === '8787') { seen.push('GATEWAY ' + u.pathname); r.abort(); return true; }
      return false;
    };
    try {
      await open(page, '#/movie/603');
      await waitFor(() => page.$('.dinfo h1'), { what: 'details' });
      // a gateway is configured, yet Fendrix must not use it (its API and CDN are public and send CORS headers)
      await page.evaluate((st) => localStorage.setItem('rh:settings', st), JSON.stringify({ ...JSON.parse(ONLY('fendrix')), gatewayUrl: 'http://127.0.0.1:8787' }));
      bdix.log.length = 0;
      await page.evaluate(() => { location.hash = '#/watch/movie/603'; });
      await waitPlaying(page, 1.0);
      const v = await video(page, (v) => ({ src: v.currentSrc, w: v.videoWidth, audio: v.webkitAudioDecodedByteCount }));
      // the provider's own read of the master carries an Origin and is refused (as by the real CDN), so the master
      // itself is offered and the built-in HLS player picks the variant
      assert.equal(v.src, cdn.base + '/hls/e2e/master.m3u8', 'master playlist, played straight from the CDN');
      assert.equal(v.w, 640); assert.ok(v.audio > 0, 'sound is decoded');
      assert.ok(seen.includes('GET enc-dec Nebula') && seen.includes('GET enc-dec Secret'), 'both servers asked');
      assert.ok(seen.includes('POST wing no content-type'), 'binary POST without Content-Type (CORS simple request)');
      assert.ok(!seen.some((x) => x.startsWith('GATEWAY')), 'never routed through the gateway');
      assert.equal(bdix.log.length, 0);
      const withOrigin = cdn.log.filter((l) => l.origin);
      assert.ok(withOrigin.length >= 1 && withOrigin.every((l) => l.path === '/hls/e2e/master.m3u8'), 'only the lookup\u2019s master read carried an Origin (and got 404)');
      const media = cdn.log.filter((l) => l.path.includes('/1080p/'));
      assert.ok(media.length >= 2 && media.every((l) => l.origin === null), 'built-in HLS requests carry no Origin, so the CDN serves them');
      // the reason an in-page player (hls.js) cannot be used: page requests always send Origin
      assert.equal(await page.evaluate((u) => fetch(u).then((r) => r.status), cdn.base + '/hls/e2e/master.m3u8'), 404);
      // the source list shows the provider and its server
      await page.evaluate(() => [...document.querySelectorAll('.toolrow .btn')].find((x) => /Sources/.test(x.textContent)).click());
      await waitFor(() => page.$('dialog.sheet .ticket'), { what: 'tickets' });
      assert.equal(await text(page, 'dialog.sheet .ticket .from'), 'Fendrix (Nebula)');
      assert.equal(await text(page, 'dialog.sheet .ticket .name'), 'The Matrix (1999)', 'named after the title, not "master.m3u8"');
      assert.ok(await hasText(page, 'dialog.sheet .pstat .chip', /^Fendrix: 1 found$/));
      await shot(page, 'fendrix-sources');
      assert.deepEqual(await b.cspViolations(page), []);
    } finally { await page.close(); cdn.close(); }
  });

  await step('fendrix without built-in HLS (Firefox-like): flagged with the gateway hint; with a gateway it plays through hls.js, playlists rewritten', async () => {
    const cdn = await startCdn(path.join(MEDIA_DIR, 'hls'));
    const gw = await startGateway({ origin: app.origin });
    const page = await b.newPage({ width: 1280, height: 800, label: 'fendrix-nohls', setup: withoutNativeHls });
    try {
      await mockFendrixApi(page, cdn.base + '/hls/e2e/master.m3u8');
      await open(page, '#/movie/603');
      await waitFor(() => page.$('.dinfo h1'), { what: 'details' });
      assert.equal(await page.evaluate(() => document.createElement('video').canPlayType('application/vnd.apple.mpegurl')), '', 'no built-in HLS in this page');
      // 1) no gateway: the source is honestly marked and the reason names the way out
      await page.evaluate((st) => localStorage.setItem('rh:settings', st), ONLY('fendrix'));
      await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Download/.test(x.textContent)).click());
      await waitFor(() => page.$('dialog.sheet .ticket'), { what: 'tickets' });
      assert.equal(await page.$eval('dialog.sheet .ticket', (e) => e.dataset.level), 'bad');
      assert.match(await text(page, 'dialog.sheet .ticket .why'), /through the gateway/);
      await page.keyboard.press('Escape');
      // 2) with a gateway: plays in the page through hls.js; every CDN request comes from the gateway without an Origin
      await page.evaluate((st) => localStorage.setItem('rh:settings', st), JSON.stringify({ ...JSON.parse(ONLY('fendrix')), gatewayUrl: gw.url, gatewayToken: gw.token }));
      cdn.log.length = 0;
      await page.evaluate(() => { location.hash = '#/watch/movie/603'; });
      await waitPlaying(page, 1.5);
      const v = await video(page, (v) => ({ src: v.currentSrc, w: v.videoWidth, audio: v.webkitAudioDecodedByteCount }));
      assert.match(v.src, /^blob:/, 'Media Source playback (hls.js), not <video src>');
      assert.equal(v.w, 640); assert.ok(v.audio > 0, 'sound is decoded');
      assert.ok(cdn.log.some((l) => l.path === '/hls/e2e/1080p/playlist.jpg') && cdn.log.filter((l) => /playlist_\d+\.jpg$/.test(l.path)).length >= 1, 'variant playlist and segments fetched');
      // only the lookup's own read of the master carries an Origin (refused, as by the real CDN); playback never does
      assert.ok(cdn.log.filter((l) => l.origin).every((l) => l.path === '/hls/e2e/master.m3u8'), JSON.stringify(cdn.log));
      assert.ok(cdn.log.filter((l) => l.path !== '/hls/e2e/master.m3u8').every((l) => l.origin === null), 'variant and segments fetched without an Origin');
      assert.ok(cdn.log.some((l) => l.path === '/hls/e2e/master.m3u8' && l.origin === null), 'the master itself came through the gateway');
      const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
      assert.ok(loaded.some((n) => /\/vendor\/hls/.test(n)), 'hls.js was loaded');
      assert.ok(loaded.some((n) => n.startsWith(gw.url + '/s?') && n.includes('hls=1')), 'playlists requested through the gateway with hls=1');
      assert.deepEqual([...new Set(loaded.filter((n) => n.startsWith(cdn.base)))], [cdn.base + '/hls/e2e/master.m3u8'], 'the page touched the CDN only for the lookup\u2019s master read');
      assert.equal(await page.$$eval('.banner', (e) => e.length), 0, 'no error banner');
      await shot(page, 'fendrix-firefox-gateway');
      assert.deepEqual(await b.cspViolations(page), []);
    } finally { await page.close(); cdn.close(); gw.close(); }
  });

  await step('hexion: 4kHdHub chain via the edge proxy (wrapper -> HubCloud -> file page), size shown, file plays from its host', async () => {
    const mp4 = fs.readFileSync(path.join(MEDIA_DIR, 'test.mp4'));
    const page = await b.newPage({ width: 1280, height: 800, label: 'hexion' });
    await page.setCacheEnabled(false); // edge-proxy replies are cacheable (max-age=60); earlier steps asked the same URLs
    app.sources.hexion = true;
    const fileHits = [];
    page.__intercept = (r, u) => {
      if (u.hostname === 'e2e-media.workers.dev') { fileHits.push(u.pathname); r.respond({ status: 200, contentType: 'video/mp4', headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'none' }, body: mp4 }); return true; }
      return false;
    };
    try {
      await open(page, '#/movie/603');
      await waitFor(() => page.$('.dinfo h1'), { what: 'details' });
      await page.evaluate((st) => localStorage.setItem('rh:settings', st), ONLY('hexion'));
      app.mockLog.length = 0;
      await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Download/.test(x.textContent)).click());
      await waitFor(() => page.$('dialog.sheet .ticket'), { what: 'tickets' });
      const t = await page.$$eval('dialog.sheet .ticket', (els) => els.map((e) => ({ from: e.querySelector('.from').textContent, name: e.querySelector('.name').textContent, tags: [...e.querySelectorAll('.tag')].map((x) => x.textContent) })));
      assert.equal(t.length, 1, 'the pixel.hubcloud interstitial link is not offered');
      assert.equal(t[0].from, 'Hexion (FSL)'); assert.equal(t[0].name, 'The.Matrix.1999.1080p.WEB-DL.x264.AAC.mp4');
      assert.ok(t[0].tags.includes('1.4 GB') && t[0].tags.includes('Recommended'), JSON.stringify(t[0].tags));
      for (const host of ['4khdhub.one/', 'greenmotors.club/', 'hubcloud.mov/drive/m1', 'gamerxyt.com/hubcloud.php']) assert.ok(app.mockLog.some((l) => l.startsWith(host)), `${host} fetched through the edge proxy`);
      assert.equal(fileHits.length, 0, 'nothing downloaded during lookup');
      await shot(page, 'hexion-download');
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }); // no isMobile: toggling it reloads the page and closes the sheet
      await waitFor(() => page.$('dialog.sheet[open] .ticket'), { what: 'sheet still open at phone width' });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow at phone width');
      await shot(page, 'hexion-download-phone');
      await page.setViewport({ width: 1280, height: 800 });
      await page.keyboard.press('Escape');
      await page.evaluate(() => { location.hash = '#/watch/movie/603'; });
      await waitPlaying(page, 1.0);
      assert.equal(await video(page, (v) => v.currentSrc), 'https://e2e-media.workers.dev/files/The.Matrix.1999.1080p.WEB-DL.x264.AAC.mp4', 'played straight from the file host');
      assert.deepEqual(await b.cspViolations(page), []);
    } finally { app.sources.hexion = false; await page.close(); }
  });

  await step('online sources down + BDIX down: guidance names the BDIX problem and mentions the online sources', async () => {
    const page = await b.newPage({ width: 1280, height: 900, label: 'public-down' });
    page.__expectErrors = true;
    page.__intercept = (r, u) => (u.hostname === 'enc-dec.app' ? (r.abort('internetdisconnected'), true) : false); // Fendrix unreachable
    try {
      await open(page, '#/movie/603');
      await waitFor(() => page.$('.dinfo h1'), { what: 'details' });
      await page.evaluate(() => localStorage.setItem('rh:settings', JSON.stringify({ providers: { 'bdix-fh': false, hexion: false } })));
      bdix.state.down = true;
      await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Download/.test(x.textContent)).click());
      await waitFor(() => page.$('dialog.sheet .notice'), { what: 'guidance' });
      assert.deepEqual(await page.$$eval('.pstat .chip', (e) => e.map((x) => x.textContent)), ['DhakaFlix: unreachable', 'Circle FTP: unreachable', 'FlixHub: off', 'Fendrix: unreachable', 'Hexion: off']);
      assert.match(await text(page, 'dialog.sheet .notice h3'), /Could not reach the BDIX servers/);
      assert.ok(await hasText(page, 'dialog.sheet .notice li', /BDIX-connected network/));
      assert.ok(await hasText(page, 'dialog.sheet .notice li', /online sources did not answer either/));
    } finally { bdix.state.down = false; await page.close(); }
  });
}

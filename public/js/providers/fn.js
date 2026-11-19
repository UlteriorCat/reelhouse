// Fendrix (Cinejoy / Shegu API): encrypted stream lists from public HTTPS endpoints.
// Port of the eclipsia "fendrix.js" scraper (GPL-3.0, see /NOTICE.md). Same requests, order and filtering; differences:
//   * title, year and IMDb id come from the TMDB details the site already loaded (the original makes its own TMDB call)
//   * the Origin/Referer/User-Agent request headers are not sent: browsers forbid them, and the API was measured to
//     answer any Origin with `Access-Control-Allow-Origin: *` (Nov 2026), so lookups go straight from the browser
//   * AES-256-GCM uses WebCrypto; the original's software AES (./aesgcm.js) is the fallback outside secure contexts
//   * the response is read as bytes: decoding it as text first replaces invalid UTF-8 and destroys the ciphertext
//   * once the preferred API endpoint has answered, the others are not waited for (same result, no stall)
//   * DEVIATION: when the master playlist cannot be read (always, from a browser) the master itself is offered
//     (quality "auto") instead of dropping the stream; see resolveItem
//   * HLS streams are flagged: their CDN rejects any foreign Origin, so they play only where the browser fetches
//     them without one (built-in HLS: Safari, Chrome 142+) or in an external player. See streams.js playability().
import { makeStream, unlessAbort } from './common.js';

export const id = 'fendrix';
export const name = 'Fendrix';
/** Public HTTPS with CORS: never through the gateway or the edge proxy. */
export const direct = true;
export const group = 'public';

export const SESSION_URL = 'https://enc-dec.app/api/enc-cinejoy';
export const API_URL = 'https://api.shegu.xyz/';
export const API_BASE = ['https://api.wing.st', 'https://api.shegu.st'];
export const SERVERS = ['Nebula', 'Secret'];
const BASE_URL = 'https://cinejoy.pk';
/** What the original sends with playback requests. Kept on the stream for external tools; a browser cannot send it. */
const PLAY_HEADERS = { Origin: BASE_URL, Referer: BASE_URL + '/' };

const isCount = (v) => Number.isInteger(v) && v >= 1;
const pad2 = (n) => String(n).padStart(2, '0');

export function buildQuery(meta) {
  const tmdbId = String(meta.tmdbId ?? '').trim();
  if (!/^\d+$/.test(tmdbId) || (meta.type !== 'movie' && meta.type !== 'tv')) return null;
  const isTv = meta.type === 'tv';
  if (isTv && (meta.season == null || meta.episode == null)) return null;
  const season = isTv ? Number(meta.season) : 1;
  const episode = isTv ? Number(meta.episode) : 1;
  if (isTv && (!isCount(season) || !isCount(episode))) return null;
  return { tmdbId, isTv, season, episode };
}

export function sessionTarget(q, server, meta) {
  let url = `${API_URL}?type=${q.isTv ? 'series' : 'movie'}&tmdb=${q.tmdbId}&server=${server}`;
  if (q.isTv) url += `&season=${q.season}&episode=${q.episode}`;
  if (meta.title) url += `&title=${encodeURIComponent(meta.title)}`;
  if (meta.year) url += `&year=${meta.year}`;
  if (meta.imdbId) url += `&imdb=${meta.imdbId}`;
  return url;
}

export function b64ToBytes(s) {
  let t = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[\t\n\f\r ]/g, '');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** iv(12) || ciphertext || tag(16) -> UTF-8 text. Throws on a bad key/tag. */
export async function openSealed(bytes, key, aad, { subtle = globalThis.crypto && globalThis.crypto.subtle } = {}) {
  const iv = bytes.slice(0, 12);
  const data = bytes.slice(12);
  let plain;
  if (subtle) {
    const k = await subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
    plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, k, data));
  } else {
    const { aesGcmDecrypt } = await import('./aesgcm.js');
    plain = aesGcmDecrypt(key, iv, data, aad);
  }
  return new TextDecoder().decode(plain);
}

async function createSession(ctx, q, server, meta) {
  const r = await ctx.json(`${SESSION_URL}?url=${encodeURIComponent(sessionTarget(q, server, meta))}`);
  if (!r || r.status !== 200 || !r.result || !r.result.state) return null;
  try {
    return { body: b64ToBytes(r.result.data), key: b64ToBytes(r.result.state.responseKey), aad: b64ToBytes(r.result.state.aad) };
  } catch { return null; }
}

async function readEndpoint(ctx, endpoint, session, server) {
  // No Content-Type header: a bare byte body keeps this a CORS "simple request" (no preflight round trip).
  const bytes = await ctx.bytes(endpoint + '/g', { method: 'POST', body: session.body });
  if (!bytes) return null;
  try {
    const payload = JSON.parse(await openSealed(bytes, session.key, session.aad));
    const items = (payload && payload.data && payload.data.stream) || [];
    if (!Array.isArray(items)) return null;
    return items.filter((it) => it && typeof it === 'object').map((it) => ({ ...it, sourceServer: server }));
  } catch { return null; }
}

async function readServer(ctx, q, server, meta) {
  const session = await createSession(ctx, q, server, meta);
  if (!session) return [];
  // Both endpoints in parallel like the original, and the first one in API_BASE order that answers wins. Unlike the
  // original we do not wait for the others once a preferred endpoint has answered: a hanging fallback endpoint must
  // not hold back (or, at the provider timeout, throw away) a result we already have.
  const slots = API_BASE.map((e) => readEndpoint(ctx, e, session, server).catch(unlessAbort(null)));
  // a slot we stop waiting for may still reject later (timeout/cancel); mark it handled so that is not an unhandled
  // rejection. Awaiting a slot below still sees its error.
  for (const slot of slots) slot.catch(() => {});
  for (const slot of slots) {
    const items = await slot;
    if (items) return items;
  }
  return [];
}

export function hlsVariants(text, masterUrl) {
  const out = [];
  let pending = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const m = line.match(/RESOLUTION=(\d+)x(\d+)/i);
      pending = { height: m ? Number(m[2]) : 0 };
    } else if (line && !line.startsWith('#') && pending) {
      let url = line;
      try { url = new URL(line, masterUrl).href; } catch { /* keep as is */ }
      out.push({ height: pending.height, url });
      pending = null;
    }
  }
  return out;
}

export const qualityLabel = (raw) => {
  const s = String(raw || '').toLowerCase();
  if (s.includes('2160') || s.includes('4k')) return '2160p';
  if (s.includes('1080') || s.includes('fhd')) return '1080p';
  return 'auto';
};

export function subtitlesOf(captions) {
  if (!Array.isArray(captions)) return [];
  return captions
    .map((c) => ({ url: c && typeof c.url === 'string' ? c.url.trim() : '', lang: String((c && (c.language || c.id)) || 'en').toLowerCase(), label: String((c && (c.language || c.id)) || 'Subtitle') }))
    .filter((c) => /^https?:\/\//i.test(c.url));
}

async function resolveItem(ctx, item) {
  const base = { server: item.sourceServer || SERVERS[0], subtitles: subtitlesOf(item.captions) };
  if (item.type === 'hls' && item.playlist) {
    const text = await ctx.text(item.playlist);
    // DEVIATION: in a browser this read always fails (the CDN answers 404 to any request with an Origin header, and
    // fetch() always sends one). The original then drops the item; we offer the master playlist itself: the built-in
    // HLS player reads it without an Origin and picks the variant on its own.
    if (text === null) return [{ ...base, url: item.playlist, quality: 'auto', hls: true }];
    const variants = hlsVariants(text, item.playlist);
    if (/#EXT-X-MEDIA\s*:\s*TYPE=AUDIO/i.test(text)) {
      // separate audio renditions: only the master playlist carries them, so keep the master
      const max = Math.max(0, ...variants.map((v) => v.height));
      const quality = max >= 2160 ? '2160p' : max === 1080 ? '1080p' : max === 720 ? '720p' : 'auto';
      return [{ ...base, url: item.playlist, quality, hls: true }];
    }
    return variants.filter((v) => v.height === 2160 || v.height === 1080).map((v) => ({ ...base, url: v.url, quality: v.height === 2160 ? '2160p' : '1080p', hls: true }));
  }
  if (item.type === 'file' && item.qualities && typeof item.qualities === 'object') {
    return Object.entries(item.qualities)
      .filter(([k, e]) => e && typeof e.url === 'string' && e.url.startsWith('http') && qualityLabel(k) !== 'auto')
      .map(([k, e]) => ({ ...base, url: e.url, quality: qualityLabel(k), hls: false }));
  }
  return [];
}

const weight = (q) => (q === '2160p' ? 2 : q === '1080p' ? 1 : 0);

export async function search(meta, ctx) {
  const q = buildQuery(meta);
  if (!q) return [];
  const perServer = await Promise.all(SERVERS.map((s) => readServer(ctx, q, s, meta).catch(unlessAbort([]))));
  const groups = await Promise.all(perServer.flat().map((it) => resolveItem(ctx, it).catch(unlessAbort([]))));
  const seen = new Set();
  const unique = groups.flat().filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
  // stable: 2160p, then 1080p, then the rest, ties in discovery order (Array.prototype.sort is stable)
  unique.sort((a, b) => weight(b.quality) - weight(a.quality));
  return unique.map((s) => {
    // URLs end in master.m3u8 / playlist.jpg / a hash: name the stream after the title instead (also the download name)
    const label = meta.title ? `${meta.title}${q.isTv ? ` S${pad2(q.season)}E${pad2(q.episode)}` : meta.year ? ` (${meta.year})` : ''}` : undefined;
    const stream = makeStream({ provider: id, providerName: `${name} (${s.server})`, url: s.url, quality: s.quality, filename: label, headers: PLAY_HEADERS, container: s.hls ? 'm3u8' : undefined });
    stream.direct = true;
    if (s.hls) stream.needsNativeHls = true;
    if (s.subtitles.length) stream.subtitles = s.subtitles;
    return stream;
  });
}

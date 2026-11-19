// Subtitle helpers that run in the browser. Network calls go through /api/subs and /api/sub (see lib/subs.js).

export const SUB_LANGS = ['en', 'bn', 'hi', 'ar', 'es', 'fr', 'de', 'id', 'ms', 'ta', 'te', 'ur', 'tr', 'ru', 'pt', 'it', 'ja', 'ko', 'zh'];

export function langName(code) {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return code; }
}

/** Decode subtitle bytes: honour a BOM, prefer strict UTF-8, otherwise Windows-1252 (the usual legacy SRT encoding). */
export function decodeBytes(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); }
}

const pad = (n, w) => String(n).padStart(w, '0');

/** SRT -> WebVTT (also accepts text that is already VTT). Strips ASS positioning tags and <font>. */
export function srtToVtt(input) {
  let text = String(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (/^WEBVTT/.test(text)) return text + '\n';
  text = text
    .replace(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g, (m, hh, mm, ss, ms) => `${pad(hh, 2)}:${mm}:${ss}.${ms.padEnd(3, '0')}`)
    .replace(/\{\\[^}]*\}/g, '') // {\an8} and friends
    .replace(/<\/?font[^>]*>/gi, '')
    .replace(/<(?!\/?(?:b|i|u)>)[^>]*>/gi, ''); // keep only <b> <i> <u>
  return 'WEBVTT\n\n' + text + '\n';
}

/** Basic sanity check so a broken download doesn't silently show nothing. */
export function countCues(vtt) { return (vtt.match(/-->/g) || []).length; }

/**
 * User preferences -> concrete CSS values. `size` is a percentage of a base that scales with the player width,
 * so captions stay readable on a phone and don't get huge on a desktop monitor.
 */
export function subtitleStyle(prefs, playerWidth = 960) {
  const base = playerWidth / 38;
  const fontPx = Math.round(Math.min(72, Math.max(12, base * (prefs.size / 100))));
  const bgs = {
    none: { background: 'transparent', textShadow: 'none' },
    shadow: { background: 'transparent', textShadow: '0 0 4px #000, 0 0 2px #000, 1px 1px 2px #000' },
    box: { background: 'rgba(0,0,0,.72)', textShadow: 'none' },
  };
  return { fontSize: `${fontPx}px`, color: prefs.color, bottomPct: prefs.bottom, ...(bgs[prefs.bg] || bgs.shadow) };
}

export const SUB_COLORS = [['#ffffff', 'White'], ['#ffe066', 'Yellow'], ['#7ee8c8', 'Mint'], ['#8ecbff', 'Sky']];

export async function fetchSubtitleList({ type, tmdbId, imdbId, season, episode, langs, signal }) {
  const q = new URLSearchParams({ type, lang: langs.join(',') });
  if (tmdbId) q.set('tmdb', String(tmdbId));
  if (imdbId) q.set('imdb', imdbId);
  if (type === 'tv') { q.set('season', String(season)); q.set('episode', String(episode)); }
  const res = await fetch(`/api/subs?${q}`, { signal });
  if (!res.ok) throw new Error(`Subtitle search failed (${res.status})`);
  return res.json();
}

/** Downloads one subtitle and returns a blob: URL with WebVTT content, ready for the player. */
export async function loadSubtitleBlob(id, signal) {
  const res = await fetch(`/api/sub?id=${encodeURIComponent(id)}`, { signal });
  if (!res.ok) {
    let msg = `Subtitle download failed (${res.status})`;
    try { const j = await res.json(); if (j.message) msg = j.message; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return vttBlobUrl(decodeBytes(await res.arrayBuffer()));
}

export function vttBlobUrl(text) {
  const vtt = srtToVtt(text);
  if (!countCues(vtt)) throw new Error('This subtitle file has no readable cues.');
  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
}

/** Subtitle that came with a source (e.g. Fendrix captions): fetched straight from its host, which must allow CORS. */
export async function loadSourceSubtitle(url, signal, fetchImpl = (...a) => globalThis.fetch(...a)) {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('Invalid subtitle address.');
  let res;
  try { res = await fetchImpl(url, { signal, referrerPolicy: 'no-referrer', credentials: 'omit' }); } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new Error('The source’s subtitle server does not allow downloads from a website. Try a subtitle search instead.');
  }
  if (!res.ok) throw new Error(`Subtitle download failed (${res.status})`);
  return vttBlobUrl(decodeBytes(await res.arrayBuffer()));
}

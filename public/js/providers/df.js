// DhakaFlix FTP: JSON search API on two private BDIX servers.
// Port of eclipsia-bdix bdix-df.js (GPL-3.0). Differences from the original, all deliberate:
//   * title/year come from TMDB details the app already has (no extra TMDB call)
//   * .mov / .m4v / .webm files are accepted unless opts.compat is true (the original only knew mkv/mp4/avi)
import { makeStream } from './common.js';

export const id = 'bdix-df';
export const name = 'DhakaFlix';
export const SERVERS = [
  { url: 'http://172.16.50.12', root: '/DHAKA-FLIX-12/' },
  { url: 'http://172.16.50.14', root: '/DHAKA-FLIX-14/' },
];
const ORIGINAL_EXT = ['.mkv', '.mp4', '.avi'];
const EXTRA_EXT = ['.mov', '.m4v', '.webm'];

const pad = (v) => (String(v).length < 2 ? '0' + v : String(v));

export function parseQuality(filename) {
  const s = filename.toLowerCase();
  if (s.includes('2160p') || s.includes('4k')) return '2160p';
  if (s.includes('1080p')) return '1080p';
  if (s.includes('720p')) return '720p';
  if (s.includes('480p')) return '480p';
  return 'hd';
}

export function buildSearchVariants(title) {
  const clean = title.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  return [clean.replace(/ /g, '\\ '), clean.replace(/ /g, '.')]; // regex-escaped spaces first, dotted second
}

function toStreams(server, data, meta, opts) {
  if (!data || !Array.isArray(data.search)) return [];
  const exts = opts.compat ? ORIGINAL_EXT : [...ORIGINAL_EXT, ...EXTRA_EXT];
  const out = [];
  for (const item of data.search) {
    const href = item.href;
    const lowerHref = href.toLowerCase();
    const filename = decodeURIComponent(href.split('/').pop());
    const lower = filename.toLowerCase();
    if (!exts.some((e) => lowerHref.endsWith(e))) continue;
    if (meta.type === 'movie') {
      if (lowerHref.includes('tv-web-series') || lowerHref.includes('tv series')) continue;
      if (meta.year && !lower.includes(meta.year)) continue;
    } else {
      if (lowerHref.includes('english movies') || lowerHref.includes('hindi movies') || lowerHref.includes('movies')) continue;
      if (!new RegExp(`s${pad(meta.season)}[. _-]?e${pad(meta.episode)}`, 'i').test(lower)) continue; // not anchored, as in the original
    }
    out.push(makeStream({ provider: id, providerName: name, url: server.url + href, quality: parseQuality(filename), filename }));
  }
  return out;
}

export async function search(meta, ctx, opts = {}) {
  if (!meta.title) return [];
  const variants = buildSearchVariants(meta.title);
  if (!variants[0]) return [];
  const jobs = [];
  // Every variant x server request is sent in parallel; the first variant that yields streams wins.
  for (const pattern of variants) {
    for (const server of SERVERS) {
      jobs.push(ctx.json(server.url + server.root, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get', search: { href: server.root, ignorecase: true, pattern } }),
      }).then((data) => { try { return toStreams(server, data, meta, opts); } catch { return []; } }));
    }
  }
  const batches = await Promise.all(jobs);
  for (let vi = 0; vi < variants.length; vi++) {
    const seen = new Set();
    const streams = [];
    for (let si = 0; si < SERVERS.length; si++) {
      for (const s of batches[vi * SERVERS.length + si]) {
        if (!s.url || seen.has(s.url)) continue;
        seen.add(s.url);
        streams.push(s);
      }
    }
    if (streams.length) return streams;
  }
  return [];
}

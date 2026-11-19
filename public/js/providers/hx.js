// Hexion (4kHdHub): WordPress site whose download buttons lead through link wrappers to HubCloud/HubDrive file pages.
// Port of the eclipsia "hexion.js" scraper (GPL-3.0, see /NOTICE.md). Same search, page matching, link unwrapping
// (base64 + ROT13) and request order. The original ships a tag scanner because Rhino has no DOM; this uses DOMParser
// (inert: scripts never run). Differences:
//   * title, year and IMDb id come from the TMDB details the site already loaded (no extra TMDB call)
//   * none of these hosts send CORS headers, so lookups go through the edge proxy (or the gateway); the browser
//     cannot set the Referer/User-Agent the original sends
//   * DEVIATION (measured Nov 2026): the file pages now link `*.workers.dev` downloads instead of R2/FSL buckets, and
//     show the size as <i id="size">. The original finds nothing on such pages; this port also accepts them.
//     `pixel.<hubcloud>` links are skipped: they redirect to an HTML interstitial, not to a file.
//   * the original's per-resolution/per-host limits and its sort tag are left out: the site ranks every source itself
import { makeStream, containerOf, unlessAbort } from './common.js';

export const id = 'hexion';
export const name = 'Hexion';
export const BASE_URL = 'https://4khdhub.one';
/** Mutable on purpose (tests point it at a mock). */
export const endpoints = { base: BASE_URL };
/** Public HTTPS without CORS: the Pages edge proxy (/api/proxy) fetches the pages when no gateway is set. */
export const edge = true;
export const group = 'public';

const HTML = { headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } };
const PLAY_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

const pad = (n) => (String(n).length < 2 ? '0' + n : String(n));
const clean = (v) => String(v).replace(/\s+/g, ' ').trim();

function parseDoc(html, opts) {
  const Parser = opts.DOMParser || globalThis.DOMParser;
  return new Parser().parseFromString(String(html), 'text/html');
}
const textAll = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent).join('');

/** Strict base64 like the original (throws on bad input), returning a byte string. */
export function decode64(text) {
  let s = String(text).replace(/[\t\n\f\r ]/g, '');
  if (s.length % 4 === 0) s = s.replace(/={1,2}$/, '');
  if (s.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(s)) throw new Error('base64');
  return atob(s + '='.repeat((4 - (s.length % 4)) % 4));
}
export const rot13 = (v) => String(v).replace(/[a-zA-Z]/g, (c) => { const code = c.charCodeAt(0) + 13; return String.fromCharCode(code <= (c <= 'Z' ? 90 : 122) ? code : code - 26); });

function absolute(href, base) {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  try { return new URL(String(href).replace(/&amp;/g, '&'), base || endpoints.base).href; } catch { return ''; }
}
const hostOf = (url) => { try { return new URL(String(url).trim()).hostname.toLowerCase(); } catch { return ''; } };

function normalize(v) {
  return String(v || '').toLowerCase().replace(/\[[^\]]*]/g, ' ').replace(/\b(the|a|an|directors?|cut)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const words = (v) => normalize(v).split(' ').filter(Boolean);
export function titleScore(expected, candidate) {
  const want = words(expected);
  if (!want.length) return 0;
  const have = new Set(words(candidate));
  return want.filter((w) => have.has(w)).length / want.length;
}

export const parseSizeMB = (size) => { const m = /(\d+\.?\d*)\s*(GB|MB)/i.exec(size || ''); return m ? (m[2].toUpperCase() === 'GB' ? parseFloat(m[1]) * 1024 : parseFloat(m[1])) : null; };
/** '2160p' | '1080p' | '720p' | '480p'; no marker means 1080p, as in the original. */
export function qualityOf(text) {
  const m = /(2160|1080|720|480)p|(4K|UHD)/i.exec(text);
  if (!m) return '1080p';
  const v = (m[1] || m[2]).toUpperCase();
  return v === '4K' || v === 'UHD' ? '2160p' : v.toLowerCase() + 'p';
}
const sizeOf = (text) => { const m = /(?:^|[\s>])(\d+\.?\d*)\s*(GB|MB)\b/i.exec(text); return m ? m[1] + ' ' + m[2] : ''; };

export function searchTerm(meta) {
  if (meta.type === 'tv' && meta.season) return meta.title + ' Season ' + meta.season;
  return (meta.title + ' ' + (meta.year || '')).trim();
}

export function bestCard(html, meta, opts = {}) {
  if (!html) return null;
  const isTv = meta.type === 'tv';
  let best = null;
  for (const card of parseDoc(html, opts).querySelectorAll('.movie-card')) {
    const title = textAll(card, '.movie-card-title').trim();
    const format = textAll(card, '.movie-card-format').trim();
    const firstA = [...card.querySelectorAll('a')].find((a) => a.hasAttribute('href'));
    const href = card.getAttribute('href') || (firstA ? firstA.getAttribute('href') : '');
    if (!title || !href) continue;
    if (isTv ? !/series/i.test(format) : !/movies?/i.test(format)) continue;
    const ym = textAll(card, '.movie-card-meta').match(/\b(19|20)\d{2}\b/);
    const cardYear = ym ? Number(ym[0]) : null;
    let score = titleScore(meta.title, title);
    if (meta.year && cardYear === Number(meta.year)) score += 0.35;
    else if (meta.year && cardYear && Math.abs(cardYear - Number(meta.year)) > 1) score -= 0.5;
    if (isTv && meta.season) {
      const sm = title.match(/(?:season\s*|s)(\d+)/i);
      if (sm && Number(sm[1]) === Number(meta.season)) score += 0.4;
      else if (sm) score -= 0.6;
    }
    const url = absolute(href, endpoints.base);
    if (!best || score > best.score) best = { url, score };
  }
  return best && best.score >= 0.5 ? best.url : null;
}

async function findPage(ctx, meta, opts) {
  // Both in parallel, like the original: the WordPress API by IMDb id wins, the HTML search is the fallback.
  const [posts, html] = await Promise.all([
    meta.imdbId ? ctx.json(endpoints.base + '/wp-json/wp/v2/posts?search=' + encodeURIComponent(meta.imdbId)) : null,
    ctx.text(endpoints.base + '/?s=' + encodeURIComponent(searchTerm(meta)), HTML),
  ]);
  if (Array.isArray(posts) && posts.length && posts[0] != null) return posts[0].link || null;
  return bestCard(html, meta, opts);
}

const linksOf = (el) => [...el.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent }));

export function itemsOf(html, meta, opts = {}) {
  const doc = parseDoc(html, opts);
  if (meta.type !== 'tv') return [...doc.querySelectorAll('.download-item')].map((d) => ({ links: linksOf(d), context: d.textContent }));
  const code = 'S' + pad(Number(meta.season));
  const mark = 'Episode-' + pad(Number(meta.episode));
  const items = [];
  for (const section of doc.querySelectorAll('.episode-item')) {
    if (!textAll(section, '.episode-title').includes(code)) continue;
    for (const d of section.querySelectorAll('.episode-download-item')) if (d.textContent.includes(mark)) items.push({ links: linksOf(d), context: d.textContent });
  }
  return items;
}

/** The wrapper page hides the target as base64(rot13(base64(base64(json)))) with the URL itself base64 in `o`. */
export function unwrapPayload(html) {
  try {
    const m = /['"]o['"]\s*,\s*['"]([^'"]+)['"]/.exec(html);
    if (!m) return null;
    const payload = JSON.parse(decode64(rot13(decode64(decode64(m[1])))));
    return payload.o ? decode64(payload.o).trim() : null;
  } catch { return null; }
}

async function unwrap(ctx, url) {
  if (/hubcloud|hubdrive/i.test(url)) return url;
  const html = await ctx.text(url, HTML);
  return (html && unwrapPayload(html)) || url;
}

function cloudOnPage(html, base, opts) {
  if (!html) return '';
  for (const a of parseDoc(html, opts).querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/hubcloud/i.test(a.textContent + ' ' + href)) return href ? absolute(href, base) : '';
  }
  return '';
}

async function probe(ctx, link, pageUrl, opts) {
  const abs = link.href ? absolute(link.href, pageUrl) : '';
  if (!abs) return { stop: false, url: '' };
  if (/hubcloud/i.test(link.text) || /hubcloud/i.test(link.href)) return { stop: true, url: await unwrap(ctx, abs) };
  if (/hubdrive/i.test(link.text) || /hubdrive/i.test(link.href)) {
    const drive = await unwrap(ctx, abs);
    return { stop: false, url: cloudOnPage(await ctx.text(drive, HTML), drive, opts) };
  }
  return { stop: false, url: '' };
}

async function findCloud(ctx, links, pageUrl, opts) {
  const found = await Promise.all(links.map((l) => probe(ctx, l, pageUrl, opts).catch(unlessAbort({ stop: false, url: '' }))));
  const hit = found.find((f) => f.stop || f.url);
  return hit ? hit.url : '';
}

export function redirectOf(html) {
  const m = /var\s+url\s*=\s*['"]([^'"]+)['"]/.exec(html)
    || /id=["']download["'][^>]*href=["']([^'"]+)["']/i.exec(html)
    || /href=["']([^'"]+)["'][^>]*id=["']download["']/i.exec(html);
  return m ? m[1] : '';
}

const FSL_V2 = /\.r2\.cloudflarestorage\.com$|\.r2\.dev$|^cdn\.fsl-buckets\.life$|\.fsl-buckets\.life$/;
const WORKERS = /\.workers\.dev$/; // deviation, see header

/** File page -> direct links. Returns [{url, host, filename, size}]. */
export function collect(html, opts = {}, size = '') {
  const out = [];
  const doc = parseDoc(html, opts);
  let head = clean(textAll(doc, 'div.card-header'));
  if (!head) head = textAll(doc, 'title').trim();
  // the original strips the extension for display; keep it: it is the only format hint for signed R2 URLs
  const filename = head;
  const found = /<td[^>]*>\s*File\s*Size\s*:\s*<\/td>\s*<td[^>]*>\s*([\d.]+\s*[MGBtbi]+)\s*<\/td>/i.exec(html)
    || /Size\s*:\s*<\/strong>\s*([\d.]+\s*[MGBtbi]+)/i.exec(html)
    || /id=["']size["'][^>]*>\s*([\d.]+\s*[MGBtbi]+)\s*</i.exec(html); // deviation: current layout
  if (found) size = found[1].trim();
  const add = (url, host) => { if (!out.some((e) => e.url === url)) out.push({ url, host, filename, size }); };
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('javascript:')) continue;
    const abs = href.replace(/&amp;/g, '&');
    if (/\.zip|\.rar/.test(abs)) continue;
    const host = hostOf(abs);
    if (FSL_V2.test(host)) add(abs, 'FSL-v2');
    else if (WORKERS.test(host)) add(abs, 'FSL');
  }
  const pxl = /var\s+pxl\s*=\s*["']https?:\/\/pixeldrain\.[a-z0-9.-]+\/u\/([A-Za-z0-9_-]+)["']/i.exec(html)
    || /href=["']https?:\/\/pixeldrain\.[a-z0-9.-]+\/u\/([A-Za-z0-9_-]+)["']/i.exec(html);
  if (pxl && pxl[1]) add('https://pixeldrain.com/api/file/' + pxl[1], 'PixelDrain');
  return out;
}

async function hubStreams(ctx, cloudUrl, size, opts) {
  const html = await ctx.text(cloudUrl, HTML);
  if (!html) return [];
  const redirect = redirectOf(html);
  if (!redirect) return collect(html, opts, size);
  const next = absolute(redirect.replace(/&amp;/g, '&'), cloudUrl);
  const page = next ? await ctx.text(next, HTML) : null;
  return page ? collect(page, opts, size) : [];
}

async function resolveItem(ctx, item, pageUrl, opts) {
  const text = clean(item.context);
  const quality = qualityOf(text);
  if (quality === '480p') return [];
  const cloud = await findCloud(ctx, item.links, pageUrl, opts);
  const files = cloud ? await hubStreams(ctx, cloud, sizeOf(text), opts) : [];
  return files.map((f) => ({ ...f, quality }));
}

const resWeight = (q) => (q === '2160p' ? 4 : q === '1080p' ? 3 : q === '720p' ? 2 : 1);

export async function search(meta, ctx, opts = {}) {
  if (!meta.title || !/^\d+$/.test(String(meta.tmdbId ?? '')) || (meta.type !== 'movie' && meta.type !== 'tv')) return [];
  if (meta.type === 'tv' && (meta.season == null || meta.episode == null)) return [];
  const pageUrl = await findPage(ctx, meta, opts);
  if (!pageUrl) return [];
  const html = await ctx.text(pageUrl, HTML);
  if (!html) return [];
  const groups = await Promise.all(itemsOf(html, meta, opts).map((it) => resolveItem(ctx, it, pageUrl, opts).catch(unlessAbort([]))));
  const seen = new Set();
  const entries = groups.flat().map((e, i) => ({ ...e, i, mb: parseSizeMB(e.size) || 0 })).filter((e) => (seen.has(e.url) ? false : (seen.add(e.url), true)));
  entries.sort((a, b) => resWeight(b.quality) - resWeight(a.quality) || b.mb - a.mb || a.i - b.i);
  return entries.map((e) => {
    const url = e.url.replace(/ /g, '%20');
    const filename = e.filename || undefined;
    const container = containerOf(url) === 'unknown' && filename ? containerOf('x:/' + filename) : undefined;
    const stream = makeStream({ provider: id, providerName: `${name} (${e.host})`, url, quality: e.quality, filename, container, headers: { 'User-Agent': PLAY_UA, Referer: endpoints.base + '/' } });
    stream.direct = true; // the file hosts allow any origin and need no Referer (measured); never detour video through a proxy
    if (e.size) stream.sizeLabel = e.size;
    return stream;
  });
}

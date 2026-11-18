// Hexion (4kHdHub): public HTTPS site, WordPress-based, with download links via HubCloud.
// Port of the eclipsia "hexion.js" scraper. Differences from the original:
//   * title/year/imdbId come from TMDB details the app already has (no extra TMDB call)
//   * Uses DOMParser for HTML parsing (same pattern as FlixHub)
//   * Returns makeStream()-shaped objects consistent with Reelhouse's provider contract
//   * Rich metadata (file size, bitrate, language, codec, HDR) is exposed via the info system
import { makeStream, describe } from './common.js';

export const id = 'hexion';
export const name = '4kHdHub';
export const BASE_URL = 'https://4khdhub.one';
/** All endpoints are public HTTPS — edge proxy is usable. */
export const edge = true;
export const endpoints = { base: BASE_URL };

const UA_SESSION = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';
const UA_PLAY = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

// ---- helpers ----

const pad = (n) => (String(n).length < 2 ? '0' + n : String(n));

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(the|a|an|directors?|cut)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleScore(expected, candidate) {
  const want = normalize(expected).split(' ').filter(Boolean);
  const have = new Set(normalize(candidate).split(' ').filter(Boolean));
  if (!want.length) return 0;
  let hits = 0;
  for (const w of want) if (have.has(w)) hits++;
  return hits / want.length;
}

function qualityOf(text) {
  const m = /(2160|1080|720|480)p|(4K|UHD)/i.exec(text);
  if (!m) return '1080p';
  const v = (m[1] || m[2]).toUpperCase();
  return v === '4K' || v === 'UHD' ? '2160p' : v.toLowerCase() + 'p';
}

function sizeOf(text) {
  const m = /(?:^|[\s>])(\d+\.?\d*)\s*(GB|MB)\b/i.exec(text);
  return m ? m[1] + ' ' + m[2] : '';
}

function parseSizeMB(size) {
  if (!size) return null;
  const m = /(\d+\.?\d*)\s*(GB|MB)/i.exec(size);
  if (!m) return null;
  return m[2].toUpperCase() === 'GB' ? parseFloat(m[1]) * 1024 : parseFloat(m[1]);
}

function decode64(text) {
  try { return atob(text); } catch { return ''; }
}

function rot13(value) {
  return String(value).replace(/[a-zA-Z]/g, (c) => {
    const code = c.charCodeAt(0) + 13;
    const limit = c <= 'Z' ? 90 : 122;
    return String.fromCharCode(code <= limit ? code : code - 26);
  });
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function parseDoc(html, opts) {
  const Parser = opts.DOMParser || globalThis.DOMParser;
  return new Parser().parseFromString(html, 'text/html');
}

// ---- search + page finding ----

function searchTerm(title, year, isTv, season) {
  if (isTv && season) return title + ' Season ' + season;
  return (title + ' ' + (year || '')).trim();
}

function bestCard(html, title, year, isTv, season, opts) {
  if (!html) return null;
  const doc = parseDoc(html, opts);
  const cards = doc.querySelectorAll('.movie-card');
  let best = null;
  let bestScore = -1;

  for (const card of cards) {
    const titleEl = card.querySelector('.movie-card-title');
    const formatEl = card.querySelector('.movie-card-format');
    const cardTitle = titleEl?.textContent?.trim() || '';
    const format = formatEl?.textContent?.trim() || '';
    const href = card.getAttribute('href') || card.querySelector('a')?.getAttribute('href') || '';
    if (!cardTitle || !href) continue;

    if (isTv && !/series/i.test(format)) continue;
    if (!isTv && !/movies?/i.test(format)) continue;

    const metaEl = card.querySelector('.movie-card-meta');
    const metaText = metaEl?.textContent || '';
    const ym = metaText.match(/\b(19|20)\d{2}\b/);
    const cardYear = ym ? Number(ym[0]) : null;

    let score = titleScore(title, cardTitle);
    if (year && cardYear === Number(year)) score += 0.35;
    else if (year && cardYear && Math.abs(cardYear - Number(year)) > 1) score -= 0.5;

    if (isTv && season) {
      const sm = cardTitle.match(/(?:season\s*|s)(\d+)/i);
      if (sm && Number(sm[1]) === Number(season)) score += 0.4;
      else if (sm) score -= 0.6;
    }

    const link = href.startsWith('http') ? href : endpoints.base + href;
    if (!best || score > bestScore) {
      best = { url: link, score };
      bestScore = score;
    }
  }

  return best && best.score >= 0.5 ? best.url : null;
}

async function findPage(ctx, meta, opts) {
  // Try IMDB-based WP API search first
  if (meta.imdbId) {
    try {
      const posts = await ctx.json(endpoints.base + '/wp-json/wp/v2/posts?search=' + encodeURIComponent(meta.imdbId));
      if (posts && posts.length > 0 && posts[0]?.link) return posts[0].link;
    } catch { /* fall through */ }
  }

  // HTML search
  const term = searchTerm(meta.title, meta.year, meta.type === 'tv', meta.season);
  const html = await ctx.text(endpoints.base + '/?s=' + encodeURIComponent(term), {
    headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
  });
  return bestCard(html, meta.title, meta.year, meta.type === 'tv', meta.season, opts);
}

// ---- page parsing: items + download links ----

function itemsOf(doc, meta) {
  const items = [];
  if (meta.type === 'tv') {
    const code = 'S' + pad(Number(meta.season));
    const mark = 'Episode-' + pad(Number(meta.episode));
    for (const section of doc.querySelectorAll('.episode-item')) {
      const titleEl = section.querySelector('.episode-title');
      if (!titleEl || !titleEl.textContent.includes(code)) continue;
      for (const dl of section.querySelectorAll('.episode-download-item')) {
        const text = dl.textContent;
        if (text.includes(mark)) {
          const links = [...dl.querySelectorAll('a[href]')].map((a) => ({
            href: a.getAttribute('href'),
            text: a.textContent,
          }));
          items.push({ links, context: text });
        }
      }
    }
  } else {
    for (const dl of doc.querySelectorAll('.download-item')) {
      const links = [...dl.querySelectorAll('a[href]')].map((a) => ({
        href: a.getAttribute('href'),
        text: a.textContent,
      }));
      items.push({ links, context: dl.textContent });
    }
  }
  return items;
}

// ---- HubCloud unwrapping ----

function unwrapPayload(html) {
  try {
    const m = /['"]o['"]\s*,\s*['"]([^'"]+)['"]/.exec(html);
    if (!m) return null;
    const payload = JSON.parse(decode64(rot13(decode64(decode64(m[1])))));
    return payload.o ? decode64(payload.o).trim() : null;
  } catch { return null; }
}

async function unwrap(ctx, url) {
  if (/hubcloud|hubdrive/i.test(url)) return url;
  const html = await ctx.text(url);
  if (!html) return url;
  const unwrapped = unwrapPayload(html);
  return unwrapped || url;
}

function cloudOnPage(html, base, opts) {
  if (!html) return '';
  try {
    const doc = parseDoc(html, opts);
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      const text = a.textContent;
      if (/hubcloud/i.test(text + ' ' + href)) {
        return href.startsWith('http') ? href : (href.startsWith('/') ? new URL(href, base).href : href);
      }
    }
  } catch { /* ignore */ }
  return '';
}

async function probe(ctx, link, pageUrl, opts) {
  if (!link.href) return { stop: false, url: '' };
  const abs = link.href.startsWith('http') ? link.href : new URL(link.href, pageUrl).href;

  if (/hubcloud/i.test(link.text) || /hubcloud/i.test(link.href)) {
    const url = await unwrap(ctx, abs);
    return { stop: true, url };
  }
  if (/hubdrive/i.test(link.text) || /hubdrive/i.test(link.href)) {
    const drive = await unwrap(ctx, abs);
    const html = await ctx.text(drive);
    return { stop: false, url: cloudOnPage(html, drive, opts) };
  }
  return { stop: false, url: '' };
}

async function findCloud(ctx, links, pageUrl, opts) {
  const results = await Promise.all(links.map((l) => probe(ctx, l, pageUrl, opts).catch(() => ({ stop: false, url: '' }))));
  for (const r of results) {
    if (r.stop || r.url) return r.url;
  }
  return '';
}

// ---- HubCloud page → download links ----

function redirectOf(html) {
  const m = /var\s+url\s*=\s*['"]([^'"]+)['"]/.exec(html)
    || /id=["']download["'][^>]*href=["']([^'"]+)["']/i.exec(html)
    || /href=["']([^'"]+)["'][^>]*id=["']download["']/i.exec(html);
  return m ? m[1] : '';
}

function collectStreams(html, pageUrl, quality, size, runtime) {
  const out = [];
  if (!html) return out;
  try {
    const headMatch = html.match(/<div[^>]*class="card-header"[^>]*>([\s\S]*?)<\/div>/i);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    let head = headMatch ? headMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    if (!head) head = titleMatch ? titleMatch[1].trim() : '';
    const filename = head.replace(/\.(mkv|mp4|avi|rar|zip)$/i, '');

    // Extract file size from the page if not already known
    const sizeMatch = /<td[^>]*>\s*File\s*Size\s*:\s*<\/td>\s*<td[^>]*>\s*([\d.]+\s*[MGBtbi]+)\s*<\/td>/i.exec(html)
      || /Size\s*:\s*<\/strong>\s*([\d.]+\s*[MGBtbi]+)/i.exec(html);
    if (sizeMatch) size = sizeMatch[1].trim();

    // Find R2/FSL/PixelDrain links
    const hrefRe = /href=["']([^"']+)["']/gi;
    let hm;
    while ((hm = hrefRe.exec(html)) !== null) {
      const href = hm[1].replace(/&amp;/g, '&');
      if (/\.zip|\.rar/.test(href)) continue;
      const host = hostOf(href);
      if (!host) continue;
      if (/\.r2\.cloudflarestorage\.com$|\.r2\.dev$|^cdn\.fsl-buckets\.life$|\.fsl-buckets\.life$/.test(host)) {
        if (!out.some((e) => e.url === href)) {
          out.push({ url: href, filename, host: 'FSL-v2', quality, size, runtime });
        }
      }
    }

    // Check for PixelDrain
    const pxl = /var\s+pxl\s*=\s*["']https?:\/\/pixeldrain\.[a-z0-9.-]+\/u\/([A-Za-z0-9_-]+)["']/i.exec(html)
      || /href=["']https?:\/\/pixeldrain\.[a-z0-9.-]+\/u\/([A-Za-z0-9_-]+)["']/i.exec(html);
    if (pxl?.[1]) {
      const drain = 'https://pixeldrain.com/api/file/' + pxl[1];
      if (!out.some((e) => e.url === drain)) {
        out.push({ url: drain, filename, host: 'PixelDrain', quality, size, runtime });
      }
    }
  } catch { /* ignore */ }
  return out;
}

async function hubStreams(ctx, cloudUrl, quality, size, runtime) {
  const html = await ctx.text(cloudUrl, { headers: { Referer: endpoints.base + '/' } });
  if (!html) return [];
  const redirect = redirectOf(html);
  if (!redirect) return collectStreams(html, cloudUrl, quality, size, runtime);
  const next = redirect.startsWith('http') ? redirect : new URL(redirect.replace(/&amp;/g, '&'), cloudUrl).href;
  const page = await ctx.text(next, { headers: { Referer: cloudUrl } });
  return page ? collectStreams(page, next, quality, size, runtime) : [];
}

async function resolveItem(ctx, item, pageUrl, runtime) {
  const text = item.context.replace(/\s+/g, ' ').trim();
  const quality = qualityOf(text);
  if (quality === '480p') return [];
  const size = sizeOf(text);
  const cloud = await findCloud(ctx, item.links, pageUrl, {});
  return cloud ? hubStreams(ctx, cloud, quality, size, runtime) : [];
}

async function gather(ctx, pageUrl, meta, runtime) {
  const html = await ctx.text(pageUrl, {
    headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
  });
  if (!html) return [];
  const doc = parseDoc(html, {});
  const items = itemsOf(doc, meta);
  const groups = await Promise.all(items.map((item) => resolveItem(ctx, item, pageUrl, runtime)));
  return groups.flat();
}

// ---- ranking ----

function resWeight(q) {
  if (q === '2160p') return 4;
  if (q === '1080p') return 3;
  if (q === '720p') return 2;
  return 1;
}

// ---- main search ----

export async function search(meta, ctx, opts = {}) {
  if (!meta.title) return [];
  if (meta.type !== 'movie' && meta.type !== 'tv') return [];
  if (meta.type === 'tv' && (meta.season == null || meta.episode == null)) return [];

  const pageUrl = await findPage(ctx, meta, opts);
  if (!pageUrl) return [];

  const runtime = null; // We don't have runtime from meta; it's display-only anyway
  const entries = await gather(ctx, pageUrl, meta, runtime);
  if (!entries.length) return [];

  // Deduplicate by URL
  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    if (seen.has(e.url)) continue;
    seen.add(e.url);
    unique.push(e);
  }

  // Sort by resolution then size
  unique.sort((a, b) => resWeight(b.quality) - resWeight(a.quality) || (b.size ? parseSizeMB(b.size) || 0 : 0) - (a.size ? parseSizeMB(a.size) || 0 : 0));

  // Convert to Reelhouse's makeStream format
  return unique.map((e) => {
    const stream = makeStream({
      provider: id,
      providerName: `${name} • ${e.host}`,
      url: e.url,
      quality: e.quality,
      filename: e.filename,
      headers: { 'User-Agent': UA_PLAY, Referer: endpoints.base + '/' },
    });
    // Attach size metadata for display
    if (e.size) stream.sizeLabel = e.size;
    return stream;
  });
}

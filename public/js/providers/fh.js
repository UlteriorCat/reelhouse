// FlixHub: HTML watch pages. Port of eclipsia-bdix bdix-fh.js (GPL-3.0).
// The original ships a hand-written tag scanner because Rhino has no DOM; browsers do, so this uses DOMParser
// (inert: scripts never run, resources never load) while keeping the same extraction order and fallbacks.
import { makeStream } from './common.js';

export const id = 'bdix-fh';
export const name = 'FlixHub';
/** 'bdix' = reachable only from a BDIX network; 'public' = on the open internet. Used to explain failures. */
// BDIX (original: "FlixHub FTP: BDIX"); Cloudflare cannot reach it, so no edge proxy (IMPLEMENTATION section 6)
export const group = 'bdix';
export const BASE_URL = 'https://flixhub.net';
/** Mutable on purpose (see cf.js). */
export const endpoints = { base: BASE_URL };

export const toSlug = (title) => title.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function qualityOf(url) {
  const s = String(url || '').toLowerCase();
  if (s.includes('4k') || s.includes('2160')) return '2160p';
  if (s.includes('1440')) return '1440p';
  if (s.includes('1080')) return '1080p';
  if (s.includes('720')) return '720p';
  if (s.includes('480')) return '480p';
  if (s.includes('360')) return '360p';
  return 'auto';
}

const absolute = (href) => (href.startsWith('http') ? href : endpoints.base + href);
const episodeSlug = (href) => { const p = href.split('/episode/'); return p.length < 2 ? '' : p[1].split('?')[0].split('#')[0]; };

function parseDoc(html, opts) {
  const Parser = opts.DOMParser || globalThis.DOMParser;
  return new Parser().parseFromString(html, 'text/html');
}

export function extractStreamUrls(html, opts = {}) {
  const doc = parseDoc(html, opts);
  const seen = new Set();
  const out = [];
  const collect = (raw) => {
    const url = (raw || '').trim();
    if (url && url.startsWith('http') && !seen.has(url)) { seen.add(url); out.push(url); }
  };
  const player = doc.getElementById('theaterPlayer');
  if (player) collect(player.getAttribute('data-stream-url'));
  const dl = doc.querySelector('[data-download-url]');
  if (dl) collect(dl.getAttribute('data-download-url'));
  for (const s of doc.querySelectorAll('source[src]')) collect(s.getAttribute('src'));
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href.includes('/stream/')) collect(href.startsWith('http') ? href : endpoints.base + href);
  }
  const re = /https?:\/\/[^\s"'<>\\]+\.(?:mp4|mkv|m3u8|webm|m4v)(?:\?[^\s"'<>\\]*)?/gi;
  let m;
  while ((m = re.exec(html)) !== null) collect(m[0]);
  return out;
}

const isEpisodeLink = (a) => a.classList.contains('player-sidebar-card-link') || (a.getAttribute('href') || '').includes('/watch/episode/');

function cardEpisodes(doc) {
  const episodes = [];
  const visited = new Set();
  for (const card of doc.querySelectorAll('article.player-sidebar-card[data-season-number]')) {
    const season = parseInt(card.getAttribute('data-season-number'), 10);
    if (!season) continue;
    const anchor = [...card.querySelectorAll('a')].find(isEpisodeLink);
    const href = anchor ? anchor.getAttribute('href') || '' : '';
    if (!href) continue;
    const slug = episodeSlug(href);
    if (!slug || visited.has(slug)) continue;
    visited.add(slug);
    const titleText = [...card.querySelectorAll('.player-sidebar-card-title')].map((t) => t.textContent).join('').trim();
    const match = titleText.match(/^E(\d+)/i) || titleText.match(/(\d+)/);
    const count = episodes.filter((e) => e.season === season).length;
    episodes.push({ season, episode: match ? parseInt(match[1], 10) : count + 1, watchUrl: absolute(href) });
  }
  return episodes;
}

function linkEpisodes(doc) {
  const episodes = [];
  const visited = new Set();
  let index = 0;
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href.includes('/watch/episode/')) continue;
    const position = index++;
    const slug = episodeSlug(href);
    if (!slug || visited.has(slug)) continue;
    visited.add(slug);
    const match = a.textContent.match(/(\d+)/);
    episodes.push({ season: 1, episode: match ? parseInt(match[1], 10) : position + 1, watchUrl: absolute(href) });
  }
  return episodes;
}

export function parseEpisodeList(html, opts = {}) {
  const doc = parseDoc(html, opts);
  const cards = cardEpisodes(doc);
  return cards.length ? cards : linkEpisodes(doc);
}

function entries(urls) {
  const seen = new Set();
  const out = [];
  for (const url of urls) {
    if (out.length >= 2) break;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(makeStream({ provider: id, providerName: name, url, quality: qualityOf(url) }));
  }
  return out;
}

export async function search(meta, ctx, opts = {}) {
  const slug = meta.title ? toSlug(meta.title) : '';
  if (!slug) return [];
  const segment = meta.type === 'tv' ? 'series' : 'movie';
  const urls = [`${endpoints.base}/watch/${segment}/${slug}`, `${endpoints.base}/watch/${segment}/${slug}-1`];
  const pages = await Promise.all(urls.map((u) => ctx.text(u, { headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } })));
  const html = pages.find((p) => p && p.includes('theaterPlayer'));
  if (!html) return [];
  if (meta.type === 'movie') return entries(extractStreamUrls(html, opts));
  const target = parseEpisodeList(html, opts).find((e) => e.season === Number(meta.season) && e.episode === Number(meta.episode));
  if (!target) return [];
  const episodeHtml = await ctx.text(target.watchUrl, { headers: { Accept: 'text/html,*/*;q=0.8' } });
  return episodeHtml ? entries(extractStreamUrls(episodeHtml, opts)) : [];
}

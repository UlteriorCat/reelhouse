// Circle FTP: REST/JSON API. Playable URLs come straight from API data (the provider never constructs them).
// Port of eclipsia-bdix bdix-cf.js (GPL-3.0); title/year come from the app's TMDB details.
import { makeStream, QUALITY_RANK } from './common.js';

export const id = 'bdix-cf';
export const name = 'Circle FTP';
export const BASE_URL_P = 'http://new.circleftp.net:5000';
export const FALLBACK_URL = 'http://15.1.1.50:5000';
/** Mutable on purpose: tests and advanced users can repoint the servers if they move. */
export const endpoints = { primary: BASE_URL_P, fallback: FALLBACK_URL };

const normalize = (title) => String(title || '')
  .replace(/\b(1080p|720p|480p|2160p|4k|web[- ]?dl|webrip|bluray|hdrip|x264|x265|hevc|10bit|dual[- ]?audio|hindi[- ]?dubbed|dubbed|esub)\b/gi, ' ')
  .replace(/\[[^\]]*\]/g, ' ')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const parseYear = (text) => {
  for (const f of String(text || '').match(/(?:19|20)\d{2}/g) || []) {
    const n = parseInt(f, 10);
    if (n >= 1900 && n <= 2035) return n;
  }
  return null;
};

export function qualityOf(url, title) {
  const m = [url, title].filter(Boolean).join(' ').match(/(2160p|1440p|1080p|720p|576p|540p|480p|360p|4k|uhd)/i);
  if (!m) return 'Unknown';
  const v = m[1].toLowerCase();
  return v === '4k' || v === 'uhd' ? '2160p' : v;
}
const rankOf = (q) => (QUALITY_RANK[q] === undefined ? -1 : QUALITY_RANK[q]);
const titleCase = (text) => text.split(/\s+/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');

function extractMeta(nameText, title) {
  let cleaned = String(nameText || '').trim();
  if (!cleaned || cleaned.toLowerCase() === 'null') {
    cleaned = String(title || '').replace(/\.[a-zA-Z0-9]{2,4}$/, '').replace(/[._-]/g, ' ').replace(/\b(19|20)\d{2}\b/g, '').trim();
  }
  return titleCase(cleaned);
}

function isAnime(categories, title) {
  if (/\banime\b|\bdubbed anime\b|\bova\b|\bona\b/i.test(title || '')) return true;
  if (!Array.isArray(categories)) return false;
  return categories.some((c) => String((c && (c.name || c.title)) || c || '').toLowerCase().includes('anime'));
}

function groupPosts(posts) {
  const groups = new Map();
  for (const post of posts) {
    const cleaned = extractMeta(post.name, post.title);
    const anime = isAnime(post.categories, post.title);
    const year = parseYear(post.title) || parseYear(post.name);
    const key = normalize(cleaned) + (!anime && year ? '|' + year : '');
    if (!groups.has(key)) groups.set(key, { cleanedTitle: cleaned, year, posts: [] });
    groups.get(key).posts.push({ id: post.id, type: post.type });
  }
  return [...groups.values()];
}

function scoreGroup(group, targetNorm, targetYear, type) {
  const itemNorm = normalize(group.cleanedTitle);
  let score = -1;
  if (itemNorm === targetNorm) {
    score = 100;
    if (targetYear && group.year === targetYear) score += 50;
  } else if (targetNorm.length >= 4 && itemNorm.includes(targetNorm)) {
    score = 60;
    if (targetYear && group.year === targetYear) score += 30;
  } else if (itemNorm.length >= 4 && targetNorm.includes(itemNorm)) {
    score = 40;
  }
  const mainType = group.posts[0] && group.posts[0].type;
  if (type === 'movie' && mainType === 'singleVideo') score += 10;
  if (type === 'tv' && mainType === 'series') score += 10;
  return score;
}

function matchGroup(info, posts, type) {
  if (!posts.length) return null;
  const target = normalize(info.title);
  let best = null;
  let bestScore = -1;
  for (const g of groupPosts(posts)) {
    const score = scoreGroup(g, target, info.year, type);
    if (score > bestScore) { bestScore = score; best = g; }
  }
  return bestScore >= 30 ? best : null;
}

const movieLinks = (details) => details.flatMap(({ obj }) => (obj && typeof obj.content === 'string' && obj.content.trim() ? [{ url: obj.content.trim(), title: obj.title || '' }] : []));

function episodeLinks(details, seasonNumber, episodeNumber) {
  const links = [];
  for (const { obj } of details) {
    if (!obj || !Array.isArray(obj.content)) continue;
    const byIndex = obj.content[seasonNumber - 1];
    if (byIndex && Array.isArray(byIndex.episodes)) {
      const direct = byIndex.episodes[episodeNumber - 1];
      const directUrl = String((direct && (direct.link || direct.url)) || '');
      if (directUrl) { links.push({ url: directUrl, title: (direct && direct.title) || obj.title || '' }); continue; }
    }
    obj.content.forEach((s, si) => {
      if (!s) return;
      const sNum = parseInt((String(s.seasonName || s.name || '').match(/\d+/) || [])[0], 10) || si + 1;
      if (sNum !== seasonNumber) return;
      (s.episodes || []).forEach((ep, ei) => {
        if (!ep) return;
        const eNum = parseInt(String(ep.episode || ep.number || ep.ep || ''), 10) || ei + 1;
        if (eNum !== episodeNumber) return;
        const url = String(ep.link || ep.url || '');
        if (url) links.push({ url, title: ep.title || obj.title || '' });
      });
    });
  }
  return links;
}

export async function search(meta, ctx) {
  if (!meta.title) return [];
  const info = { title: meta.title, year: meta.year ? parseInt(meta.year, 10) : null };

  /** Primary host first; the fallback IP is tried only when the primary request FAILED (network error or non-2xx). */
  const circleGet = async (path) => {
    for (const base of [endpoints.primary, endpoints.fallback]) {
      const text = await ctx.text(base + path, { headers: { Accept: 'application/json, text/plain, */*' } });
      if (text !== null) return text;
    }
    return null;
  };
  const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

  const searchText = await circleGet('/api/posts?searchTerm=' + encodeURIComponent(meta.title) + '&order=desc');
  const obj = searchText ? parse(searchText) : null;
  const raw = obj ? (Array.isArray(obj) ? obj : obj.posts || obj.data || []) : [];
  const posts = (Array.isArray(raw) ? raw : [])
    .filter((p) => p && (p.type === 'singleVideo' || p.type === 'series'))
    .map((p) => ({ id: p.id, type: p.type, title: p.title || '', name: p.name || '', categories: p.categories || [] }));

  const group = matchGroup(info, posts, meta.type);
  if (!group) return [];
  const details = (await Promise.all(group.posts.map(async (p) => {
    const text = await circleGet('/api/posts/' + p.id);
    const o = text ? parse(text) : null;
    return o ? { obj: o.post || o.data || o } : null;
  }))).filter(Boolean);
  if (!details.length) return [];

  const links = meta.type === 'tv' ? episodeLinks(details, Number(meta.season), Number(meta.episode)) : movieLinks(details);
  const seen = new Set();
  const items = [];
  for (const l of links) {
    if (!l.url || seen.has(l.url)) continue;
    seen.add(l.url);
    items.push({ index: items.length, stream: makeStream({ provider: id, providerName: name, url: l.url, quality: qualityOf(l.url, l.title) }) });
  }
  items.sort((a, b) => rankOf(b.stream.quality) - rankOf(a.stream.quality) || a.index - b.index);
  return items.map((i) => i.stream);
}

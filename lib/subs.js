// Subtitle discovery + download. Secrets (API key, account login) stay server-side.
//   1. OpenSubtitles.com REST API v1 (needs OPENSUBTITLES_API_KEY; optional username/password raises the download quota)
//   2. Fallback: the keyless Stremio "OpenSubtitles v3" addon (needs an IMDb id)
import { HttpError } from './tmdb.js';

export const OS_BASE = 'https://api.opensubtitles.com/api/v1';
export const STREMIO_BASE = 'https://opensubtitles-v3.strem.io';
/** OpenSubtitles wants the User-Agent to name your registered app: set APP_NAME to match your OpenSubtitles consumer. */
const userAgent = (env) => `${(env && env.APP_NAME) || 'RafTV'} v1.0`;
const MAX_SUB_BYTES = 2_000_000;
const ALLOWED_DL_HOSTS = /(^|\.)(strem\.io|opensubtitles\.org|opensubtitles\.com)$/i;

const ISO3 = {
  eng: 'en', ben: 'bn', hin: 'hi', ara: 'ar', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', por: 'pt', pob: 'pt',
  rus: 'ru', tur: 'tr', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', zht: 'zh', ind: 'id', may: 'ms', msa: 'ms', urd: 'ur', tam: 'ta',
  tel: 'te', tha: 'th', vie: 'vi', dut: 'nl', nld: 'nl', pol: 'pl', swe: 'sv', per: 'fa', fas: 'fa', heb: 'he', ell: 'el', gre: 'el',
  ukr: 'uk', ron: 'ro', rum: 'ro', hun: 'hu', ces: 'cs', cze: 'cs', dan: 'da', fin: 'fi', nor: 'no',
};
export const toIso2 = (c) => (c && c.length === 3 ? ISO3[c.toLowerCase()] || c.toLowerCase() : (c || '').toLowerCase());

export function normalizeLangs(input) {
  const list = String(input || 'en').toLowerCase().split(',').map((s) => s.trim()).filter((s) => /^[a-z]{2,3}$/.test(s));
  return [...new Set(list)].slice(0, 5).join(',') || 'en';
}

const b64urlEncode = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export async function searchSubtitles(p, env = {}, fetchImpl = fetch) {
  const langs = normalizeLangs(p.lang);
  const out = [];
  const used = { opensubtitles: false, stremio: false };

  if (env.OPENSUBTITLES_API_KEY && p.tmdbId) {
    try {
      const q = {};
      if (p.type === 'tv') {
        q.parent_tmdb_id = p.tmdbId;
        q.season_number = p.season;
        q.episode_number = p.episode;
      } else q.tmdb_id = p.tmdbId;
      q.languages = langs;
      q.order_by = 'download_count';
      q.order_direction = 'desc';
      // OpenSubtitles expects lowercase, alphabetically sorted query parameters.
      const qs = Object.keys(q).sort().map((k) => `${k}=${encodeURIComponent(String(q[k]).toLowerCase())}`).join('&');
      const res = await fetchImpl(`${OS_BASE}/subtitles?${qs}`, {
        headers: { 'Api-Key': env.OPENSUBTITLES_API_KEY, 'User-Agent': userAgent(env), Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        used.opensubtitles = true;
        const data = await res.json();
        for (const it of data.data || []) {
          const a = it.attributes || {};
          const file = (a.files || [])[0];
          if (!file || !file.file_id) continue;
          out.push({
            id: 'os:' + file.file_id, provider: 'opensubtitles', lang: toIso2(a.language), name: a.release || file.file_name || 'Subtitle',
            downloads: a.download_count || 0, hi: !!a.hearing_impaired,
          });
        }
      }
    } catch { /* fall through to the keyless source */ }
  }

  if (!out.length && p.imdbId && /^tt\d{5,10}$/.test(p.imdbId)) {
    try {
      const id = p.type === 'tv' ? `${p.imdbId}:${p.season}:${p.episode}` : p.imdbId;
      const res = await fetchImpl(`${STREMIO_BASE}/subtitles/${p.type === 'tv' ? 'series' : 'movie'}/${id}.json`, {
        headers: { Accept: 'application/json', 'User-Agent': userAgent(env) }, signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        used.stremio = true;
        const want = new Set(langs.split(','));
        const perLang = {};
        for (const s of (await res.json()).subtitles || []) {
          const lang = toIso2(s.lang);
          let host;
          try { host = new URL(s.url).hostname; } catch { continue; }
          if (!want.has(lang) || !ALLOWED_DL_HOSTS.test(host)) continue;
          perLang[lang] = (perLang[lang] || 0) + 1;
          if (perLang[lang] > 6) continue;
          out.push({ id: 'sv:' + b64urlEncode(s.url), provider: 'stremio-os', lang, name: `OpenSubtitles #${perLang[lang]}`, downloads: 0, hi: false });
        }
      }
    } catch { /* no subtitles available */ }
  }
  return { items: out.slice(0, 40), used };
}

let tokenCache = { token: null, exp: 0 };
async function osToken(env, fetchImpl) {
  if (!env.OPENSUBTITLES_USERNAME || !env.OPENSUBTITLES_PASSWORD) return null;
  if (tokenCache.token && tokenCache.exp > Date.now()) return tokenCache.token;
  const res = await fetchImpl(`${OS_BASE}/login`, {
    method: 'POST',
    headers: { 'Api-Key': env.OPENSUBTITLES_API_KEY, 'User-Agent': userAgent(env), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: env.OPENSUBTITLES_USERNAME, password: env.OPENSUBTITLES_PASSWORD }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const j = await res.json();
  tokenCache = { token: j.token || null, exp: Date.now() + 20 * 3600 * 1000 };
  return tokenCache.token;
}

async function readCapped(res) {
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_SUB_BYTES) throw new HttpError(413, 'subtitle_too_large', 'Subtitle file is too large.');
  if (buf[0] === 0x1f && buf[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
    const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
    return new Uint8Array(await ds.arrayBuffer());
  }
  return buf;
}

/** Returns the raw subtitle bytes (encoding is detected client-side). */
export async function fetchSubtitle(id, env = {}, fetchImpl = fetch) {
  let url;
  if (/^os:\d{1,12}$/.test(id)) {
    if (!env.OPENSUBTITLES_API_KEY) throw new HttpError(501, 'opensubtitles_not_configured', 'OpenSubtitles is not configured.');
    const token = await osToken(env, fetchImpl);
    const headers = { 'Api-Key': env.OPENSUBTITLES_API_KEY, 'User-Agent': userAgent(env), 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const dl = await fetchImpl(`${OS_BASE}/download`, {
      method: 'POST', headers, body: JSON.stringify({ file_id: Number(id.slice(3)), sub_format: 'srt' }), signal: AbortSignal.timeout(10000),
    });
    if (dl.status === 406 || dl.status === 429) throw new HttpError(429, 'download_quota', 'OpenSubtitles download quota reached.');
    if (!dl.ok) throw new HttpError(502, 'opensubtitles_error', `OpenSubtitles returned ${dl.status}.`);
    url = (await dl.json()).link;
  } else if (/^sv:[A-Za-z0-9_-]{8,2000}$/.test(id)) {
    try { url = b64urlDecode(id.slice(3)); } catch { throw new HttpError(400, 'bad_id', 'Invalid subtitle id.'); }
  } else throw new HttpError(400, 'bad_id', 'Invalid subtitle id.');

  let u;
  try { u = new URL(url); } catch { throw new HttpError(502, 'bad_link', 'Subtitle link was invalid.'); }
  if (u.protocol !== 'https:' || !ALLOWED_DL_HOSTS.test(u.hostname)) throw new HttpError(403, 'host_not_allowed', 'Subtitle host is not allowed.');
  const res = await fetchImpl(u.toString(), { headers: { 'User-Agent': userAgent(env) }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new HttpError(502, 'subtitle_fetch_failed', `Subtitle host returned ${res.status}.`);
  return readCapped(res);
}

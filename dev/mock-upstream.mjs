// A fake internet for local development and the E2E suite: TMDB, the Stremio OpenSubtitles addon, subtitle files and FlixHub.
// Inject it as the `fetch` of the dev server:  createDevServer({ fetchImpl: createMockFetch({ mediaBase }) })

const TITLES = [
  'Harbor Lights', 'The Salt Road', 'Midnight Orchard', 'Paper Cities', 'Glass Meridian', 'Ember and Ash', 'The Long Quiet', 'Northern Static',
  'Saffron Hours', 'Lantern District', 'Tidewater', 'The Cartographer\u2019s Daughter', 'Velvet Horizon', 'Quarry Lake', 'Silent Harvest', 'A Thousand Windows',
  'Copper Sky', 'The Last Ferry', 'Distant Relatives of Rain', 'Marrow', 'Blue Hour Radio', 'Underneath the Orchard Lights and Everything After', 'Kestrel', 'Winter Kitchen',
];
const OVERVIEW = 'A quiet harbor town is thrown into turmoil when an old lighthouse keeper disappears, and a young cartographer must decide what she is willing to risk to find the truth behind the lights.';

const movie = (i) => ({ id: i, title: TITLES[i % TITLES.length], poster_path: i % 13 === 0 ? null : `/p${i}.jpg`, backdrop_path: `/b${i}.jpg`, vote_average: 5 + ((i * 7) % 45) / 10, overview: OVERVIEW, release_date: `${1995 + (i % 30)}-0${1 + (i % 9)}-15`, media_type: 'movie' });
const show = (i) => ({ id: i, name: TITLES[(i + 5) % TITLES.length], poster_path: `/p${i + 100}.jpg`, backdrop_path: `/b${i + 100}.jpg`, vote_average: 5 + ((i * 3) % 45) / 10, overview: OVERVIEW, first_air_date: `${2000 + (i % 25)}-0${1 + (i % 9)}-20`, media_type: 'tv' });
const MATRIX = { ...movie(1), id: 603, title: 'The Matrix', release_date: '1999-03-31', poster_path: '/pmatrix.jpg', backdrop_path: '/bmatrix.jpg', vote_average: 8.2 };
const BB = { ...show(1), id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', poster_path: '/pbb.jpg', backdrop_path: '/bbb.jpg', vote_average: 8.9 };
const movies = [MATRIX, ...Array.from({ length: 19 }, (_, i) => movie(i + 2))];
const shows = [BB, ...Array.from({ length: 19 }, (_, i) => show(i + 2))];
const byId = (type, id) => (type === 'movie' ? movies : shows).find((x) => x.id === Number(id));

export const SRT_EN = Buffer.from('1\r\n00:00:00,500 --> 00:00:30,000\r\nHello from the test subtitle.\r\nCaf\xe9 au lait\r\n\r\n2\r\n00:00:31,000 --> 00:00:35,000\r\nSecond cue\r\n', 'latin1');
export const SRT_BN = Buffer.from('1\n00:00:00,500 --> 00:00:30,000\n\u09b8\u09cd\u09ac\u09be\u0997\u09a4\u09ae \u09aa\u09b0\u09c0\u0995\u09cd\u09b7\u09be\n', 'utf8');

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export function createMockFetch({ mediaBase = 'http://127.0.0.1:1', log = [] } = {}) {
  return async (input) => {
    const url = new URL(String(input));
    log.push(url.hostname + url.pathname);
    const p = url.pathname;
    if (url.hostname === 'api.themoviedb.org') {
      const t = p.replace(/^\/3/, '');
      if (t === '/trending/all/day') return json({ results: [...movies.slice(0, 6), ...shows.slice(0, 6)].sort((a, b) => a.id - b.id).map((x, i) => (i === 0 ? { ...x, media_type: x.media_type } : x)).concat([{ id: 9, media_type: 'person', name: 'X', profile_path: '/x' }]) });
      if (t === '/movie/popular' || t === '/movie/top_rated') return json({ results: movies.slice(t.endsWith('popular') ? 0 : 4, 20) });
      if (t === '/tv/popular' || t === '/tv/top_rated') return json({ results: shows.slice(t.endsWith('popular') ? 0 : 3, 20) });
      if (t === '/search/multi') {
        const q = (url.searchParams.get('query') || '').toLowerCase();
        return json({ page: 1, total_pages: 1, results: [...movies, ...shows].filter((x) => (x.title || x.name).toLowerCase().includes(q)) });
      }
      let m = /^\/(movie|tv)\/(\d+)\/recommendations$/.exec(t);
      if (m) return json({ results: (m[1] === 'movie' ? movies : shows).filter((x) => x.id !== Number(m[2])).slice(0, 12) });
      m = /^\/tv\/(\d+)\/season\/(\d+)$/.exec(t);
      if (m) {
        const n = Number(m[2]); const count = n === 1 ? 7 : 13;
        return json({ season_number: n, name: `Season ${n}`, overview: '', episodes: Array.from({ length: count }, (_, i) => ({ episode_number: i + 1, name: ['Pilot', 'Cat\u2019s in the Bag', 'And the Bag\u2019s in the River', 'Cancer Man', 'Gray Matter', 'Crazy Handful of Nothin\u2019', 'A No-Rough-Stuff-Type Deal', 'Seven Thirty-Seven', 'Grilled', 'Bit by a Dead Bee', 'Down', 'Breakage', 'Peekaboo'][i], overview: OVERVIEW + ' ' + OVERVIEW, still_path: i % 4 === 3 ? null : `/s${n}${i}.jpg`, runtime: 47 + i, air_date: `2008-0${1 + (i % 9)}-${10 + i}`, vote_average: 7.5 + (i % 3) / 10 })) });
      }
      m = /^\/(movie|tv)\/(\d+)$/.exec(t);
      if (m) {
        const base = byId(m[1], m[2]);
        if (!base) return json({ status_message: 'nf' }, 404);
        const isTv = m[1] === 'tv';
        return json({
          ...base, tagline: 'Some doors only open from the inside.', runtime: isTv ? undefined : 136, episode_run_time: isTv ? [47] : undefined, imdb_id: base.id === 603 ? 'tt0133093' : `tt${String(base.id).padStart(7, '0')}`,
          genres: [{ name: 'Drama' }, { name: 'Mystery' }, { name: 'Thriller' }], status: 'Released',
          seasons: isTv ? [{ season_number: 0, episode_count: 3, name: 'Specials' }, { season_number: 1, episode_count: 7, name: 'Season 1', air_date: '2008-01-20' }, { season_number: 2, episode_count: 13, name: 'Season 2', air_date: '2009-03-08' }] : undefined,
          external_ids: { imdb_id: base.id === 1396 ? 'tt0903747' : `tt${String(base.id).padStart(7, '0')}` },
          credits: { cast: Array.from({ length: 14 }, (_, i) => ({ name: `Actor Number ${i + 1}`, character: `Character ${i + 1}`, profile_path: i === 3 ? null : `/c${i}.jpg` })) },
          recommendations: { results: (isTv ? shows : movies).filter((x) => x.id !== base.id).slice(0, 14) },
          videos: { results: [{ site: 'YouTube', type: 'Trailer', official: true, key: 'dQw4w9WgXcQ' }] },
        });
      }
      return json({ status_message: 'unknown' }, 404);
    }
    if (url.hostname === 'opensubtitles-v3.strem.io') {
      if (p === '/subtitles/movie/tt0133093.json' || p === '/subtitles/series/tt0903747:1:2.json') {
        return json({ subtitles: [{ id: '1', lang: 'eng', url: 'https://subs5.strem.io/en/test.srt' }, { id: '2', lang: 'ben', url: 'https://subs5.strem.io/bn/test.srt' }, { id: '3', lang: 'eng', url: 'https://subs5.strem.io/en/test2.srt' }] });
      }
      return json({ subtitles: [] });
    }
    if (url.hostname === 'subs5.strem.io') return new Response(p.startsWith('/bn/') ? SRT_BN : SRT_EN);
    if (url.hostname === 'flixhub.net' || url.hostname === 'www.flixhub.net') {
      if (p === '/watch/movie/the-matrix') return new Response(`<html><body><video id="theaterPlayer" data-stream-url="${mediaBase}/media/test.mp4"></video></body></html>`, { headers: { 'content-type': 'text/html' } });
      return new Response('not found', { status: 404 });
    }
    return new Response('unmocked host ' + url.hostname, { status: 502 });
  };
}

/** Poster-like SVG used for image.tmdb.org requests in E2E (no external network needed). */
export function placeholderSvg(path) {
  let n = 0; for (const c of path) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const hue = n % 360; const wide = /^\/(b|s)/.test(path);
  const [w, hh] = wide ? [780, 439] : [342, 513];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,32%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},50%,14%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${hh * 0.3}" r="${w * 0.18}" fill="hsl(${(hue + 30) % 360},60%,60%)" opacity=".25"/><text x="50%" y="52%" fill="#fff" opacity=".35" font-family="sans-serif" font-size="${w / 8}" text-anchor="middle">${path.replace(/[^\w]/g, '').slice(0, 8)}</text></svg>`;
}

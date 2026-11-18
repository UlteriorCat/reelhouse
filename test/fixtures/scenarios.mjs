// Canned BDIX upstream behaviour. Each scenario has a `meta` (what the web app knows from TMDB) and a `handler`
// that answers requests aimed at the BDIX hosts. The SAME scenarios drive (a) the original CloudStream scrapers
// (to produce test/fixtures/golden.json) and (b) the browser providers (which must reproduce the golden output).

const DF = (path) => ({ href: path });
const mk = (status, body, type = 'application/json') => ({ status, body: typeof body === 'string' ? body : JSON.stringify(body), type });
const isDF = (url) => /^http:\/\/172\.16\.50\.1[24]\//.test(url);
const pattern = (body) => { try { return JSON.parse(body).search.pattern; } catch { return null; } };

const matrixPosts = [
  { id: 11, type: 'singleVideo', title: 'The Matrix (1999) 1080p', name: 'The Matrix', categories: [] },
  { id: 12, type: 'singleVideo', title: 'The Matrix (1999) 720p', name: 'The Matrix', categories: [] },
  { id: 13, type: 'singleVideo', title: 'The Matrix Reloaded (2003)', name: 'The Matrix Reloaded', categories: [] },
  { id: 14, type: 'other', title: 'The Matrix junk', name: 'The Matrix' },
];
const cfMovieHandler = (primaryUp) => (method, url) => {
  if (url.startsWith('http://new.circleftp.net:5000')) { if (!primaryUp) return mk(503, 'down'); url = url.replace('http://new.circleftp.net:5000', 'http://15.1.1.50:5000'); }
  if (!url.startsWith('http://15.1.1.50:5000')) return undefined;
  if (url === 'http://15.1.1.50:5000/api/posts?searchTerm=The%20Matrix&order=desc') return mk(200, { posts: matrixPosts });
  if (url.endsWith('/api/posts/11')) return mk(200, { post: { type: 'singleVideo', title: 'The Matrix (1999) 1080p', content: 'http://example.invalid/m/The.Matrix.1999.1080p.mkv' } });
  if (url.endsWith('/api/posts/12')) return mk(200, { id: 12, content: 'http://example.invalid/m/The.Matrix.1999.720p.mp4' });
  return undefined;
};

const fhEpisodePage = (q) => `<video id="theaterPlayer" data-stream-url="https://cdn.invalid/stream/bb.${q}.mp4"></video>`;
const fhCard = (season, href, title) => `<article class="player-sidebar-card" data-season-number="${season}"><a class="player-sidebar-card-link" href="${href}"></a><h4 class="player-sidebar-card-title">${title}</h4></article>`;

export const scenarios = [
  {
    id: 'df-movie-variant2', scraper: 'bdix-df', meta: { type: 'movie', tmdbId: '603', title: 'The Matrix', year: '1999' },
    handler: (m, url, body) => {
      if (!isDF(url) || m !== 'POST') return undefined;
      if (pattern(body) === 'The\\ Matrix') return mk(200, { search: [] });
      if (url.includes('172.16.50.12')) return mk(200, { search: [
        DF('/DHAKA-FLIX-12/English%20Movies/The%20Matrix%20(1999)/The.Matrix.1999.2160p.UHD.BluRay.HDR10.x265.10bit.Atmos.mkv'),
        DF('/DHAKA-FLIX-12/English%20Movies/The%20Matrix%20(1999)/The.Matrix.1999.1080p.BluRay.x264.mp4'),
        DF('/DHAKA-FLIX-12/English%20Movies/The%20Matrix%20(1999)/The.Matrix.1999.720p.WEB-DL.MOV'),
        DF('/DHAKA-FLIX-12/English%20Movies/The%20Matrix%20(1999)/poster.jpg'),
        DF('/DHAKA-FLIX-12/TV-WEB-SERIES/The.Matrix.1999.720p.mkv'),
        DF('/DHAKA-FLIX-12/English%20Movies/The%20Matrix%20Reloaded%20(2003)/The.Matrix.Reloaded.2003.1080p.mkv'),
      ] });
      return mk(200, { search: [DF('/DHAKA-FLIX-14/Hindi%20Movies/The.Matrix.1999.480p.avi'), DF('/DHAKA-FLIX-12/English%20Movies/The%20Matrix%20(1999)/The.Matrix.1999.1080p.BluRay.x264.mp4')] });
    },
  },
  {
    id: 'df-movie-variant1-wins', scraper: 'bdix-df', meta: { type: 'movie', tmdbId: '603', title: 'The Matrix', year: '1999' },
    handler: (m, url, body) => {
      if (!isDF(url) || m !== 'POST') return undefined;
      if (pattern(body) === 'The\\ Matrix' && url.includes('.14')) return mk(200, { search: [DF('/DHAKA-FLIX-14/English%20Movies/The.Matrix.1999.1080p.mkv')] });
      if (pattern(body) === 'The.Matrix') return mk(200, { search: [DF('/DHAKA-FLIX-12/English%20Movies/The.Matrix.1999.720p.mkv')] });
      return mk(200, { search: [] });
    },
  },
  {
    id: 'df-tv-quirks', scraper: 'bdix-df', meta: { type: 'tv', tmdbId: '1396', title: 'Breaking Bad', year: '2008', season: 1, episode: 2 },
    handler: (m, url, body) => {
      if (!isDF(url) || m !== 'POST') return undefined;
      if (pattern(body) === 'Breaking\\ Bad') return mk(200, { search: [
        DF('/DHAKA-FLIX-14/TV-WEB-SERIES/Breaking%20Bad/Season%201/Breaking.Bad.S01E02.720p.mkv'),
        DF('/DHAKA-FLIX-14/TV-WEB-SERIES/Breaking%20Bad/Season%201/Breaking.Bad.S01E03.720p.mkv'),
        DF('/DHAKA-FLIX-14/TV-WEB-SERIES/Breaking%20Bad/Season%201/Breaking.Bad.S01E020.1080p.mkv'),
        DF('/DHAKA-FLIX-14/TV-WEB-SERIES/Breaking%20Bad/Season%201/Breaking.Bad.s01.e02.480p.mp4'),
        DF('/DHAKA-FLIX-14/English%20Movies/Breaking.Bad.The.Movie.S01E02.mkv'),
        DF('/DHAKA-FLIX-14/TV-WEB-SERIES/Breaking%20Bad/Season%201/Breaking.Bad.S01E02.srt'),
      ] });
      if (pattern(body) === 'Breaking.Bad') return mk(200, { search: [DF('/DHAKA-FLIX-12/TV-WEB-SERIES/OTHER/Breaking.Bad.S01E02.480p.mkv')] });
      return mk(200, { search: [] });
    },
  },
  {
    id: 'df-punctuation', scraper: 'bdix-df', meta: { type: 'movie', tmdbId: '634649', title: 'Spider-Man: No Way Home', year: '2021' },
    handler: (m, url, body) => (isDF(url) && m === 'POST' && pattern(body) === 'SpiderMan.No.Way.Home' && url.includes('.12')
      ? mk(200, { search: [DF('/DHAKA-FLIX-12/English%20Movies/Spider-Man.No.Way.Home.2021.2160p.mkv')] }) : isDF(url) ? mk(200, { search: [] }) : undefined),
  },
  { id: 'df-all-fail', scraper: 'bdix-df', meta: { type: 'movie', tmdbId: '603', title: 'The Matrix', year: '1999' }, handler: (m, url) => (isDF(url) ? mk(500, 'boom') : undefined) },

  { id: 'cf-movie-fallback-host', scraper: 'bdix-cf', meta: { type: 'movie', tmdbId: '603', title: 'The Matrix', year: '1999' }, handler: cfMovieHandler(false) },
  { id: 'cf-movie-primary-ok', scraper: 'bdix-cf', meta: { type: 'movie', tmdbId: '603', title: 'The Matrix', year: '1999' }, handler: cfMovieHandler(true) },
  {
    id: 'cf-tv-direct-index', scraper: 'bdix-cf', meta: { type: 'tv', tmdbId: '1396', title: 'Breaking Bad', year: '2008', season: 1, episode: 2 },
    handler: (m, url) => {
      if (!url.startsWith('http://new.circleftp.net:5000')) return undefined;
      if (url.includes('/api/posts?searchTerm=Breaking%20Bad')) return mk(200, [{ id: 7, type: 'series', title: 'Breaking Bad (2008) Complete', name: 'Breaking Bad' }]);
      if (url.endsWith('/api/posts/7')) return mk(200, { data: { type: 'series', content: [{ seasonName: 'Season 1', episodes: [{ link: 'http://x.invalid/bb/s01e01.1080p.mkv' }, { link: 'http://x.invalid/bb/s01e02.1080p.mkv' }] }] } });
      return undefined;
    },
  },
  {
    id: 'cf-tv-scan-fallback', scraper: 'bdix-cf', meta: { type: 'tv', tmdbId: '1396', title: 'Breaking Bad', year: '2008', season: 1, episode: 2 },
    handler: (m, url) => {
      if (!url.startsWith('http://new.circleftp.net:5000')) return undefined;
      if (url.includes('/api/posts?searchTerm=Breaking%20Bad')) return mk(200, { data: [{ id: 8, type: 'series', title: 'Breaking Bad 2008', name: 'Breaking Bad' }] });
      if (url.endsWith('/api/posts/8')) return mk(200, { post: { type: 'series', title: 'Breaking Bad', content: [
        { seasonName: 'Season 2', episodes: [{ link: 'http://x.invalid/bb/s02e01.720p.mkv' }] },
        { seasonName: 'Season 1', episodes: [{ episode: '1', url: 'http://x.invalid/bb/s01e01.720p.mkv' }, { episode: '2', url: 'http://x.invalid/bb/s01e02.720p.mkv', title: 'Cat' }] },
      ] } });
      return undefined;
    },
  },
  {
    id: 'cf-no-match', scraper: 'bdix-cf', meta: { type: 'movie', tmdbId: '9', title: 'Totally Different Film', year: '2010' },
    handler: (m, url) => (url.includes('searchTerm=') ? mk(200, { posts: [{ id: 1, type: 'singleVideo', title: 'Zzz Unrelated (1999)', name: 'Zzz Unrelated' }] }) : undefined),
  },

  {
    id: 'fh-movie-slug-fallback', scraper: 'bdix-fh', meta: { type: 'movie', tmdbId: '603', title: "The Matrix", year: '1999' },
    handler: (m, url) => {
      if (url === 'https://flixhub.net/watch/movie/the-matrix') return mk(404, 'nf', 'text/html');
      if (url === 'https://flixhub.net/watch/movie/the-matrix-1') return mk(200, `<html><body><video id="theaterPlayer" data-stream-url="https://cdn.invalid/stream/matrix.1080p.mp4"></video><a data-download-url="https://cdn.invalid/dl/matrix.720p.mkv">dl</a><source src="https://cdn.invalid/s/matrix.480p.webm"><a href="/stream/abc">s</a><script>var u="https://cdn.invalid/x/matrix.2160p.m3u8?t=1";</script></body></html>`, 'text/html');
      return undefined;
    },
  },
  {
    id: 'fh-tv-cards', scraper: 'bdix-fh', meta: { type: 'tv', tmdbId: '1396', title: 'Breaking Bad', year: '2008', season: 2, episode: 3 },
    handler: (m, url) => {
      if (url === 'https://flixhub.net/watch/series/breaking-bad') return mk(200, fhCard(1, '/watch/episode/bb-s1-e1', 'E1 Pilot') + fhCard(2, '/watch/episode/bb-s2-e1', 'E1 Seven') + fhCard(2, '/watch/episode/bb-s2-e2', 'E2 Grilled') + fhCard(2, '/watch/episode/bb-s2-e3', 'E3 Bit') + '<div id="theaterPlayer"></div>', 'text/html');
      if (url === 'https://flixhub.net/watch/episode/bb-s2-e3') return mk(200, fhEpisodePage('s02e03.1080p'), 'text/html');
      return undefined;
    },
  },
  {
    id: 'fh-tv-links-fallback', scraper: 'bdix-fh', meta: { type: 'tv', tmdbId: '1396', title: 'Breaking Bad', year: '2008', season: 1, episode: 2 },
    handler: (m, url) => {
      if (url === 'https://flixhub.net/watch/series/breaking-bad') return mk(200, '<div id="theaterPlayer"></div><a href="/watch/episode/bb-a">Episode 1</a><a href="/watch/episode/bb-b">Episode 2</a>', 'text/html');
      if (url === 'https://flixhub.net/watch/episode/bb-b') return mk(200, fhEpisodePage('s01e02.720p'), 'text/html');
      return undefined;
    },
  },
  { id: 'fh-no-player-marker', scraper: 'bdix-fh', meta: { type: 'movie', tmdbId: '603', title: 'The Matrix', year: '1999' }, handler: (m, url) => (url.startsWith('https://flixhub.net') ? mk(200, '<html>no player here</html>', 'text/html') : undefined) },
];

/** TMDB answers for the ORIGINAL scrapers (which look the title up themselves). */
export function tmdbReply(meta, url) {
  const re = new RegExp(`^https://api\\.themoviedb\\.org/3/${meta.type}/${meta.tmdbId}\\?`);
  if (!re.test(url)) return null;
  const date = meta.year ? `${meta.year}-06-15` : '';
  return meta.type === 'tv' ? { name: meta.title, first_air_date: date } : { title: meta.title, release_date: date };
}

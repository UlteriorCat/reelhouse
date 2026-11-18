// Hash router: works on any static host with no server fallback rules (#/movie/603, #/watch/tv/1396/1/2, ...).
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const [path, query = ''] = raw.split('?');
  const segs = path.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  return { segs, query: new URLSearchParams(query) };
}

const isId = (s) => /^\d{1,10}$/.test(s || '');

/** @returns {{name: string, params: object, query: URLSearchParams}} */
export function matchRoute({ segs, query }) {
  const [a, b, c, d, e] = segs;
  if (!a) return { name: 'home', params: {}, query };
  if (a === 'search' && segs.length === 1) return { name: 'search', params: {}, query };
  if (a === 'list' && segs.length === 1) return { name: 'list', params: {}, query };
  if ((a === 'movie' || a === 'tv') && isId(b) && segs.length === 2) return { name: 'details', params: { type: a, id: b }, query };
  if (a === 'watch' && b === 'movie' && isId(c) && segs.length === 3) return { name: 'watch', params: { type: 'movie', id: c }, query };
  if (a === 'watch' && b === 'tv' && isId(c) && isId(d) && isId(e) && segs.length === 5) return { name: 'watch', params: { type: 'tv', id: c, season: Number(d), episode: Number(e) }, query };
  return { name: 'notfound', params: {}, query };
}

export const href = (path, query) => {
  const q = query ? new URLSearchParams(query).toString() : '';
  return '#' + path + (q ? '?' + q : '');
};
export const hrefTitle = (type, id) => href(`/${type}/${id}`);
export const hrefWatch = (type, id, season, episode) => href(type === 'tv' ? `/watch/tv/${id}/${season}/${episode}` : `/watch/movie/${id}`);

/** Calls render(route, {signal}) on every navigation; the previous view's signal is aborted so its requests stop. */
export function startRouter(render) {
  let ctrl;
  const run = () => {
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    render(matchRoute(parseHash(location.hash)), { signal: ctrl.signal });
  };
  addEventListener('hashchange', run);
  run();
  return run;
}

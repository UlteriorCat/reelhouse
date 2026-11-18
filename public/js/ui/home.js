import { h, mount, imgUrl, srcset } from '../util.js';
import { homeSWR, api, ApiError } from '../api.js';
import { store } from '../store.js';
import { card, rail, skeletonRail, resumeFor, icon } from './components.js';
import { hrefTitle, hrefWatch } from '../router.js';

export function errorNotice(e, retry) {
  if (e instanceof ApiError && e.code === 'tmdb_not_configured') {
    return h('div', { class: 'notice warn' }, h('h2', null, 'TMDB API key needed'),
      h('p', null, 'This site loads titles from TMDB, which is free for personal use. To finish setup:'),
      h('ol', null,
        h('li', null, 'Create a free account at themoviedb.org, then open Settings \u2192 API and request a key.'),
        h('li', null, 'In Cloudflare Pages, open your project \u2192 Settings \u2192 Variables and Secrets and add ', h('code', null, 'TMDB_API_KEY'), '.'),
        h('li', null, 'Redeploy, then reload this page.')));
  }
  return h('div', { class: 'notice' }, h('h2', null, 'Something went wrong'), h('p', null, e.message || 'Unexpected error.'),
    retry ? h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onClick: retry }, 'Try again')) : null);
}

function hero(item) {
  const isMovie = item.type === 'movie';
  return h('section', { class: 'hero', 'aria-label': 'Featured' },
    h('img', { class: 'bg', src: imgUrl(item.backdrop, 'w1280'), srcset: srcset(item.backdrop, [780, 1280]) + ', ' + imgUrl(item.backdrop, 'original') + ' 1920w', sizes: '100vw', alt: '', fetchpriority: 'high', decoding: 'async' }),
    h('div', { class: 'hero-body' },
      h('h1', null, item.title),
      h('div', { class: 'chips' }, item.rating ? h('span', { class: 'chip star' }, icon('star'), item.rating.toFixed(1)) : null, item.year ? h('span', { class: 'chip' }, item.year) : null, h('span', { class: 'chip' }, isMovie ? 'Movie' : 'Series')),
      h('p', { class: 'lede' }, item.overview),
      h('div', { class: 'actions' },
        isMovie ? h('a', { class: 'btn primary', href: hrefWatch('movie', item.id) }, icon('play'), 'Play') : h('a', { class: 'btn primary', href: hrefTitle('tv', item.id) }, icon('play'), 'Episodes'),
        h('a', { class: 'btn', href: hrefTitle(item.type, item.id) }, icon('info'), 'Details'))));
}

/** Fetch recommendations only when the row scrolls near the viewport. */
function lazyRecsRail(entry, signal) {
  const slot = h('div', { 'data-slot': 'recs' });
  const io = new IntersectionObserver(async (ents) => {
    if (!ents.some((e) => e.isIntersecting)) return;
    io.disconnect();
    try {
      const { items } = await api.recs(entry.type, entry.id, signal);
      if (items.length) slot.replaceWith(rail(`Because you watched ${entry.title}`, items.map((i) => card(i)), { id: 'because' }));
      else slot.remove();
    } catch { slot.remove(); }
  }, { rootMargin: '400px' });
  queueMicrotask(() => io.observe(slot));
  signal.addEventListener('abort', () => io.disconnect());
  return slot;
}

export function homeView({ root, signal }) {
  mount(root, skeletonRail('Trending today'), skeletonRail('Popular movies'));
  let rendered = false;

  const render = (data) => {
    const nodes = [];
    if (data.hero) nodes.push(hero(data.hero));
    const hist = store.history();
    if (hist.length) nodes.push(rail('Continue watching', hist.slice(0, 12).map((e) => card({ type: e.type, id: e.id, title: e.type === 'tv' ? `${e.title}` : e.title, year: e.type === 'tv' ? `S${e.season} E${e.episode}` : e.year || '', poster: e.poster, rating: 0 }, { resume: resumeFor(e) })), { id: 'continue' }));
    const list = store.list();
    if (list.length) nodes.push(rail('My List', list.slice(0, 20).map((i) => card(i)), { id: 'list' }));
    const [first, ...rest] = data.rows;
    nodes.push(rail(first.title, first.items.map((i) => card(i)), { id: first.id }));
    if (hist.length) nodes.push(lazyRecsRail(hist[0], signal));
    for (const r of rest) if (r.items.length) nodes.push(rail(r.title, r.items.map((i) => card(i)), { id: r.id }));
    mount(root, ...nodes);
    rendered = true;
  };

  const load = () => homeSWR((data) => render(data), signal).catch((e) => {
    if (e && e.name === 'AbortError') return;
    if (!rendered) mount(root, errorNotice(e, () => { mount(root, skeletonRail()); load(); }));
  });
  load();
}

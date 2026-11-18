// Search results and My List.
import { h, mount, debounce } from '../util.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { card, icon } from './components.js';
import { errorNotice } from './home.js';
import { href } from '../router.js';

export function searchView({ root, route, signal }) {
  const q = (route.query.get('q') || '').trim();
  const input = h('input', { class: 'field', type: 'search', value: q, placeholder: 'Search movies and series', 'aria-label': 'Search', autocomplete: 'off', enterkeyhint: 'search' });
  const results = h('div');
  const go = () => { location.hash = href('/search', { q: input.value.trim() }); };
  const live = debounce(() => { if (input.value.trim().length >= 2 && input.value.trim() !== q) go(); }, 400);
  input.addEventListener('input', live);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { live.cancel(); go(); } });
  mount(root, h('div', { class: 'page-head' }, h('h1', null, q ? `Results for \u201c${q}\u201d` : 'Search'), h('div', { class: 'mobile-only', style: { marginTop: '12px' } }, input)), results);
  if (!q) { results.append(h('div', { class: 'empty' }, h('p', null, 'Type a title to search movies and series.'))); return; }
  if (q.length < 2) return;
  results.append(h('p', { class: 'empty' }, 'Searching\u2026'));
  api.search(q, 1, signal).then(({ items }) => {
    if (!items.length) return mount(results, h('div', { class: 'empty' }, h('h2', null, 'No matches'), h('p', null, `Nothing found for \u201c${q}\u201d. Try a different spelling.`)));
    mount(results, h('div', { class: 'grid' }, items.map((i) => card(i))));
  }).catch((e) => { if (!(e && e.name === 'AbortError')) mount(results, errorNotice(e, () => searchView({ root, route, signal }))); });
}

export function listView({ root }) {
  const items = store.list();
  mount(root, h('div', { class: 'page-head' }, h('h1', null, 'My List'), h('p', null, 'Saved on this device only.')),
    items.length ? h('div', { class: 'grid' }, items.map((i) => card(i)))
      : h('div', { class: 'empty' }, icon('list'), h('h2', null, 'Nothing saved yet'), h('p', null, 'Use the + button on any title to keep it here.')));
}

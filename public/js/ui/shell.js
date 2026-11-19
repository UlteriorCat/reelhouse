import { h, $, $$, debounce } from '../util.js';
import { icon } from './components.js';
import { href, parseHash } from '../router.js';
import { BRAND } from '../brand.js';

export function buildShell({ onSettings }) {
  const search = h('input', { type: 'search', placeholder: 'Search movies and series', 'aria-label': 'Search', autocomplete: 'off', enterkeyhint: 'search' });
  const go = (q) => { location.hash = q.trim() ? href('/search', { q: q.trim() }) : href('/'); };
  const live = debounce(() => { if (search.value.trim().length >= 2) go(search.value); }, 350);
  search.addEventListener('input', live);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { live.cancel(); go(search.value); } });

  $('#topbar').replaceChildren(
    h('a', { class: 'logo', href: '#/', 'aria-label': `${BRAND.name} home` }, h('img', { src: BRAND.logo, alt: '', width: 28, height: 28 }), BRAND.name),
    h('nav', { class: 'nav', 'aria-label': 'Main' }, h('a', { href: '#/', dataset: { nav: 'home' } }, 'Home'), h('a', { href: '#/list', dataset: { nav: 'list' } }, 'Lists'), h('a', { href: '#/history', dataset: { nav: 'history' } }, 'History')),
    h('div', { class: 'grow' }),
    h('div', { class: 'searchbox' }, icon('search'), search),
    h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Settings', onClick: onSettings }, icon('settings')));

  $('#tabbar').replaceChildren(
    h('a', { href: '#/', dataset: { nav: 'home' } }, icon('home'), 'Home'),
    h('a', { href: '#/search', dataset: { nav: 'search' } }, icon('search'), 'Search'),
    h('a', { href: '#/list', dataset: { nav: 'list' } }, icon('list'), 'Lists'),
    h('button', { type: 'button', onClick: onSettings }, icon('settings'), 'Settings'));

  return {
    /** Keep nav highlight and the desktop search box in sync with the current route. */
    update(route) {
      const key = ['home', 'list', 'search', 'history'].includes(route.name) ? route.name : '';
      for (const a of $$('[data-nav]')) { if (a.dataset.nav === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
      if (route.name === 'search') { const q = route.query.get('q') || ''; if (document.activeElement !== search) search.value = q; } else if (document.activeElement !== search) search.value = '';
      // The watch page is full-focus: hide the footer and tab bar chrome noise via a body class
      document.body.classList.toggle('is-watch', route.name === 'watch');
    },
    isSearchRoute: () => parseHash(location.hash).segs[0] === 'search',
  };
}

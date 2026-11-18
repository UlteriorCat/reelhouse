// App entry: builds the shell, starts the hash router and renders the matching view.
import { $, h, mount } from './util.js';
import { startRouter } from './router.js';
import { buildShell } from './ui/shell.js';
import { homeView } from './ui/home.js';
import { searchView, listView } from './ui/browse.js';
import { detailsView } from './ui/details.js';
import { watchView } from './ui/watch.js';
import { openSettings } from './ui/settings.js';
import { BRAND } from './brand.js';

const root = $('#main');
let settingsOpen = null;
const showSettings = () => { if (settingsOpen && settingsOpen.el.open) return; settingsOpen = openSettings(); };
document.addEventListener('rh:settings', showSettings);

const shell = buildShell({ onSettings: showSettings });

const views = { home: homeView, search: searchView, list: listView, details: detailsView, watch: watchView };

startRouter((route, { signal }) => {
  document.title = BRAND.name;
  shell.update(route);
  const view = views[route.name];
  if (!view) {
    mount(root, h('div', { class: 'empty' }, h('h2', null, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
    return;
  }
  window.scrollTo(0, 0);
  // Every navigation gets its own container. A view that is still waiting on the network after the user left
  // can then only write into a detached element, never into the page that replaced it.
  const viewRoot = h('div', { class: 'view' });
  mount(root, viewRoot);
  try { view({ root: viewRoot, route, signal }); } catch (e) {
    console.error(e);
    mount(viewRoot, h('div', { class: 'notice' }, h('h2', null, 'Something went wrong'), h('p', null, 'Reload the page to try again.')));
  }
});

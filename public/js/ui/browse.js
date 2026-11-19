// Search results, lists and history.
import { h, mount, debounce } from '../util.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { card, icon, toast, openSheet, confirmSheet } from './components.js';
import { historyCard, focusCard } from './home.js';
import { account } from '../account.js';
import { DEFAULT_LIST } from '../sync-merge.js';
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

const where = () => (account.state().user ? `Synced to ${account.state().user.username}\u2019s account.` : 'Saved on this device. Sign in (Settings) to have it on every device.');

/** All lists: one section each, with rename/delete and a remove button on every title. */
export function listView({ root }) {
  const draw = () => {
    const lists = store.lists();
    const total = lists.reduce((n, l) => n + l.items.length, 0);
    mount(root,
      h('div', { class: 'page-head' }, h('h1', null, 'Lists'), h('p', null, where()),
        h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onClick: () => nameSheet({ title: 'New list', onSave: (name) => store.createList(name), done: draw }) }, icon('plus'), 'New list'))),
      total === 0 && lists.length === 1
        ? h('div', { class: 'empty' }, icon('list'), h('h2', null, 'Nothing saved yet'), h('p', null, 'Use the + button on any title to save it to a list.'))
        : lists.map((l) => listSection(l, draw)));
  };
  draw();
}

function listSection(l, redraw) {
  const isDefault = l.id === DEFAULT_LIST;
  const grid = h('div', { class: 'grid' });
  const sec = h('section', { class: 'listsec', 'aria-label': l.name, dataset: { list: l.id } },
    h('div', { class: 'listsec-head' },
      h('h2', null, l.name, h('span', { class: 'count' }, l.items.length === 1 ? '1 title' : `${l.items.length} titles`)),
      h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Rename ${l.name}`, onClick: () => nameSheet({ title: 'Rename list', value: l.name, onSave: (name) => store.renameList(l.id, name), done: redraw }) }, 'Rename'),
      isDefault ? null : h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Delete ${l.name}`, onClick: async () => {
        if (!(await confirmSheet({ title: `Delete \u201c${l.name}\u201d?`, text: l.items.length ? `The list and its ${l.items.length} saved title${l.items.length === 1 ? '' : 's'} will be removed. The titles themselves stay on the site.` : 'The empty list will be removed.', confirmLabel: 'Delete list' }))) return;
        store.deleteList(l.id); toast(`Deleted ${l.name}`); redraw();
      } }, 'Delete')),
    l.items.length ? grid : h('p', { class: 'hint' }, 'Empty. Use the + button on a title to add it here.'));
  for (const item of l.items) {
    grid.append(card(item, {
      removeLabel: `Remove ${item.title} from ${l.name}`,
      onRemove: (wrap, how = {}) => {
        const removed = store.removeFromList(l.id, item.type, item.id);
        const next = wrap.nextSibling;
        wrap.remove();
        toast(`Removed ${item.title} from ${l.name}`, { focusAction: how.keyboard, action: removed && { label: 'Undo', onClick: () => { store.addToList(l.id, removed); grid.insertBefore(wrap, next && next.parentNode === grid ? next : null); focusCard(`${item.type}:${item.id}`); } } });
      },
    }));
  }
  return sec;
}

/** Ask for a list name (new or rename); `onSave` may throw a message to show. */
export function nameSheet({ title, value = '', onSave, done }) {
  const sheet = openSheet({ title });
  const input = h('input', { class: 'field', type: 'text', value, maxlength: 60, required: true, autocomplete: 'off', id: 'list-name' });
  const msg = h('p', { class: 'err-text', role: 'alert' });
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { for: 'list-name' }, 'Name', input), msg,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save'), h('button', { class: 'btn ghost', type: 'button', onClick: () => sheet.close() }, 'Cancel')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    try { const r = onSave(input.value); sheet.close(); done && done(r); } catch (err) { msg.textContent = err.message; input.focus(); }
  });
  mount(sheet.body, form);
  input.focus(); input.select();
}

/** "Clear history", the same from the History page and from Settings. Resolves true when cleared. */
export async function clearHistoryFlow() {
  const n = store.history().length; // now, not when a page was drawn (single removals change it)
  if (!n) { toast('Your history is already empty'); return false; }
  if (!(await confirmSheet({ title: 'Clear your history?', text: `${n === 1 ? 'The 1 title' : `All ${n} titles`} will be removed from Continue watching${account.state().user ? ' on every device you are signed in on' : ''}. Resume positions are kept.`, confirmLabel: 'Clear history' }))) return false;
  store.clearHistory();
  toast('History cleared');
  document.dispatchEvent(new CustomEvent('rh:library-synced')); // open pages (home, history) redraw, e.g. when cleared from Settings
  return true;
}

/** Full watch history (Continue watching shows the newest 12). */
export function historyView({ root }) {
  const draw = () => {
    const hist = store.history();
    const grid = h('div', { class: 'grid' });
    for (const e of hist) grid.append(historyCard(e, () => grid, draw));
    mount(root,
      h('div', { class: 'page-head' }, h('h1', null, 'History'), h('p', null, where()),
        hist.length ? h('div', { class: 'actions' }, h('button', { class: 'btn small danger', type: 'button', onClick: async () => { if (await clearHistoryFlow()) draw(); } }, 'Clear history')) : null),
      hist.length ? grid : h('div', { class: 'empty' }, icon('history'), h('h2', null, 'No history yet'), h('p', null, 'Titles you play show up here and in Continue watching on the home page.')));
  };
  draw();
}

import { h, imgUrl, srcset, clamp } from '../util.js';
import { hrefTitle, hrefWatch } from '../router.js';
import { store } from '../store.js';
import { progressKey } from '../util.js';

// ---------- icons (24px, stroke) ----------
const ICONS = {
  play: { fill: true, d: 'M8 5v14l11-7z' },
  download: { d: 'M12 3v12m0 0-4-4m4 4 4-4M5 21h14' },
  plus: { d: 'M12 5v14M5 12h14' },
  check: { d: 'M5 13l4 4L19 7' },
  search: { d: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2' },
  home: { d: 'M3 11l9-8 9 8v10h-6v-6H9v6H3z' },
  list: { d: 'M6 3h12v18l-6-4-6 4z' },
  settings: { d: 'M4 7h9M17 7h3M4 17h3M11 17h9', extra: '<circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>' },
  close: { d: 'M6 6l12 12M18 6 6 18' },
  info: { d: 'M12 11v6M12 7.5v.5', extra: '<circle cx="12" cy="12" r="9"/>' },
  star: { fill: true, d: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' },
  external: { d: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' },
  copy: { d: 'M9 9h11v11H9zM5 15V4h10' },
  left: { d: 'M15 5l-7 7 7 7' },
  right: { d: 'M9 5l7 7-7 7' },
  warn: { d: 'M12 3l10 18H2zM12 10v5M12 18v.5' },
  film: { d: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M16 9h4M4 15h4M16 15h4' },
};

export function icon(name, cls = '') {
  const spec = ICONS[name];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon${spec.fill ? ' fill' : ''} ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<path d="${spec.d}"/>${spec.extra || ''}`; // constant strings from this file only
  return svg;
}

// ---------- images ----------
const POSTER_SIZES = '(min-width:1800px) 10vw, (min-width:1280px) 12.5vw, (min-width:820px) 17vw, (min-width:560px) 24vw, 38vw';
export function posterImg(path, alt) {
  if (!path) return h('div', { class: 'noimg' });
  return h('img', { src: imgUrl(path, 'w342'), srcset: srcset(path, [185, 342, 500]), sizes: POSTER_SIZES, alt, width: 342, height: 513, loading: 'lazy', decoding: 'async' });
}

// ---------- cards ----------
export function card(item, { resume } = {}) {
  const pct = resume ? clamp(Math.round((resume.pos / resume.dur) * 100), 0, 100) : 0;
  const a = h('a', { class: 'card', href: hrefTitle(item.type, item.id), 'aria-label': `${item.title}${item.year ? ` (${item.year})` : ''}` },
    h('div', { class: 'poster' },
      posterImg(item.poster, ''),
      item.rating ? h('span', { class: 'rate' }, '\u2605 ', item.rating.toFixed(1)) : null,
      resume ? h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } })) : null),
    h('div', { class: 'meta' }, h('div', { class: 't' }, item.title), item.year ? h('div', { class: 'y' }, item.year) : null));
  if (!resume) return a;
  return h('div', { class: 'card-wrap' }, a,
    h('a', { class: 'resume', href: hrefWatch(item.type, item.id, resume.season, resume.episode), 'aria-label': `Resume ${item.title}` }, icon('play')));

}

export function personCard(p) {
  return h('div', { class: 'card person' },
    h('div', { class: 'poster' }, p.photo ? h('img', { src: imgUrl(p.photo, 'w185'), alt: '', width: 185, height: 185, loading: 'lazy', decoding: 'async' }) : null),
    h('div', { class: 'meta' }, h('div', { class: 't' }, p.name), h('div', { class: 'y' }, p.character)));
}

export function skeletonRail(title = '') {
  const items = Array.from({ length: 8 }, () => h('div', { class: 'card skel', 'aria-hidden': 'true' }, h('div', { class: 'poster' }), h('div', { class: 'line' })));
  return h('section', { class: 'rail', 'aria-busy': 'true' }, h('div', { class: 'rail-head' }, h('h2', null, title || '\u00a0')), h('div', { class: 'track' }, items));
}

/** A horizontally scrolling row. `nodes` are already-built card elements. */
export function rail(title, nodes, { id } = {}) {
  const track = h('div', { class: 'track', role: 'list' }, nodes.map((n) => { n.setAttribute('role', 'listitem'); return n; }));
  const by = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: 'smooth' });
  const section = h('section', { class: 'rail', 'aria-label': title, dataset: id ? { rail: id } : undefined },
    h('div', { class: 'rail-head' },
      h('h2', null, title),
      h('div', { class: 'rail-ctrl' },
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': `Scroll ${title} left`, onClick: () => by(-1) }, icon('left')),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': `Scroll ${title} right`, onClick: () => by(1) }, icon('right')))),
    track);
  return section;
}

export const resumeFor = (entry) => {
  const p = store.progress(progressKey(entry.type, entry.id, entry.season, entry.episode));
  return p && p.dur ? { pos: p.pos, dur: p.dur, season: entry.season, episode: entry.episode } : { pos: 0, dur: 1, season: entry.season, episode: entry.episode };
};

// ---------- toast ----------
export function toast(message, { error = false, ms = 4200 } = {}) {
  const host = document.getElementById('toasts');
  const t = h('div', { class: `toast${error ? ' err' : ''}` }, message);
  host.append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}

// ---------- sheet (bottom sheet on phones, side drawer on desktop) ----------
export function openSheet({ title, subtitle, onClose } = {}) {
  const dlg = h('dialog', { class: 'sheet', 'aria-label': title });
  const body = h('div', { class: 'sheet-body' });
  const head = h('div', { class: 'sheet-head' },
    h('h2', null, title, subtitle ? h('span', { class: 'sub' }, subtitle) : null),
    h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', onClick: () => dlg.close() }, icon('close')));
  dlg.append(head, body);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { dlg.remove(); onClose && onClose(); });
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, body, close: () => dlg.open && dlg.close(), setTitle: (t, s) => { head.querySelector('h2').replaceChildren(t, ...(s ? [h('span', { class: 'sub' }, s)] : [])); } };
}

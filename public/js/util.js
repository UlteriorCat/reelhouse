// Tiny DOM + formatting helpers. No framework: elements are built with h(), and all text goes through textContent,
// so strings from TMDB or from BDIX file names can never inject markup.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...children) { clear(el); append(el, children); return el; }

export const IMG = 'https://image.tmdb.org/t/p/';
export const imgUrl = (path, size = 'w342') => (path ? `${IMG}${size}${path}` : '');
export const srcset = (path, sizes) => (path ? sizes.map((s) => `${IMG}w${s}${path} ${s}w`).join(', ') : '');

export function runtimeText(min) {
  if (!min) return '';
  const hrs = Math.floor(min / 60);
  const m = min % 60;
  return hrs ? (m ? `${hrs}h ${m}m` : `${hrs}h`) : `${m}m`;
}

export function clock(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const hrs = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return hrs ? `${hrs}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export const debounce = (fn, ms) => {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
};

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** key used for resume positions and history: movie:603  or  tv:1396:1:2 */
export const progressKey = (type, id, season, episode) => (type === 'tv' ? `tv:${id}:${season}:${episode}` : `movie:${id}`);

export function sanitizeFilename(name) {
  return String(name || 'video').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150) || 'video';
}

/** Copy text. Uses the Clipboard API when available; falls back to execCommand (needed on plain-http pages, where navigator.clipboard is undefined). */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  // a modal <dialog> makes everything outside it inert, so the helper element must live inside the open dialog
  (document.querySelector('dialog[open]') || document.body).append(ta);
  ta.focus({ preventScroll: true }); // iOS Safari only copies from a focused element
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

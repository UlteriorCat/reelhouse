import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRAND } from '../public/js/brand.js';
import { applyBrand } from '../scripts/rebrand.mjs';

const PUB = new URL('../public/', import.meta.url).pathname;
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('brand: index.html and the web manifest match public/js/brand.js (run `npm run rebrand` if this fails)', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.equal(decode(html.match(/<title>([^<]*)<\/title>/)[1]), BRAND.name);
  assert.equal(decode(html.match(/<meta name="description" content="([^"]*)"/)[1]), BRAND.tagline);
  assert.equal(html.match(/<meta name="theme-color" content="([^"]*)"/)[1], BRAND.themeColor);
  assert.equal(html.match(/<link rel="icon" href="([^"]*)"/)[1], BRAND.logo);
  const m = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, BRAND.name); assert.ok(BRAND.name.startsWith(m.short_name));
  assert.equal(m.theme_color, BRAND.themeColor); assert.equal(m.icons[0].src, BRAND.logo);
});

test('brand: the logo file exists and is a real SVG', () => {
  const f = path.join(PUB, BRAND.logo.replace(/^\//, ''));
  assert.ok(fs.existsSync(f), f);
  assert.match(fs.readFileSync(f, 'utf8'), /<svg[\s>]/);
});

test('brand: no module under public/js hardcodes the product name (single source of truth)', () => {
  const offenders = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js') && e.name !== 'brand.js' && fs.readFileSync(p, 'utf8').includes(BRAND.name)) offenders.push(p); } };
  walk(path.join(PUB, 'js'));
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').replace(/<title>[^<]*<\/title>/, '');
  if (html.includes(BRAND.name)) offenders.push('index.html body');
  assert.deepEqual(offenders, []);
});

test('rebrand script: applies a new identity (special characters escaped), is idempotent, leaves other markup alone', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  fs.copyFileSync(path.join(PUB, 'index.html'), path.join(tmp, 'index.html'));
  fs.copyFileSync(path.join(PUB, 'manifest.webmanifest'), path.join(tmp, 'manifest.webmanifest'));
  const next = { name: 'Cin\u00e9 & <Co> "Play" Nest', tagline: 'Watch "this" & that <now>', themeColor: '#102030', logo: '/mylogo.svg' };
  applyBrand(next, tmp);
  const once = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
  assert.equal(decode(once.match(/<title>([^<]*)<\/title>/)[1]), next.name);
  assert.ok(once.includes('<title>Cin\u00e9 &amp; &lt;Co&gt; &quot;Play&quot; Nest</title>'), 'HTML-escaped');
  assert.equal(decode(once.match(/<meta name="description" content="([^"]*)"/)[1]), next.tagline);
  assert.equal(once.match(/<meta name="theme-color" content="([^"]*)"/)[1], '#102030');
  assert.equal(once.match(/<link rel="icon" href="([^"]*)"/)[1], '/mylogo.svg');
  assert.ok(once.includes('<main id="main"') && once.includes('/js/main.js'), 'rest of the page untouched');
  const m = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual([m.name, m.short_name, m.theme_color, m.background_color, m.icons[0].src], [next.name, next.name.slice(0, 12), '#102030', '#102030', '/mylogo.svg']);
  assert.equal(m.start_url, '/'); assert.equal(m.display, 'standalone');
  applyBrand(next, tmp);
  assert.equal(fs.readFileSync(path.join(tmp, 'index.html'), 'utf8'), once, 'idempotent');
  fs.rmSync(tmp, { recursive: true });
});

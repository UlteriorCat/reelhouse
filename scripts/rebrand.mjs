#!/usr/bin/env node
// Syncs the two static files that cannot import JavaScript with public/js/brand.js:
//   public/index.html (title, description, theme-color) and public/manifest.webmanifest (name, short_name, colours).
// Usage: edit public/js/brand.js, (optionally replace public/icon.svg), then `npm run rebrand`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function applyBrand(brand, publicDir) {
  const htmlPath = path.join(publicDir, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(brand.name)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(brand.tagline)}$2`)
    .replace(/(<meta name="theme-color" content=")[^"]*(")/, `$1${esc(brand.themeColor)}$2`)
    .replace(/(<link rel="icon" href=")[^"]*(")/, `$1${esc(brand.logo)}$2`);
  fs.writeFileSync(htmlPath, html);
  const mPath = path.join(publicDir, 'manifest.webmanifest');
  const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  Object.assign(m, { name: brand.name, short_name: brand.name.length > 12 ? brand.name.slice(0, 12) : brand.name, theme_color: brand.themeColor, background_color: brand.themeColor });
  m.icons = [{ src: brand.logo, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }];
  fs.writeFileSync(mPath, JSON.stringify(m, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  const { BRAND } = await import(pathToFileURL(path.join(publicDir, 'js/brand.js')).href);
  if (!fs.existsSync(path.join(publicDir, BRAND.logo.replace(/^\//, '')))) { console.error(`Logo file not found: public${BRAND.logo}`); process.exit(1); }
  applyBrand(BRAND, publicDir);
  console.log(`Synced index.html and manifest.webmanifest with brand "${BRAND.name}".`);
}

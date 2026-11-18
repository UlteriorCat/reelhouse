// Bundles the third-party player code into versioned static files under public/vendor/ (committed, so Cloudflare Pages
// needs no build step). Re-run after changing versions in package.json:  npm run build:vendor
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const root = new URL('../node_modules/', import.meta.url).pathname;
const ver = (p) => JSON.parse(fs.readFileSync(path.join(root, p, 'package.json'), 'utf8')).version; // not via require(): exports maps hide package.json
const out = new URL('../public/vendor/', import.meta.url).pathname;
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
for (const f of fs.readdirSync(out)) if (/^(artplayer|hls-light)-/.test(f)) fs.unlinkSync(path.join(out, f));

const common = { bundle: true, minify: true, format: 'esm', target: ['es2020', 'chrome100', 'safari15', 'firefox100'], legalComments: 'linked', logLevel: 'error' };
const art = `artplayer-${ver('artplayer')}.js`;
const hls = `hls-light-${ver('hls.js')}.js`;
await build({ ...common, stdin: { contents: "import A from 'artplayer'; export default A;", resolveDir: process.cwd() }, outfile: path.join(out, art) });
await build({ ...common, stdin: { contents: "import H from 'hls.js/dist/hls.light.mjs'; export default H;", resolveDir: process.cwd() }, outfile: path.join(out, hls) });
fs.copyFileSync(path.join(root, '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2'), path.join(out, 'fonts/bricolage-grotesque-latin-wght.woff2'));
fs.writeFileSync(path.join(out, 'versions.json'), JSON.stringify({ artplayer: art, hls: hls, font: 'fonts/bricolage-grotesque-latin-wght.woff2' }, null, 2) + '\n');
for (const f of fs.readdirSync(out)) { const p = path.join(out, f); if (fs.statSync(p).isFile()) console.log(f.padEnd(32), String(fs.statSync(p).size).padStart(8), 'bytes'); }

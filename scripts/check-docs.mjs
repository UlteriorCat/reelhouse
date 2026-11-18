#!/usr/bin/env node
// Verifies the documentation still matches the code: referenced paths and npm scripts exist, counted numbers are
// right, versions and design tokens agree, documented env vars are real. Run after changing code OR docs:  npm run check:docs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const read = (f) => fs.readFileSync(f, 'utf8');
const DOCS = ['README.md', 'CLAUDE.md', 'HANDOFF.md', 'VERIFICATION.md', 'NOTICE.md', 'docs/IMPLEMENTATION.md'].filter((f) => fs.existsSync(f));
const docs = Object.fromEntries(DOCS.map((f) => [f, read(f)]));
const all = Object.values(docs).join('\n');
let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.wrangler', 'media', 'screenshots'].includes(e.name)) continue; const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : out.push(p); } return out; };

// 1. every backticked repo path exists
const pkg = JSON.parse(read('package.json'));
const paths = new Set([...all.matchAll(/`((?:public|lib|gateway|dev|e2e|test|scripts|functions|docs)\/[A-Za-z0-9_./\[\]\-]+|(?:README|CLAUDE|HANDOFF|VERIFICATION|NOTICE|LICENSE)(?:\.md)?|package\.json|wrangler\.toml|\.dev\.vars\.example)`/g)].map((m) => m[1]));
// directories that only exist after running the tests (git-ignored) are valid references
const GENERATED = ['e2e/screenshots', 'e2e/media'];
const missing = [...paths].filter((p) => !fs.existsSync(p) && !fs.existsSync(p.replace(/\/$/, '')) && !/[*<{]/.test(p) && !GENERATED.some((g) => p.replace(/\/$/, '').startsWith(g)));
check(missing.length === 0, `${paths.size} referenced repo paths exist${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);

// 2. npm scripts mentioned exist
const scripts = new Set([...all.matchAll(/npm run ([a-z0-9:]+)/g)].map((m) => m[1]));
for (const s of scripts) check(!!pkg.scripts[s], `npm script \`${s}\` exists`);
check(!!pkg.scripts.test, 'npm test exists');

// 3. counted numbers
const t = spawnSync('npm', ['test'], { encoding: 'utf8' });
const unit = Number((t.stdout.match(/ℹ tests (\d+)/) || [])[1]);
const unitFail = Number((t.stdout.match(/ℹ fail (\d+)/) || [])[1]);
check(unit > 0 && unitFail === 0, `unit tests run: ${unit} tests, ${unitFail} failing`);
const e2eSrc = ['e2e/run.mjs', 'e2e/steps2.mjs', 'e2e/steps3.mjs'].map(read).join('\n');
const e2e = (e2eSrc.match(/await step\(/g) || []).length + 2; // the layout step is a loop over 3 viewports
const cf = (read('e2e/cloudflare-smoke.mjs').match(/await t\(/g) || []).length;
const goldenScenarios = Object.keys(JSON.parse(read('test/fixtures/golden.json'))).length;
const modules = walk('public/js').filter((f) => f.endsWith('.js')).length;
const gwLines = read('gateway/bdix-gateway.mjs').split('\n').length - 1;
const numbers = [[/(\d+) unit and integration tests/g, unit, 'unit/integration test count'], [/(\d+) (?:browser )?end-to-end steps/g, e2e, 'E2E step count'], [/(\d+) Cloudflare[- ]runtime checks/g, cf, 'Cloudflare runtime check count'], [/(\d+) shared scenarios/g, goldenScenarios, 'golden scenario count'], [/(\d+) modules/g, modules, 'JS module count'], [/(\d+) lines\b/g, gwLines, 'gateway line count']];
for (const [re, actual, label] of numbers) {
  const found = [...all.matchAll(re)].map((m) => Number(m[1]));
  check(found.length > 0 && found.every((n) => n === actual), `${label}: docs say [${found.join(', ') || 'nothing'}], actual ${actual}`);
}

// 4. versions + design tokens
const vs = JSON.parse(read('public/vendor/versions.json'));
check(vs.artplayer.includes(pkg.devDependencies.artplayer) && /ArtPlayer 5\.4\.0|ArtPlayer \*\*?5\.4\.0/.test(all), 'ArtPlayer version in docs = package.json = vendor');
check(vs.hls.includes('1.7.4') && all.includes('hls.js 1.7.4') || all.includes('hls.js light'), 'hls.js version documented');
const css = read('public/css/app.css');
for (const [tok, val] of [['--ink', '#0c111b'], ['--panel', '#121a29'], ['--raised', '#1b2538'], ['--line', '#2a364d'], ['--lamp', '#ffb02e'], ['--mint', '#47d7b5']]) check(new RegExp(`${tok}:\\s*${val}`).test(css) && all.includes(val), `design token ${tok} ${val}`);

// 5. env vars documented are real
const code = ['lib/api.js', 'lib/subs.js', 'lib/tmdb.js'].map(read).join('\n');
for (const v of ['TMDB_API_KEY', 'OPENSUBTITLES_API_KEY', 'OPENSUBTITLES_USERNAME', 'OPENSUBTITLES_PASSWORD', 'EDGE_PROXY_HOSTS', 'APP_NAME', 'TMDB_API_BASE']) check(code.includes(v) && all.includes(v), `function env ${v} real and documented`);
const gw = read('gateway/bdix-gateway.mjs');
for (const v of ['HOST', 'PORT', 'GATEWAY_TOKEN', 'ALLOWED_ORIGINS', 'ALLOW_PRIVATE', 'TLS_KEY', 'TLS_CERT']) check(gw.includes('env.' + v) && all.includes(v), `gateway env ${v} real and documented`);

// 6. branding single source
const brand = read('public/js/brand.js');
check(/name: '[^']+'/.test(brand) && all.includes('brand.js') && all.includes('npm run rebrand'), 'branding workflow documented (brand.js + rebrand)');

// 7. hygiene
check(!/\/home\/claude|\/mnt\/user-data|307b[0-9a-f]{20}/.test(all), 'no sandbox paths or key literals in docs');
console.log(`\nFAILURES: ${bad}`);
process.exit(bad ? 1 : 0);

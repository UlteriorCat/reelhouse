#!/usr/bin/env node
// Local development server. Serves public/ and routes /api/* through the SAME handler the Cloudflare Pages Function uses.
// It also applies public/_headers (including the Content-Security-Policy) so what you see locally is what Pages serves.
//   TMDB_API_KEY=... node dev/server.mjs        (PORT defaults to 8788)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleApi } from '../lib/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(here, '../public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

/** Minimal parser for Cloudflare's _headers file: unindented lines are path patterns, indented lines are headers. */
export function parseHeadersFile(text) {
  const rules = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\S/.test(line)) { cur = { pattern: line.trim(), headers: {} }; rules.push(cur); } else if (cur) { const i = line.indexOf(':'); cur.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  return rules;
}
const matches = (pattern, pathname) => (pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern);

export function loadDevVars(file) {
  const env = {};
  try { for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m && m[2]) env[m[1]] = m[2]; } } catch { /* no .dev.vars */ }
  return env;
}

export function createDevServer({ env = process.env, fetchImpl = fetch, publicDir = PUBLIC } = {}) {
  let rules = [];
  try { rules = parseHeadersFile(fs.readFileSync(path.join(publicDir, '_headers'), 'utf8')); } catch { /* optional */ }
  const applyHeaders = (pathname, h) => { for (const r of rules) if (matches(r.pattern, pathname)) Object.assign(h, r.headers); return h; };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        let size = 0;
        for await (const c of req) { size += c.length; if (size > 1_000_000) { res.writeHead(413); return res.end(); } chunks.push(c); }
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
        const r = await handleApi(new Request(url, { method: req.method, headers, body }), env, { fetch: fetchImpl });
        const out = {};
        r.headers.forEach((v, k) => { out[k] = v; });
        if (r.headers.getSetCookie && r.headers.getSetCookie().length) out['set-cookie'] = r.headers.getSetCookie();
        res.writeHead(r.status, out);
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(publicDir, '.' + rel);
      if (!file.startsWith(publicDir + path.sep) && file !== publicDir) { res.writeHead(403); return res.end('Forbidden'); }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, applyHeaders(url.pathname, { 'content-type': 'text/plain' })); return res.end('Not found'); }
      if (path.basename(file) === '_headers' || path.basename(file) === '_routes.json') { res.writeHead(404); return res.end(); }
      res.writeHead(200, applyHeaders(url.pathname, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }));
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500); res.end('Internal error');
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const env = { ...loadDevVars(path.resolve(here, '../.dev.vars')), ...process.env };
  // accounts: a local SQLite file stands in for the D1 database (git-ignored, like wrangler's own local state)
  fs.mkdirSync(path.resolve(here, '../.wrangler'), { recursive: true });
  const { createD1 } = await import('./d1-sqlite.mjs');
  env.DB = createD1(path.resolve(here, '../.wrangler/dev-accounts.sqlite'));
  const port = Number(process.env.PORT || 8788);
  createDevServer({ env }).listen(port, () => {
    console.log(`Reelhouse dev server: http://localhost:${port}`);
    if (!env.TMDB_API_KEY) console.log('  (TMDB_API_KEY is not set: the home page will show the setup notice)');
    console.log(env.ADMIN_USERNAME ? `  accounts: local database; first admin sign-in as ${env.ADMIN_USERNAME} (ADMIN_PASSWORD in .dev.vars)` : '  accounts: local database; set ADMIN_USERNAME / ADMIN_PASSWORD in .dev.vars to create the first admin');
  });
}

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
        const r = await handleApi(new Request(url, { method: req.method }), env, { fetch: fetchImpl });
        const headers = {};
        r.headers.forEach((v, k) => { headers[k] = v; });
        res.writeHead(r.status, headers);
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
  const port = Number(process.env.PORT || 8788);
  createDevServer({ env }).listen(port, () => {
    console.log(`Reelhouse dev server: http://localhost:${port}`);
    if (!env.TMDB_API_KEY) console.log('  (TMDB_API_KEY is not set: the home page will show the setup notice)');
  });
}

// Dev-only: regenerates test/fixtures/golden.json by running the ORIGINAL CloudStream BDIX scrapers
// (from the extension repo, EXT_REPO=/path/to/cloudstream) against the shared scenarios.
// The web app's tests then require the browser providers to reproduce this output (and the same network calls).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { scenarios, tmdbReply } from '../test/fixtures/scenarios.mjs';
const require = createRequire(import.meta.url);
const { run, reply } = require('./extension-harness.cjs');

const golden = {};
for (const sc of scenarios) {
  const { requests, output } = await run(sc.scraper, { tmdbId: sc.meta.tmdbId, mediaType: sc.meta.type, season: sc.meta.season ?? null, episode: sc.meta.episode ?? null }, (rec) => {
    const t = tmdbReply(sc.meta, rec.url);
    if (t) return reply(200, t);
    const r = sc.handler(rec.method, rec.url, rec.body);
    return r ? reply(r.status, r.body, { headers: { 'content-type': r.type } }) : reply(404, 'not found');
  });
  golden[sc.id] = {
    streams: output.map((s) => ({ url: s.url, quality: s.quality })),
    requests: requests.filter((r) => !r.url.startsWith('https://api.themoviedb.org')).map((r) => `${r.method} ${r.url}${r.body ? ' ' + r.body : ''}`).sort(),
  };
  console.log(sc.id.padEnd(26), String(golden[sc.id].streams.length).padStart(2), 'streams,', golden[sc.id].requests.length, 'requests');
}
fs.writeFileSync(new URL('../test/fixtures/golden.json', import.meta.url), JSON.stringify(golden, null, 2) + '\n');
console.log('wrote test/fixtures/golden.json');

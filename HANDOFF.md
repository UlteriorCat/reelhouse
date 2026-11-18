# HANDOFF: start here

**Reelhouse**: a streaming-style website on Cloudflare Pages (`*.pages.dev`, https). It browses TMDB (free key), and plays or downloads titles from **BDIX-only servers** (Bangladesh local network) when the user presses Play or Download. Built-in player (ArtPlayer), OpenSubtitles subtitles, phone/tablet/desktop layout. It is a browser port of the GPL-3.0 "eclipsia-bdix" CloudStream plugin.

## Status

* Built and tested: 70 unit and integration tests, 25 browser end-to-end steps (real Chromium, real gateway, real video files), 8 Cloudflare runtime checks (real `workerd`). Reproduced from a clean extract.
* **Not verified**: the real BDIX servers, FlixHub, TMDB, OpenSubtitles and a live Cloudflare deployment were unreachable during development (mocks used); Firefox/Safari; real phones; https `pages.dev` with the gateway. See `VERIFICATION.md` section 14.
* Key constraint: **Cloudflare cannot reach BDIX**, and an https page cannot freely call http BDIX servers. On `pages.dev` the user normally needs the **gateway** (`gateway/bdix-gateway.mjs`) on their own device or network.

## Read order

1. This file. 2. `CLAUDE.md` (rules, file map, design control, video logic, BDIX limits). 3. The relevant sections of `docs/IMPLEMENTATION.md` (CLAUDE.md has a task-to-section map). 4. `VERIFICATION.md` before touching tests. `README.md` is for the owner (setup, deploy).

## File map

```
public/                  deployed as-is
  index.html  css/app.css  icon.svg  manifest.webmanifest  _headers  _routes.json
  js/brand.js            name, tagline, theme colour, logo path (single source)
  js/main.js router.js api.js store.js net.js player.js streams.js subs.js util.js core.js
  js/providers/          df.js cf.js fh.js (BDIX scrapers ported), common.js, index.js (orchestrator)
  js/ui/                 home details watch browse settings sources shell components
  vendor/                committed player (ArtPlayer), hls.js light, font (versioned, immutable)
functions/api/[[path]].js   the single Pages Function -> lib/api.js
lib/                     api.js (router)  tmdb.js  subs.js   (shared by Function, dev server, tests)
gateway/bdix-gateway.mjs optional proxy for BDIX (Node, zero dependencies)
dev/                     server.mjs (local site + API + _headers)  mock-upstream.mjs
scripts/                 build-vendor  rebrand  check-docs  make-golden  extension-harness
test/                    *.test.mjs  fixtures/ (scenarios, golden.json from the original scrapers)
e2e/                     run.mjs steps2.mjs steps3.mjs lib.mjs helpers.mjs make-media.mjs cloudflare-smoke.mjs
docs/                    IMPLEMENTATION.md  screenshots/
README.md CLAUDE.md HANDOFF.md VERIFICATION.md NOTICE.md LICENSE
```

## Packages needed

Runtime on Cloudflare: **none** (no build step; `public/vendor/` is committed).

Dev/test (exact versions pinned in `package.json`): `artplayer` 5.4.0, `hls.js` 1.7.4, `esbuild` 0.28.2, `@fontsource-variable/bricolage-grotesque` 5.3.0, `linkedom` 0.18.15, `puppeteer-core` 25.17.0, `@sparticuz/chromium` 153.0.0 (Chromium via npm), `wrangler` 4.160.0.

Outside npm: **Node 22+**; **ffmpeg** with libx264/libx265/vpx/aac/ac3/opus for `npm run e2e:media` (e.g. `pip install imageio-ffmpeg --break-system-packages`, then `export FFMPEG=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")`).

## Prepare the environment

```bash
npm ci                    # installs everything incl. Chromium and workerd binaries (no other downloads needed)
npm test                  # 70 tests, ~3 s
npm run e2e:media         # once; writes e2e/media/ (git-ignored)
npm run e2e               # ~4 min; add a word to run matching steps only
npm run smoke:cf          # ~20 s
npm run check:docs        # docs vs code
```

Local site: copy `.dev.vars.example` to `.dev.vars`, set `TMDB_API_KEY`, then `npm run dev` (http://localhost:8788).

Sandbox reminders (details: `VERIFICATION.md` section 3): only npm/PyPI/GitHub/Ubuntu hosts are reachable (use mocks); shell is dash (no `{a,b}`); background processes do not persist between tool calls; never `pkill -f` your own command text; kill orphan `workerd`; `create_file` will not overwrite.

## Deploy and customise (owner tasks)

* Deploy: Cloudflare Pages, build command empty, output directory `public`, secret `TMDB_API_KEY` (README). Run the gateway on a BDIX machine and set `ALLOWED_ORIGINS=https://<project>.pages.dev`.
* Rename / new logo: edit `public/js/brand.js` and replace `public/icon.svg`, then `npm run rebrand` and `npm test` (README section "Change the name or logo").

## Open items

Real-network validation; Firefox/Safari pass; gateway setup helper page; WebAssembly decode fallback for HEVC/DTS; episode list on the watch page. Full list in `CLAUDE.md`.

## Prompt to start a new session

Copy, fill the `<...>` parts, and paste as the first message:

```text
You are continuing work on "Reelhouse", a streaming-style website on Cloudflare Pages that
plays titles from BDIX-only servers. The project is the folder I attached (reelhouse.zip,
extract it and `cd reelhouse`).

READ FIRST, in this order, before changing anything:
1. HANDOFF.md  2. CLAUDE.md  3. the sections of docs/IMPLEMENTATION.md that CLAUDE.md maps to
my task  4. VERIFICATION.md (before touching tests).

SETUP: Node 22+, run `npm ci`, then `npm test` and confirm the baseline (70 passing) before
you change code. For browser tests run `npm run e2e:media` once (needs ffmpeg), then `npm run e2e`.

TASK: <one or two sentences: what I want, and why>

CONTEXT / CONSTRAINTS:
- Hosting: pages.dev (https). BDIX servers are only reachable from my network; use the gateway
  design, never server-side BDIX code.
- <anything specific: devices, browsers, files not to touch, deadlines>

HOW TO WORK:
- Plan first: tell me which files you will change and how you will verify it.
- Write the failing test first, see it fail, then fix (mutation-check logic and security fixes).
- Run `npm test`, the relevant `npm run e2e -- <word>`, and `npm run check:docs`; before finishing
  run the full e2e and look at screenshots for UI changes (phone + desktop).
- Do not weaken browser security flags in the test harness; do not query BDIX outside a user click.
- Update HANDOFF/CLAUDE/IMPLEMENTATION/VERIFICATION where they are affected.

REPORT BACK: what changed (files), what you verified and how (commands + results), what you
could NOT verify, and any bugs found along the way.
```

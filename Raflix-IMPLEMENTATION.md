> **Outdated copy.** The maintained version is `docs/IMPLEMENTATION.md` (it covers the Fendrix/Hexion online sources added in Nov 2026). This file is kept only as uploaded.

# Raflix: implementation notes

How the site was built, which technologies it uses and why, what was measured, what was verified, and what was not. Companion to the README (in the project zip) (setup and deployment) and to the separate *EclipsiaBDIX scraping reference* (how the original CloudStream plugin finds and fetches links).

Contents: [1 Goals](#1-goals-and-constraints) · [2 Architecture](#2-architecture) · [3 Technologies](#3-technologies-and-why) · [4 Data loading](#4-loading-recommended-and-trending-titles-efficiently) · [5 Click-to-stream](#5-click-to-stream-flow) · [6 Providers](#6-the-bdix-providers-port) · [7 Connectivity](#7-connectivity-what-a-browser-can-and-cannot-do) · [8 Player choice](#8-choosing-the-player) · [9 Playback robustness](#9-playback-robustness-measured-in-a-real-browser) · [10 Subtitles](#10-subtitles) · [11 UI and design](#11-ui-and-design-system) · [12 Security](#12-security-model) · [13 Verification](#13-verification) · [14 Performance](#14-performance) · [15 Limits](#15-known-limitations-and-what-was-not-verified) · [16 Licensing](#16-licensing-and-terms) · [17 Extending](#17-extending)

---

## 1. Goals and constraints

| Requirement | How it is met |
|---|---|
| Host on Cloudflare Pages | Static `public/` folder + one Pages Function (`functions/api/[[path]].js`); no build step on Cloudflare (player and font are committed under `public/vendor/`) |
| Modern, streaming-service look; fast; little animation | Dark UI with hero, poster rails and a bottom tab bar on phones; no framework; motion only in response to a tap (sheet slide, press state); skeletons are static; `prefers-reduced-motion` respected |
| Phone, tablet, desktop | One responsive layout driven by CSS variables (`--card-w`, `--pad`) and three breakpoints (560, 768/820, 1280 px); verified at 390, 820 and 1440 px |
| Recommended and trending titles loaded efficiently from TMDB (free key) | One aggregated, trimmed, edge-cached `/api/home` request (section 4) |
| Details, seasons, episodes from TMDB | `/api/title/{type}/{id}` (one TMDB call with `append_to_response`) and `/api/season/{id}/{n}` on demand |
| Query BDIX like the extension, only on click; separate download button | Providers run only from the watch page and the sources sheet; asserted in the browser tests (zero BDIX requests until a click) |
| Efficient built-in player: MP4/MOV, subtitle size/appearance, OpenSubtitles | ArtPlayer, chosen from measurements (section 8); subtitle pipeline in section 10 |
| Document the build | This file |

*Interpretation note:* the request said "customize extension size, appearance, fetch extensions from opensubtitles". This was read as **subtitle** size/appearance and fetching **subtitles** from OpenSubtitles.

## 2. Architecture

```
 Browser (static files from Cloudflare Pages)                      Cloudflare Pages Function  /api/*
 ┌──────────────────────────────────────────────────┐             ┌──────────────────────────────────┐
 │ hash router ─► views (home, details, watch, ...) │  /api/...   │ lib/api.js  (router)             │
 │ store.js   (localStorage: settings, history,     │────────────►│  ├ lib/tmdb.js   TMDB (key stays  │──► api.themoviedb.org
 │             progress, My List)                   │             │  │   server-side, edge-cached)    │
 │ providers/ (DhakaFlix, Circle FTP, FlixHub)      │             │  ├ lib/subs.js   OpenSubtitles /  │──► opensubtitles.com
 │ net.js     direct | gateway | edge transport     │             │  │   Stremio addon, SSRF-guarded  │──► opensubtitles-v3.strem.io
 │ player.js  ArtPlayer (lazy)                      │             │  └ /api/proxy    allow-listed     │──► flixhub.net
 └───────┬──────────────────────┬───────────────────┘             │      public hosts only            │
         │ only after a click   │                                 └──────────────────────────────────┘
         ▼                      ▼
   BDIX servers directly   optional gateway (your network) ─► BDIX servers
   (needs CORS + permission)   Referer/UA, CORS, Range, downloads
```

Principles: (1) **secrets only in the Function**; (2) **BDIX traffic never touches Cloudflare**, because Cloudflare cannot reach private BDIX addresses; (3) **one code path** for the API (`lib/`), shared by the Function, the dev server and the tests; (4) **each view owns its DOM** (section 13, bug 1).

## 3. Technologies and why

| Layer | Choice | Reason |
|---|---|---|
| UI | Vanilla ES modules, `h()` element builder, hash router | No framework runtime (about 37 KB gz of app JS in total); all text goes through `textContent`, so TMDB or file-name strings cannot inject markup; hash routes need no SPA rewrite rules on any static host |
| Styling | One CSS file with design tokens (CSS variables) | 5 KB gz; no build step |
| Font | Bricolage Grotesque variable, latin subset, self-hosted (41 KB) | Distinctive heavy display weights for titles, readable at UI sizes; one family, `font-display: swap`, preloaded |
| API | Cloudflare Pages Function (Workers runtime) | Hides the TMDB key; edge cache; scoped to `/api/*` by `_routes.json` |
| Player | ArtPlayer 5.4.0 (MIT), hls.js 1.7.4 light (Apache-2.0, lazy) | Section 8 |
| Gateway | Node 22, `node:http`, zero dependencies | Easy to run anywhere on a BDIX network |
| Tests | `node:test`; Puppeteer + Chromium 153; wrangler/workerd | Real browser, real sockets, real runtime |
| Bundling | esbuild, only for `public/vendor/` | Output is committed and versioned (`artplayer-5.4.0.js`), so it can be cached as `immutable` |

## 4. Loading recommended and trending titles efficiently

TMDB is free for non-commercial use with an API key and attribution (the footer carries the required notice).

* **One request for the home page.** `/api/home` makes five parallel TMDB calls inside the Function (trending, popular movies, popular series, top-rated movies, top-rated series), drops everything the UI does not draw (items without posters, people, most fields), and returns one compact JSON document. The browser makes one round trip instead of five.
* **Three cache layers.** TMDB responses are cached at Cloudflare's edge (`cf.cacheTtl`, 15 minutes for trending/popular, 1 hour for top-rated and details); the Function's responses carry `s-maxage`/`stale-while-revalidate`; the browser keeps the home payload in `localStorage` and paints it instantly on the next visit while refreshing in the background.
* **Lazy and personalised.** "Because you watched ..." fetches `/api/recs` only when its row approaches the viewport (`IntersectionObserver`). Cast and recommendations on the details page arrive with the details (`append_to_response=credits,recommendations,videos,external_ids`), episodes load per season on demand.
* **Images.** Posters use `srcset` with TMDB's real sizes (`w185/w342/w500`), `loading="lazy"`, explicit width/height (no layout shift); the hero image is `fetchpriority="high"`. Episode stills use only `w185/w300` (a test caught an invalid `w780` request).
* **Free-plan friendly.** The Function only trims JSON (expected to be well under the free plan's 10 ms CPU per request, though this was not measured on Cloudflare); edge caching means most requests never reach TMDB; static assets are not metered.

## 5. Click-to-stream flow

```
details page ── Play ──► #/watch/movie/603
                         │  1. api.title()                     (TMDB, cached)
                         │  2. resolveStreams() in parallel:   DhakaFlix ×4 POST · Circle FTP · FlixHub
                         │     settle window: once any provider has streams, wait ≤1.5 s for the rest
                         │  3. rank(): playable first → resolution → container → provider
                         │  4. createPlayer(best) ─► health monitor ─► fallback / banner
                         └  5. subtitles auto-load (OpenSubtitles) · progress saved every 5 s and on pause
details page ── Download ──► sources sheet: same lookup (waits for all providers), ticket list, no playback
```

* Nothing in steps 2-5 runs while browsing. The browser tests assert that the BDIX mock server has seen **zero requests** after loading home, search and details pages.
* **Settle window.** A dead server can take 15-25 s to time out. Without a window the player would wait for it even when another provider already has a working file. With it, slow providers are aborted and reported as "still searching"; the Sources sheet can still show them later.
* **Failure explanation.** The original extension swallowed every error. Here each provider's result is classified: *ok*, *empty* (servers answered, nothing matched), *error* (HTTP errors), *unreachable* (every request failed at the network level), *timeout*, *slow*. The UI turns that into advice (not on BDIX? mixed content? set up the gateway).

## 6. The BDIX providers (port)

`public/js/providers/{df,cf,fh}.js` are a browser port of the three scrapers in `eclipsia-bdix` (see the scraping reference for the original algorithms: endpoints, request bodies, filters, scoring).

**How faithfulness was proven.** `scripts/make-golden.mjs` runs the *original* scrapers (via a harness that reproduces the plugin's JS runtime contract) against 14 shared scenarios and records their output **and the exact network calls they make**; `test/providers.test.mjs` requires the port to produce identical streams (URL, quality, order) and an identical sorted list of requests for every scenario. Scenarios include: variant precedence, the unanchored `S01E020` quirk, punctuation stripping, host fallback, slug fallback, episode cards vs. link fallback, and all failure paths.

**Deliberate differences** (all documented in code and tested separately):

| Difference | Why |
|---|---|
| No per-provider TMDB call | The page already has the title and year |
| `.mov`, `.m4v`, `.webm` accepted (switch: "Original file types only") | The original silently dropped `.mov` files |
| Same URL from two providers becomes one entry, keeping the one that knows the resolution | Found by the end-to-end run: "first wins" lost the quality at random depending on which provider answered first |
| FlixHub uses `DOMParser` instead of a hand-written tag scanner | Browsers have a DOM; the parser is inert (scripts never run, nothing loads) |
| Richer release parsing (video/audio codec tokens) | Drives the playability prediction in section 9 |
| Browsers cannot send `User-Agent`/`Referer` | The gateway adds them (section 7) |
| Endpoints are overridable objects | Lets tests and advanced users repoint servers |

Provider endpoints: DhakaFlix `http://172.16.50.12` and `.14` (JSON `POST`), Circle FTP `http://new.circleftp.net:5000` with fallback `http://15.1.1.50:5000` (REST `GET`), FlixHub `https://flixhub.net` (HTML watch pages).

## 7. Connectivity: what a browser can and cannot do

A website cannot do what the Android plugin does. The constraints, and how each is handled:

| Constraint | Effect | Handling |
|---|---|---|
| Cloudflare cannot reach private BDIX IPs | A server-side proxy on Pages is useless for BDIX | Lookups run in the browser or in a gateway on your network |
| **CORS**: servers must send `Access-Control-Allow-Origin` | Without it the browser hides the response | Settings → *Test connection* distinguishes "reachable but blocked by CORS" (an opaque `no-cors` probe succeeds) from "unreachable"; gateway adds CORS |
| **Mixed content**: https page → http server | Blocked | Gateway on `http://127.0.0.1`, gateway with TLS, or an http custom domain. Per Chrome's Local Network Access documentation, Chrome 142+ asks permission for requests from public sites to private IP literals and relaxes mixed-content blocking for them; hostnames and public IPs (`new.circleftp.net`, `15.1.1.50`) do not qualify |
| `Referer`, `User-Agent` cannot be set | Servers that check them refuse | Gateway injects the extension's UA and a per-host Referer |
| `<video>` cannot send headers | Same | Gateway `/s` endpoint streams with them |
| Cross-origin downloads ignore `download=` | Browser may play instead of save | Gateway `?dl=1` sets `Content-Disposition: attachment` |

**Gateway design** (`gateway/bdix-gateway.mjs`, 252 lines, no dependencies): `POST /p` takes a JSON envelope for small lookups (sent as `text/plain` so the browser does not need a preflight); `GET /s` streams media and forwards `Range`; every request needs a token unless bound to loopback; a non-loopback bind without a token refuses to start. **SSRF protection** mirrors the extension's address policy: addresses are classified as *public*, *private* (only if allow-listed), or *never* (link-local, metadata, multicast, unspecified). DNS results are validated at connect time (defeats rebinding), IP literals are validated up front (Node skips `lookup` for literals), redirects are re-validated per hop, and IPv6 is parsed to bytes so IPv4-mapped, NAT64 and 6to4 forms cannot smuggle a private address.

## 8. Choosing the player

Requirements: efficient, MP4/MOV, subtitle styling, OpenSubtitles, "feature packaged", customisable.

Facts gathered (npm registry and package contents, November 2026):

| Candidate | Status | Size (measured) | Verdict |
|---|---|---|---|
| **ArtPlayer 5.4.0** | MIT, releases every few months (5.3.0 Sep 2025, 5.4.0 Mar 2026); single maintainer | **141 KB / 36 KB gz**, one file, no dependencies | **Chosen**: ships a settings panel (speed, aspect, subtitle offset, extensible), subtitle renderer with style API, PiP, fullscreen, gestures, mini progress bar, hotkeys, HLS hook |
| Video.js 10.3.0 | Current `latest`; v8 kept as `latest-8` | Player + default skin bundled with esbuild: **573 KB / 125 KB gz** (core 341 KB, skin 199 KB); can be trimmed by building a custom skin | Strong long-term choice, but heavier and subtitle styling would be custom work (captions use native `::cue`) |
| Plyr 3.8.5 | **Deprecated** on npm (security updates only); merged into Video.js 10 | - | Rejected |
| Vidstack 1.15.7 | **Deprecated** on npm (security fixes until 2028); merged into Video.js 10 | - | Rejected |
| Media Chrome | Active; building block merged into Video.js 10 | - | Not a packaged player |

**Decision:** ArtPlayer for size and built-in features. The risk (single maintainer) is contained: only `public/js/player.js` and `scripts/build-vendor.mjs` know about it; everything else talks to a small controller (`switchTo`, `addSubtitle`, `selectSubtitle`, `focus`, `destroy`). Video.js 10 is the migration target.

MOV/MP4 note: containers are handled by the **browser**, not the player library, so "excellent MP4/MOV support" is really a browser-codec question; see section 9.

## 9. Playback robustness (measured in a real browser)

Experiment: real files generated with ffmpeg, served with Range support under different `Content-Type`s, played in Chromium 153.

| File | Result |
|---|---|
| MP4, H.264 + AAC | plays |
| **MOV**, H.264 + AAC | plays with any `Content-Type`, including `application/octet-stream` and `video/quicktime`, even though `canPlayType('video/quicktime')` returns `""` |
| **MKV**, H.264 + AAC | plays with any `Content-Type` |
| MP4, **HEVC** | metadata loads, picture is **0×0, no error event** |
| MKV, H.264 + **AC-3** audio | video plays, **zero audio bytes decoded, no error** |

Consequences built into the app:

* **Never gate on `canPlayType`** for MOV/MKV.
* **Prediction before playing** (`streams.js`): file names are parsed for video codec and audio codecs; sources are ranked *playable → risky → unlikely* (HEVC when the browser cannot decode it, AVI, XviD, MKV on Safari/iOS, files whose only audio is DD+/AC-3/TrueHD/DTS), then by resolution, container friendliness (MP4 > MOV > MKV) and provider. The default pick is therefore the best file the browser can most likely play, not the biggest. A setting switches back to pure quality order.
* **Health monitor after starting** (`player.js`): `videoWidth === 0` after metadata → video unsupported; no decoded audio after 2.5 s of playback (`webkitAudioDecodedByteCount`, `mozHasAudio`) → audio unsupported; media error or 25 s without metadata → failure. Video failures switch to the next playable source automatically (with a toast); silent audio shows a banner offering another source, an external player or a download.
* **External players**: Android intents (VLC, MX Player), iOS `vlc-x-callback` / Infuse, and an `.m3u` playlist for VLC, mpv or PotPlayer on desktop. The URL given is the gateway URL when a gateway is configured.
* **Not supported:** software decoding of HEVC/DTS/AC-3 in the browser (would need WebAssembly ffmpeg; large and slow on phones). The fallbacks above are the practical answer.

## 10. Subtitles

* **Search** `/api/subs`: OpenSubtitles.com API v1 when `OPENSUBTITLES_API_KEY` is set (TMDB id, or parent id + season + episode; lowercase, alphabetically sorted query as the API expects; descriptive `User-Agent`), otherwise the keyless Stremio OpenSubtitles v3 addon by IMDb id. Languages are normalised (ISO 639-2 → 639-1).
* **Download** `/api/sub`: OpenSubtitles needs login + `POST /download` → temporary link; the Function does that. Only `https` links on `opensubtitles.org/.com` or `strem.io` (exact suffix match) are fetched; 2 MB cap; gzip handled.
* **Decoding** (`subs.js`): BOM, strict UTF-8, otherwise Windows-1252 (the usual legacy SRT encoding; verified with a `Café` file), then SRT → WebVTT (timestamps padded, ASS tags and `<font>` removed, `<b> <i> <u>` kept).
* **Auto-load** the first result in your preferred language; **Subtitles** button for other languages; **upload** a `.srt`/`.vtt` from the device.
* **Appearance**: size (50-250 %, scaled to the player width so phones and monitors both look right), height from the bottom, colour, background (none / shadow / box). Available in the player's settings panel and in the site settings with a live preview; stored per device. ArtPlayer's own offset slider adjusts timing.
* **Shortcuts**: Space, ←/→, ↑/↓ (ArtPlayer) plus M mute, C captions, F fullscreen. ArtPlayer keys its table by `KeyboardEvent.code` and only after a click inside the player; the app enables shortcuts on load and after any sheet closes.

## 11. UI and design system

* **Palette**: `ink #0c111b` page, `panel #121a29`, `raised #1b2538`, `line #2a364d`, text `#eef1f6` / `#9ba8c0`; one action colour, **lamp amber `#ffb02e`** (the projector bulb); mint `#47d7b5` only for "ready" status.
* **Type**: Bricolage Grotesque, heavy tight-tracked weights for titles, regular for UI. No all-caps eyebrow labels, no dot-joined meta strings (chips and spacing instead).
* **Memorable element**: the **source ticket**: a quality "stub" (`1080p / MP4`) with a dashed perforation, then file name, provider, codec/audio tags and a playability warning. Only the recommended ticket gets the amber button.
* **Layout**: hero that leaves the first poster row visible on every viewport; scroll-snap rails (arrows on hover-capable desktops); bottom tab bar below 768 px, top navigation above; episode rows with stills and per-episode Play/Download; sheets are bottom sheets on phones and side drawers on desktop (native `<dialog>`: focus trap, Esc, inert background).
* **Motion**: sheet slide (0.18 s) and press state only; no autoplay carousels, parallax or shimmer.
* **Identity**: the product name, tagline and theme colour are defined once in `public/js/brand.js`; the logo is the file `public/icon.svg` (header, favicon, app icon). `npm run rebrand` syncs `index.html` and the manifest, and `test/brand.test.mjs` fails on drift or on a hardcoded name (change the name and see the README).
* **Accessibility** (asserted in tests): every control has an accessible name, all images have `alt`, one `h1` per page, skip link is the first Tab stop, visible focus ring, 44 px touch targets, reduced-motion support.

## 12. Security model

* **Secrets** (TMDB key, OpenSubtitles key/login) exist only in the Function's environment; tests assert they never appear in any response.
* **CSP** (`public/_headers`, applied by the dev server and verified under workerd): `default-src 'self'`, scripts from self only, images from self and `image.tmdb.org`, `object-src 'none'`, `frame-ancestors 'none'`. `connect-src` and `media-src` allow `http:`/`https:` because BDIX hosts and your gateway are user-specific; the browser's own mixed-content rules still apply. `'unsafe-inline'` is allowed for styles only (the player sets inline styles).
* **No HTML injection**: DOM is built with `textContent`; provider HTML is parsed with an inert `DOMParser`.
* **SSRF**: three independent guards (edge proxy host allow-list; subtitle host suffix allow-list; gateway address policy), each with tests, including the bypasses found during development (section 13).
* **Gateway**: token required off-loopback, constant-time comparison, header allow-list (it forwards only `user-agent`, `referer`, `accept`, `accept-language`, `content-type`, `range`), CORS origin allow-list, filename sanitising for `Content-Disposition`.

## 13. Verification

| Suite | Count | What it proves |
|---|---|---|
| Unit / integration (`npm test`) | 70 | API router and TMDB slimming, key handling, error mapping, subtitle service and SSRF guards; gateway (auth, envelope, Range, CORS, downloads, address matrix); **providers vs. golden output of the original scrapers (14 scenarios, same requests)**; orchestration (failure classes, timeouts, cancel, settle window, dedupe); client logic (store, ranking, playability, subtitle conversion, router, API client) |
| Browser end-to-end (`npm run e2e`) | 25 browser end-to-end steps | Real Chromium 153 with a mock BDIX server on real sockets, real test videos, the real gateway. See list below |
| Cloudflare runtime (`npm run smoke:cf`) | 8 Cloudflare runtime checks | `wrangler pages dev` (workerd): bundling of the Function with `../../lib` imports, `_headers`, `_routes.json`, validation, SSRF guards, no key leakage |

E2E coverage: home/search/details/My List; layouts at 390/820/1440 px; **zero BDIX requests until a click**; download sheet (4 parallel POSTs, ranking, warnings, anchors, clipboard API and fallback, `.m3u`); playback of MP4, MOV and MKV with sound; resume, Continue watching, next episode; HEVC and AC-3 detection with fallback; subtitles (auto-load, Latin-1, size/height/colour/background, language search, upload, Off); gateway mode (UA injected, Range proxied, attachment download, token enforced); unreachable and CORS-blocked servers; settings effects; Android/iOS/desktop external-player links; route errors; missing-API-key setup notice; lazy loading and byte budget; accessibility; keyboard shortcuts; 8 cold-start navigation races; phone portrait/landscape and tablet layouts. The run fails on any browser console error or CSP violation (there are none).

**Test environment honesty.** The packaged `@sparticuz/chromium` starts with `--disable-web-security`, `--allow-running-insecure-content` and site-isolation flags (it targets AWS Lambda). An early E2E run was green *with CORS switched off*, which made direct-mode results meaningless. The harness now strips those flags, and the whole suite was re-run and passes with real CORS enforcement.

**Mutation checks.** For three security/logic fixes the code was deliberately reverted to confirm the test fails (host-suffix regex, abort handling, duplicate-URL choice).

**Bugs found by testing, and fixed:**

1. *Navigation race*: leaving the home page mid-download made the API client resolve `null` (an aborted body read was swallowed and even cached); the home view then crashed and overwrote the new page. Found by cold-start stress (2 of 5 runs failed). Fixes: abort/parse errors propagate; every navigation gets its own detached view container; regression tests.
2. *Gateway SSRF, IP literals*: Node skips `lookup` for IP-literal hosts, so `http://169.254.169.254/` bypassed DNS-time checks. Literals are now validated up front.
3. *Gateway SSRF, IPv6*: the URL parser rewrites `[::ffff:127.0.0.1]` as `::ffff:7f00:1`, which a dotted-only pattern classified as public. IPv6 is now parsed to bytes (mapped, NAT64, 6to4 handled).
4. *Copy link on plain-http sites*: `navigator.clipboard` does not exist there, and the legacy fallback was inert inside a modal `<dialog>` (everything outside is inert) and unfocused (iOS needs focus). Fixed and tested on both paths.
5. *Resume positions lost on native pause* (media keys, headset): ArtPlayer's `pause` event fires only for `art.pause()`; now `video:pause` is used.
6. *Dead shortcuts*: hotkeys were registered as `'m'`, `'c'`, `'f'`, but ArtPlayer keys by `event.code` and enables them only after a click inside the player.
7. *"Box" subtitle background did nothing*: the CSS variable was set but no rule consumed it.
8. *Invalid TMDB image size* (`w780` for episode stills).
9. *Duplicate sources lost resolution* depending on provider response order.
10. *Audio labels*: the original `DDP5.1` pattern missed the common `DDP5.1` spelling (display only).
11. Smaller UX fixes: hero crowded out the first rail; three watch-page buttons wrapped; notices inside sheets had dim headings; Subtitle tooltip ran into its label; slow providers delayed playback (settle window).

## 14. Performance

Measured in the E2E run (desktop viewport, local server):

| Item | Size |
|---|---|
| App JavaScript (24 modules, unminified) | 118 KB raw, **37 KB gzipped** |
| CSS | 21 KB raw, 5 KB gzipped |
| Font | 41 KB (woff2) |
| ArtPlayer (loaded on the watch page only) | 141 KB raw, 36 KB gzipped |
| hls.js light (loaded only if an HLS source is chosen) | 369 KB raw, 117 KB gzipped |
| Home page | 68 requests including posters and the logo; `DOMContentLoaded` about 130-190 ms locally |
| Watch page: player mounted / video playing (mock sources) | about 0.2 s / 1.3 s after the click |

The tests assert that the player libraries are **not** requested on the home page and that hls.js is not requested for an MP4. Real-world figures depend on TMDB/CDN latency and on the BDIX servers.

## 15. Known limitations and what was not verified

* **No live service was reachable from the build environment**: the BDIX servers, FlixHub, TMDB, OpenSubtitles and a real Cloudflare deployment. TMDB, Stremio and FlixHub are mocked with the documented response shapes; BDIX response shapes are inferred from the original parsers. Run *Test connection* and a real title on your network before relying on it.
* **Only Chromium was automated.** Firefox and Safari behaviour (mixed content, `webkitAudioDecodedByteCount` equivalents, MKV, hotkeys) is by design/reading, not by test. The audio-silence check relies on `webkitAudioDecodedByteCount` (Chromium/WebKit) and `mozHasAudio` (Firefox).
* **Real devices, https and Chrome's Local Network Access prompt flow** were not exercised; tests run over http on loopback. The mixed-content/permission statements come from Chrome's documentation and general browser rules.
* **Headless audio**: "audio is decoding" is measured by decoded byte counts, not by listening.
* Edge caching (`cf.cacheTtl`) and the free-plan quotas were not exercised on Cloudflare itself; the local runtime ignores the cache hint.
* HEVC/DTS/AC-3 cannot be decoded in the browser; the app detects and works around them but cannot fix them.
* The gateway is a plain proxy for your own network, not an authentication system; use a token and do not expose it to the internet.
* Provider selectors may need updating if the servers or FlixHub's markup change; the golden-output tests and `make-golden.mjs` make that a mechanical change.

## 16. Licensing and terms

* **The provider modules are derived from GPL-3.0 code** (`eclipsia-bdix` / the CloudStream extension repository). If you publish a site that serves them to visitors, GPL-3.0 applies to that code: keep the notices, and make the corresponding source available under GPL-3.0. The simplest consistent choice, taken here, is to license the whole project GPL-3.0 (`LICENSE`, `NOTICE.md`). The other dependencies (ArtPlayer MIT, hls.js Apache-2.0, Bricolage Grotesque OFL, dev tools MIT/Apache) are compatible. This is information, not legal advice.
* **TMDB**: free key for non-commercial use; the attribution notice must stay visible. Commercial use needs a TMDB agreement.
* **OpenSubtitles**: use an API key per their terms; downloads are quota-limited.
* **Content**: this project hosts no media. What the BDIX servers offer, and your right to access it, are your responsibility under local law and the servers' own terms.

## 17. Extending

* **Add a provider**: create `public/js/providers/<id>.js` exporting `id`, `name`, `search(meta, ctx, opts)` returning streams built with `makeStream()`; register it in `providers/index.js`; add scenarios to `test/fixtures/scenarios.mjs` and expectations to the tests. Use `ctx.json/ctx.text`, which classify failures for the UI.
* **Change the player**: implement the same controller in `player.js` (`switchTo`, `addSubtitle`, `selectSubtitle`, `focus`, `applySubStyle`, `destroy`) and update `scripts/build-vendor.mjs`.
* **Change server addresses**: edit the constants at the top of each provider, or repoint at runtime through the exported `endpoints`/`SERVERS` objects.
* **Update vendor files**: change versions in `package.json`, `npm install`, `npm run build:vendor`, commit `public/vendor/`.

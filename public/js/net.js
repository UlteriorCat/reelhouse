// Network transport. A browser cannot set Referer/User-Agent, is bound by CORS and blocks http:// from https:// pages,
// so requests can travel three ways:
//   gateway : your own bdix-gateway (recommended for BDIX hosts)   POST {gateway}/p  (JSON envelope)
//   edge    : the Pages Function /api/proxy, for public HTTPS hosts that lack CORS (FlixHub)
//   direct  : straight from the browser (works if the host sends CORS headers and the page may reach it)
// A provider (or stream) marked `direct: true` always goes straight from the browser, even when a gateway is set:
// its hosts are public and send CORS headers, so a detour would only add latency (and, for HLS, break relative URLs).

export class NetError extends Error {
  constructor(message, kind = 'network', cause) {
    super(message);
    this.name = 'NetError';
    this.kind = kind;
    this.cause = cause;
  }
}

function withTimeout(signal, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), ms);
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  return { signal: ctrl.signal, done: () => { clearTimeout(timer); signal && signal.removeEventListener('abort', onAbort); } };
}

const trimSlash = (s) => String(s || '').replace(/\/+$/, '');
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * @param {() => {gatewayUrl?: string, gatewayToken?: string, edge?: boolean}} getCfg  read lazily so settings changes apply instantly
 * @param {typeof fetch} fetchImpl
 */
export function createNet(getCfg, fetchImpl = (...a) => globalThis.fetch(...a), opts = {}) {
  const edgeBase = opts.edgeBase ?? '';
  const nativeHls = opts.nativeHls || (() => true); // does this browser play HLS itself (no Origin on media requests)?
  const mode = (provider) => {
    const c = getCfg();
    if (provider && provider.direct) return 'direct';
    if (trimSlash(c.gatewayUrl)) return 'gateway';
    if (provider && provider.edge && c.edge !== false) return 'edge';
    return 'direct';
  };

  async function request(url, { method = 'GET', headers = {}, body, signal, provider, timeoutMs = 15000 } = {}) {
    const c = getCfg();
    const m = mode(provider);
    const t = withTimeout(signal, timeoutMs);
    try {
      if (m === 'gateway') {
        const q = c.gatewayToken ? `?k=${encodeURIComponent(c.gatewayToken)}` : '';
        // text/plain keeps this a CORS "simple request" (no preflight round trip)
        return await fetchImpl(`${trimSlash(c.gatewayUrl)}/p${q}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ url, method, headers, body }), signal: t.signal, credentials: 'omit' });
      }
      if (m === 'edge' && method === 'GET') {
        return await fetchImpl(`${edgeBase}/api/proxy?u=${encodeURIComponent(url)}`, { signal: t.signal, credentials: 'omit' });
      }
      return await fetchImpl(url, { method, headers, body, signal: t.signal, referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store' });
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw e;
      throw new NetError(`Request failed (${m})`, 'network', e);
    } finally { t.done(); }
  }

  /**
   * URL to hand to <video> or an <a download>. Through the gateway when configured, else the raw URL.
   * `direct` streams skip the gateway, except one case: `player` (the in-page player) asks for an HLS stream whose CDN
   * refuses page origins (`needsNativeHls`) and this browser has no built-in HLS (Firefox): only the gateway can fetch it.
   * HLS through the gateway gets `hls=1`, so playlists come back with their URIs rewritten to the gateway as well.
   */
  function mediaUrl(stream, { download = false, filename, player = false } = {}) {
    const c = getCfg();
    const gw = trimSlash(c.gatewayUrl);
    const rescue = player && !download && stream.needsNativeHls && !nativeHls();
    if (!gw || (stream.direct && !rescue)) return stream.url;
    const p = new URLSearchParams({ u: stream.url });
    if (c.gatewayToken) p.set('k', c.gatewayToken);
    if (stream.headers && Object.keys(stream.headers).length) p.set('h', b64url(JSON.stringify(stream.headers)));
    if (download) { p.set('dl', '1'); if (filename) p.set('n', filename); } else if (stream.container === 'm3u8') p.set('hls', '1');
    return `${gw}/s?${p}`;
  }

  /** Diagnose why a host can't be used: 'ok' | 'cors' (reachable but unreadable) | 'unreachable' (blocked, offline, mixed content, ...) | 'auth' | 'blocked' (gateway only). */
  async function diagnose(url, { signal } = {}) {
    const c = getCfg();
    const t = withTimeout(signal, 8000);
    try {
      if (trimSlash(c.gatewayUrl)) {
        const res = await request(url, { signal: t.signal, timeoutMs: 8000 });
        if (res.status === 401) return 'auth';      // wrong or missing gateway token
        if (res.status === 403) return 'blocked';   // gateway refused the address (not allowlisted)
        return res.status < 500 ? 'ok' : 'unreachable';
      }
      try { await fetchImpl(url, { signal: t.signal, referrerPolicy: 'no-referrer', credentials: 'omit' }); return 'ok'; } catch (e) {
        if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) return 'unreachable';
        try { await fetchImpl(url, { mode: 'no-cors', signal: t.signal, referrerPolicy: 'no-referrer', credentials: 'omit' }); return 'cors'; } catch { return 'unreachable'; }
      }
    } catch { return 'unreachable'; } finally { t.done(); }
  }

  return { request, mediaUrl, diagnose, mode };
}

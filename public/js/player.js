// The player. ArtPlayer is loaded on demand (36 KB gzipped) and hls.js only if an HLS source is actually chosen.
// Everything outside this file is player-agnostic, so swapping the library later only touches this module.
import { subtitleStyle, SUB_COLORS } from './subs.js';

let vendor;
const vendorFiles = () => (vendor ||= fetch('/vendor/versions.json').then((r) => r.json()));
let artPromise;
export const loadArtplayer = () => (artPromise ||= vendorFiles().then((v) => import(/* @vite-ignore */ '/vendor/' + v.artplayer)).then((m) => m.default));
let hlsPromise;
const loadHls = () => (hlsPromise ||= vendorFiles().then((v) => import(/* @vite-ignore */ '/vendor/' + v.hls)).then((m) => m.default));

const BG_CHOICES = [['none', 'None'], ['shadow', 'Shadow'], ['box', 'Box']];

/**
 * @param o.container  element to mount into
 * @param o.streams    ranked streams; o.index selects the first one to try
 * @param o.net        transport (gives the playable URL: direct or through the gateway)
 * @param o.prefs      () => settings object (read fresh so changes apply immediately)
 * @param o.save       (patch) => persist settings
 * @param o.cb         {onProgress, onEnded, onIssue, onFindSubtitles, onNext, onSourceChange}
 */
export async function createPlayer(o) {
  const Art = await loadArtplayer();
  let current = o.streams[o.index || 0];
  let destroyed = false;
  let subs = []; // {id, label, url}
  let activeSub = null;
  let lastReport = 0;
  const issues = new Set();
  let metaTimer = null;
  let cleanupMonitor = () => {};
  let reportIssue = () => {};

  const urlFor = (s) => o.net.mediaUrl(s, { player: true });
  const nativeHls = () => document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';

  const art = new Art({
    container: o.container,
    url: urlFor(current),
    type: current.container === 'm3u8' ? 'm3u8' : '',
    poster: o.poster || '',
    volume: 0.8,
    autoplay: true,
    pip: true,
    setting: true,
    playbackRate: true,
    aspectRatio: true,
    fullscreen: true,
    subtitleOffset: true,
    miniProgressBar: true,
    mutex: true,
    backdrop: false,
    playsInline: true,
    autoPlayback: false,
    lock: true,
    gesture: true,
    fastForward: true,
    autoOrientation: true,
    hotkey: true,
    theme: '#ffb02e',
    lang: 'en',
    subtitle: { url: '', type: 'vtt', escape: true },
    customType: {
      m3u8(video, url, a) {
        if (nativeHls()) { video.src = url; return; }
        loadHls().then((Hls) => {
          if (destroyed) return;
          if (a.hls) a.hls.destroy();
          const hls = new Hls({ enableWorker: true });
          // hls.js network failures never fire <video> 'error': report them (IMPLEMENTATION section 9)
          hls.on(Hls.Events.ERROR, (_, data) => { if (data && data.fatal && a.hls === hls) reportIssue('error', data.details); });
          hls.loadSource(url);
          hls.attachMedia(video);
          a.hls = hls;
          a.once('destroy', () => hls.destroy());
        });
      },
    },
    settings: [],
  });

  // ---------------- subtitles ----------------
  function applySubStyle() {
    const p = o.prefs().subStyle;
    const css = subtitleStyle(p, art.template.$player.clientWidth || 960);
    art.subtitle.style({ fontSize: css.fontSize, color: css.color, textShadow: css.textShadow });
    art.template.$player.style.setProperty('--rh-sub-bg', css.background);
    art.template.$player.style.setProperty('--rh-sub-bottom', css.bottomPct + '%');
    art.cssVar('--art-subtitle-bottom', css.bottomPct + '%');
  }

  function rebuildSettings() {
    const prefs = o.prefs();
    const items = [
      {
        name: 'source', html: 'Source', tooltip: srcLabel(current),
        selector: o.streams.map((s) => ({ html: srcLabel(s) + (s.play && s.play.level !== 'ok' ? ' (may not play)' : ''), stream: s, default: s.id === current.id })),
        onSelect(item) { controller.switchTo(item.stream); return item.html; },
      },
      {
        name: 'subs', html: 'Subtitles', tooltip: activeSub ? (activeSub.short || activeSub.label) : 'Off',
        selector: [
          { html: 'Off', value: null, default: !activeSub },
          ...subs.map((s) => ({ html: s.label, value: s, default: activeSub && activeSub.id === s.id })),
          { html: 'Find subtitles\u2026', value: 'find' },
        ],
        onSelect(item) {
          if (item.value === 'find') { o.cb.onFindSubtitles && o.cb.onFindSubtitles(); return activeSub ? activeSub.label : 'Off'; }
          controller.selectSubtitle(item.value);
          return item.html;
        },
      },
      {
        name: 'subsize', html: 'Subtitle size', tooltip: prefs.subStyle.size + '%', range: [prefs.subStyle.size, 50, 250, 10],
        onChange(item) { o.save({ subStyle: { size: item.range[0] } }); applySubStyle(); return item.range[0] + '%'; },
      },
      {
        name: 'subpos', html: 'Subtitle height', tooltip: prefs.subStyle.bottom + '%', range: [prefs.subStyle.bottom, 2, 30, 1],
        onChange(item) { o.save({ subStyle: { bottom: item.range[0] } }); applySubStyle(); return item.range[0] + '%'; },
      },
      {
        name: 'subcolor', html: 'Subtitle color', tooltip: (SUB_COLORS.find((c) => c[0] === prefs.subStyle.color) || SUB_COLORS[0])[1],
        selector: SUB_COLORS.map(([value, label]) => ({ html: label, value, default: value === prefs.subStyle.color })),
        onSelect(item) { o.save({ subStyle: { color: item.value } }); applySubStyle(); return item.html; },
      },
      {
        name: 'subbg', html: 'Subtitle background', tooltip: (BG_CHOICES.find((c) => c[0] === prefs.subStyle.bg) || BG_CHOICES[1])[1],
        selector: BG_CHOICES.map(([value, label]) => ({ html: label, value, default: value === prefs.subStyle.bg })),
        onSelect(item) { o.save({ subStyle: { bg: item.value } }); applySubStyle(); return item.html; },
      },
    ];
    for (const it of items) { if (art.setting.find(it.name)) art.setting.update(it); else art.setting.add(it); }
  }
  const srcLabel = (s) => [s.quality && s.quality !== 'Unknown' && s.quality !== 'auto' ? s.quality : '', s.container !== 'unknown' ? s.container.toUpperCase() : '', s.providerName].filter(Boolean).join(' ');

  // ---------------- health monitor ----------------
  // Browsers report HEVC as a 0x0 picture and unsupported audio as silence WITHOUT firing an error, so check explicitly.
  function monitor(stream) {
    cleanupMonitor();
    const v = art.video;
    const issue = (kind, detail) => {
      const key = stream.id + kind;
      if (issues.has(key) || destroyed) return;
      issues.add(key);
      o.cb.onIssue && o.cb.onIssue({ kind, stream, detail });
    };
    reportIssue = issue;
    clearTimeout(metaTimer);
    metaTimer = setTimeout(() => { if (v.readyState < 1) issue('timeout'); }, 25000);
    let audioChecked = false;
    const onMeta = () => {
      clearTimeout(metaTimer);
      if (v.videoWidth === 0 && v.videoHeight === 0 && !(stream.container === 'mp3')) issue('video-unsupported');
    };
    const onErr = () => issue('error', v.error && v.error.code);
    const onTime = () => {
      if (audioChecked || v.paused || v.currentTime < 2.5 || v.muted) return;
      audioChecked = true;
      const decoded = v.webkitAudioDecodedByteCount;
      if (decoded === 0 || v.mozHasAudio === false) issue('audio-unsupported');
    };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('error', onErr);
    v.addEventListener('timeupdate', onTime);
    cleanupMonitor = () => { reportIssue = () => {}; clearTimeout(metaTimer); v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('error', onErr); v.removeEventListener('timeupdate', onTime); };
  }

  // ---------------- lifecycle wiring ----------------
  let resumeAt = o.startAt || 0;
  art.on('video:loadedmetadata', () => {
    if (resumeAt > 0 && art.duration && resumeAt < art.duration - 5) art.currentTime = resumeAt;
    resumeAt = 0;
  });
  art.on('video:timeupdate', () => {
    const now = Date.now();
    if (now - lastReport > 5000 && art.duration) { lastReport = now; o.cb.onProgress && o.cb.onProgress(art.currentTime, art.duration); }
  });
  art.on('video:ended', () => o.cb.onEnded && o.cb.onEnded());
  // 'video:pause' covers every pause (media keys, headset buttons, OS controls); ArtPlayer's own 'pause' fires only for art.pause()
  art.on('video:pause', () => { if (art.duration) o.cb.onProgress && o.cb.onProgress(art.currentTime, art.duration); });
  art.on('resize', applySubStyle);
  art.on('fullscreen', () => setTimeout(applySubStyle, 50));
  const onHide = () => { if (art.duration) o.cb.onProgress && o.cb.onProgress(art.currentTime, art.duration); };
  window.addEventListener('pagehide', onHide);

  // now, not on 'ready': ArtPlayer emits that on the first canplay, which a dead source never reaches
  monitor(current);
  art.on('ready', () => {
    applySubStyle();
    rebuildSettings();
    if (o.hasNext) art.controls.add({ name: 'next', position: 'right', html: 'Next episode', tooltip: 'Next episode', click: () => o.cb.onNext && o.cb.onNext() });
    // ArtPlayer only enables shortcuts after a click INSIDE the player; arriving from another page that would leave Space/M/F/C dead
    art.isFocus = true;
    // ArtPlayer's hotkey table is keyed by KeyboardEvent.code ('Space', 'KeyM'), not by the typed character
    art.hotkey.add('KeyF', () => { art.fullscreen = !art.fullscreen; });
    art.hotkey.add('KeyM', () => { art.muted = !art.muted; });
    art.hotkey.add('KeyC', () => { art.subtitle.show = !art.subtitle.show; });
  });

  const controller = {
    art,
    get stream() { return current; },
    get time() { return art.currentTime; },
    async switchTo(stream) {
      if (destroyed || !stream || stream.id === current.id) return;
      const t = art.currentTime || 0;
      current = stream;
      const url = urlFor(stream);
      art.type = stream.container === 'm3u8' ? 'm3u8' : '';
      resumeAt = t;
      art.template.$player.classList.remove('rh-failed');
      const box = art.template.$player.querySelector('.rh-fail');
      if (box) box.remove();
      await art.switchUrl(url);
      art.play().catch(() => {});
      monitor(stream);
      rebuildSettings();
      o.cb.onSourceChange && o.cb.onSourceChange(stream);
    },
    /** Register a subtitle (blob: URL with WebVTT) and optionally show it. */
    async addSubtitle(item, { select = true } = {}) {
      if (!subs.some((s) => s.id === item.id)) subs.push(item);
      if (select) await controller.selectSubtitle(item); else rebuildSettings();
    },
    async selectSubtitle(item) {
      activeSub = item;
      if (!item) { art.subtitle.show = false; rebuildSettings(); return; }
      await art.subtitle.switch(item.url, { name: item.label, type: 'vtt' });
      art.subtitle.show = true;
      applySubStyle();
      rebuildSettings();
    },
    get activeSubtitle() { return activeSub; },
    /** Nothing left to try: stop the spinner, say so in the player. */
    fail(message) {
      if (destroyed) return;
      art.loading.show = false;
      art.template.$player.classList.add('rh-failed');
      let box = art.template.$player.querySelector('.rh-fail');
      if (!box) { box = document.createElement('div'); box.className = 'rh-fail'; box.setAttribute('role', 'status'); art.template.$player.append(box); }
      box.textContent = message;
    },
    applySubStyle,
    /** Re-enable keyboard shortcuts (e.g. after a sheet that sat on top of the player closed). */
    focus() { art.isFocus = true; },
    report() { if (art.duration) o.cb.onProgress && o.cb.onProgress(art.currentTime, art.duration); },
    destroy() {
      if (destroyed) return;
      controller.report();
      destroyed = true;
      cleanupMonitor();
      window.removeEventListener('pagehide', onHide);
      subs.forEach((s) => { try { URL.revokeObjectURL(s.url); } catch { /* already gone */ } });
      try { art.destroy(true); } catch { /* player already torn down */ }
    },
  };
  return controller;
}

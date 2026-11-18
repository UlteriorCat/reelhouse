'use strict';
const crypto = require('crypto');

const b = (a) => Buffer.from(a);
const NATIVE = [b([99, 122, 49, 52, 82, 83, 116, 107, 78, 48, 49, 80, 86, 69, 53, 119]), b([87, 84, 108, 69, 118, 99, 107, 100, 50, 85, 82, 52, 49, 115, 100, 107])];
const PRIMARY = [b([98, 47, 49, 106, 109, 108, 53, 110, 107, 52, 120, 53, 107, 55, 112, 78]), b([49, 52, 110, 77, 107, 56, 109, 78, 53, 75, 108, 53, 75, 76, 55, 108])];
const FALLBACK = [b([109, 53, 75, 108, 53, 110, 107, 52, 120, 75, 49, 107, 78, 55, 112, 78]), b([107, 53, 75, 52, 110, 77, 56, 109, 75, 108, 78, 76, 55, 108, 49, 53])];
const FROM = 'aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ';
const TO = 'fFgGjJkKaApPbBmMoOzZeEnNcCdDrRqQtTvVuUxXhHiIwWyYlLsS';

const aes = (text, pair) => {
  const c = crypto.createCipheriv('aes-128-cbc', pair[0], pair[1]);
  return Buffer.concat([c.update(text, 'utf8'), c.final()]);
};

const encNative = (t) => {
  const s = b(aes(t, NATIVE).toString('base64'));
  for (let i = 0; i + 1 < s.length; i += 2) {
    const x = s[i];
    s[i] = s[i + 1];
    s[i + 1] = x;
  }
  return s.reverse().toString('base64');
};

const encPrimary = (t) => Buffer.from(aes(t, PRIMARY).toString('base64')).toString('base64').split('').map((ch) => {
  const i = FROM.indexOf(ch);
  return i < 0 ? ch : TO[i];
}).join('');

const encFallback = (t) => aes(t, FALLBACK).toString('base64');

const layouts = { native: encNative, primary: encPrimary, fallback: encFallback };

const stamp = (hours) => {
  const x = new Date(Date.now() + hours * 3600e3);
  return [x.getUTCDate() + '/' + (x.getUTCMonth() + 1) + '/' + x.getUTCFullYear(), x.getUTCHours() + ':' + x.getUTCMinutes() + ':00'];
};

const span = (from, to) => {
  const a = stamp(from);
  const z = stamp(to);
  return { date: a[0], time: a[1], end_date: z[0], end_time: z[1] };
};

const events = [
  Object.assign({ category: 'Cricket', eventName: 'Test Series', teamAName: 'India', teamBName: 'Australia', links: 'ind-aus.txt', link_names: ['A', 'B'] }, span(-1, 2)),
  { event: JSON.stringify(Object.assign({ category: 'Football', eventName: 'League', teamAName: 'Arsenal', teamBName: 'Chelsea', links: 'ars-che.txt' }, span(2, 4))) },
  Object.assign({ category: 'Basketball', eventName: 'Finals', teamAName: 'Lakers', teamBName: 'Celtics', links: 'lak-cel.txt' }, span(-6, -3)),
  { category: 'Hidden', eventName: 'x', links: 'x.txt', visible: false },
];

const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\n720/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n360/index.m3u8\n';

const streams = [
  { name: 'Main HD', link: 'https://livevideos.cricbuzz.com/a/master.m3u8|User-Agent=TestUA&Referer=https%3A%2F%2Fref.example%2F', api: '' },
  { name: 'DRM', link: 'https://cdn.example/live/manifest.mpd', api: '0123456789abcdef0123456789abcdef:fedcba9876543210fedcba9876543210' },
  { name: 'WV', link: 'https://cdn.example/wv/manifest.mpd', api: 'https://lic.example/widevine' },
  { name: 'Tok', link: '', tokenApi: JSON.stringify({ type: 'json', api: 'https://tok.example/get', link_key: 'playback_url' }) },
];

const hostOf = (url) => /^https?:\/\/([^/]+)/.exec(url)[1];

const makeRoute = (options) => {
  const o = Object.assign({ layout: 'native', dead: [], garbage: [], remote: null, eventsBody: events }, options);
  const enc = layouts[o.layout];
  return (url, method) => {
    if (url.indexOf('firebaseremoteconfig') !== -1) {
      return { status: 200, body: JSON.stringify({ entries: o.remote ? { api_url: o.remote } : {} }) };
    }
    const host = hostOf(url);
    if (o.dead.indexOf(host) !== -1) return { status: 404, body: '' };
    if (o.garbage.indexOf(host) !== -1) return { status: 200, body: 'not a payload at all' };
    if (/\/events\.txt$/.test(url)) return { status: 200, body: enc(JSON.stringify(o.eventsBody)) };
    if (/\/ind-aus\.txt$/.test(url)) return { status: 200, body: enc(JSON.stringify(streams)) };
    if (/\/empty\.txt$/.test(url)) return { status: 200, body: enc('[]') };
    if (url.indexOf('/a/master.m3u8') !== -1) return { status: 200, body: master };
    if (url.indexOf('tok.example/get') !== -1) return { status: 200, body: JSON.stringify({ playback_url: 'https://tok.example/live.m3u8|Cookie=abc' }) };
    return { status: 404, body: '' };
  };
};

module.exports = { events, streams, layouts, makeRoute, span };

// Shared helpers for the BDIX providers.
// The providers in this folder are a browser port of the "eclipsia-bdix" CloudStream scrapers
// (https://gitea.com/eclipsia/cloudstream, GPL-3.0). See /NOTICE.md and /LICENSE.

export const QUALITY_RANK = { '2160p': 5, '1440p': 4, '1080p': 3, '720p': 2, '576p': 1, '480p': 0, '360p': -1, hd: -1, Unknown: -1, auto: -2 };

export const heightOf = (q) => {
  const m = /^(\d{3,4})p$/.exec(String(q || ''));
  return m ? Number(m[1]) : 0;
};

export const fileNameOf = (url) => {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return ''; }
};

const CONTAINERS = ['mkv', 'mp4', 'm4v', 'mov', 'webm', 'avi', 'ts', 'm3u8', 'mpd'];
export const containerOf = (url) => {
  let path = '';
  try { path = new URL(url).pathname.toLowerCase(); } catch { path = String(url).toLowerCase(); }
  const ext = path.split('.').pop();
  return CONTAINERS.includes(ext) ? ext : 'unknown';
};

const AUDIO_LABELS = [
  [/ddp.?5.?1.*truehd.*7.?1|truehd.*7.?1.*ddp.?5.?1/, 'DDP 5.1 + TrueHD 7.1'],
  [/ddp.?5.?1.*ddp.?7.?1|ddp.?7.?1.*ddp.?5.?1/, 'DDP 5.1 + DDP 7.1'],
  [/ddp.?5.?1.*aac.?7.?1|aac.?7.?1.*ddp.?5.?1/, 'DDP 5.1 + AAC 7.1'],
  [/ddp.?5.?1/, 'DDP 5.1'],
  [/ddp.?7.?1/, 'DDP 7.1'],
  [/truehd/, 'TrueHD 7.1'],
  [/aac.*7.?1|7.?1.*aac/, 'AAC 7.1'],
  [/aac/, 'AAC 5.1'],
];

/**
 * Describe a release from its file name + URL. Heuristics only (nothing is inspected inside the file).
 * `video`/`audio` are machine-readable codec tokens used for playability prediction; the rest is for display.
 */
export function describe(filename, url = '') {
  const s = `${filename} ${url}`.toLowerCase();
  const video = /\b(?:hevc|x265|h\.?265|265)\b/.test(s) ? 'hevc' : /\bav1\b/.test(s) ? 'av1' : /\b(?:xvid|divx)\b/.test(s) ? 'xvid' : /\bvp9\b/.test(s) ? 'vp9' : /\b(?:x264|h\.?264|avc)\b/.test(s) ? 'avc' : '';
  const audio = new Set();
  if (/\b(?:ddp|dd\+|eac3|e-ac-3)/.test(s) || /ddp.?\d/.test(s)) audio.add('eac3');
  if (!audio.has('eac3') && (/\b(?:dd|ac3|ac-3)\b|\bdd.?[257]\.?[01]\b|dolby digital/.test(s))) audio.add('ac3');
  if (/truehd/.test(s)) audio.add('truehd');
  if (/\bdts(?:-?hd|-?x|-?ma)?\b/.test(s)) audio.add('dts');
  if (/\baac/.test(s)) audio.add('aac');
  if (/\bopus\b/.test(s)) audio.add('opus');
  if (/\bflac\b/.test(s)) audio.add('flac');
  if (/\bmp3\b/.test(s)) audio.add('mp3');
  let audioLabel = '';
  for (const [re, label] of AUDIO_LABELS) if (re.test(s)) { audioLabel = label; break; }
  if (audioLabel && /\batmos\b/.test(s)) audioLabel += ' Atmos';
  const langs = [];
  if (/\b(?:english|eng)\b/.test(s)) langs.push('English');
  if (/\bhindi\b/.test(s)) langs.push('Hindi');
  if (/\btamil\b/.test(s)) langs.push('Tamil');
  if (/\btelugu\b/.test(s)) langs.push('Telugu');
  return {
    video,
    audio: [...audio],
    source: /\bbluray\b|\bbdrip\b|\bbrrip\b/.test(s) ? 'Blu-ray' : /\b(?:webrip|hdrip)\b/.test(s) ? 'WEB-Rip' : /\bweb.?dl\b/.test(s) ? 'WEB-DL' : '',
    hdr: /\bhdr10\+|hdr10p\b/.test(s) ? 'HDR10+' : /\bhdr10\b/.test(s) ? 'HDR10' : /\bhdr\b/.test(s) ? 'HDR' : '',
    dv: /\b(?:dv|dolby\s*vision)\b/.test(s),
    tenBit: /\b10bit\b/.test(s),
    imax: /\bimax\b/.test(s),
    codecLabel: video === 'hevc' ? 'H.265' : video === 'avc' ? 'H.264' : video === 'av1' ? 'AV1' : video === 'xvid' ? 'XviD' : video === 'vp9' ? 'VP9' : '',
    audioLabel,
    langs,
  };
}

export function makeStream({ provider, providerName, url, quality, filename, headers }) {
  const name = filename || fileNameOf(url);
  return { id: `${provider}|${url}`, provider, providerName, url, quality, height: heightOf(quality), container: containerOf(url), filename: name, info: describe(name, url), headers: headers || {} };
}

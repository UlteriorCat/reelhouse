// AES-GCM decryption in plain JavaScript. Port of the software implementation in the eclipsia "fendrix.js" scraper
// (GPL-3.0, see /NOTICE.md). Only loaded when WebCrypto is missing: `crypto.subtle` exists in secure contexts only
// (https or localhost), and the site may be opened over plain http on a LAN to reach a gateway.

function xtime(x) { return ((x << 1) ^ ((x & 128) ? 27 : 0)) & 255; }

function buildSbox() {
  const rotl = (v, s) => ((v << s) | (v >> (8 - s))) & 255;
  const box = [];
  let p = 1;
  let q = 1;
  do {
    p = (p ^ (p << 1) ^ ((p & 128) ? 27 : 0)) & 255;
    q = (q ^ (q << 1)) & 255;
    q = (q ^ (q << 2)) & 255;
    q = (q ^ (q << 4)) & 255;
    if (q & 128) q ^= 9;
    box[p] = (q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 99) & 255;
  } while (p !== 1);
  box[0] = 99;
  return box;
}
const SBOX = buildSbox();

function expandKey(key) {
  const nk = key.length / 4;
  const rounds = nk + 6;
  const w = new Array(4 * (rounds + 1));
  for (let i = 0; i < nk; i++) w[i] = [key[i * 4], key[i * 4 + 1], key[i * 4 + 2], key[i * 4 + 3]];
  let rcon = 1;
  for (let i = nk; i < w.length; i++) {
    let t = w[i - 1].slice();
    if (i % nk === 0) {
      t = [t[1], t[2], t[3], t[0]].map((b) => SBOX[b]);
      t[0] ^= rcon;
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) t = t.map((b) => SBOX[b]);
    const p = w[i - nk];
    w[i] = [p[0] ^ t[0], p[1] ^ t[1], p[2] ^ t[2], p[3] ^ t[3]];
  }
  return { w, rounds };
}

function addRoundKey(s, w, r) {
  for (let c = 0; c < 4; c++) { const k = w[r * 4 + c]; for (let j = 0; j < 4; j++) s[c * 4 + j] ^= k[j]; }
}
function subShift(s) {
  for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
  const t = [s[0], s[5], s[10], s[15], s[4], s[9], s[14], s[3], s[8], s[13], s[2], s[7], s[12], s[1], s[6], s[11]];
  for (let i = 0; i < 16; i++) s[i] = t[i];
}
function mixColumn(s, o) {
  const [a, b, c, d] = [s[o], s[o + 1], s[o + 2], s[o + 3]];
  s[o] = xtime(a) ^ (xtime(b) ^ b) ^ c ^ d;
  s[o + 1] = a ^ xtime(b) ^ (xtime(c) ^ c) ^ d;
  s[o + 2] = a ^ b ^ xtime(c) ^ (xtime(d) ^ d);
  s[o + 3] = (xtime(a) ^ a) ^ b ^ c ^ xtime(d);
}
function encryptBlock(block, ks) {
  const s = block.slice();
  addRoundKey(s, ks.w, 0);
  for (let r = 1; r < ks.rounds; r++) { subShift(s); for (let i = 0; i < 16; i += 4) mixColumn(s, i); addRoundKey(s, ks.w, r); }
  subShift(s);
  addRoundKey(s, ks.w, ks.rounds);
  return s;
}

const toWords = (b) => [0, 1, 2, 3].map((i) => (((b[i * 4] || 0) << 24) | ((b[i * 4 + 1] || 0) << 16) | ((b[i * 4 + 2] || 0) << 8) | (b[i * 4 + 3] || 0)) >>> 0);
const toBytes = (w) => w.flatMap((x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]);

function gmul(x, y) {
  const z = [0, 0, 0, 0];
  const v = x.slice();
  for (let i = 0; i < 128; i++) {
    if ((y[i >> 5] >>> (31 - (i & 31))) & 1) for (let j = 0; j < 4; j++) z[j] = (z[j] ^ v[j]) >>> 0;
    const lsb = v[3] & 1;
    v[3] = ((v[3] >>> 1) | (v[2] << 31)) >>> 0;
    v[2] = ((v[2] >>> 1) | (v[1] << 31)) >>> 0;
    v[1] = ((v[1] >>> 1) | (v[0] << 31)) >>> 0;
    v[0] = v[0] >>> 1;
    if (lsb) v[0] = (v[0] ^ 0xe1000000) >>> 0;
  }
  return z;
}
function ghash(acc, h, data) {
  for (let i = 0; i < data.length; i += 16) {
    const b = toWords(data.slice(i, i + 16));
    acc = gmul([0, 1, 2, 3].map((j) => (acc[j] ^ b[j]) >>> 0), h);
  }
  return acc;
}
function inc32(c) {
  const n = c.slice();
  for (let i = 15; i >= 12; i--) { n[i] = (n[i] + 1) & 255; if (n[i]) break; }
  return n;
}

/**
 * Decrypt AES-GCM (128-bit tag appended to the ciphertext). Throws on a bad tag.
 * @param {Uint8Array} key @param {Uint8Array} iv 12 bytes @param {Uint8Array} data ciphertext+tag @param {Uint8Array} aad
 * @returns {Uint8Array}
 */
export function aesGcmDecrypt(key, iv, data, aad) {
  if (iv.length !== 12 || data.length < 16) throw new Error('Invalid AES-GCM input');
  const k = [...key]; const ivA = [...iv]; const all = [...data]; const aadA = [...aad];
  const ks = expandKey(k);
  const h = toWords(encryptBlock(new Array(16).fill(0), ks));
  const j0 = ivA.concat([0, 0, 0, 1]);
  const body = all.slice(0, -16);
  const tag = all.slice(-16);
  let acc = ghash([0, 0, 0, 0], h, aadA);
  acc = ghash(acc, h, body);
  const al = aadA.length * 8; const bl = body.length * 8;
  acc = ghash(acc, h, toBytes([Math.floor(al / 4294967296), al % 4294967296, Math.floor(bl / 4294967296), bl % 4294967296]));
  const s = toBytes(acc);
  const e0 = encryptBlock(j0, ks);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= tag[i] ^ (e0[i] ^ s[i]);
  if (diff !== 0) throw new Error('aes-gcm: invalid tag');
  const out = new Uint8Array(body.length);
  let ctr = inc32(j0);
  for (let o = 0; o < body.length; o += 16) {
    const ksb = encryptBlock(ctr, ks);
    for (let j = 0; j < 16 && o + j < body.length; j++) out[o + j] = body[o + j] ^ ksb[j];
    ctr = inc32(ctr);
  }
  return out;
}

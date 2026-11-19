// Accounts: invite-only sign-up, sign-in, sessions, password changes, admin (users, invite codes) and the synced
// library document. Storage: a Cloudflare D1 database bound as env.DB (Node dev/tests use dev/d1-sqlite.mjs).
// Without env.DB every route answers 503 accounts_not_configured and the site works as before (device only).
//
// Security model (tested in test/accounts.test.mjs):
//   * passwords: PBKDF2-SHA256 with a random salt; the iteration count is stored in each hash. Unknown users still
//     cost one hash (no timing difference). Login failures are rate limited per username and per IP.
//   * sessions: 32 random bytes in an HttpOnly, SameSite=Strict cookie scoped to /api; only a SHA-256 of it is stored.
//   * every state-changing request must be JSON and, when the browser sends an Origin, same-origin (CSRF).
//   * invite codes are stored hashed and shown once; use is counted atomically with the account creation.
//   * admin routes check the role in the database on every request; the last admin cannot be removed.
import { normalize } from '../public/js/sync-merge.js';
import { HttpError } from './tmdb.js';

const DAY = 86400000;
const SESSION_MS = 30 * DAY;
const COOKIE = 'rh_session';
const MAX_SYNC_BYTES = 512 * 1024;
const MAX_BODY_BYTES = 8 * 1024;
export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
const LIMITS = { loginUser: [10, 15 * 60000], loginIp: [30, 15 * 60000], signupIp: [20, 60 * 60000] };

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')), created_at INTEGER NOT NULL, invite_id INTEGER, last_seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS invites (id INTEGER PRIMARY KEY AUTOINCREMENT, code_hash TEXT NOT NULL UNIQUE, hint TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, disabled INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS user_state (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, doc TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
];
const ready = new WeakMap();
async function ensureSchema(db) {
  if (!ready.has(db)) ready.set(db, (async () => { for (const sql of SCHEMA) await db.prepare(sql).run(); })().catch((e) => { ready.delete(db); throw e; }));
  return ready.get(db);
}

// ---------------- crypto ----------------
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256(s) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))); }
function equalBytes(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
const equalStrings = (a, b) => equalBytes(enc.encode(String(a)), enc.encode(String(b)));

const iterationsOf = (env) => { const n = parseInt(env.PBKDF2_ITERATIONS, 10); return n >= 10000 && n <= 100000 ? n : 100000; }; // 100k = Workers' maximum
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
export async function hashPassword(password, env = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const it = iterationsOf(env);
  return `pbkdf2-sha256$${it}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, it))}`;
}
export async function verifyPassword(password, stored) {
  const [alg, it, salt, hash] = String(stored || '').split('$');
  if (alg !== 'pbkdf2-sha256' || !(Number(it) >= 1000)) return false;
  return equalBytes(await pbkdf2(password, fromB64url(salt), Number(it)), fromB64url(hash));
}
const DUMMY_HASH = 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// invite codes: 12 characters without look-alikes (0/O, 1/I/L), shown as XXXX-XXXX-XXXX
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function newInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join(''); // 31 symbols: bias < 2.3%, ~59 bits
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const canonCode = (c) => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

// ---------------- HTTP helpers ----------------
const HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
function reply(data, status = 200, extra = {}) {
  const h = new Headers({ ...HEADERS });
  for (const [k, v] of Object.entries(extra)) h.append(k, v);
  return new Response(JSON.stringify(data), { status, headers: h });
}
const err = (status, code, message) => new HttpError(status, code, message);

function cookieHeader(url, value, maxAgeSec) {
  const secure = url.protocol === 'https:' ? '; Secure' : ''; // plain http only on a local machine (dev/tests)
  return `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}
function readCookie(request) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,100})`).exec(request.headers.get('cookie') || '');
  return m ? m[1] : null;
}
async function readJson(request, limit) {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) throw err(415, 'json_required', 'Send JSON.');
  const text = await request.text();
  if (text.length > limit) throw err(413, 'too_large', 'Request too large.');
  try { const v = JSON.parse(text || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; } catch { throw err(400, 'bad_json', 'Invalid JSON.'); }
}
/** CSRF: browsers send Origin on cross-site POST/PUT/DELETE; it must be ours. JSON content type blocks form posts. */
function checkOrigin(request, url) {
  const o = request.headers.get('origin');
  if (o && o !== url.origin) throw err(403, 'bad_origin', 'Cross-site request refused.');
}
const ipOf = (request) => request.headers.get('cf-connecting-ip') || 'local';

// ---------------- rate limiting ----------------
async function limited(db, key, [max], now) {
  const row = await db.prepare('SELECT count, reset_at FROM attempts WHERE key = ?').bind(key).first();
  return !!row && row.reset_at > now && row.count >= max;
}
async function countFailure(db, key, [, windowMs], now) {
  await db.prepare('INSERT INTO attempts (key, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END, reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END')
    .bind(key, now + windowMs, now, now, now + windowMs).run();
}
const clearFailures = (db, key) => db.prepare('DELETE FROM attempts WHERE key = ?').bind(key).run();

// ---------------- sessions ----------------
async function createSession(db, url, userId, now) {
  const token = randomToken(32);
  await db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)').bind(await sha256(token), userId, now, now + SESSION_MS, now).run();
  await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, userId).run();
  // housekeeping, cheap: expired sessions and stale attempt counters
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  await db.prepare('DELETE FROM attempts WHERE reset_at < ?').bind(now).run();
  return { token, cookie: cookieHeader(url, token, SESSION_MS / 1000) };
}
/** The signed-in user for this request, or null. Slides the expiry at most once an hour (keeps writes low). */
async function currentUser(db, request, url, now) {
  const token = readCookie(request);
  if (!token) return null;
  const sid = await sha256(token);
  const row = await db.prepare('SELECT s.id AS sid, s.expires_at, s.last_seen AS s_seen, u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').bind(sid).first();
  if (!row || row.expires_at <= now) return null;
  let refresh = null;
  if (now - row.s_seen > 3600000) {
    await db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?').bind(now, now + SESSION_MS, sid).run();
    await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, row.id).run();
    refresh = cookieHeader(url, token, SESSION_MS / 1000);
  }
  return { id: row.id, username: row.username, role: row.role, sid, refresh };
}
const publicUser = (u) => (u ? { username: u.username, role: u.role } : null);

function validateCredentials(username, password) {
  if (!USERNAME_RE.test(String(username || ''))) throw err(400, 'bad_username', 'Username: 3 to 32 letters, digits, dot, dash or underscore.');
  checkPassword(password, username);
}
function checkPassword(password, username) {
  const p = String(password || '');
  if (p.length < PASSWORD_MIN || p.length > PASSWORD_MAX) throw err(400, 'weak_password', `Password: ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`);
  if (username && p.toLowerCase().includes(String(username).toLowerCase())) throw err(400, 'weak_password', 'The password must not contain the username.');
}

// ---------------- routes ----------------
/** Handles /api/auth/*, /api/sync and /api/admin/*. Returns null for other paths. */
export async function handleAccounts(request, env, url, parts, { now = Date.now() } = {}) {
  const area = parts[0];
  if (area !== 'auth' && area !== 'sync' && area !== 'admin') return null;
  const db = env.DB;
  if (!db) throw err(503, 'accounts_not_configured', 'Accounts are not set up on this site.');
  await ensureSchema(db);
  const m = request.method;
  if (m !== 'GET') checkOrigin(request, url);
  const user = await currentUser(db, request, url, now);
  const extra = user && user.refresh ? { 'set-cookie': user.refresh } : {};
  const out = (data, status = 200, more = {}) => reply(data, status, { ...extra, ...more });
  const needUser = () => { if (!user) throw err(401, 'signed_out', 'Please sign in.'); };
  const route = `${m} /${parts.join('/')}`;

  // ---- auth ----
  if (route === 'GET /auth/me') return out({ user: publicUser(user) });

  if (route === 'POST /auth/login') {
    const { username, password } = await readJson(request, MAX_BODY_BYTES);
    const name = String(username || '').trim();
    const uKey = 'login:u:' + name.toLowerCase();
    const iKey = 'login:ip:' + ipOf(request);
    if (await limited(db, uKey, LIMITS.loginUser, now) || await limited(db, iKey, LIMITS.loginIp, now)) throw err(429, 'too_many_attempts', 'Too many failed attempts. Wait 15 minutes and try again.');
    let row = name && name.length <= 32 ? await db.prepare('SELECT id, username, pass, role FROM users WHERE username = ?').bind(name).first() : null;
    let ok = await verifyPassword(String(password || ''), row ? row.pass : DUMMY_HASH);
    if (!row && !ok) row = await bootstrapAdmin(db, env, name, String(password || ''), now);
    if (row && !ok && row.bootstrapped) ok = true;
    if (!row || !ok) {
      await countFailure(db, uKey, LIMITS.loginUser, now); await countFailure(db, iKey, LIMITS.loginIp, now);
      throw err(401, 'bad_credentials', 'Wrong username or password.');
    }
    await clearFailures(db, uKey);
    if (!row.bootstrapped && Number(String(row.pass).split('$')[1]) < iterationsOf(env)) {
      await db.prepare('UPDATE users SET pass = ? WHERE id = ?').bind(await hashPassword(String(password), env), row.id).run(); // upgrade old hashes
    }
    const s = await createSession(db, url, row.id, now);
    return reply({ user: publicUser(row) }, 200, { 'set-cookie': s.cookie });
  }

  if (route === 'POST /auth/signup') {
    const { username, password, invite } = await readJson(request, MAX_BODY_BYTES);
    const name = String(username || '').trim();
    const iKey = 'signup:ip:' + ipOf(request);
    if (await limited(db, iKey, LIMITS.signupIp, now)) throw err(429, 'too_many_attempts', 'Too many attempts. Try again in an hour.');
    validateCredentials(name, password);
    const codeHash = await sha256(canonCode(invite));
    // the invite first: without a valid code nobody learns which usernames exist
    const valid = await db.prepare('SELECT 1 AS x FROM invites WHERE code_hash = ? AND disabled = 0 AND (max_uses IS NULL OR uses < max_uses) AND (expires_at IS NULL OR expires_at > ?)').bind(codeHash, now).first();
    if (!valid) { await countFailure(db, iKey, LIMITS.signupIp, now); throw err(400, 'bad_invite', 'That invite code is not valid (wrong, used up, expired or disabled).'); }
    // the admin's name is reserved even before the admin's first sign-in (otherwise an invitee could take it)
    if (env.ADMIN_USERNAME && name.toLowerCase() === String(env.ADMIN_USERNAME).trim().toLowerCase()) throw err(409, 'username_taken', 'That username is taken.');
    if (await db.prepare('SELECT 1 AS x FROM users WHERE username = ?').bind(name).first()) throw err(409, 'username_taken', 'That username is taken.');
    const pass = await hashPassword(String(password), env);
    let res;
    try {
      // One transaction: the account is created only if the invite is valid, and the use is counted only if it was.
      res = await db.batch([
        db.prepare(`INSERT INTO users (username, pass, role, created_at, invite_id) SELECT ?, ?, 'user', ?, id FROM invites WHERE code_hash = ? AND disabled = 0 AND (max_uses IS NULL OR uses < max_uses) AND (expires_at IS NULL OR expires_at > ?)`).bind(name, pass, now, codeHash, now),
        db.prepare('UPDATE invites SET uses = uses + 1 WHERE code_hash = ? AND EXISTS (SELECT 1 FROM users WHERE username = ? AND invite_id = invites.id)').bind(codeHash, name),
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(String(e && e.message))) throw err(409, 'username_taken', 'That username is taken.');
      throw e;
    }
    if (!res[0].meta.changes) {
      await countFailure(db, iKey, LIMITS.signupIp, now);
      throw err(400, 'bad_invite', 'That invite code is not valid (wrong, used up, expired or disabled).');
    }
    const row = await db.prepare('SELECT id, username, role FROM users WHERE username = ?').bind(name).first();
    const s = await createSession(db, url, row.id, now);
    return reply({ user: publicUser(row) }, 201, { 'set-cookie': s.cookie });
  }

  if (route === 'POST /auth/logout') {
    await readJson(request, MAX_BODY_BYTES);
    if (user) await db.prepare('DELETE FROM sessions WHERE id = ?').bind(user.sid).run();
    return reply({ ok: true }, 200, { 'set-cookie': cookieHeader(url, '', 0) });
  }

  if (route === 'POST /auth/password') {
    needUser();
    const { current, next } = await readJson(request, MAX_BODY_BYTES);
    const row = await db.prepare('SELECT pass FROM users WHERE id = ?').bind(user.id).first();
    const uKey = 'login:u:' + user.username.toLowerCase();
    if (await limited(db, uKey, LIMITS.loginUser, now)) throw err(429, 'too_many_attempts', 'Too many failed attempts. Wait 15 minutes and try again.');
    if (!(await verifyPassword(String(current || ''), row.pass))) { await countFailure(db, uKey, LIMITS.loginUser, now); throw err(403, 'bad_credentials', 'Your current password is wrong.'); }
    checkPassword(next, user.username);
    if (String(next) === String(current)) throw err(400, 'same_password', 'Choose a different password.');
    await db.batch([
      db.prepare('UPDATE users SET pass = ? WHERE id = ?').bind(await hashPassword(String(next), env), user.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(user.id, user.sid), // sign out everywhere else
    ]);
    return out({ ok: true });
  }

  if (route === 'POST /auth/delete') {
    needUser();
    const { password } = await readJson(request, MAX_BODY_BYTES);
    const row = await db.prepare('SELECT pass FROM users WHERE id = ?').bind(user.id).first();
    if (!(await verifyPassword(String(password || ''), row.pass))) throw err(403, 'bad_credentials', 'Your password is wrong.');
    if (user.role === 'admin' && (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first('n')) <= 1) throw err(409, 'last_admin', 'You are the only admin, so this account cannot be deleted.');
    await deleteUser(db, user.id);
    return reply({ ok: true }, 200, { 'set-cookie': cookieHeader(url, '', 0) });
  }

  // ---- sync ----
  if (area === 'sync') {
    needUser();
    if (route === 'GET /sync') {
      const row = await db.prepare('SELECT doc, version FROM user_state WHERE user_id = ?').bind(user.id).first();
      return out(row ? { doc: JSON.parse(row.doc), version: row.version } : { doc: null, version: 0 });
    }
    if (route === 'PUT /sync') {
      const body = await readJson(request, MAX_SYNC_BYTES);
      const version = Number(body.version);
      if (!Number.isInteger(version) || version < 0) throw err(400, 'bad_version', 'Missing version.');
      const doc = JSON.stringify(normalize(body.doc));
      if (doc.length > MAX_SYNC_BYTES) throw err(413, 'too_large', 'Your library is too large to sync.');
      // optimistic concurrency: the write only lands on the version the client merged from
      const r = version === 0
        ? await db.prepare('INSERT INTO user_state (user_id, doc, version, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING').bind(user.id, doc, now).run()
        : await db.prepare('UPDATE user_state SET doc = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?').bind(doc, now, user.id, version).run();
      if (!r.meta.changes) {
        const cur = await db.prepare('SELECT doc, version FROM user_state WHERE user_id = ?').bind(user.id).first();
        return out({ error: 'conflict', doc: cur ? JSON.parse(cur.doc) : null, version: cur ? cur.version : 0 }, 409);
      }
      return out({ version: version + 1 });
    }
    throw err(405, 'method_not_allowed', 'Method not allowed.');
  }

  // ---- admin ----
  if (area === 'admin') {
    needUser();
    if (user.role !== 'admin') throw err(403, 'forbidden', 'Admins only.');
    if (route === 'GET /admin/users') {
      const { results } = await db.prepare('SELECT u.id, u.username, u.role, u.created_at, u.last_seen, i.note AS invite_note FROM users u LEFT JOIN invites i ON i.id = u.invite_id ORDER BY u.created_at').all();
      return out({ users: results.map((r) => ({ ...r, self: r.id === user.id })) });
    }
    const userAction = /^(DELETE|POST) \/admin\/users\/(\d{1,10})(\/reset)?$/.exec(route);
    if (userAction) {
      const id = Number(userAction[2]);
      const target = await db.prepare('SELECT id, username, role FROM users WHERE id = ?').bind(id).first();
      if (!target) throw err(404, 'not_found', 'No such user.');
      if (userAction[1] === 'DELETE' && !userAction[3]) {
        await readJson(request, MAX_BODY_BYTES);
        if (target.id === user.id) throw err(409, 'self', 'You cannot remove your own account here.');
        await deleteUser(db, id);
        return out({ ok: true });
      }
      if (userAction[1] === 'POST' && userAction[3]) {
        await readJson(request, MAX_BODY_BYTES);
        if (target.id === user.id) throw err(409, 'self', 'Change your own password in Settings.');
        const temp = newInviteCode().replace(/-/g, '').toLowerCase() + randomToken(3).replace(/[-_]/g, 'x');
        await db.batch([
          db.prepare('UPDATE users SET pass = ? WHERE id = ?').bind(await hashPassword(temp, env), id),
          db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
        ]);
        return out({ password: temp }); // shown once to the admin
      }
    }
    if (route === 'GET /admin/invites') {
      const { results } = await db.prepare('SELECT i.id, i.hint, i.note, i.max_uses, i.uses, i.expires_at, i.disabled, i.created_at, u.username AS created_by FROM invites i LEFT JOIN users u ON u.id = i.created_by ORDER BY i.created_at DESC').all();
      return out({ invites: results.map((r) => ({ ...r, disabled: !!r.disabled, status: r.disabled ? 'disabled' : r.expires_at && r.expires_at <= now ? 'expired' : r.max_uses !== null && r.uses >= r.max_uses ? 'used' : 'active' })) });
    }
    if (route === 'POST /admin/invites') {
      const b = await readJson(request, MAX_BODY_BYTES);
      const maxUses = b.maxUses === null || b.maxUses === 0 ? null : Number(b.maxUses ?? 1);
      if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 1000)) throw err(400, 'bad_uses', 'Uses: 1 to 1000, or unlimited.');
      const days = b.expiresDays === null || b.expiresDays === 0 ? null : Number(b.expiresDays ?? 7);
      if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 365)) throw err(400, 'bad_expiry', 'Expiry: 1 to 365 days, or never.');
      const note = String(b.note || '').trim().slice(0, 80);
      const code = newInviteCode();
      await db.prepare('INSERT INTO invites (code_hash, hint, note, max_uses, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(await sha256(canonCode(code)), canonCode(code).slice(-4), note, maxUses, days ? now + days * DAY : null, user.id, now).run();
      return out({ code }, 201); // the code itself is never stored or shown again
    }
    const disable = /^POST \/admin\/invites\/(\d{1,10})\/disable$/.exec(route);
    if (disable) {
      await readJson(request, MAX_BODY_BYTES);
      const r = await db.prepare('UPDATE invites SET disabled = 1 WHERE id = ?').bind(Number(disable[1])).run();
      if (!r.meta.changes) throw err(404, 'not_found', 'No such invite.');
      return out({ ok: true });
    }
  }
  throw err(404, 'not_found', 'Not found.');
}

async function deleteUser(db, id) {
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM user_state WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
}

/**
 * First admin: when no admin exists yet, signing in with ADMIN_USERNAME / ADMIN_PASSWORD (Function secrets) creates
 * that admin account. From then on the database is authoritative (the admin can change the password; the secrets are
 * no longer read for sign-in).
 */
async function bootstrapAdmin(db, env, name, password, now) {
  const wantName = String(env.ADMIN_USERNAME || '').trim();
  const wantPass = String(env.ADMIN_PASSWORD || '');
  if (!wantName || wantPass.length < PASSWORD_MIN || !USERNAME_RE.test(wantName)) return null;
  if (name.toLowerCase() !== wantName.toLowerCase() || !equalStrings(password, wantPass)) return null;
  if (await db.prepare("SELECT 1 AS x FROM users WHERE role = 'admin'").first()) return null;
  await db.prepare("INSERT INTO users (username, pass, role, created_at) VALUES (?, ?, 'admin', ?) ON CONFLICT(username) DO NOTHING").bind(wantName, await hashPassword(password, env), now).run();
  const row = await db.prepare('SELECT id, username, pass, role FROM users WHERE username = ?').bind(wantName).first();
  return row && row.role === 'admin' ? { ...row, bootstrapped: true } : null;
}

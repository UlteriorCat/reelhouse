// Accounts, invites, admin and sync: driven through the real API router (lib/api.js) with D1 emulated on SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.js';
import { hashPassword, verifyPassword } from '../lib/accounts.js';
import { createD1 } from '../dev/d1-sqlite.mjs';

const ADMIN = { name: 'owner', pass: 'correct horse battery staple' };
const mkEnv = (o = {}) => ({ DB: createD1(), ADMIN_USERNAME: ADMIN.name, ADMIN_PASSWORD: ADMIN.pass, PBKDF2_ITERATIONS: '10000', ...o });

/** A browser-like client: keeps the session cookie, sends JSON with a same-origin Origin. */
function client(env, { origin = 'https://site.example', clock } = {}) {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { ...(cookie ? { cookie } : {}), ...headers };
    if (method !== 'GET' && !('content-type' in headers)) h['content-type'] = 'application/json';
    if (method !== 'GET' && !('origin' in headers)) h.origin = origin;
    const res = await handleApi(new Request('https://site.example/api' + path, { method, headers: h, body: body === undefined ? (method === 'GET' ? undefined : '{}') : typeof body === 'string' ? body : JSON.stringify(body) }), env, clock ? { now: clock() } : {});
    const set = res.headers.get('set-cookie');
    if (set) { const m = /rh_session=([^;]*)/.exec(set); cookie = m && m[1] ? `rh_session=${m[1]}` : ''; }
    let data = null; try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data, setCookie: set, headers: res.headers };
  };
  return { call, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}
async function adminClient(env) { const a = client(env); assert.equal((await a.call('POST', '/auth/login', { username: ADMIN.name, password: ADMIN.pass })).status, 200); return a; }
async function invite(admin, o = {}) { const r = await admin.call('POST', '/admin/invites', { note: 'test', ...o }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.code; }
async function signup(env, username, code, password = 'a long enough password') { const c = client(env); const r = await c.call('POST', '/auth/signup', { username, password, invite: code }); return { c, r }; }

test('without a database the site works and accounts answer 503', async () => {
  const env = {};
  const me = await handleApi(new Request('https://x/api/auth/me'), env);
  assert.equal(me.status, 503); assert.equal((await me.json()).error, 'accounts_not_configured');
  assert.equal((await (await handleApi(new Request('https://x/api/health'), env)).json()).accounts, false);
  assert.equal((await handleApi(new Request('https://x/api/search?q=x', { method: 'POST' }), env)).status, 405, 'other routes still GET only');
});

test('first admin comes from the ADMIN_* secrets once; afterwards the database decides', async () => {
  const env = mkEnv();
  const c = client(env);
  assert.equal((await c.call('POST', '/auth/login', { username: ADMIN.name, password: 'wrong password!!' })).status, 401);
  const ok = await c.call('POST', '/auth/login', { username: 'OWNER', password: ADMIN.pass });
  assert.equal(ok.status, 200); assert.deepEqual(ok.data.user, { username: ADMIN.name, role: 'admin' }, 'username is case-insensitive');
  assert.deepEqual((await c.call('GET', '/auth/me')).data.user, { username: ADMIN.name, role: 'admin' });
  // admin changes the password: the secret no longer signs in
  assert.equal((await c.call('POST', '/auth/password', { current: ADMIN.pass, next: 'a brand new passphrase' })).status, 200);
  assert.equal((await client(env).call('POST', '/auth/login', { username: ADMIN.name, password: ADMIN.pass })).status, 401);
  assert.equal((await client(env).call('POST', '/auth/login', { username: ADMIN.name, password: 'a brand new passphrase' })).status, 200);
  // a different ADMIN_USERNAME later does not create a second admin
  const env2 = { ...env, ADMIN_USERNAME: 'intruder', ADMIN_PASSWORD: 'another long secret' };
  assert.equal((await client(env2).call('POST', '/auth/login', { username: 'intruder', password: 'another long secret' })).status, 401);
  // secrets too weak are ignored
  const weak = mkEnv({ ADMIN_PASSWORD: 'short' });
  assert.equal((await client(weak).call('POST', '/auth/login', { username: ADMIN.name, password: 'short' })).status, 401);
});

test('session cookie: HttpOnly, SameSite=Strict, Path=/api, Secure on https; only its hash is stored', async () => {
  const env = mkEnv();
  const r = await client(env).call('POST', '/auth/login', { username: ADMIN.name, password: ADMIN.pass });
  assert.match(r.setCookie, /^rh_session=[A-Za-z0-9_-]{43}; Path=\/api; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
  const token = /rh_session=([^;]+)/.exec(r.setCookie)[1];
  const { results } = await env.DB.prepare('SELECT id FROM sessions').all();
  assert.equal(results.length, 1); assert.notEqual(results[0].id, token, 'raw token never stored');
  const http = await handleApi(new Request('http://127.0.0.1:8788/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: ADMIN.name, password: ADMIN.pass }) }), env);
  assert.ok(!/Secure/.test(http.headers.get('set-cookie')), 'plain http (local dev) cannot use Secure cookies');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('CSRF and input: cross-site Origin refused, non-JSON refused, oversized refused', async () => {
  const env = mkEnv();
  const c = client(env);
  assert.equal((await c.call('POST', '/auth/login', { username: ADMIN.name, password: ADMIN.pass }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.call('POST', '/auth/login', `username=${ADMIN.name}`, { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await c.call('POST', '/auth/login', '{bad json')).status, 400);
  assert.equal((await c.call('POST', '/auth/login', { username: 'x'.repeat(9000), password: 'y' })).status, 413);
  assert.equal((await c.call('POST', '/auth/login', [1, 2])).status, 400, 'body must be an object');
});

test('invites: shown once, stored hashed, single use by default, counted, disabled and expired codes refused', async () => {
  let t = 1_000_000;
  const env = mkEnv();
  const admin = await adminClient(env);
  const code = await invite(admin);
  assert.match(code, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/, 'no look-alike characters');
  const stored = await env.DB.prepare('SELECT * FROM invites').first();
  assert.ok(!JSON.stringify(stored).includes(code.replace(/-/g, '')), 'code not stored in clear');
  assert.equal(stored.hint, code.slice(-4));
  const a = await signup(env, 'alice', code.toLowerCase().replace(/-/g, ' '));
  assert.equal(a.r.status, 201, 'case and separators do not matter'); assert.deepEqual(a.r.data.user, { username: 'alice', role: 'user' });
  assert.equal((await signup(env, 'bob', code)).r.data.error, 'bad_invite', 'used up');
  const list = (await admin.call('GET', '/admin/invites')).data.invites;
  assert.equal(list[0].uses, 1); assert.equal(list[0].status, 'used'); assert.equal(list[0].created_by, ADMIN.name);
  const multi = await invite(admin, { maxUses: null });
  for (const n of ['carol', 'dave', 'erin']) assert.equal((await signup(env, n, multi)).r.status, 201, 'unlimited code');
  const id = (await admin.call('GET', '/admin/invites')).data.invites.find((i) => i.hint === multi.slice(-4)).id;
  assert.equal((await admin.call('POST', `/admin/invites/${id}/disable`)).status, 200);
  assert.equal((await signup(env, 'frank', multi)).r.data.error, 'bad_invite', 'disabled');
  // expiry: create with 1 day, sign up 2 days later
  const clockEnv = env;
  const admin2 = client(clockEnv, { clock: () => t }); admin2.cookie = admin.cookie;
  const exp = (await admin2.call('POST', '/admin/invites', { expiresDays: 1 })).data.code;
  t += 2 * 86400000;
  const late = client(clockEnv, { clock: () => t });
  assert.equal((await late.call('POST', '/auth/signup', { username: 'gina', password: 'a long enough password', invite: exp })).data.error, 'bad_invite', 'expired');
  assert.equal((await admin.call('POST', '/admin/invites', { maxUses: 0.5 })).status, 400);
  assert.equal((await admin.call('POST', '/admin/invites', { expiresDays: 9999 })).status, 400);
});

test('a single-use invite cannot be used twice even by simultaneous sign-ups', async () => {
  const env = mkEnv();
  const code = await invite(await adminClient(env));
  const results = await Promise.all(['pat1', 'pat2', 'pat3', 'pat4'].map((n) => signup(env, n, code)));
  assert.equal(results.filter((x) => x.r.status === 201).length, 1);
  assert.equal(results.filter((x) => x.r.data.error === 'bad_invite').length, 3);
  assert.equal((await env.DB.prepare('SELECT uses FROM invites').first()).uses, 1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n, 2, 'admin + one user');
});

test('sign-up validation: username rules, password rules, taken names (any case), the admin name is reserved', async () => {
  const env = mkEnv();
  const code = await invite(await adminClient(env), { maxUses: null });
  for (const [u, p, e] of [['ab', 'a long enough password', 'bad_username'], ['has space', 'a long enough password', 'bad_username'], ['zed', 'short', 'weak_password'], ['zed', 'x'.repeat(129), 'weak_password'], ['zed', 'my name is zed ok', 'weak_password']]) {
    assert.equal((await signup(env, u, code, p)).r.data.error, e, `${u} / ${p.slice(0, 10)}`);
  }
  assert.equal((await signup(env, 'zed', code)).r.status, 201);
  assert.equal((await signup(env, 'ZED', code)).r.data.error, 'username_taken');
  assert.equal((await signup(env, 'Owner', code)).r.data.error, 'username_taken', 'cannot squat the admin name');
  const renamed = { ...env, ADMIN_USERNAME: 'boss' }; // configured admin name with no account yet: still reserved
  assert.equal((await signup(renamed, 'Boss', code)).r.data.error, 'username_taken');
  assert.equal((await signup(env, 'nobody', 'WRONG-CODE-0000')).r.data.error, 'bad_invite');
  assert.equal((await signup(env, 'zed', 'WRONG-CODE-0000')).r.data.error, 'bad_invite', 'without a valid code, taken names are not revealed');
});

test('login: same answer for unknown user and wrong password; rate limited per username (even with the right password)', async () => {
  const env = mkEnv();
  await signup(env, 'alice', await invite(await adminClient(env)));
  const unknown = await client(env).call('POST', '/auth/login', { username: 'nobody', password: 'whatever pass' });
  const wrong = await client(env).call('POST', '/auth/login', { username: 'alice', password: 'whatever pass' });
  assert.deepEqual([unknown.status, unknown.data], [wrong.status, wrong.data], 'no user enumeration');
  for (let i = 0; i < 9; i++) await client(env).call('POST', '/auth/login', { username: 'alice', password: 'bad guess ' + i });
  const locked = await client(env).call('POST', '/auth/login', { username: 'alice', password: 'a long enough password' });
  assert.equal(locked.status, 429, 'after 10 failures');
  const other = await client(env).call('POST', '/auth/login', { username: ADMIN.name, password: ADMIN.pass });
  assert.equal(other.status, 200, 'other accounts unaffected');
});

test('login rate limit window expires; success clears the counter', async () => {
  let t = 5_000_000;
  const env = mkEnv();
  await signup(env, 'alice', await invite(await adminClient(env)));
  const c = () => client(env, { clock: () => t });
  for (let i = 0; i < 10; i++) await c().call('POST', '/auth/login', { username: 'alice', password: 'bad guess ' + i });
  assert.equal((await c().call('POST', '/auth/login', { username: 'alice', password: 'a long enough password' })).status, 429);
  t += 15 * 60000 + 1;
  assert.equal((await c().call('POST', '/auth/login', { username: 'alice', password: 'a long enough password' })).status, 200);
});

test('password change: needs the current password, signs out other devices, keeps this one', async () => {
  const env = mkEnv();
  const { c: phone } = await signup(env, 'alice', await invite(await adminClient(env)));
  const laptop = client(env);
  await laptop.call('POST', '/auth/login', { username: 'alice', password: 'a long enough password' });
  assert.equal((await phone.call('POST', '/auth/password', { current: 'wrong current pw', next: 'another fine password' })).status, 403);
  assert.equal((await phone.call('POST', '/auth/password', { current: 'a long enough password', next: 'short' })).data.error, 'weak_password');
  assert.equal((await phone.call('POST', '/auth/password', { current: 'a long enough password', next: 'a long enough password' })).data.error, 'same_password');
  assert.equal((await phone.call('POST', '/auth/password', { current: 'a long enough password', next: 'another fine password' })).status, 200);
  assert.equal((await phone.call('GET', '/auth/me')).data.user.username, 'alice', 'this device stays signed in');
  assert.equal((await laptop.call('GET', '/auth/me')).data.user, null, 'the other device is signed out');
  assert.equal((await client(env).call('POST', '/auth/login', { username: 'alice', password: 'a long enough password' })).status, 401);
  assert.equal((await client(env).call('POST', '/auth/password', { current: 'x', next: 'y' })).status, 401, 'signed out: refused');
});

test('admin: only admins; list users; reset password (temporary, signs the user out); remove user; not themselves', async () => {
  const env = mkEnv();
  const admin = await adminClient(env);
  const { c: alice } = await signup(env, 'alice', await invite(admin, { note: 'for Alice' }));
  assert.equal((await alice.call('GET', '/admin/users')).status, 403);
  assert.equal((await alice.call('POST', '/admin/invites', {})).status, 403);
  assert.equal((await client(env).call('GET', '/admin/users')).status, 401);
  const users = (await admin.call('GET', '/admin/users')).data.users;
  assert.deepEqual(users.map((u) => [u.username, u.role, u.self, u.invite_note]), [[ADMIN.name, 'admin', true, null], ['alice', 'user', false, 'for Alice']]);
  assert.ok(!JSON.stringify(users).includes('pbkdf2'), 'password hashes are never returned');
  const aliceId = users[1].id; const selfId = users[0].id;
  const reset = await admin.call('POST', `/admin/users/${aliceId}/reset`);
  assert.equal(reset.status, 200); assert.ok(reset.data.password.length >= 12);
  assert.equal((await alice.call('GET', '/auth/me')).data.user, null, 'reset signs the user out');
  assert.equal((await client(env).call('POST', '/auth/login', { username: 'alice', password: reset.data.password })).status, 200, 'temporary password works');
  assert.equal((await admin.call('DELETE', `/admin/users/${selfId}`)).data.error, 'self');
  assert.equal((await admin.call('POST', `/admin/users/${selfId}/reset`)).data.error, 'self');
  assert.equal((await admin.call('DELETE', '/admin/users/99999')).status, 404);
  const back = client(env); await back.call('POST', '/auth/login', { username: 'alice', password: reset.data.password });
  await back.call('PUT', '/sync', { doc: {}, version: 0 });
  assert.equal((await admin.call('DELETE', `/admin/users/${aliceId}`)).status, 200);
  assert.equal((await back.call('GET', '/auth/me')).data.user, null, 'removed user is signed out');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM user_state').first()).n, 0, 'their data is gone');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(aliceId).first()).n, 0);
});

test('own account: delete needs the password; the last admin cannot delete itself; sign out ends the session', async () => {
  const env = mkEnv();
  const admin = await adminClient(env);
  const { c: alice } = await signup(env, 'alice', await invite(admin));
  assert.equal((await alice.call('POST', '/auth/delete', { password: 'nope nope nope' })).status, 403);
  const del = await alice.call('POST', '/auth/delete', { password: 'a long enough password' });
  assert.equal(del.status, 200); assert.match(del.setCookie, /Max-Age=0/);
  assert.equal((await client(env).call('POST', '/auth/login', { username: 'alice', password: 'a long enough password' })).status, 401);
  assert.equal((await admin.call('POST', '/auth/delete', { password: ADMIN.pass })).data.error, 'last_admin');
  const out = await admin.call('POST', '/auth/logout');
  assert.match(out.setCookie, /Max-Age=0/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n, 0);
});

test('sync: per user, optimistic concurrency (409 returns the current copy), normalized, size-limited', async () => {
  const env = mkEnv();
  const admin = await adminClient(env);
  const code = await invite(admin, { maxUses: null });
  const { c: a } = await signup(env, 'alice', code);
  const { c: b } = await signup(env, 'bob', code);
  assert.deepEqual((await a.call('GET', '/sync')).data, { doc: null, version: 0 });
  const doc = { history: { 'movie:1': { type: 'movie', id: 1, title: 'A', ts: 5 } }, settings: { ts: 1, value: { autoNext: false, gatewayToken: 'secret!' } } };
  assert.deepEqual((await a.call('PUT', '/sync', { doc, version: 0 })).data, { version: 1 });
  const stale = await a.call('PUT', '/sync', { doc: {}, version: 0 });
  assert.equal(stale.status, 409); assert.equal(stale.data.version, 1); assert.ok(stale.data.doc.history['movie:1'], 'conflict hands back the current copy');
  const got = (await a.call('GET', '/sync')).data;
  assert.equal(got.version, 1); assert.deepEqual(got.doc.settings.value, { autoNext: false }, 'stored normalized: no device secrets');
  assert.equal((await a.call('PUT', '/sync', { doc, version: 1 })).data.version, 2);
  const staleUpdate = await a.call('PUT', '/sync', { doc: {}, version: 1 });
  assert.equal(staleUpdate.status, 409, 'a write based on an older version never overwrites a newer one');
  assert.ok((await a.call('GET', '/sync')).data.doc.history['movie:1'], 'nothing was lost');
  assert.deepEqual((await b.call('GET', '/sync')).data, { doc: null, version: 0 }, 'users never see each other’s data');
  assert.equal((await client(env).call('GET', '/sync')).status, 401);
  const big = { history: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`movie:${i}`, { type: 'movie', id: i, title: 'x'.repeat(200), ts: i }])) };
  assert.equal((await a.call('PUT', '/sync', { doc: big, version: 2 })).status, 413);
  assert.equal((await a.call('PUT', '/sync', { doc, version: -1 })).status, 400);
  assert.equal((await a.call('DELETE', '/sync')).status, 405);
});

test('passwords: PBKDF2 with the iteration count stored; old hashes are upgraded on sign-in', async () => {
  const h = await hashPassword('some password here', { PBKDF2_ITERATIONS: '10000' });
  assert.match(h, /^pbkdf2-sha256\$10000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.equal(await verifyPassword('some password here', h), true);
  assert.equal(await verifyPassword('some password herE', h), false);
  assert.notEqual(h, await hashPassword('some password here', { PBKDF2_ITERATIONS: '10000' }), 'random salt');
  assert.match(await hashPassword('x'.repeat(10), {}), /^pbkdf2-sha256\$100000\$/, 'default = Workers maximum');
  const env = mkEnv();
  await adminClient(env); // admin hashed with 10000
  const env2 = { ...env, PBKDF2_ITERATIONS: '20000' };
  await client(env2).call('POST', '/auth/login', { username: ADMIN.name, password: ADMIN.pass });
  assert.match((await env.DB.prepare('SELECT pass FROM users').first()).pass, /^pbkdf2-sha256\$20000\$/);
});

test('routing: unknown account routes 404, GET on POST-only 404, health reports accounts', async () => {
  const env = mkEnv();
  const c = client(env);
  assert.equal((await c.call('GET', '/auth/login')).status, 404);
  assert.equal((await c.call('GET', '/auth/whatever')).status, 404);
  assert.equal((await c.call('GET', '/admin/users/1/reset')).status, 401);
  assert.equal((await (await handleApi(new Request('https://x/api/health'), env)).json()).accounts, true);
});

test('sessions expire after 30 days without use; use within the window extends them', async () => {
  let t = 10_000_000;
  const env = mkEnv();
  const c = client(env, { clock: () => t });
  await c.call('POST', '/auth/login', { username: ADMIN.name, password: ADMIN.pass });
  t += 20 * 86400000;
  const mid = await c.call('GET', '/auth/me');
  assert.equal(mid.data.user.username, ADMIN.name); assert.match(mid.setCookie || '', /Max-Age=2592000/, 'cookie refreshed');
  t += 25 * 86400000; // 45 days after login, 25 after last use
  assert.equal((await c.call('GET', '/auth/me')).data.user.username, ADMIN.name, 'sliding expiry');
  t += 31 * 86400000;
  assert.equal((await c.call('GET', '/auth/me')).data.user, null, 'expired');
});

// The browser-side account + sync engine against the real API router and database: two devices, one account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.js';
import { createD1 } from '../dev/d1-sqlite.mjs';
import { createStore } from '../public/js/store.js';
import { createAccount } from '../public/js/account.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const env = () => ({ DB: createD1(), ADMIN_USERNAME: 'owner', ADMIN_PASSWORD: 'correct horse battery staple', PBKDF2_ITERATIONS: '10000' });

/** A device: its own storage, store, cookie jar and account client; requests go to the real handler. */
function device(e, { fail, beforePut, delays } = {}) {
  let cookie = '';
  const calls = [];
  const fetchImpl = async (path, init = {}) => {
    calls.push(`${init.method || 'GET'} ${path}`);
    if (fail && fail(path, init)) throw new TypeError('Failed to fetch');
    if (beforePut && init.method === 'PUT') { const f = beforePut; beforePut = null; await f(); }
    const headers = { ...(init.headers || {}), ...(cookie ? { cookie } : {}), origin: 'https://site.example' };
    const res = await handleApi(new Request('https://site.example' + path, { ...init, headers }), e);
    const set = res.headers.get('set-cookie');
    if (set) { const m = /rh_session=([^;]*)/.exec(set); cookie = m && m[1] ? `rh_session=${m[1]}` : ''; }
    return res;
  };
  const storage = mem();
  const store = createStore(storage);
  const account = createAccount({ store, fetchImpl, storage, delays });
  return { store, account, calls, storage };
}
async function setup() {
  const e = env();
  const admin = device(e);
  await admin.account.init();
  await admin.account.signIn('owner', 'correct horse battery staple');
  const { code } = await admin.account.admin.createInvite({ maxUses: 5 });
  return { e, admin, code };
}

test('sign up with an invite; what was on the device before goes into the account', async (t) => {
  const { e, admin, code } = await setup();
  const phone = device(e);
  t.after(() => { phone.account.destroy(); admin.account.destroy(); });
  assert.equal((await phone.account.init()).enabled, true);
  phone.store.pushHistory({ type: 'movie', id: 1, title: 'Watched before signing up' });
  const user = await phone.account.signUp('alice', 'a long enough password', code);
  assert.deepEqual(user, { username: 'alice', role: 'user' });
  assert.equal(phone.account.state().sync, 'ok');
  const laptop = device(e);
  t.after(() => laptop.account.destroy());
  await laptop.account.signIn('alice', 'a long enough password');
  assert.deepEqual(laptop.store.history().map((h) => h.title), ['Watched before signing up'], 'arrives on the other device');
});

test('two devices: lists, removals and settings sync both ways; nothing removed comes back', async (t) => {
  const { e, admin, code } = await setup();
  const phone = device(e); const laptop = device(e);
  t.after(() => { phone.account.destroy(); laptop.account.destroy(); admin.account.destroy(); });
  await phone.account.signUp('bob', 'a long enough password', code);
  await laptop.account.signIn('bob', 'a long enough password');
  const id = phone.store.createList('Weekend');
  phone.store.addToList(id, { type: 'tv', id: 1396, title: 'Breaking Bad' });
  phone.store.pushHistory({ type: 'movie', id: 2, title: 'Two' });
  phone.store.saveSettings({ autoNext: false });
  await phone.account.flush();
  await laptop.account.syncNow();
  assert.equal(laptop.store.lists().find((l) => l.name === 'Weekend').items[0].title, 'Breaking Bad');
  assert.equal(laptop.store.settings().autoNext, false);
  laptop.store.removeHistory('movie', 2);
  laptop.store.removeFromList(id, 'tv', 1396);
  await laptop.account.flush();
  // the phone still has its old copy and pushes something unrelated: the removals must survive
  phone.store.pushHistory({ type: 'movie', id: 3, title: 'Three' });
  await phone.account.flush();
  assert.deepEqual(phone.store.history().map((h) => h.id), [3]);
  assert.equal(phone.store.lists().find((l) => l.name === 'Weekend').items.length, 0);
  await laptop.account.syncNow();
  assert.deepEqual(laptop.store.history().map((h) => h.id), [3]);
});

test('simultaneous writes from two devices: the conflict is merged, both changes kept', async (t) => {
  const { e, admin, code } = await setup();
  const a = device(e); const b = device(e);
  t.after(() => { a.account.destroy(); b.account.destroy(); admin.account.destroy(); });
  await a.account.signUp('carol', 'a long enough password', code);
  await b.account.signIn('carol', 'a long enough password');
  a.store.pushHistory({ type: 'movie', id: 10, title: 'A side' });
  b.store.pushHistory({ type: 'movie', id: 20, title: 'B side' });
  await Promise.all([a.account.flush(), b.account.flush()]);
  await a.account.syncNow(); await b.account.syncNow();
  for (const d of [a, b]) assert.deepEqual(d.store.history().map((h) => h.id).sort(), [10, 20]);
  assert.ok(a.calls.concat(b.calls).filter((c) => c.startsWith('PUT')).length >= 2);
});

test('sign out removes the account data from the device (device settings stay); offline keeps working', async (t) => {
  const { e, admin, code } = await setup();
  const failing = { on: false };
  const d = device(e, { fail: () => failing.on });
  t.after(() => { d.account.destroy(); admin.account.destroy(); });
  await d.account.signUp('dave', 'a long enough password', code);
  d.store.saveSettings({ gatewayUrl: 'http://127.0.0.1:8787' });
  d.store.pushHistory({ type: 'movie', id: 5, title: 'Five' });
  failing.on = true;
  await d.account.syncNow();
  assert.equal(d.account.state().sync, 'error'); assert.match(d.account.state().error, /connection/);
  assert.equal(d.store.history().length, 1, 'still there locally');
  failing.on = false;
  await d.account.syncNow();
  assert.equal(d.account.state().sync, 'ok', 'recovers');
  await d.account.signOut();
  assert.equal(d.account.state().user, null);
  assert.equal(d.store.history().length, 0, 'account data removed from this device');
  assert.equal(d.store.settings().gatewayUrl, 'http://127.0.0.1:8787', 'device setting kept');
  const back = device(e);
  t.after(() => back.account.destroy());
  await back.account.signIn('dave', 'a long enough password');
  assert.deepEqual(back.store.history().map((h) => h.id), [5], 'the data is safe in the account');
});

test('signed out elsewhere (password changed on another device): sync stops and the state says so', async (t) => {
  const { e, admin, code } = await setup();
  const a = device(e); const b = device(e);
  t.after(() => { a.account.destroy(); b.account.destroy(); admin.account.destroy(); });
  await a.account.signUp('erin', 'a long enough password', code);
  await b.account.signIn('erin', 'a long enough password');
  await a.account.changePassword('a long enough password', 'a different password!');
  await b.account.syncNow();
  assert.equal(b.account.state().user, null); assert.equal(b.account.state().error, 'signed_out');
  await assert.rejects(a.account.changePassword('wrong', 'x'), (err) => err.status === 403);
});

test('accounts not configured: init says so and nothing else is attempted', async (t) => {
  const d = device({});
  t.after(() => d.account.destroy());
  assert.equal((await d.account.init()).enabled, false);
  assert.deepEqual(d.calls, ['GET /api/auth/me']);
});

test('conflict: another device writes between our read and our write; both changes end up everywhere', async (t) => {
  const { e, admin, code } = await setup();
  const b = device(e);
  t.after(() => { b.account.destroy(); admin.account.destroy(); });
  await b.account.signUp('frank', 'a long enough password', code);
  const a = device(e, { beforePut: async () => { b.store.pushHistory({ type: 'movie', id: 20, title: 'B' }); await b.account.flush(); } });
  t.after(() => a.account.destroy());
  a.store.pushHistory({ type: 'movie', id: 10, title: 'A' });
  await a.account.signIn('frank', 'a long enough password'); // sign-in syncs: GET, then (B writes) PUT -> 409 -> merge -> PUT
  assert.ok(a.calls.filter((c) => c === 'PUT /api/sync').length >= 2, 'the first write was refused and retried');
  assert.deepEqual(a.store.history().map((h) => h.id).sort(), [10, 20], 'B\u2019s change merged in on A');
  await b.account.syncNow();
  assert.deepEqual(b.store.history().map((h) => h.id).sort(), [10, 20], 'and A\u2019s reached B');
});

test('applying the account copy does not count as a local change (no endless sync loop)', async (t) => {
  const { e, admin, code } = await setup();
  const other = device(e);
  t.after(() => { other.account.destroy(); admin.account.destroy(); });
  await other.account.signUp('gina', 'a long enough password', code);
  other.store.pushHistory({ type: 'movie', id: 1, title: 'One' });
  await other.account.flush();
  const d = device(e, { delays: { push: 20, progress: 20 } });
  t.after(() => d.account.destroy());
  await d.account.signIn('gina', 'a long enough password'); // imports the account copy
  const n = d.calls.length;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(d.calls.length, n, 'quiet after syncing: ' + d.calls.slice(n).join(', '));
  d.store.addToList('default', { type: 'movie', id: 2, title: 'Two' }); // a real local change is pushed by itself
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(d.calls.slice(n).includes('PUT /api/sync'), 'local change pushed after the delay');
});

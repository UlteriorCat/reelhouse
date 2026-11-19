// The merge rules behind account sync: nothing is lost, nothing removed comes back, all devices converge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { merge, normalize, emptyDoc, sameDoc, LIMITS, DEFAULT_LIST } from '../public/js/sync-merge.js';
import { createStore } from '../public/js/store.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const H = (id, ts, extra = {}) => ({ type: 'movie', id, title: 'T' + id, ts, ...extra });
const doc = (o) => ({ ...emptyDoc(), ...o });

test('merge: history union keeps the newest copy of each title; caps at the limit', () => {
  const a = doc({ history: { 'movie:1': H(1, 10, { season: 1 }), 'movie:2': H(2, 20) } });
  const b = doc({ history: { 'movie:1': H(1, 30, { season: 2 }), 'movie:3': H(3, 5) } });
  const m = merge(a, b);
  assert.deepEqual(Object.keys(m.history).sort(), ['movie:1', 'movie:2', 'movie:3']);
  assert.equal(m.history['movie:1'].season, 2, 'newer watch wins');
  const many = doc({ history: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`movie:${i}`, H(i, i)])) });
  const capped = merge(many, emptyDoc());
  assert.equal(Object.keys(capped.history).length, LIMITS.history);
  assert.ok(capped.history['movie:59'] && !capped.history['movie:0'], 'the newest are kept');
});

test('merge: a removal on one device is not undone by an older copy on another; a newer watch beats the removal', () => {
  const phone = doc({ history: {}, historyDel: { 'movie:1': 50 } });
  const laptop = doc({ history: { 'movie:1': H(1, 40) } });
  assert.equal(merge(phone, laptop).history['movie:1'], undefined, 'removed at 50, laptop copy from 40: stays removed');
  assert.equal(merge(laptop, phone).history['movie:1'], undefined, 'either order');
  const watchedAgain = doc({ history: { 'movie:1': H(1, 60) } });
  assert.ok(merge(phone, watchedAgain).history['movie:1'], 'watched again after the removal: back');
});

test('merge: lists — items LWW with tombstones, renames LWW, deleted lists stay deleted unless changed later, My List never deleted', () => {
  const L = (id, o) => ({ id, name: o.name || id, nameTs: o.nameTs || 1, created: o.created || 1, ts: o.ts || 1, items: o.items || {}, itemsDel: o.itemsDel || {} });
  const a = doc({ lists: { x: L('x', { name: 'Old', nameTs: 5, ts: 20, items: { 'movie:1': H(1, 10) } }), [DEFAULT_LIST]: L(DEFAULT_LIST, { name: 'My List' }) } });
  const b = doc({ lists: { x: L('x', { name: 'New', nameTs: 9, ts: 30, itemsDel: { 'movie:1': 15 }, items: { 'tv:2': { type: 'tv', id: 2, ts: 25 } } }) }, listsDel: { [DEFAULT_LIST]: 99 } });
  const m = merge(a, b);
  assert.equal(m.lists.x.name, 'New');
  assert.deepEqual(Object.keys(m.lists.x.items), ['tv:2'], 'item removed at 15 after being added at 10');
  assert.ok(m.lists[DEFAULT_LIST], 'a tombstone for My List is ignored');
  const del = doc({ listsDel: { x: 40 } });
  assert.equal(merge(m, del).lists.x, undefined, 'deleted at 40 after the last change at 30');
  const laterEdit = doc({ lists: { x: L('x', { ts: 50, items: { 'movie:9': H(9, 50) } }) } });
  assert.ok(merge(del, laterEdit).lists.x, 'changed after the deletion: kept (nothing added is silently lost)');
});

test('merge: progress and settings are last-writer-wins', () => {
  const a = doc({ progress: { k: { pos: 10, dur: 100, ts: 1 } }, settings: { ts: 5, value: { autoNext: false } } });
  const b = doc({ progress: { k: { pos: 50, dur: 100, ts: 2 } }, settings: { ts: 3, value: { autoNext: true } } });
  const m = merge(a, b);
  assert.equal(m.progress.k.pos, 50); assert.equal(m.settings.value.autoNext, false);
});

test('merge: commutative, idempotent, associative on random documents (devices converge)', () => {
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const randomDoc = () => {
    const d = emptyDoc();
    for (let i = 0; i < 8; i++) d.history[`movie:${rnd(6)}`] = H(rnd(6), rnd(100));
    for (let i = 0; i < 4; i++) d.historyDel[`movie:${rnd(6)}`] = rnd(100);
    for (const id of ['default', 'a', 'b']) if (rnd(2)) d.lists[id] = { id, name: 'n' + rnd(3), nameTs: rnd(50), created: rnd(9), ts: rnd(100), items: { [`tv:${rnd(4)}`]: { type: 'tv', id: rnd(4), ts: rnd(100) } }, itemsDel: { [`tv:${rnd(4)}`]: rnd(100) } };
    if (rnd(2)) d.listsDel.a = rnd(100);
    d.progress[`p${rnd(3)}`] = { pos: rnd(100), dur: 100, ts: rnd(100) };
    d.settings = { ts: rnd(10), value: { autoNext: !!rnd(2) } };
    return d;
  };
  for (let i = 0; i < 300; i++) {
    const [a, b, c] = [randomDoc(), randomDoc(), randomDoc()];
    assert.ok(sameDoc(merge(a, b), merge(b, a)), 'commutative');
    assert.ok(sameDoc(merge(a, a), normalize(a)) || sameDoc(merge(merge(a, a), a), merge(a, a)), 'idempotent');
    assert.ok(sameDoc(merge(merge(a, b), b), merge(a, b)), 'merging again changes nothing');
    assert.ok(sameDoc(merge(merge(a, b), c), merge(a, merge(b, c))), 'associative');
  }
});

test('normalize: hostile or malformed input becomes a safe document', () => {
  const n = normalize({ history: { x: 'str', y: { type: 'person', id: 1 }, z: H(3, 1) }, lists: { q: null, w: { name: 'A'.repeat(500), items: 5 } }, progress: { a: { pos: 'x' } }, settings: { ts: 'no', value: { gatewayToken: 'secret', autoNext: true } }, __proto__: { polluted: 1 } });
  assert.deepEqual(Object.keys(n.history), ['z']);
  assert.equal(n.lists.w.name.length, LIMITS.listName); assert.deepEqual(n.lists.w.items, {});
  assert.deepEqual(n.progress, {});
  assert.deepEqual(n.settings, { ts: 0, value: { autoNext: true } }, 'only synced settings survive; never the gateway token');
  assert.equal({}.polluted, undefined);
});

test('two devices through the store: changes, removals and settings meet in the middle', () => {
  let t = 100; const now = () => t;
  const phone = createStore(mem(), { now }); const laptop = createStore(mem(), { now });
  phone.pushHistory({ type: 'movie', id: 1, title: 'A' }); t++;
  laptop.pushHistory({ type: 'movie', id: 2, title: 'B' }); t++;
  const listId = laptop.createList('Kids'); laptop.addToList(listId, { type: 'movie', id: 3, title: 'C' }); t++;
  laptop.saveSettings({ autoNext: false, gatewayUrl: 'http://laptop-only' }); t++;
  const server1 = phone.importDoc(laptop.exportDoc());
  laptop.importDoc(server1);
  assert.deepEqual(phone.history().map((h) => h.id).sort(), [1, 2]);
  assert.equal(phone.lists().find((l) => l.name === 'Kids').items[0].title, 'C');
  assert.equal(phone.settings().autoNext, false, 'synced setting arrives');
  assert.equal(phone.settings().gatewayUrl, '', 'device setting does not travel');
  t++; phone.removeHistory('movie', 2); phone.removeFromList(listId, 'movie', 3); t++;
  laptop.importDoc(phone.exportDoc());
  assert.deepEqual(laptop.history().map((h) => h.id), [1], 'removal reached the laptop');
  assert.equal(laptop.lists().find((l) => l.name === 'Kids').items.length, 0);
  phone.importDoc(laptop.exportDoc());
  assert.deepEqual(phone.history().map((h) => h.id), [1], 'and did not come back');
  phone.clearAccountData();
  assert.equal(phone.history().length, 0); assert.equal(phone.lists()[0].items.length, 0);
  assert.equal(phone.settings().autoNext, true, 'synced settings removed with the account data');
});

test('normalize/merge: keys like __proto__ in a stored document are dropped, never turned into prototypes', () => {
  const evil = JSON.parse('{"history":{"__proto__":{"type":"movie","id":1,"ts":5,"polluted":true},"movie:2":{"type":"movie","id":2,"ts":1}},"historyDel":{"__proto__":{"x":1}},"lists":{"__proto__":{"name":"x"},"a":{"name":"A","items":{"__proto__":{"type":"tv","id":3,"ts":9}}}}}');
  const n = normalize(evil);
  for (const m of [n, merge(evil, emptyDoc()), merge(emptyDoc(), evil)]) {
    assert.deepEqual(Object.keys(m.history), ['movie:2']);
    assert.equal(Object.getPrototypeOf(m.history), Object.prototype);
    assert.equal(m.history.polluted, undefined);
    assert.deepEqual(Object.keys(m.lists).sort(), ['a']);
    assert.deepEqual(Object.keys(m.lists.a.items), []);
    assert.equal(Object.getPrototypeOf(m.lists.a.items), Object.prototype);
  }
});

test('merge: without a tombstone nothing is removed, even items or lists whose time is 0 (old data, a new empty My List)', () => {
  const a = doc({ history: { 'movie:1': { type: 'movie', id: 1, title: 'no time' } }, lists: { default: { id: 'default', name: 'My List', ts: 0, items: { 'tv:2': { type: 'tv', id: 2 } } } } });
  for (const m of [merge(a, emptyDoc()), merge(emptyDoc(), a)]) {
    assert.ok(m.history['movie:1'], 'item without a time kept');
    assert.ok(m.lists.default && m.lists.default.items['tv:2'], 'list and item with time 0 kept');
  }
  assert.equal(merge(a, doc({ historyDel: { 'movie:1': 0 } })).history['movie:1'], undefined, 'a real tombstone (even at 0) still removes');
});

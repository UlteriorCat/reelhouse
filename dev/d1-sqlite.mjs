// A Cloudflare D1 stand-in on Node's built-in SQLite, for the dev server and the tests. Implements the part of the
// D1 API that lib/accounts.js uses: prepare().bind().first()/all()/run(), and batch() (atomic, like D1's).
// Not deployed: on Cloudflare the real D1 binding (env.DB) is used.
import { DatabaseSync } from 'node:sqlite';

export function createD1(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first(col) { const row = db.prepare(sql).get(...args); return row === undefined ? null : col ? row[col] : { ...row }; },
    async all() { return { results: db.prepare(sql).all(...args).map((r) => ({ ...r })), success: true, meta: {} }; },
    async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    _run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      db.exec('BEGIN IMMEDIATE');
      try { const out = list.map((s) => s._run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async exec(sql) { db.exec(sql); return { count: 1 }; },
    close: () => db.close(),
  };
}

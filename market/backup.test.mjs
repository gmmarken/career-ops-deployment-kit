import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupDb, prune, offsite, KEEP } from './backup.mjs';

function liveDb() {
  const d = mkdtempSync(join(tmpdir(), 'bk-'));
  const path = join(d, 'market.db');
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE p (id INTEGER PRIMARY KEY, t TEXT); INSERT INTO p (t) VALUES ('a'), ('b');");
  return { d, path, db };
}

test('backup copies a database that is still open, and the copy is complete', () => {
  const { d, path, db } = liveDb(); // left open on purpose: the daily run may overlap other work
  db.exec("INSERT INTO p (t) VALUES ('c')");
  const out = backupDb(path, join(d, 'backups'), '2026-11-03');
  db.close();
  const copy = new DatabaseSync(out, { readOnly: true });
  assert.equal(copy.prepare('SELECT count(*) AS n FROM p').get().n, 3);
  copy.close();
  assert.deepEqual(readdirSync(join(d, 'backups')), ['market-2026-11-03.db'], 'no .partial left behind');
});

test('a second backup the same day replaces the first', () => {
  const { d, path, db } = liveDb(); db.close();
  backupDb(path, join(d, 'b'), '2026-11-03');
  backupDb(path, join(d, 'b'), '2026-11-03');
  assert.deepEqual(readdirSync(join(d, 'b')), ['market-2026-11-03.db']);
});

test('backup fails loudly on a missing database or bad date', () => {
  const d = mkdtempSync(join(tmpdir(), 'bk-'));
  assert.throws(() => backupDb(join(d, 'nope.db'), d, '2026-11-03'), /market database not found/);
  const { path, db } = liveDb(); db.close();
  assert.throws(() => backupDb(path, d, 'today'), /bad date/);
});

test(`prune keeps the newest ${KEEP} dated copies and ignores other files`, () => {
  const d = mkdtempSync(join(tmpdir(), 'bk-'));
  for (let i = 1; i <= 35; i++) writeFileSync(join(d, `market-2026-${String(Math.ceil(i / 28) + 9).padStart(2, '0')}-${String(((i - 1) % 28) + 1).padStart(2, '0')}.db`), '');
  writeFileSync(join(d, 'notes.txt'), '');
  const gone = prune(d);
  assert.equal(gone.length, 5);
  assert.deepEqual(gone.sort(), ['market-2026-10-01.db', 'market-2026-10-02.db', 'market-2026-10-03.db', 'market-2026-10-04.db', 'market-2026-10-05.db']);
  assert.equal(readdirSync(d).length, KEEP + 1);
});

test('offsite writes one market-latest.db and fails loudly when the folder is missing', () => {
  const { d, path, db } = liveDb(); db.close();
  const file = backupDb(path, join(d, 'b'), '2026-11-03');
  const off = join(d, 'icloud'); mkdirSync(off);
  offsite(file, off); offsite(file, off);
  assert.deepEqual(readdirSync(off), ['market-latest.db']);
  assert.throws(() => offsite(file, join(d, 'missing')), /does not exist/);
  assert.throws(() => offsite(file, ''), /no offsite folder/);
  assert.ok(existsSync(file));
});

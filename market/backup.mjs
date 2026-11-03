// market.db backups (D54): a dated, consistent copy made with SQLite's VACUUM INTO
// (safe while the database is open), the newest KEEP kept, plus one offsite copy.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const KEEP = 30;
const NAME = /^market-(\d{4}-\d{2}-\d{2})\.db$/;

/** Make <dir>/market-<date>.db from the live database. Replaces a same-day copy. Returns the path. */
export function backupDb(dbPath, dir, date) {
  if (!existsSync(dbPath)) throw new Error(`backup: market database not found at ${dbPath}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`backup: bad date "${date}" (want YYYY-MM-DD)`);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `market-${date}.db`);
  const tmp = `${out}.partial`;
  rmSync(tmp, { force: true });
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.prepare('VACUUM INTO ?').run(tmp);
  } finally {
    db.close();
  }
  const check = new DatabaseSync(tmp, { readOnly: true });
  try {
    const r = check.prepare('PRAGMA integrity_check').get();
    const v = Object.values(r)[0];
    if (v !== 'ok') throw new Error(`backup: integrity check on the new copy failed: ${v}`);
  } finally {
    check.close();
  }
  renameSync(tmp, out);
  return out;
}

/** Delete dated copies beyond the newest `keep`. Returns the names removed. */
export function prune(dir, keep = KEEP) {
  const dated = readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse();
  const gone = dated.slice(keep);
  for (const f of gone) rmSync(join(dir, f));
  return gone;
}

/** Copy a finished backup to the offsite folder as market-latest.db (one copy, overwritten daily). */
export function offsite(file, offsiteDir) {
  if (!offsiteDir) throw new Error('backup: no offsite folder set (icloud_dir in private/config/daily.json).');
  if (!existsSync(offsiteDir) || !statSync(offsiteDir).isDirectory()) {
    throw new Error(`backup: offsite folder ${offsiteDir} does not exist. Create it (in iCloud Drive) or fix icloud_dir in private/config/daily.json.`);
  }
  const out = join(offsiteDir, 'market-latest.db');
  const tmp = `${out}.partial`;
  copyFileSync(file, tmp);
  renameSync(tmp, out);
  return out;
}

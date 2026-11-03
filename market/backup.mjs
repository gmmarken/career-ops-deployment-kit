// market.db backups (D54, D59): a dated, consistent copy made with SQLite's VACUUM INTO
// (safe while the database is open), the newest KEEP kept. The offsite copy is iCloud's own sync
// of the folder the workspace lives in (D58), checked on every run rather than assumed.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

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

const ICLOUD_MARK = 'com.apple.icloud.desktop'; // set on ~/Desktop and ~/Documents when "Desktop & Documents Folders" sync is on

/** True if macOS has marked this folder as synced by iCloud Desktop & Documents. */
export function hasICloudMark(path) {
  const names = execFileSync('xattr', [path], { encoding: 'utf8' });
  return names.split('\n').includes(ICLOUD_MARK);
}

/**
 * Which iCloud-synced folder holds `dir`: iCloud Drive itself, or ~/Desktop / ~/Documents with
 * Desktop & Documents sync on. Throws if none does, so "backed up to iCloud" is never claimed falsely.
 */
export function iCloudRoot(dir, { home = homedir(), marked = hasICloudMark } = {}) {
  const real = realpathSync(dir);
  const inside = (root) => real === root || real.startsWith(root + sep);
  const drive = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  if (inside(drive)) return drive;
  for (const name of ['Documents', 'Desktop']) {
    const root = join(home, name);
    if (inside(root) && marked(root)) return root;
  }
  throw new Error(`backup: ${real} is not in an iCloud-synced folder, so backups are on this Mac only. Turn on iCloud Drive → "Desktop & Documents Folders", or move the workspace back under ~/Documents (D58).`);
}

// Market database: the long-term source of truth for postings, companies, scans,
// and tier history (D30). One SQLite file in the private data dir, via Node's
// built-in node:sqlite (no dependency). Notion is a working view synced from here.
//
// Time model: a posting is open from first_seen (or its earlier posted_at) until
// closed_at; until it closes, last_seen is the latest day it was confirmed live.
// Every scan is logged so "no postings" can be told apart from "didn't look".
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { titleFamily, TITLE_CLASSIFIER_VERSION } from './classify.mjs';

export const SCHEMA_VERSION = 1;
export const CLOSE_AFTER_MISSES = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_seen TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS postings (
  id INTEGER PRIMARY KEY,
  url_key TEXT NOT NULL UNIQUE,
  url TEXT,
  board TEXT,
  company_id INTEGER REFERENCES companies(id),
  title TEXT NOT NULL,
  locations TEXT NOT NULL DEFAULT '[]',
  in_home_metro INTEGER,
  workplace TEXT,
  pay_min REAL, pay_max REAL, pay_currency TEXT, pay_interval TEXT, pay_source TEXT,
  posted_at TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  closed_at TEXT,
  miss_count INTEGER NOT NULL DEFAULT 0,
  title_family TEXT NOT NULL,
  title_classifier TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS postings_company ON postings(company_id);
CREATE INDEX IF NOT EXISTS postings_board ON postings(board);
CREATE TABLE IF NOT EXISTS tier_decisions (
  id INTEGER PRIMARY KEY,
  posting_id INTEGER NOT NULL REFERENCES postings(id),
  decided_at TEXT NOT NULL,
  tier TEXT NOT NULL,
  ai_family TEXT,
  flags TEXT NOT NULL,
  steps TEXT NOT NULL,
  facts TEXT NOT NULL,
  rules_hash TEXT,
  prompt_hash TEXT
);
CREATE INDEX IF NOT EXISTS tiers_posting ON tier_decisions(posting_id);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  found INTEGER,
  error TEXT
);
CREATE TABLE IF NOT EXISTS recall_checks (
  id INTEGER PRIMARY KEY,
  checked_at TEXT NOT NULL,
  source TEXT NOT NULL,
  total INTEGER NOT NULL,
  matched INTEGER NOT NULL,
  entries TEXT NOT NULL
);
`;

const day = (d = new Date()) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

/** Stable identity for a posting URL: host + path, no query/fragment/trailing slash or /application. */
export function urlKey(url) {
  const u = new URL(url);
  let path = u.pathname.replace(/\/application\/?$/i, '').replace(/\/+$/, '');
  if (/(^|\.)ashbyhq\.com$/i.test(u.hostname)) path = path.toLowerCase(); // Ashby board names are case-insensitive
  return `${u.hostname.toLowerCase()}${path}`;
}

/** Identity for a posting without a URL (pasted JD): company + title. */
export const textKey = (company, title) => `nourl:${String(company).toLowerCase().trim()}|${String(title).toLowerCase().trim()}`;

export function defaultDbPath(dataDir = process.env.CAREER_OPS_DATA_DIR) {
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set.');
  return join(dataDir, 'data', 'market.db');
}

export function openStore(path = defaultDbPath()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const v = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!v) db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  else if (Number(v.value) !== SCHEMA_VERSION) throw new Error(`market.db is schema v${v.value}; this code expects v${SCHEMA_VERSION}. Migrate before running.`);
  return new Store(db);
}

class Store {
  constructor(db) { this.db = db; }
  close() { this.db.close(); }

  /** Insert or touch a company by name (case-insensitive). Returns its id. */
  company(name, at = new Date()) {
    if (!name?.trim()) throw new Error('Company name is required.');
    const d = day(at);
    const row = this.db.prepare('SELECT id FROM companies WHERE name = ?').get(name.trim());
    if (row) { this.db.prepare('UPDATE companies SET updated_at = ? WHERE id = ?').run(d, row.id); return row.id; }
    return Number(this.db.prepare('INSERT INTO companies (name, first_seen, updated_at) VALUES (?, ?, ?)').run(name.trim(), d, d).lastInsertRowid);
  }

  /**
   * Record that a posting was seen live on `at`. New postings get first_seen; known ones
   * get last_seen bumped and, if they had been closed, reopen. Returns { id, isNew }.
   */
  seePosting(p, at = new Date()) {
    const d = day(at);
    if (!p.title) throw new Error('Posting title is required.');
    const key = p.url ? urlKey(p.url) : textKey(p.company, p.title);
    const companyId = this.company(p.company, at);
    const pay = p.pay ?? {};
    const existing = this.db.prepare('SELECT id, first_seen FROM postings WHERE url_key = ?').get(key);
    const fields = {
      url: p.url ?? null, board: p.board ?? null, company_id: companyId, title: p.title,
      locations: JSON.stringify(p.locations ?? []), in_home_metro: p.in_home_metro == null ? null : Number(Boolean(p.in_home_metro)),
      workplace: p.workplace ?? null, pay_min: pay.min ?? null, pay_max: pay.max ?? null, pay_currency: pay.currency ?? null,
      pay_interval: pay.interval ?? null, pay_source: pay.source ?? null, posted_at: p.posted_at ?? null,
    };
    if (existing) {
      const firstSeen = d < existing.first_seen ? d : existing.first_seen;
      this.db.prepare(`UPDATE postings SET url = ?, board = ?, company_id = ?, title = ?, locations = ?, in_home_metro = ?, workplace = ?,
        pay_min = ?, pay_max = ?, pay_currency = ?, pay_interval = ?, pay_source = ?, posted_at = COALESCE(?, posted_at),
        first_seen = ?, last_seen = MAX(last_seen, ?), closed_at = NULL, miss_count = 0 WHERE id = ?`)
        .run(...Object.values(fields), firstSeen, d, existing.id);
      return { id: existing.id, isNew: false };
    }
    const id = this.db.prepare(`INSERT INTO postings (url, board, company_id, title, locations, in_home_metro, workplace,
      pay_min, pay_max, pay_currency, pay_interval, pay_source, posted_at, url_key, first_seen, last_seen, title_family, title_classifier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...Object.values(fields), key, d, d, titleFamily(p.title), TITLE_CLASSIFIER_VERSION).lastInsertRowid;
    return { id: Number(id), isNew: true };
  }

  /** Save one tier decision (history; never overwritten). */
  recordTier(postingId, result, facts, { at = new Date(), rulesHash = null, promptHash = null } = {}) {
    this.db.prepare(`INSERT INTO tier_decisions (posting_id, decided_at, tier, ai_family, flags, steps, facts, rules_hash, prompt_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(postingId, new Date(at).toISOString(), result.tier, facts.judgment?.role_family?.value ?? null,
      JSON.stringify(result.flags), JSON.stringify(result.steps), JSON.stringify(facts), rulesHash, promptHash);
  }

  startScan(source, at = new Date()) {
    return Number(this.db.prepare('INSERT INTO scans (source, started_at) VALUES (?, ?)').run(source, new Date(at).toISOString()).lastInsertRowid);
  }
  finishScan(id, { status, found = null, error = null }, at = new Date()) {
    if (!['ok', 'error'].includes(status)) throw new Error(`scan status must be ok or error, got ${status}`);
    this.db.prepare('UPDATE scans SET finished_at = ?, status = ?, found = ?, error = ? WHERE id = ?').run(new Date(at).toISOString(), status, found, error, id);
  }

  /**
   * After a COMPLETE, successful scan of one board: every open posting on that board
   * not seen in this scan gets a miss; after CLOSE_AFTER_MISSES misses it closes on its
   * last_seen day. Never call this after a failed or partial scan.
   */
  closeMissing(board, seenUrls, at = new Date()) {
    const seen = new Set(seenUrls.map(urlKey));
    const open = this.db.prepare('SELECT id, url_key, miss_count, last_seen FROM postings WHERE board = ? AND closed_at IS NULL').all(board);
    let closed = 0;
    for (const r of open) {
      if (seen.has(r.url_key)) continue;
      const misses = r.miss_count + 1;
      if (misses >= CLOSE_AFTER_MISSES) { this.db.prepare('UPDATE postings SET miss_count = ?, closed_at = last_seen WHERE id = ?').run(misses, r.id); closed++; }
      else this.db.prepare('UPDATE postings SET miss_count = ? WHERE id = ?').run(misses, r.id);
    }
    return { checked: open.length, closed };
  }

  recordRecall({ source, total, matched, entries }, at = new Date()) {
    this.db.prepare('INSERT INTO recall_checks (checked_at, source, total, matched, entries) VALUES (?, ?, ?, ?, ?)')
      .run(new Date(at).toISOString(), source, total, matched, JSON.stringify(entries));
  }

  /** All postings joined with company name and latest tier, for metrics and sync. */
  postings() {
    return this.db.prepare(`SELECT p.*, c.name AS company,
      (SELECT tier FROM tier_decisions t WHERE t.posting_id = p.id ORDER BY decided_at DESC, id DESC LIMIT 1) AS tier,
      (SELECT ai_family FROM tier_decisions t WHERE t.posting_id = p.id ORDER BY decided_at DESC, id DESC LIMIT 1) AS ai_family
      FROM postings p JOIN companies c ON c.id = p.company_id`).all()
      .map((r) => ({ ...r, locations: JSON.parse(r.locations), in_home_metro: r.in_home_metro == null ? null : Boolean(r.in_home_metro) }));
  }
  scans() { return this.db.prepare('SELECT * FROM scans ORDER BY started_at').all(); }

  /** Latest tier decision for a posting, parsed, or null. */
  latestDecision(postingId) {
    const r = this.db.prepare('SELECT * FROM tier_decisions WHERE posting_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1').get(postingId);
    return r ? { ...r, flags: JSON.parse(r.flags), steps: JSON.parse(r.steps), facts: JSON.parse(r.facts) } : null;
  }
  companies() { return this.db.prepare('SELECT * FROM companies ORDER BY name').all(); }
}

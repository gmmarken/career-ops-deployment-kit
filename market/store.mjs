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

export const SCHEMA_VERSION = 5;
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

// v2 (D38–D40): company records live here, and history is append-only.
const COMPANY_COLUMNS = {
  aliases: "TEXT NOT NULL DEFAULT '[]'", status: 'TEXT', verified: 'INTEGER', watch: 'INTEGER', ai_native: 'INTEGER',
  stage: 'TEXT', last_raise: 'TEXT', investors: "TEXT NOT NULL DEFAULT '[]'", what_they_do: 'TEXT', parent: 'TEXT',
  nyc_presence: 'INTEGER', owner_categories: "TEXT NOT NULL DEFAULT '[]'", is_mbb: 'INTEGER', reason: 'TEXT',
  sources: "TEXT NOT NULL DEFAULT '[]'", origin: 'TEXT', researched_at: 'TEXT', notion_pushed: 'TEXT',
  // v5 (Phase 6, D70–D76): Company Radar enrichment and how a company was found.
  leaders: "TEXT NOT NULL DEFAULT '[]'", careers_url: 'TEXT', nyc_evidence: 'TEXT', fit_facts: 'TEXT', fit: 'TEXT', fit_reason: 'TEXT', found_via: 'TEXT',
};
const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS company_snapshots (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id),
  observed_at TEXT NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS funding_rounds (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id),
  round TEXT, amount_usd REAL, announced TEXT, investors TEXT NOT NULL DEFAULT '[]', source_url TEXT, recorded_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS funding_unique ON funding_rounds(company_id, COALESCE(announced, ''), COALESCE(round, ''), COALESCE(amount_usd, -1));
CREATE TABLE IF NOT EXISTS company_calls (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id),
  at TEXT NOT NULL, field TEXT NOT NULL, old_value TEXT, new_value TEXT, by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posting_changes (
  id INTEGER PRIMARY KEY, posting_id INTEGER NOT NULL REFERENCES postings(id),
  observed_at TEXT NOT NULL, field TEXT NOT NULL, old_value TEXT, new_value TEXT
);
CREATE TABLE IF NOT EXISTS monthly_stats (
  id INTEGER PRIMARY KEY, month TEXT NOT NULL, company_id INTEGER NOT NULL REFERENCES companies(id),
  scope TEXT NOT NULL, family TEXT NOT NULL, classifier TEXT NOT NULL, open INTEGER NOT NULL, new INTEGER NOT NULL,
  coverage_scans INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('provisional', 'frozen', 'correction')),
  computed_at TEXT NOT NULL, frozen_at TEXT, note TEXT
);
CREATE INDEX IF NOT EXISTS stats_month ON monthly_stats(month, scope, status);
CREATE TABLE IF NOT EXISTS frozen_months (month TEXT PRIMARY KEY, frozen_at TEXT NOT NULL, rows INTEGER NOT NULL);
`;

// v3 (D49–D51): the no-AI text check on borderline titles, and job boards found other
// ways than a recorded posting (an investor board, or added by hand for a watched company).
const POSTING_COLUMNS_V3 = { text_check: 'TEXT', text_check_found: 'TEXT', text_check_version: 'TEXT', text_checked_at: 'TEXT' };
const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS boards (
  board TEXT PRIMARY KEY, company TEXT NOT NULL, source TEXT NOT NULL, detail TEXT, added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS getro_jobs (
  url TEXT PRIMARY KEY, network TEXT NOT NULL, company_slug TEXT NOT NULL, title TEXT NOT NULL,
  first_seen TEXT NOT NULL, resolved_url TEXT, company TEXT, resolved_at TEXT, board TEXT
);
CREATE INDEX IF NOT EXISTS getro_company ON getro_jobs(network, company_slug);
`;

// v4 (D61): portfolio-board company pages (a16z), each checked about once a week.
const SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS portfolio_pages (
  network TEXT NOT NULL, slug TEXT NOT NULL, url TEXT NOT NULL, first_seen TEXT NOT NULL,
  checked_at TEXT, company TEXT, titles TEXT, boards TEXT, relevant INTEGER, unreadable TEXT, error TEXT,
  PRIMARY KEY (network, slug)
);
`;

// v5 (Phase 6): Form D filings and funding news already looked at, and where each funding round came from.
const SCHEMA_V5 = `
CREATE TABLE IF NOT EXISTS formd_filings (
  accession TEXT PRIMARY KEY, cik TEXT NOT NULL, entity TEXT NOT NULL, filed TEXT NOT NULL, city TEXT,
  industry TEXT, amount_sold REAL, offering REAL, first_sale TEXT, qualifies INTEGER NOT NULL, why TEXT,
  company_id INTEGER REFERENCES companies(id), checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS funding_news (
  url TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL, published TEXT, company TEXT, nyc INTEGER NOT NULL,
  outcome TEXT NOT NULL, company_id INTEGER REFERENCES companies(id), seen_at TEXT NOT NULL
);
`;

function migrate(db, from) {
  if (from < 2) {
    const have = new Set(db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name));
    for (const [col, type] of Object.entries(COMPANY_COLUMNS)) if (!have.has(col)) db.exec(`ALTER TABLE companies ADD COLUMN ${col} ${type}`);
    db.exec(SCHEMA_V2);
  }
  if (from < 3) {
    const have = new Set(db.prepare('PRAGMA table_info(postings)').all().map((c) => c.name));
    for (const [col, type] of Object.entries(POSTING_COLUMNS_V3)) if (!have.has(col)) db.exec(`ALTER TABLE postings ADD COLUMN ${col} ${type}`);
    db.exec(SCHEMA_V3);
  }
  if (from < 4) db.exec(SCHEMA_V4);
  if (from < 5) {
    const have = new Set(db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name));
    for (const [col, type] of Object.entries(COMPANY_COLUMNS)) if (!have.has(col)) db.exec(`ALTER TABLE companies ADD COLUMN ${col} ${type}`);
    const fr = new Set(db.prepare('PRAGMA table_info(funding_rounds)').all().map((c) => c.name));
    if (!fr.has('found_via')) db.exec('ALTER TABLE funding_rounds ADD COLUMN found_via TEXT');
    db.exec(SCHEMA_V5);
  }
  db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION));
}

const SAME_ROUND_DAYS = 45;
const day = (d = new Date()) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

/** Stable identity for a posting URL: host + path (+ Greenhouse's gh_jid), no other query, fragment, trailing slash or /application. */
export function urlKey(url) {
  const u = new URL(url);
  let path = u.pathname.replace(/\/application\/?$/i, '').replace(/\/+$/, '');
  if (/(^|\.)ashbyhq\.com$/i.test(u.hostname)) path = path.toLowerCase(); // Ashby board names are case-insensitive
  // Greenhouse boards that link to the company's own site name the job only in ?gh_jid=,
  // so keep it, or every job on that board would look like one posting.
  const gh = u.searchParams.get('gh_jid');
  return `${u.hostname.toLowerCase()}${path}${gh ? `?gh_jid=${gh}` : ''}`;
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
  if (!v) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '1')").run();
    migrate(db, 1);
  } else if (Number(v.value) < SCHEMA_VERSION) {
    db.exec('BEGIN');
    try { migrate(db, Number(v.value)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw new Error(`market.db upgrade from v${v.value} failed, nothing changed: ${e.message}`); }
  } else if (Number(v.value) > SCHEMA_VERSION) {
    throw new Error(`market.db is schema v${v.value}, newer than this code (v${SCHEMA_VERSION}). Update the kit.`);
  }
  return new Store(db);
}

const TRACKED_POSTING_FIELDS = ['title', 'pay_min', 'pay_max', 'pay_currency', 'pay_interval', 'locations', 'workplace'];
const OWNED = ['status', 'verified', 'watch', 'ai_native'];
const FACT_FIELDS = ['aliases', 'stage', 'last_raise', 'investors', 'what_they_do', 'parent', 'nyc_presence', 'owner_categories', 'is_mbb', 'reason', 'sources', 'origin',
  'leaders', 'careers_url', 'nyc_evidence', 'fit_facts', 'fit', 'fit_reason', 'found_via'];
const JSON_COLS = ['aliases', 'last_raise', 'investors', 'owner_categories', 'sources', 'notion_pushed', 'leaders', 'fit_facts'];
const LIST_COLS = ['aliases', 'investors', 'owner_categories', 'sources', 'leaders'];
const BOOL_COLS = ['verified', 'watch', 'ai_native', 'nyc_presence', 'is_mbb'];
const ownedValue = (e, f) => (f === 'status' ? e.status ?? 'unknown' : f === 'verified' ? e.verified !== false : Boolean(e[f]));
const factsOf = (e) => Object.fromEntries(FACT_FIELDS.map((k) => [k, e[k] ?? null]));

function rowToEntry(r) {
  const e = { name: r.name, first_seen: r.first_seen };
  for (const k of Object.keys(COMPANY_COLUMNS)) {
    let v = r[k];
    if (JSON_COLS.includes(k)) v = v == null ? null : JSON.parse(v);
    else if (BOOL_COLS.includes(k)) v = v == null ? null : Boolean(v);
    if (v != null) e[k] = v;
  }
  return e;
}
function entryToRow(e) {
  const out = {};
  for (const k of Object.keys(COMPANY_COLUMNS)) {
    let v = e[k];
    if (JSON_COLS.includes(k)) v = v == null ? (LIST_COLS.includes(k) ? '[]' : null) : JSON.stringify(v);
    else if (BOOL_COLS.includes(k)) v = v == null ? null : Number(Boolean(v));
    else v = v ?? null;
    out[k] = v;
  }
  if (out.status == null) out.status = 'unknown';
  return out;
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
    const existing = this.db.prepare('SELECT * FROM postings WHERE url_key = ?').get(key);
    const fields = {
      url: p.url ?? null, board: p.board ?? null, company_id: companyId, title: p.title,
      locations: JSON.stringify(p.locations ?? []), in_home_metro: p.in_home_metro == null ? null : Number(Boolean(p.in_home_metro)),
      workplace: p.workplace ?? null, pay_min: pay.min ?? null, pay_max: pay.max ?? null, pay_currency: pay.currency ?? null,
      pay_interval: pay.interval ?? null, pay_source: pay.source ?? null, posted_at: p.posted_at ?? null,
    };
    if (existing) {
      // Keep a trace of anything about the role that changed (D38): pay, title, place, work model.
      for (const f of TRACKED_POSTING_FIELDS) {
        const was = existing[f];
        const now = fields[f];
        if (now != null && was != null && String(was) !== String(now)) {
          this.db.prepare('INSERT INTO posting_changes (posting_id, observed_at, field, old_value, new_value) VALUES (?, ?, ?, ?, ?)')
            .run(existing.id, new Date(at).toISOString(), f, String(was), String(now));
        }
      }
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

  /** A small saved setting (e.g. where the search rotation stopped), or null. */
  getMeta(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  }
  setMeta(key, value) {
    if (key === 'schema_version') throw new Error('schema_version is managed by the store.');
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  }

  startScan(source, at = new Date()) {
    return Number(this.db.prepare('INSERT INTO scans (source, started_at) VALUES (?, ?)').run(source, new Date(at).toISOString()).lastInsertRowid);
  }
  /** When a source last finished a scan with status ok (ISO time), or null. */
  lastOkScan(source) {
    return this.db.prepare("SELECT MAX(started_at) AS at FROM scans WHERE source = ? AND status = 'ok'").get(source)?.at ?? null;
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

  // --- Company records (D40) and their history (D38) --------------------------------

  /** Companies with a record (researched, imported, or decided by you), shaped like watchlist entries. */
  companyRecords() {
    return this.db.prepare('SELECT * FROM companies WHERE status IS NOT NULL ORDER BY name').all().map(rowToEntry);
  }

  /**
   * Save one company record. Diffs against what's stored and appends history:
   * your columns → company_calls (by), facts → company_snapshots (source),
   * a new last_raise → funding_rounds. Nothing is overwritten without a trace.
   */
  saveCompany(entry, { source, by, at = new Date() }) {
    if (!entry?.name?.trim()) throw new Error('Company record needs a name.');
    if (!source || !by) throw new Error('saveCompany needs { source, by } so history says where the change came from.');
    const iso = new Date(at).toISOString();
    let row = this.db.prepare('SELECT * FROM companies WHERE name = ?').get(entry.name.trim());
    if (!row) {
      const id = this.company(entry.name, at);
      row = this.db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
    }
    const before = row.status == null ? null : rowToEntry(row);
    const next = { ...(before ?? {}), ...entry };
    const enc = entryToRow(next);
    const cols = Object.keys(enc);
    this.db.prepare(`UPDATE companies SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...Object.values(enc), iso.slice(0, 10), row.id);

    let changed = false;
    for (const f of OWNED) {
      const was = before ? ownedValue(before, f) : null;
      const now = ownedValue(next, f);
      if (JSON.stringify(was) !== JSON.stringify(now)) {
        this.db.prepare('INSERT INTO company_calls (company_id, at, field, old_value, new_value, by) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, iso, f, JSON.stringify(was), JSON.stringify(now), by);
        changed = true;
      }
    }
    const facts = factsOf(next);
    if (!before || JSON.stringify(factsOf(before)) !== JSON.stringify(facts)) {
      this.db.prepare('INSERT INTO company_snapshots (company_id, observed_at, source, data) VALUES (?, ?, ?, ?)').run(row.id, iso, source, JSON.stringify(facts));
      changed = true;
    }
    const r = next.last_raise;
    if (r && (r.amount_usd != null || r.date || r.round)) {
      if (this.#insertRound(row.id, r, { investors: next.investors ?? [], source_url: r.source_url ?? next.sources?.[0]?.url ?? null, at: iso, found_via: r.found_via ?? source })) changed = true;
    }
    return { id: row.id, changed };
  }

  postingChanges(postingId) {
    return this.db.prepare('SELECT observed_at, field, old_value, new_value FROM posting_changes WHERE posting_id = ? ORDER BY observed_at, id').all(postingId);
  }

  // --- Monthly stats (D39): provisional while the month is open, frozen after ----------

  monthState(month) {
    if (this.db.prepare('SELECT 1 FROM frozen_months WHERE month = ?').get(month)) return 'frozen';
    return this.db.prepare("SELECT 1 FROM monthly_stats WHERE month = ? AND status = 'provisional' LIMIT 1").get(month) ? 'provisional' : 'empty';
  }

  /** Replace a month's provisional rows. Refuses frozen months: those never change. */
  writeProvisional(month, rows, { classifier, at = new Date() }) {
    if (this.monthState(month) === 'frozen') throw new Error(`${month} is frozen; add a correction instead of recomputing it.`);
    const iso = new Date(at).toISOString();
    this.db.exec('BEGIN');
    try {
      this.db.prepare("DELETE FROM monthly_stats WHERE month = ? AND status = 'provisional'").run(month);
      const ins = this.db.prepare(`INSERT INTO monthly_stats (month, company_id, scope, family, classifier, open, new, coverage_scans, status, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'provisional', ?)`);
      for (const r of rows) ins.run(month, r.company_id, r.scope, r.family, classifier, r.open, r.new, r.coverage_scans, iso);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  freezeMonth(month, at = new Date()) {
    const state = this.monthState(month);
    if (state === 'frozen') throw new Error(`${month} is already frozen.`);
    const iso = new Date(at).toISOString();
    const n = Number(this.db.prepare("UPDATE monthly_stats SET status = 'frozen', frozen_at = ? WHERE month = ? AND status = 'provisional'").run(iso, month).changes);
    this.db.prepare('INSERT INTO frozen_months (month, frozen_at, rows) VALUES (?, ?, ?)').run(month, iso, n);
    return n;
  }

  /** Add a correction to a frozen month; the frozen row stays as published. */
  addCorrection(month, row, note, at = new Date()) {
    if (this.monthState(month) !== 'frozen') throw new Error(`${month} isn't frozen; corrections are only for published months.`);
    if (!note?.trim()) throw new Error('A correction needs a reason.');
    this.db.prepare(`INSERT INTO monthly_stats (month, company_id, scope, family, classifier, open, new, coverage_scans, status, computed_at, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'correction', ?, ?)`).run(month, row.company_id, row.scope, row.family, row.classifier, row.open, row.new, row.coverage_scans, new Date(at).toISOString(), note);
  }

  /** Stored stats for a range and scope, with company names; frozen/provisional plus any corrections. */
  statsRows(from, to, scope) {
    return this.db.prepare(`SELECT s.month, c.name AS company, s.family, s.classifier, s.open, s.new, s.coverage_scans, s.status, s.note
      FROM monthly_stats s JOIN companies c ON c.id = s.company_id
      WHERE s.month BETWEEN ? AND ? AND s.scope = ? ORDER BY s.month, s.open DESC, c.name`).all(from, to, scope);
  }

  // --- Title-v2 (D49): relabel and the text check ------------------------------------

  /**
   * Relabel OPEN postings with the current title classifier. Closed postings keep the
   * version that labelled them (D33). Each change is logged in posting_changes.
   * With dryRun, nothing is written. Returns [{ id, company, title, from, to }].
   */
  relabelOpen({ dryRun = false, at = new Date() } = {}) {
    const rows = this.db.prepare('SELECT p.id, p.title, p.title_family, p.title_classifier, c.name AS company FROM postings p JOIN companies c ON c.id = p.company_id WHERE p.closed_at IS NULL').all();
    const changes = [];
    const iso = new Date(at).toISOString();
    if (!dryRun) this.db.exec('BEGIN');
    try {
      for (const r of rows) {
        const fam = titleFamily(r.title);
        if (fam !== r.title_family) changes.push({ id: r.id, company: r.company, title: r.title, from: r.title_family, to: fam });
        if (dryRun || (fam === r.title_family && r.title_classifier === TITLE_CLASSIFIER_VERSION)) continue;
        if (fam !== r.title_family) {
          this.db.prepare('INSERT INTO posting_changes (posting_id, observed_at, field, old_value, new_value) VALUES (?, ?, ?, ?, ?)')
            .run(r.id, iso, 'title_family', `${r.title_family} (${r.title_classifier})`, `${fam} (${TITLE_CLASSIFIER_VERSION})`);
        }
        this.db.prepare('UPDATE postings SET title_family = ?, title_classifier = ? WHERE id = ?').run(fam, TITLE_CLASSIFIER_VERSION, r.id);
      }
      if (!dryRun) this.db.exec('COMMIT');
    } catch (e) { if (!dryRun) this.db.exec('ROLLBACK'); throw e; }
    return changes;
  }

  /** Open home-metro borderline postings with no text check yet (or one from an older check version). */
  needsTextCheck(version) {
    return this.db.prepare(`SELECT p.id, p.url, p.title, c.name AS company FROM postings p JOIN companies c ON c.id = p.company_id
      WHERE p.closed_at IS NULL AND p.in_home_metro = 1 AND p.title_family = 'borderline' AND p.url IS NOT NULL
      AND (p.text_check IS NULL OR p.text_check_version IS NOT ?) ORDER BY p.id`).all(version);
  }
  recordTextCheck(postingId, { hit, found }, version, at = new Date()) {
    this.db.prepare('UPDATE postings SET text_check = ?, text_check_found = ?, text_check_version = ?, text_checked_at = ? WHERE id = ?')
      .run(hit ? 'hit' : 'miss', JSON.stringify(found), version, new Date(at).toISOString(), postingId);
  }

  // --- Job boards found without a recorded posting (D50–D51) -------------------------

  addBoard(board, company, source, detail = null, at = new Date()) {
    if (!/^(ashby|greenhouse|lever|rippling):\S(?:[^:]*\S)?$/.test(board)) throw new Error(`Not a readable job board key: ${board} (expected ashby:, greenhouse:, lever: or rippling:<name>).`);
    if (!company?.trim()) throw new Error('A board needs a company name.');
    const res = this.db.prepare('INSERT OR IGNORE INTO boards (board, company, source, detail, added_at) VALUES (?, ?, ?, ?, ?)').run(board, company.trim(), source, detail, new Date(at).toISOString());
    return { added: Boolean(res.changes) };
  }
  boards() { return this.db.prepare('SELECT * FROM boards ORDER BY board').all(); }

  // --- Investor job boards on Getro (D50–D51) ---------------------------------------

  /** Record Getro job links; returns the ones not seen before. */
  seeGetroJobs(network, jobs, at = new Date()) {
    const d = day(at);
    const ins = this.db.prepare('INSERT OR IGNORE INTO getro_jobs (url, network, company_slug, title, first_seen) VALUES (?, ?, ?, ?, ?)');
    const fresh = [];
    this.db.exec('BEGIN');
    try {
      for (const j of jobs) if (ins.run(j.url, network, j.company_slug, j.title, d).changes) fresh.push(j);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return fresh;
  }
  /** Companies on a network already traced to where they post jobs (any of their jobs resolved). */
  resolvedGetroCompanies(network) {
    return new Set(this.db.prepare('SELECT DISTINCT company_slug FROM getro_jobs WHERE network = ? AND resolved_at IS NOT NULL').all(network).map((r) => r.company_slug));
  }
  getroJobs(network) { return this.db.prepare('SELECT * FROM getro_jobs WHERE network = ? ORDER BY url').all(network); }
  resolveGetroJob(url, { resolved_url, company, board }, at = new Date()) {
    this.db.prepare('UPDATE getro_jobs SET resolved_url = ?, company = ?, board = ?, resolved_at = ? WHERE url = ?').run(resolved_url, company, board ?? null, new Date(at).toISOString(), url);
  }

  // --- Portfolio-board company pages (D61) -----------------------------------------

  /** Record the company pages a board lists; returns how many are new. */
  seePortfolioPages(network, pages, at = new Date()) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO portfolio_pages (network, slug, url, first_seen) VALUES (?, ?, ?, ?)');
    let added = 0;
    this.db.exec('BEGIN');
    try {
      for (const p of pages) added += Number(ins.run(network, p.slug, p.url, day(at)).changes);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return added;
  }
  /** Pages never checked, then the longest-unchecked ones older than `days`; at most `limit`. */
  portfolioPagesDue(network, { days, limit, at = new Date() }) {
    const cutoff = new Date(new Date(at).getTime() - days * 86_400_000).toISOString();
    return this.db.prepare(`SELECT * FROM portfolio_pages WHERE network = ? AND (checked_at IS NULL OR checked_at < ?)
      ORDER BY checked_at IS NOT NULL, checked_at, slug LIMIT ?`).all(network, cutoff, limit);
  }
  recordPortfolioPage(network, slug, { company, titles, boards, relevant, unreadable, error = null }, at = new Date()) {
    this.db.prepare(`UPDATE portfolio_pages SET checked_at = ?, company = ?, titles = ?, boards = ?, relevant = ?, unreadable = ?, error = ?
      WHERE network = ? AND slug = ?`).run(new Date(at).toISOString(), company ?? null, JSON.stringify(titles ?? []), JSON.stringify(boards ?? []),
      relevant == null ? null : Number(Boolean(relevant)), JSON.stringify(unreadable ?? []), error, network, slug);
  }
  portfolioPages(network) { return this.db.prepare('SELECT * FROM portfolio_pages WHERE network = ? ORDER BY slug').all(network); }

  // --- Company Radar sources (Phase 6) ------------------------------------------------

  /** Accession numbers of Form D filings already looked at. */
  formDSeen() { return new Set(this.db.prepare('SELECT accession FROM formd_filings').all().map((r) => r.accession)); }

  /** Record one Form D filing we looked at, whether or not it counted (so it is read once). */
  recordFormD(f, at = new Date()) {
    this.db.prepare(`INSERT OR REPLACE INTO formd_filings (accession, cik, entity, filed, city, industry, amount_sold, offering, first_sale, qualifies, why, company_id, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.accession, f.cik, f.entity, f.filed, f.city ?? null, f.industry ?? null, f.amount_sold ?? null,
      f.offering ?? null, f.first_sale ?? null, Number(Boolean(f.qualifies)), f.why ?? null, f.company_id ?? null, new Date(at).toISOString());
  }

  /** URLs of funding news items already looked at. */
  newsSeen() { return new Set(this.db.prepare('SELECT url FROM funding_news').all().map((r) => r.url)); }

  recordNews(n, at = new Date()) {
    this.db.prepare(`INSERT OR IGNORE INTO funding_news (url, source, title, published, company, nyc, outcome, company_id, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(n.url, n.source, n.title, n.published ?? null, n.company ?? null, Number(Boolean(n.nyc)), n.outcome, n.company_id ?? null, new Date(at).toISOString());
  }

  /** Record a funding round seen in a Form D or the news. Returns true if it is new (not already recorded). */
  addFundingRound(companyId, r, at = new Date()) {
    return this.#insertRound(companyId, r, { investors: [], source_url: r.source_url ?? null, at: new Date(at).toISOString(), found_via: r.found_via ?? null });
  }

  /**
   * The round already on file that `r` is another report of, or null. Same company, amounts
   * within 10% (both known), or no amounts and the same round name; dates within 45 days.
   * Several articles about one raise, or a Form D and the news, then stay one round.
   */
  sameRound(companyId, r, at = new Date()) {
    const when = Date.parse(r.date ?? day(at));
    for (const x of this.db.prepare('SELECT * FROM funding_rounds WHERE company_id = ?').all(companyId)) {
      const a = x.amount_usd, b = r.amount_usd ?? null;
      const amounts = a != null && b != null ? Math.abs(a - b) <= 0.1 * Math.max(a, b) : a == null && b == null && x.round != null && x.round === (r.round ?? null);
      if (!amounts) continue;
      if (Math.abs(Date.parse(x.announced ?? x.recorded_at.slice(0, 10)) - when) <= SAME_ROUND_DAYS * 86_400_000) return x;
    }
    return null;
  }

  /** Save a round unless it is another report of one on file (then only a missing round name is filled in). True if saved. */
  #insertRound(companyId, r, { investors, source_url, at, found_via }) {
    const dup = this.sameRound(companyId, r, at);
    if (dup) {
      if (dup.round == null && r.round) this.db.prepare('UPDATE funding_rounds SET round = ? WHERE id = ?').run(r.round, dup.id);
      return false;
    }
    const res = this.db.prepare(`INSERT OR IGNORE INTO funding_rounds (company_id, round, amount_usd, announced, investors, source_url, recorded_at, found_via)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(companyId, r.round ?? null, r.amount_usd ?? null, r.date ?? null, JSON.stringify(investors), source_url, at, found_via);
    return res.changes > 0;
  }

  /** Funding rounds per company (newest announced first), for the Radar. */
  fundingByCompany() {
    const by = new Map();
    for (const r of this.db.prepare('SELECT * FROM funding_rounds ORDER BY COALESCE(announced, recorded_at) DESC, id DESC').all()) {
      if (!by.has(r.company_id)) by.set(r.company_id, []);
      by.get(r.company_id).push({ ...r, investors: JSON.parse(r.investors) });
    }
    return by;
  }

  companyHistory(name) {
    const row = this.db.prepare('SELECT id FROM companies WHERE name = ?').get(name);
    if (!row) return null;
    const q = (sql) => this.db.prepare(sql).all(row.id);
    return {
      snapshots: q('SELECT observed_at, source, data FROM company_snapshots WHERE company_id = ? ORDER BY observed_at').map((r) => ({ ...r, data: JSON.parse(r.data) })),
      funding: q('SELECT round, amount_usd, announced, investors, source_url, recorded_at FROM funding_rounds WHERE company_id = ? ORDER BY announced').map((r) => ({ ...r, investors: JSON.parse(r.investors) })),
      calls: q('SELECT at, field, old_value, new_value, by FROM company_calls WHERE company_id = ? ORDER BY at, id'),
    };
  }
}

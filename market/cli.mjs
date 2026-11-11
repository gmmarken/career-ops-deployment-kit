#!/usr/bin/env node
// Market database commands (run via scripts/market.sh, which sets CAREER_OPS_DATA_DIR):
//   backfill                     load already-tiered roles (evals snapshots + tiers/*.json); no AI calls
//   metrics [--from YYYY-MM] [--to YYYY-MM] [--all-locations] [--all-families]
//                                write monthly + ranking CSVs to <data dir>/exports/
//   recall <file> [--source linkedin]
//                                check a hand-collected list ("Company | Title" per line) against the database
//   enrich [--limit N]           research companies not yet researched with the Phase 6 questions (fills empty fields only)
//   radar --research N [--no-notion]
//                                Company Radar (Phase 6): SEC Form D filings + funding news -> newly funded NYC companies,
//                                then research N companies (newly funded first), recompute deployment fit, sync to Notion
//   stats                        refresh provisional monthly stats; freeze months that ended 7+ days ago
//   scan [board ...]             find boards (investor Getro boards, Watch), read every open posting on known
//                                job boards, text-check borderline NYC titles (all no AI); log scans; close gone postings
//   relabel [--dry-run]          relabel open postings with the current title classifier (D49)
//   retier [--dry-run]           re-decide open tiered postings from their saved facts with the current rules (no AI)
//   add-board <job or board link> [--company NAME]
//                                add a company's job board by hand (e.g. for a company you Watch)
//   unretire <board>             scan a board again that was retired after 3 "not found" runs in a row (D82)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRules } from '../engine/rules.mjs';
import { decideTier } from '../engine/tier-engine.mjs';
import { loadWatchlist, watchlistPath, findCompany, toCompanyFacts, researchCompany, saveResearch, saveWatchlist, applyResearch, needsEnrichment } from '../extractor/research.mjs';
import { isUsageLimit } from '../extractor/claude.mjs';
import { fetchFeed, serperNews } from '../extractor/funding-news.mjs';
import { checkRadarConfig, companyIndex, runFormD, runTechCrunch, runNewsSearch, newsSearchDue, newsWindow, creditOutlook, creditLine, SERPER_CREDITS_KEY, fundedLine, researchOrder, refit, FORM_D_SOURCE, TECHCRUNCH_SOURCE, NEWS_SEARCH_SOURCE } from './radar.mjs';
import { describeCalls } from '../scripts/pipeline.mjs';
import { openStore, RETIRE_AFTER } from './store.mjs';
import { recordTiered, rulesHash } from './record.mjs';
import { syncAll, pullCompanyEdits } from '../notion/sync.mjs';
import { listBoard, boardFromUrl, fetchPosting } from '../extractor/ats.mjs';
import { listGetroJobs, fetchJobPage, PAGE_DELAY_MS } from '../extractor/getro.mjs';
import { listCompanyPages, fetchCompanyPage } from '../extractor/a16z.mjs';
import { readSerperKey, search as serperSearch, serperBalance } from '../extractor/serper.mjs';
import { checkSerperConfig, discoveryDue, runDiscovery, SOURCE as SERPER_SOURCE, ROTATE_KEY as SERPER_ROTATE_KEY, planQueries } from './discover.mjs';
import { inHomeMetro } from './classify.mjs';
import { knownBoards, watchedWithoutBoard, isNetworkError, unreachableOutcome, RETRY_WAIT_MS } from './boards.mjs';
import { monthlyByCompany, ranking, toCsv, monthRange, freezable, postingStart, trackingStartMonth } from './metrics.mjs';
import { TARGET_FAMILIES, titleFamily, companyKey, TITLE_CLASSIFIER_VERSION, textCheck, TEXT_CHECK_VERSION } from './classify.mjs';

const dataDir = process.env.CAREER_OPS_DATA_DIR;
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const thisMonth = () => new Date().toISOString().slice(0, 7);

function backfill() {
  const rules = loadRules();
  const watchlist = loadWatchlist(watchlistPath(dataDir));
  const items = [];
  const snapDir = join(dataDir, 'evals', 'snapshots');
  if (existsSync(snapDir)) for (const f of readdirSync(snapDir).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(snapDir, f), 'utf-8'));
    items.push({ facts: s.facts, at: s.extracted_at, from: `evals/snapshots/${f}` });
  }
  const tierDir = join(dataDir, 'tiers');
  if (existsSync(tierDir)) for (const f of readdirSync(tierDir).filter((f) => f.endsWith('.json')).sort()) {
    const t = JSON.parse(readFileSync(join(tierDir, f), 'utf-8'));
    if (!t.facts.posting.url && t.facts.posting.source === 'file') continue; // pre-sourceUrl pasted JDs are covered by snapshots
    items.push({ facts: t.facts, at: `${f.slice(0, 10)}T12:00:00Z`, from: `tiers/${f}` });
  }
  if (!items.length) throw new Error('Nothing to backfill: no evals snapshots or tiers/*.json found.');
  const store = openStore();
  let added = 0, updated = 0;
  for (const it of items.sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const entry = findCompany(watchlist, it.facts.company.name, it.facts.posting.company);
    const facts = { ...it.facts, company: entry ? toCompanyFacts(entry, it.facts.company.name) : it.facts.company };
    const result = decideTier(facts, rules, { today: new Date(it.at) });
    const { isNew } = recordTiered(store, facts, result, rules, { at: new Date(it.at) });
    if (isNew) added++; else updated++;
  }
  const n = store.postings().length;
  store.close();
  console.log(`Backfill: ${items.length} records read → ${added} new postings, ${updated} updates. Database now holds ${n} postings.`);
}

/** Recompute provisional months and freeze finished ones (D39). Returns the month range covered. */
function refreshStats(store) {
  const postings = store.postings();
  const scans = store.scans();
  if (!postings.length) return null;
  const from = postings.map((p) => postingStart(p).slice(0, 7)).sort()[0];
  const to = thisMonth();
  const months = monthRange(from, to);
  const trackingStart = trackingStartMonth(scans);
  const frozenNow = [];
  for (const m of months) {
    if (store.monthState(m) === 'frozen') continue;
    const rows = [
      ...monthlyByCompany(postings, scans, { from: m, to: m, filter: (p) => p.in_home_metro === true }).map((r) => ({ ...r, scope: 'home_metro' })),
      ...monthlyByCompany(postings, scans, { from: m, to: m }).map((r) => ({ ...r, scope: 'all' })),
    ];
    store.writeProvisional(m, rows, { classifier: TITLE_CLASSIFIER_VERSION });
    // Only months inside real tracking can be frozen; earlier ones stay provisional ("before tracking").
    if (trackingStart && m >= trackingStart && freezable([m]).length) { store.freezeMonth(m); frozenNow.push(m); }
  }
  return { from, to, frozenNow, trackingStart };
}

function stats() {
  const store = openStore();
  try {
    const r = refreshStats(store);
    if (!r) { console.log('No postings yet; nothing to compute.'); return; }
    console.log(`Monthly stats ${r.from}..${r.to}: provisional months refreshed.${r.frozenNow.length ? ` Frozen now: ${r.frozenNow.join(', ')}.` : ''}`);
    console.log(r.trackingStart ? `Tracking began ${r.trackingStart} (first completed scan). Earlier months are "before tracking" and never frozen.`
      : 'No completed scans yet, so tracking hasn\'t begun: every month stays provisional ("before tracking") and nothing is frozen.');
    const states = monthRange(r.from, r.to).map((m) => [m, !r.trackingStart || m < r.trackingStart ? 'before tracking' : store.monthState(m)]);
    for (const [m, st] of states.filter(([, st], i, a) => st !== 'before tracking' || i === a.length - 1 || i === 0)) console.log(`  ${m}: ${st}`);
  } finally { store.close(); }
}

function metrics() {
  const rules = loadRules();
  const from = arg('--from') ?? thisMonth();
  const to = arg('--to') ?? thisMonth();
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) throw new Error('--from/--to must be YYYY-MM.');
  const allLoc = process.argv.includes('--all-locations');
  const allFam = process.argv.includes('--all-families');
  const store = openStore();
  let monthly, rank, states;
  try {
    refreshStats(store);
    monthly = store.statsRows(from, to, allLoc ? 'all' : 'home_metro').filter((r) => allFam || TARGET_FAMILIES.has(r.family));
    const filter = (p) => (allLoc || p.in_home_metro === true) && (allFam || TARGET_FAMILIES.has(p.title_family));
    rank = ranking(store.postings(), { from, to, filter });
    states = monthRange(from, to).map((m) => `${m} ${store.monthState(m)}`);
  } finally { store.close(); }
  const out = join(dataDir, 'exports');
  mkdirSync(out, { recursive: true });
  const scope = `${allLoc ? 'all-locations' : rules.candidate.home_metro.toLowerCase().replace(/\s+/g, '-')}_${allFam ? 'all-families' : 'target-families'}`;
  writeFileSync(join(out, `monthly_${scope}_${from}_${to}.csv`), toCsv(monthly));
  writeFileSync(join(out, `ranking_${scope}_${from}_${to}.csv`), toCsv(rank));
  console.log(`Metrics ${from}..${to} (${scope}): ${monthly.length} monthly rows, ${rank.length} companies ranked → ${out}`);
  console.log(`Months: ${states.join(' · ')}  (frozen numbers never change; provisional ones refresh until the month is frozen ${7} days after it ends)`);
  const uncovered = [...new Set(monthly.filter((r) => r.coverage_scans === 0).map((r) => r.month))];
  if (uncovered.length) console.log(`⚠️ No completed scans in: ${uncovered.join(', ')}. Counts for these months reflect one-off tiering only, not market coverage.`);
  for (const r of rank.slice(0, 10)) console.log(`  ${String(r.rank).padStart(2)}. ${r.company} — ${r.postings} posting(s)`);
}

const tokens = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2));
function similar(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  return [...A].filter((w) => B.has(w)).length / Math.min(A.size, B.size);
}

function recall() {
  const file = process.argv[3];
  if (!file || !existsSync(file)) throw new Error('Usage: market.sh recall <file>  (one "Company | Title" per line)');
  const source = arg('--source') ?? 'linkedin';
  const lines = readFileSync(file, 'utf-8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const entries = lines.map((l) => {
    const [company, ...rest] = l.split('|').map((x) => x.trim());
    if (!company || !rest.length) throw new Error(`Line not in "Company | Title" form: ${l}`);
    return { company, title: rest.join(' | ') };
  });
  const store = openStore();
  const postings = store.postings();
  const results = entries.map((e) => {
    const sameCo = postings.filter((p) => companyKey(p.company) === companyKey(e.company));
    const hit = sameCo.find((p) => similar(p.title, e.title) >= 0.6 || (titleFamily(e.title) !== 'other' && p.title_family === titleFamily(e.title)));
    return { ...e, family: titleFamily(e.title), company_known: sameCo.length > 0, matched: Boolean(hit), matched_title: hit?.title ?? null };
  });
  const matched = results.filter((r) => r.matched).length;
  store.recordRecall({ source, total: results.length, matched, entries: results });
  store.close();
  console.log(`Recall (${source}): we already had ${matched} of ${results.length} (${Math.round((100 * matched) / results.length)}%).`);
  const missing = results.filter((r) => !r.matched);
  if (missing.length) {
    console.log('\nMissed:');
    for (const r of missing) console.log(`  - ${r.company} — ${r.title}${r.company_known ? '' : '   (company not in the database: add to watchlist?)'}`);
  }
}

/**
 * Research up to `limit` companies in the Radar's order (D76): newly funded first, then
 * companies hiring for target roles in NYC, then the rest. Fills empty fields only (your
 * calls are kept). A careers page on a board we read joins the daily scan. Stops at the
 * Claude usage limit (like grading, D68); the rest wait. Returns { done, failures, paused }.
 */
async function researchCompanies(limit) {
  const path = watchlistPath(dataDir);
  const wl = loadWatchlist(path);
  let st = openStore();
  let order, known;
  try {
    order = researchOrder(st.companyRecords(), st.postings());
    known = new Set(knownBoards(st.postings(), st.boards()).boards.keys());
  } finally { st.close(); }
  const todo = needsEnrichment(wl, order);
  const batch = todo.slice(0, limit);
  console.log(`Company research: ${todo.length} compan${todo.length === 1 ? 'y' : 'ies'} to research; ${batch.length} now (newly funded first).`);
  const out = { done: [], failures: [], paused: false };
  const calls = [];
  for (const [i, { name, entry }] of batch.entries()) {
    let res;
    try { res = await researchCompany(name); } catch (err) {
      if (isUsageLimit(err.message)) { out.paused = true; break; }
      const msg = `research ${name}: ${err.message.split('\n')[0]}`;
      out.failures.push(msg);
      console.log(`  [${i + 1}/${batch.length}] FAILED ${msg}`);
      continue;
    }
    calls.push({ step: `research ${name}`, ...res.usage });
    let e = entry;
    if (e) { applyResearch(e, res.company); saveWatchlist(wl, { source: 'research', by: 'kit', path }); }
    else e = saveResearch(path, wl, res.company, [name]);
    let note = '';
    const board = e.careers_url ? boardFromUrl(e.careers_url) : null;
    if (board && !known.has(board)) {
      try {
        await listBoard(board);
        st = openStore();
        try { st.addBoard(board, e.name, 'radar', e.careers_url); } finally { st.close(); }
        known.add(board);
        note = `; job board ${board} added to the scan`;
      } catch (err) { note = `; job board ${board} not readable now (${err.message.split('\n')[0]})`; }
    } else if (e.careers_url && !board) {
      let host = e.careers_url;
      try { host = new URL(e.careers_url).hostname; } catch { /* not a full link: show it as given */ }
      note = `; posts jobs somewhere we can't read yet (${host})`;
    }
    console.log(`  [${i + 1}/${batch.length}] ${e.name}: ${e.status}, ${e.stage ?? 'unknown'}${e.nyc_presence ? ', NYC' : ''}${note}`);
    if (res.dropped.length) console.log(`      left out ${res.dropped.length} leader entr${res.dropped.length === 1 ? 'y' : 'ies'}: ${res.dropped.map((d) => `${d.name} (${d.why})`).join(', ')}`);
    out.done.push(e.name);
  }
  if (calls.length) console.log(`AI calls: ${calls.length}, ~$${calls.reduce((t, c) => t + (c.cost_usd_equivalent ?? 0), 0).toFixed(2)} API-equivalent`);
  if (out.paused) console.log(`Paused: Claude usage limit reached after ${out.done.length} of ${batch.length} researched; the rest wait for the next run.`);
  const left = todo.length - out.done.length;
  if (left > 0) console.log(`${left} compan${left === 1 ? 'y waits' : 'ies wait'} for research on later runs.`);
  return out;
}

/** Recompute every researched company's deployment fit (no AI). Returns the names that changed. */
function refitAll() {
  const st = openStore();
  let changed;
  try { changed = refit(st.companyRecords(), st.postings()); } finally { st.close(); }
  if (changed.length) saveWatchlist({ companies: changed }, { source: 'fit-rule', by: 'kit' });
  console.log(`Deployment fit: ${changed.length} compan${changed.length === 1 ? 'y' : 'ies'} changed.`);
  return changed.map((e) => e.name);
}

async function enrich() {
  const limit = Number(arg('--limit') ?? 10);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive whole number.');
  const r = await researchCompanies(limit);
  refitAll();
  console.log('Run scripts/notion.sh sync to show the new info in Company Radar.');
  if (r.failures.length) throw new Error(`${r.failures.length} compan${r.failures.length === 1 ? 'y' : 'ies'} failed and were skipped:\n  ${r.failures.join('\n  ')}`);
}

const millions = (n) => (n == null ? 'amount not given' : n >= 1e9 ? `$${+(n / 1e9).toFixed(1)}B` : `$${+(n / 1e6).toFixed(1)}M`);

/** One logged source step: runs `go`, records the scan, prints `line(result)`, collects errors. */
async function sourceStep(store, source, label, go, line, failures) {
  const id = store.startScan(source);
  try {
    const r = await go();
    store.finishScan(id, r.errors.length ? { status: 'error', found: r.found ?? null, error: r.errors.join(' | ') } : { status: 'ok', found: r.found ?? null });
    console.log(`  ✓ ${label}: ${line(r)}`);
    for (const c of r.counted) console.log(`    + ${c.name}${c.isNewCompany ? ' (new)' : ''}: ${[millions(c.amount_usd), c.round, c.nyc ? 'NYC' : 'not NYC'].filter(Boolean).join(', ')}`);
    for (const e of r.errors) { failures.push(e); console.log(`  ✗ ${e}`); }
    return r;
  } catch (err) {
    store.finishScan(id, { status: 'error', error: err.message });
    failures.push(`${label}: ${err.message}`);
    console.log(`  ✗ ${label}: ${err.message}`);
    return null;
  }
}

/** market.sh radar --research N [--no-notion]: the Company Radar step of the daily run. */
async function radar() {
  const n = Number(arg('--research'));
  if (arg('--research') === undefined || !Number.isInteger(n) || n < 0) throw new Error('Usage: market.sh radar --research N [--no-notion]   (N = companies to research this run; 0 = none)');
  const noNotion = process.argv.includes('--no-notion');
  const sources = loadSources();
  const { form_d, funding_news } = checkRadarConfig(sources, join(dataDir, 'config', 'sources.json'));
  const failures = [];
  const counted = [];
  const touched = new Set();
  const store = openStore();
  try {
    const idx = companyIndex(store);
    console.log('Funding sources:');
    const fd = await sourceStep(store, FORM_D_SOURCE, 'Form D (SEC)', async () => { const r = await runFormD(store, idx, form_d); return { ...r, found: r.listed }; },
      (r) => `${r.listed} ${form_d.state} filing(s) since ${r.start}; ${r.opened} opened, ${r.counted.length} counted (${r.counted.filter((c) => c.isNewCompany).length} new to the Radar)`, failures);
    if (fd && Object.keys(fd.skipped).length) console.log(`    Not counted: ${Object.entries(fd.skipped).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
    if (fd) counted.push(...fd.counted);
    if (funding_news.techcrunch_feeds.length) {
      const tc = await sourceStep(store, TECHCRUNCH_SOURCE, 'TechCrunch', async () => { const r = await runTechCrunch(store, idx, funding_news.techcrunch_feeds, { feed: (u) => fetchFeed(u), maxAgeDays: funding_news.max_age_days }); return { ...r, found: r.headlines }; },
        (r) => `${r.headlines} new headline(s), ${r.counted.length} recorded`, failures);
      if (tc) counted.push(...tc.counted);
    }
    const lastNews = store.lastOkScan(NEWS_SEARCH_SOURCE);
    const { due, nextInDays } = newsSearchDue(lastNews, funding_news.serper.every_days);
    if (!due) console.log(`  · News search (Serper): not due; next run in ${nextInDays} day(s)`);
    else {
      const win = newsWindow(lastNews);
      const ns = await sourceStep(store, NEWS_SEARCH_SOURCE, 'News search (Serper)', async () => {
        const key = readSerperKey(dataDir);
        const r = await runNewsSearch(store, idx, funding_news.serper.queries, { search: (q) => serperNews(key, q, { window: win.tbs }), maxAgeDays: funding_news.max_age_days, pause: () => sleep(300) });
        return { ...r, found: r.headlines };
      }, (r) => `${r.searches} search(es) of the ${win.label}, ${r.searches} credit(s); ${r.headlines} new headline(s), ${r.counted.length} recorded${r.stopped ? '; stopped early (the rest would fail the same way)' : ''}`, failures);
      if (ns) counted.push(...ns.counted);
    }
    // Serper credits (D113): checking is free; the daily run warns a week before they run out.
    try {
      const balance = await serperBalance(readSerperKey(dataDir));
      const planned = funding_news.serper.queries.length / funding_news.serper.every_days
        + (sources.serper ? sources.serper.max_credits_per_run / sources.serper.every_days : 0);
      const o = creditOutlook(JSON.parse(store.getMeta(SERPER_CREDITS_KEY) ?? '[]'), balance, planned);
      store.setMeta(SERPER_CREDITS_KEY, JSON.stringify(o.history));
      console.log(creditLine(balance, o));
    } catch (err) { failures.push(`Serper credits: ${err.message}`); console.log(`  ✗ Serper credits: ${err.message}`); }
  } finally { store.close(); }
  for (const c of counted) touched.add(c.name);
  console.log(fundedLine(counted) ?? 'Newly funded NYC companies: none new this run.');

  if (n > 0) {
    if (!noNotion) await pullCompanyEdits(dataDir);
    const r = await researchCompanies(n);
    for (const name of r.done) touched.add(name);
    failures.push(...r.failures);
  }
  for (const name of refitAll()) touched.add(name);

  if (noNotion) console.log(`Notion: skipped (--no-notion); ${touched.size} compan${touched.size === 1 ? 'y' : 'ies'} not synced.`);
  else if (touched.size) await syncAll(dataDir, { companyNames: [...touched] });
  if (failures.length) throw new Error(`${failures.length} problem(s); the other sources still ran:\n  ${failures.join('\n  ')}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Investor job boards to read, from private/config/sources.json. Missing file = clear error. */
function loadSources() {
  const path = join(dataDir, 'config', 'sources.json');
  if (!existsSync(path)) throw new Error(`${path} not found. Copy market/sources.example.json there and list the investor job boards to read.`);
  let cfg;
  try { cfg = JSON.parse(readFileSync(path, 'utf-8')); } catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
  for (const key of ['getro_boards', 'a16z_boards']) {
    if (!Array.isArray(cfg[key])) throw new Error(`${path}: "${key}" must be a list (it can be empty). See market/sources.example.json.`);
    for (const b of cfg[key]) if (!b?.name || !/^https:\/\//.test(b?.url ?? '')) throw new Error(`${path}: each ${key} entry needs a "name" and an https "url".`);
  }
  checkSerperConfig(cfg, path);
  return cfg;
}

/**
 * One investor board: record its job links, and for each company with a target or
 * borderline title that we haven't traced yet, open ONE of its job pages to learn where
 * the company posts jobs. Readable boards are added to the scan list.
 * Returns { jobs, traced, added, unreadable: [{company, url}], errors: [] }.
 */
async function readGetro(store, { name, url }) {
  const jobs = await listGetroJobs(url);
  store.seeGetroJobs(name, jobs);
  const done = store.resolvedGetroCompanies(name);
  const pick = new Map();
  for (const j of store.getroJobs(name)) {
    if (done.has(j.company_slug) || pick.has(j.company_slug)) continue;
    const f = titleFamily(j.title);
    if (TARGET_FAMILIES.has(f) || f === 'borderline') pick.set(j.company_slug, j);
  }
  const out = { jobs: jobs.length, traced: 0, added: 0, unreadable: [], errors: [] };
  // Companies traced earlier to a board we couldn't read then, but can now (e.g. Rippling, D60).
  for (const j of store.getroJobs(name)) {
    if (!j.resolved_at || j.board) continue;
    const board = boardFromUrl(j.resolved_url);
    if (!board) continue;
    store.resolveGetroJob(j.url, { resolved_url: j.resolved_url, company: j.company, board });
    if (store.addBoard(board, j.company, 'getro', name).added) out.added++;
  }
  for (const j of pick.values()) {
    await sleep(PAGE_DELAY_MS);
    try {
      const page = await fetchJobPage(j.url);
      const board = boardFromUrl(page.url);
      const company = page.company ?? j.company_slug;
      store.resolveGetroJob(j.url, { resolved_url: page.url, company, board });
      out.traced++;
      if (board) { if (store.addBoard(board, company, 'getro', name).added) out.added++; }
      else out.unreadable.push({ company, url: page.url });
    } catch (err) {
      out.errors.push(`${name} → ${j.company_slug} (${j.url}): ${err.message}`);
    }
  }
  return out;
}

// a16z-style portfolio boards (D61): each company page is checked about once a week.
export const PORTFOLIO_RECHECK_DAYS = 7;
export const PORTFOLIO_PAGES_PER_RUN = 150;
const isRelevantTitle = (t) => { const f = titleFamily(t); return TARGET_FAMILIES.has(f) || f === 'borderline'; };

/**
 * One a16z-style board: list its company pages, then check the ones that are due. A company
 * with a target or borderline title has its readable job boards added to the scan.
 * Returns { companies, checked, relevant, added, unreadable: [{company, hosts}], errors: [] }.
 */
async function readPortfolio(store, { name, url }) {
  const pages = await listCompanyPages(url);
  store.seePortfolioPages(name, pages);
  const due = store.portfolioPagesDue(name, { days: PORTFOLIO_RECHECK_DAYS, limit: PORTFOLIO_PAGES_PER_RUN });
  const out = { companies: pages.length, checked: 0, relevant: 0, added: 0, unreadable: [], errors: [] };
  for (const p of due) {
    await sleep(PAGE_DELAY_MS);
    try {
      const r = await fetchCompanyPage(p.url);
      const relevant = r.titles.some(isRelevantTitle);
      store.recordPortfolioPage(name, p.slug, { ...r, relevant });
      out.checked++;
      if (!relevant) continue;
      out.relevant++;
      const company = r.company ?? p.slug;
      for (const b of r.boards) if (store.addBoard(b, company, 'a16z', name).added) out.added++;
      if (!r.boards.length) out.unreadable.push({ company, hosts: r.unreadable });
    } catch (err) {
      out.errors.push(`${name} → ${p.slug} (${p.url}): ${err.message}`);
    }
  }
  return out;
}

/**
 * Search-engine discovery (D66), when due (or forced). Prints one summary line and any new
 * boards; returns the problems to report.
 */
async function serperStep(store, cfg, { force = false } = {}) {
  const { due, nextInDays } = discoveryDue(store.lastOkScan(SERPER_SOURCE), cfg.every_days);
  if (!due && !force) { console.log(`  · Search discovery (Serper): not due; next run in ${nextInDays} day(s)`); return []; }
  const scanId = store.startScan(SERPER_SOURCE);
  try {
    const key = readSerperKey(dataDir);
    const known = new Set(knownBoards(store.postings(), store.boards()).boards.keys());
    const r = await runDiscovery(store, cfg, (q, page) => serperSearch(key, q, page), { pause: () => sleep(300), readable: (b) => listBoard(b), known });
    store.finishScan(scanId, r.errors.length ? { status: 'error', found: r.found, error: r.errors.join(' | ') } : { status: 'ok', found: r.found });
    console.log(`  ✓ Search discovery (Serper): ${r.searches} searches, ${r.credits} credit(s); ${r.found} readable board(s) in results, ${r.added.length} new board(s) to scan${r.capped ? ` (stopped at the ${cfg.max_credits_per_run}-credit cap)` : ''}`);
    if (r.rotation.total) console.log(`    Rotating titles: ${r.rotation.done} of ${r.rotation.total} searches this run; next run starts with "${r.rotation.nextTitle}"`);
    if (r.added.length) console.log(`    New: ${r.added.map((a) => a.board).join(', ')}`);
    if (r.unreadable.length) console.log(`    Found but not readable, not added (tried again next run): ${r.unreadable.map((u) => u.board).join(', ')}`);
    if (r.stopped) console.log('    Stopped early: the remaining searches would fail the same way.');
    return r.errors.map((e) => `Serper: ${e}`);
  } catch (err) {
    store.finishScan(scanId, { status: 'error', error: err.message });
    return [`Serper: ${err.message}`];
  }
}

/** market.sh discover [--dry-run] [--force]: run search discovery on its own. */
async function discover() {
  const cfg = loadSources().serper;
  if (process.argv.includes('--dry-run')) {
    const st = openStore();
    let next;
    try { next = st.getMeta(SERPER_ROTATE_KEY); } finally { st.close(); }
    const qs = planQueries(cfg, next);
    for (const { q, rotating } of qs) console.log(`${rotating ? '  (turns) ' : '  (core)  '}${q}`);
    const core = qs.filter((x) => !x.rotating).length;
    console.log(`\n${core} core searches every run, then ${qs.length - core} rotating searches in this order until the cap; at most ${cfg.max_credits_per_run} credit(s) per run, every ${cfg.every_days} day(s). Nothing was searched.`);
    return;
  }
  const store = openStore();
  try {
    const problems = await serperStep(store, cfg, { force: process.argv.includes('--force') });
    for (const p of problems) console.log(`  ✗ ${p}`);
    if (problems.length) process.exitCode = 1;
  } finally { store.close(); }
}

async function scan() {
  const rules = loadRules();
  const wanted = process.argv.slice(3).filter((a) => !a.startsWith('--'));
  const store = openStore();
  const failures = [];
  try {
    // 1. Find boards on investor job boards (whole-market scans only). A list that can't connect is
    // tried again after the board scan, like a board (D111).
    const sourceRetry = [];
    const readSource = async (src, scanId, { lastTry }) => {
      try {
        const r = await src.read();
        store.finishScan(scanId, r.errors.length ? { status: 'error', found: r.found, error: r.errors.join(' | ') } : { status: 'ok', found: r.found });
        console.log(`  ✓ ${src.label}: ${src.done(r)}${lastTry ? ' (on the retry)' : ''}`);
        if (r.unreadable.length) console.log(`    Posts somewhere we can't read yet: ${src.unreadable(r)}`);
        for (const e of r.errors) { failures.push(e); console.log(`  ✗ ${e}`); }
        return null;
      } catch (err) {
        if (isNetworkError(err.message)) {
          if (!lastTry) {
            // The scan row stays open until the retry, so one run counts once in the streak.
            sourceRetry.push({ src, scanId });
            console.log(`  ⟳ ${src.label}: couldn't connect (${err.message}); trying again after the board scan`);
            return null;
          }
          store.finishScan(scanId, { status: 'error', error: err.message });
          return { board: src.label, name: src.name, error: err.message, streak: store.unreachableStreak(src.key, isNetworkError) };
        }
        store.finishScan(scanId, { status: 'error', error: err.message });
        failures.push(`${src.label}: ${err.message}`);
        console.log(`  ✗ ${src.label}: ${err.message}`);
        return null;
      }
    };
    if (!wanted.length) {
      const sources = loadSources();
      const vcLists = [
        ...sources.getro_boards.map((g) => ({
          key: `getro:${g.name}`, name: g.name, label: `${g.name} (Getro)`,
          read: async () => { const r = await readGetro(store, g); return { ...r, found: r.jobs }; },
          done: (r) => `${r.jobs} job links; traced ${r.traced} new compan${r.traced === 1 ? 'y' : 'ies'}, ${r.added} new board(s) to scan`,
          unreadable: (r) => r.unreadable.map((u) => `${u.company} (${new URL(u.url).hostname})`).join(', '),
        })),
        ...sources.a16z_boards.map((g) => ({
          key: `portfolio:${g.name}`, name: g.name, label: g.name,
          read: async () => { const r = await readPortfolio(store, g); return { ...r, found: r.companies }; },
          done: (r) => `${r.companies} companies; checked ${r.checked} page(s), ${r.relevant} with relevant titles, ${r.added} new board(s) to scan`,
          unreadable: (r) => r.unreadable.map((u) => `${u.company}${u.hosts.length ? ` (${u.hosts.join(', ')})` : ''}`).join(', '),
        })),
      ];
      for (const src of vcLists) await readSource(src, store.startScan(src.key), { lastTry: false });
      for (const p of await serperStep(store, sources.serper)) { failures.push(p); console.log(`  ✗ ${p}`); }
    }

    // 2. Read every known job board in full.
    const { boards, unreadable } = knownBoards(store.postings(), store.boards());
    const retired = store.retiredBoards();
    const list = wanted.length ? wanted.map((b) => [b, boards.get(b) ?? null]) : [...boards].filter(([b]) => !retired.has(b));
    const gone = [];
    const counting = []; // "not found" but not yet retired: a summary line, not a failure (D93)
    if (!list.length) throw new Error('No known job boards yet. Tier a role from an Ashby, Greenhouse or Lever link first, or pass a board like lever:palantir.');
    console.log(`Scanning ${list.length} board(s)…`);
    const retry = []; // couldn't connect: tried once more at the end (D108)
    const readOne = async (board, company, scanId, { lastTry }) => {
      try {
        const postings = await listBoard(board);
        const name = company ?? board.split(':')[1];
        let added = 0;
        for (const p of postings) {
          const { isNew } = store.seePosting({
            url: p.url, board, company: name, title: p.title, locations: p.locations,
            in_home_metro: p.locations.length ? inHomeMetro(p.locations, rules.candidate) : null,
            workplace: p.workplace, pay: p.pay, posted_at: p.posted_at,
          });
          if (isNew) added++;
        }
        const { closed } = store.closeMissing(board, postings.map((p) => p.url));
        store.finishScan(scanId, { status: 'ok', found: postings.length });
        console.log(`  ✓ ${board} (${name}): ${postings.length} open, ${added} new, ${closed} closed${lastTry ? ' (on the retry)' : ''}`);
        return null;
      } catch (err) {
        if (isNetworkError(err.message)) {
          if (!lastTry) {
            // The scan row stays open until the retry, so one run counts once in the streak.
            retry.push({ board, company, scanId });
            console.log(`  ⟳ ${board}: couldn't connect (${err.message}); trying again at the end`);
            return null;
          }
          store.finishScan(scanId, { status: 'error', error: err.message });
          return { board, name: company ?? board, error: err.message, streak: store.unreachableStreak(board, isNetworkError) };
        }
        // "Not found" RETIRE_AFTER runs in a row: the board is gone (D82). Once is just an error.
        const notFound = /HTTP 404\b/.test(err.message);
        const streak = notFound ? store.notFoundStreak(board) + 1 : 0;
        store.finishScan(scanId, { status: 'error', error: err.message });
        if (notFound && streak >= RETIRE_AFTER) {
          const closed = store.retireBoard(board, err.message);
          gone.push(company ?? board);
          console.log(`  🗑 ${board}: not found ${streak} runs in a row, so it was retired; ${closed} open posting(s) closed. To scan it again: scripts/market.sh unretire ${board}`);
          return null;
        }
        if (notFound) {
          counting.push(`${company ?? board} ${streak}/${RETIRE_AFTER}`);
          console.log(`  ⚠ ${board}: not found (${streak} of ${RETIRE_AFTER} runs in a row; retired after ${RETIRE_AFTER}): ${err.message}`);
          return null;
        }
        failures.push(`${board}: ${err.message}`);
        console.log(`  ✗ ${board}: ${err.message}`);
        return null;
      }
    };
    for (const [board, company] of list) await readOne(board, company, store.startScan(board), { lastTry: false });
    if (retry.length || sourceRetry.length) await sleep(RETRY_WAIT_MS);
    if (sourceRetry.length) {
      console.log(`Retrying ${sourceRetry.length} VC job list(s) that couldn't connect, after ${RETRY_WAIT_MS / 1000}s…`);
      const still = [];
      for (const r of sourceRetry) {
        const u = await readSource(r.src, r.scanId, { lastTry: true });
        if (u) { still.push(u); console.log(`  ✗ ${u.board}: still couldn't connect (${u.streak} run(s) in a row): ${u.error}`); }
      }
      const out = unreachableOutcome(still);
      failures.push(...out.failures);
      if (out.summary.length) console.log(`VC job lists unreachable after a retry (checked again next run): ${out.summary.join(' · ')}`);
    }
    if (retry.length) {
      console.log(`Retrying ${retry.length} board(s) that couldn't connect, after ${RETRY_WAIT_MS / 1000}s…`);
      const still = [];
      for (const r of retry) {
        const u = await readOne(r.board, r.company, r.scanId, { lastTry: true });
        if (u) { still.push(u); console.log(`  ✗ ${u.board}: still couldn't connect (${u.streak} run(s) in a row): ${u.error}`); }
      }
      const out = unreachableOutcome(still);
      failures.push(...out.failures);
      if (out.summary.length) console.log(`Unreachable after a retry (postings kept open; checked again next run): ${out.summary.join(' · ')}`);
    }
    if (gone.length) console.log(`Retired ${gone.length} job board(s) that no longer exist: ${gone.join(', ')}`);
    if (counting.length) console.log(`Not found (retired after ${RETIRE_AFTER} runs in a row): ${counting.join(' · ')}`);
    if (unreadable.size) console.log(`Not scanned (no board reader yet): ${[...unreadable].map(([c, b]) => `${c} (${b})`).join(', ')}`);

    if (!wanted.length) {
      // 3. Companies you Watch must have a board we read (D51).
      const missing = watchedWithoutBoard(store.companies(), boards);
      for (const c of missing) failures.push(`${c} is ticked Watch but has no job board we can read. Add one: scripts/market.sh add-board <a job link from its careers page>`);

      // 4. Text check for borderline NYC titles (D49), no AI.
      const todo = store.needsTextCheck(TEXT_CHECK_VERSION);
      let hits = 0;
      for (const p of todo) {
        try {
          const { jdText } = await fetchPosting(p.url);
          const r = textCheck(jdText);
          store.recordTextCheck(p.id, r, TEXT_CHECK_VERSION);
          if (r.hit) hits++;
        } catch (err) {
          failures.push(`text check, ${p.company} — ${p.title}: ${err.message}`);
        }
      }
      if (todo.length) console.log(`Text check (borderline NYC titles): ${todo.length} checked, ${hits} passed on to tiering.`);
    }
  } finally {
    store.close();
  }
  if (failures.length) throw new Error(`${failures.length} problem(s); failed boards were skipped and their postings were NOT closed:\n  ${failures.join('\n  ')}`);
}

function relabel() {
  const dryRun = process.argv.includes('--dry-run');
  const store = openStore();
  let changes;
  try { changes = store.relabelOpen({ dryRun }); } finally { store.close(); }
  const by = {};
  for (const c of changes) (by[`${c.from} → ${c.to}`] ||= []).push(c);
  console.log(`${dryRun ? 'Dry run: would relabel' : 'Relabelled'} ${changes.length} open posting(s) with ${TITLE_CLASSIFIER_VERSION}. Closed postings keep their old label.`);
  for (const [k, v] of Object.entries(by)) {
    console.log(`  ${k}: ${v.length}`);
    for (const c of v.slice(0, 8)) console.log(`     ${c.company} — ${c.title}`);
  }
}

/**
 * After a rules change: re-decide every open tiered posting from the facts saved with its
 * latest decision, using the current rules (no AI, no new extraction). A new decision is
 * recorded only where the tier changes; the old one stays in the history.
 */
async function retier() {
  const dryRun = process.argv.includes('--dry-run');
  const rules = loadRules();
  const hash = rulesHash(rules);
  const store = openStore();
  const changed = [];
  let checked = 0;
  try {
    for (const p of store.postings().filter((x) => !x.closed_at && x.tier)) {
      const d = store.latestDecision(p.id);
      checked++;
      const result = decideTier(d.facts, rules);
      if (result.tier === d.tier) continue;
      changed.push({ id: p.id, company: p.company, title: p.title, from: d.tier, to: result.tier });
      if (!dryRun) store.recordTier(p.id, result, d.facts, { rulesHash: hash, promptHash: d.prompt_hash });
    }
  } finally { store.close(); }
  console.log(`${dryRun ? 'Dry run: ' : ''}${checked} open tiered role(s) re-decided with the current rules (no AI); ${changed.length} change tier.`);
  for (const c of changed) console.log(`  ${c.from} → ${c.to}  ${c.company} — ${c.title}`);
  if (!dryRun && changed.length) {
    await syncAll(dataDir, { postingIds: changed.map((c) => c.id) });
  }
}

function unretire() {
  const board = process.argv[3];
  if (!board) throw new Error('Usage: market.sh unretire <board, e.g. ashby:pryzm>');
  const store = openStore();
  try {
    if (!store.unretireBoard(board)) throw new Error(`${board} is not retired.`);
    console.log(`${board} will be scanned again from the next run.`);
  } finally { store.close(); }
}

function addBoard() {
  const link = process.argv[3];
  if (!link) throw new Error('Usage: market.sh add-board <job or board link> [--company NAME]');
  const board = boardFromUrl(link);
  if (!board) throw new Error(`${link} is not on a job board we can read (Ashby, Greenhouse, Lever, Rippling).`);
  const store = openStore();
  try {
    const company = arg('--company') ?? knownBoards(store.postings(), store.boards()).boards.get(board) ?? board.split(':')[1];
    const { added } = store.addBoard(board, company, 'you', link);
    console.log(added ? `Added ${board} (${company}). It will be read on the next scan.` : `${board} is already on the list.`);
  } finally { store.close(); }
}

try {
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set. Run through scripts/market.sh.');
  const cmd = process.argv[2];
  if (cmd === 'backfill') backfill();
  else if (cmd === 'metrics') metrics();
  else if (cmd === 'recall') recall();
  else if (cmd === 'enrich') await enrich();
  else if (cmd === 'stats') stats();
  else if (cmd === 'scan') await scan();
  else if (cmd === 'relabel') relabel();
  else if (cmd === 'retier') await retier();
  else if (cmd === 'add-board') addBoard();
  else if (cmd === 'unretire') unretire();
  else if (cmd === 'discover') await discover();
  else if (cmd === 'radar') await radar();
  else throw new Error('Usage: market.sh backfill | metrics [--from YYYY-MM --to YYYY-MM] | recall <file> | enrich [--limit N] | stats | scan [board ...] | relabel [--dry-run] | retier [--dry-run] | add-board <link> [--company NAME] | unretire <board> | discover [--dry-run] [--force] | radar --research N [--no-notion]');
} catch (err) {
  console.error(`market: ${err.message}`);
  process.exit(1);
}

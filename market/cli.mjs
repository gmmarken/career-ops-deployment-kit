#!/usr/bin/env node
// Market database commands (run via scripts/market.sh, which sets CAREER_OPS_DATA_DIR):
//   backfill                     load already-tiered roles (evals snapshots + tiers/*.json); no AI calls
//   metrics [--from YYYY-MM] [--to YYYY-MM] [--all-locations] [--all-families]
//                                write monthly + ranking CSVs to <data dir>/exports/
//   recall <file> [--source linkedin]
//                                check a hand-collected list ("Company | Title" per line) against the database
//   enrich [--limit N]           research companies with no researched info yet (fills empty fields only)
//   stats                        refresh provisional monthly stats; freeze months that ended 7+ days ago
//   scan [board ...]             find boards (investor Getro boards, Watch), read every open posting on known
//                                job boards, text-check borderline NYC titles (all no AI); log scans; close gone postings
//   relabel [--dry-run]          relabel open postings with the current title classifier (D49)
//   add-board <job or board link> [--company NAME]
//                                add a company's job board by hand (e.g. for a company you Watch)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRules } from '../engine/rules.mjs';
import { decideTier } from '../engine/tier-engine.mjs';
import { loadWatchlist, watchlistPath, findCompany, toCompanyFacts, researchCompany, saveResearch, saveWatchlist, fillFromResearch, needsEnrichment } from '../extractor/research.mjs';
import { describeCalls } from '../scripts/pipeline.mjs';
import { openStore } from './store.mjs';
import { recordTiered } from './record.mjs';
import { listBoard, boardFromUrl, fetchPosting } from '../extractor/ats.mjs';
import { listGetroJobs, fetchJobPage, PAGE_DELAY_MS } from '../extractor/getro.mjs';
import { inHomeMetro } from './classify.mjs';
import { knownBoards, watchedWithoutBoard } from './boards.mjs';
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

async function enrich() {
  const limit = Number(arg('--limit') ?? 10);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive whole number.');
  const path = watchlistPath(dataDir);
  const wl = loadWatchlist(path);
  const store = openStore();
  const names = [...store.companies().map((c) => c.name), ...wl.companies.map((c) => c.name)];
  store.close();
  const todo = needsEnrichment(wl, names);
  if (!todo.length) { console.log('Every company already has researched info. Nothing to do.'); return; }
  const batch = todo.slice(0, limit);
  console.log(`${todo.length} compan${todo.length === 1 ? 'y needs' : 'ies need'} research; doing ${batch.length} now.`);
  const calls = [];
  for (const { name, entry } of batch) {
    const { company, usage } = await researchCompany(name);
    calls.push({ step: `research ${name}`, ...usage });
    if (entry) {
      const filled = fillFromResearch(entry, company);
      console.log(`  ${name}: filled ${filled.length ? filled.join(', ') : 'nothing new'} (your calls kept: status=${entry.status}, ai_native=${Boolean(entry.ai_native)})`);
    } else {
      saveResearch(path, wl, company, [name]);
      console.log(`  ${name}: added — ${company.status}, ${company.stage}${company.investors.length ? `, investors: ${company.investors.slice(0, 4).join(', ')}` : ''}`);
    }
    saveWatchlist(wl, { source: 'research', by: 'kit' });
  }
  console.log(`AI calls: ${describeCalls(calls)}`);
  if (todo.length > batch.length) console.log(`${todo.length - batch.length} left; run again to continue.`);
  console.log('Run scripts/notion.sh sync to show the new info in Company Radar.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Investor job boards to read, from private/config/sources.json. Missing file = clear error. */
function loadSources() {
  const path = join(dataDir, 'config', 'sources.json');
  if (!existsSync(path)) throw new Error(`${path} not found. Copy market/sources.example.json there and list the investor job boards to read.`);
  let cfg;
  try { cfg = JSON.parse(readFileSync(path, 'utf-8')); } catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
  if (!Array.isArray(cfg.getro_boards)) throw new Error(`${path}: "getro_boards" must be a list (it can be empty).`);
  for (const b of cfg.getro_boards) if (!b?.name || !/^https:\/\//.test(b?.url ?? '')) throw new Error(`${path}: each getro_boards entry needs a "name" and an https "url".`);
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

async function scan() {
  const rules = loadRules();
  const wanted = process.argv.slice(3).filter((a) => !a.startsWith('--'));
  const store = openStore();
  const failures = [];
  try {
    // 1. Find boards on investor job boards (whole-market scans only).
    if (!wanted.length) {
      for (const g of loadSources().getro_boards) {
        const scanId = store.startScan(`getro:${g.name}`);
        try {
          const r = await readGetro(store, g);
          store.finishScan(scanId, r.errors.length ? { status: 'error', found: r.jobs, error: r.errors.join(' | ') } : { status: 'ok', found: r.jobs });
          console.log(`  ✓ ${g.name} (Getro): ${r.jobs} job links; traced ${r.traced} new compan${r.traced === 1 ? 'y' : 'ies'}, ${r.added} new board(s) to scan`);
          if (r.unreadable.length) console.log(`    Posts somewhere we can't read yet: ${r.unreadable.map((u) => `${u.company} (${new URL(u.url).hostname})`).join(', ')}`);
          for (const e of r.errors) { failures.push(e); console.log(`  ✗ ${e}`); }
        } catch (err) {
          store.finishScan(scanId, { status: 'error', error: err.message });
          failures.push(`${g.name} (Getro): ${err.message}`);
          console.log(`  ✗ ${g.name} (Getro): ${err.message}`);
        }
      }
    }

    // 2. Read every known job board in full.
    const { boards, unreadable } = knownBoards(store.postings(), store.boards());
    const list = wanted.length ? wanted.map((b) => [b, boards.get(b) ?? null]) : [...boards];
    if (!list.length) throw new Error('No known job boards yet. Tier a role from an Ashby, Greenhouse or Lever link first, or pass a board like lever:palantir.');
    console.log(`Scanning ${list.length} board(s)…`);
    for (const [board, company] of list) {
      const scanId = store.startScan(board);
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
        console.log(`  ✓ ${board} (${name}): ${postings.length} open, ${added} new, ${closed} closed`);
      } catch (err) {
        store.finishScan(scanId, { status: 'error', error: err.message });
        failures.push(`${board}: ${err.message}`);
        console.log(`  ✗ ${board}: ${err.message}`);
      }
    }
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

function addBoard() {
  const link = process.argv[3];
  if (!link) throw new Error('Usage: market.sh add-board <job or board link> [--company NAME]');
  const board = boardFromUrl(link);
  if (!board) throw new Error(`${link} is not on a job board we can read (Ashby, Greenhouse, Lever).`);
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
  else if (cmd === 'add-board') addBoard();
  else throw new Error('Usage: market.sh backfill | metrics [--from YYYY-MM --to YYYY-MM] | recall <file> | enrich [--limit N] | stats | scan [board ...] | relabel [--dry-run] | add-board <link> [--company NAME]');
} catch (err) {
  console.error(`market: ${err.message}`);
  process.exit(1);
}

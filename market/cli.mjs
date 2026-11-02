#!/usr/bin/env node
// Market database commands (run via scripts/market.sh, which sets CAREER_OPS_DATA_DIR):
//   backfill                     load already-tiered roles (evals snapshots + tiers/*.json); no AI calls
//   metrics [--from YYYY-MM] [--to YYYY-MM] [--all-locations] [--all-families]
//                                write monthly + ranking CSVs to <data dir>/exports/
//   recall <file> [--source linkedin]
//                                check a hand-collected list ("Company | Title" per line) against the database
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRules } from '../engine/rules.mjs';
import { decideTier } from '../engine/tier-engine.mjs';
import { loadWatchlist, watchlistPath, findCompany, toCompanyFacts } from '../extractor/research.mjs';
import { openStore } from './store.mjs';
import { recordTiered } from './record.mjs';
import { monthlyByCompany, ranking, toCsv } from './metrics.mjs';
import { TARGET_FAMILIES, titleFamily, companyKey } from './classify.mjs';

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

function metrics() {
  const rules = loadRules();
  const from = arg('--from') ?? thisMonth();
  const to = arg('--to') ?? thisMonth();
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) throw new Error('--from/--to must be YYYY-MM.');
  const allLoc = process.argv.includes('--all-locations');
  const allFam = process.argv.includes('--all-families');
  const filter = (p) => (allLoc || p.in_home_metro === true) && (allFam || TARGET_FAMILIES.has(p.title_family));
  const store = openStore();
  const postings = store.postings();
  const scans = store.scans();
  store.close();
  const monthly = monthlyByCompany(postings, scans, { from, to, filter });
  const rank = ranking(postings, { from, to, filter });
  const out = join(dataDir, 'exports');
  mkdirSync(out, { recursive: true });
  const scope = `${allLoc ? 'all-locations' : rules.candidate.home_metro.toLowerCase().replace(/\s+/g, '-')}_${allFam ? 'all-families' : 'target-families'}`;
  writeFileSync(join(out, `monthly_${scope}_${from}_${to}.csv`), toCsv(monthly));
  writeFileSync(join(out, `ranking_${scope}_${from}_${to}.csv`), toCsv(rank));
  const uncovered = [...new Set(monthly.filter((r) => r.coverage_scans === 0).map((r) => r.month))];
  console.log(`Metrics ${from}..${to} (${scope}): ${monthly.length} monthly rows, ${rank.length} companies ranked → ${out}`);
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

try {
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set. Run through scripts/market.sh.');
  const cmd = process.argv[2];
  if (cmd === 'backfill') backfill();
  else if (cmd === 'metrics') metrics();
  else if (cmd === 'recall') recall();
  else throw new Error('Usage: market.sh backfill | metrics [--from YYYY-MM --to YYYY-MM] | recall <file>');
} catch (err) {
  console.error(`market: ${err.message}`);
  process.exit(1);
}

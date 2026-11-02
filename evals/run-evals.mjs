#!/usr/bin/env node
// Calibration runner. Labeled cases live in <data dir>/evals/cases.json (private).
// Default: re-tier every case from its frozen facts snapshot — zero AI calls.
//   --refresh [id ...]   re-extract (AI) and re-freeze the listed cases, or all
//   --prefill            copy key facts from snapshots into cases that have none (marked unconfirmed)
// Run via scripts/evals.sh, which sets CAREER_OPS_DATA_DIR.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { loadRules } from '../engine/rules.mjs';
import { decideTier } from '../engine/tier-engine.mjs';
import { loadWatchlist, watchlistPath, findCompany, toCompanyFacts } from '../extractor/research.mjs';
import { gatherFacts, describeCalls } from '../scripts/pipeline.mjs';
import { compareCase, keyFactsOf, summarize } from './compare.mjs';

const dataDir = process.env.CAREER_OPS_DATA_DIR;
if (!dataDir) { console.error('evals: CAREER_OPS_DATA_DIR is not set. Run through scripts/evals.sh.'); process.exit(1); }
const evalDir = join(dataDir, 'evals');
const casesPath = join(evalDir, 'cases.json');
const snapDir = join(evalDir, 'snapshots');

/** Fingerprint of the extraction instructions; a snapshot from older instructions is stale. */
const promptHash = () => createHash('sha256')
  .update(readFileSync(new URL('../extractor/prompt.md', import.meta.url)))
  .update(readFileSync(new URL('../extractor/judgment.schema.json', import.meta.url)))
  .digest('hex').slice(0, 12);

function loadCases() {
  if (!existsSync(casesPath)) throw new Error(`No cases at ${casesPath}. See evals/README.md for the format.`);
  const c = JSON.parse(readFileSync(casesPath, 'utf-8'));
  if (!Array.isArray(c.cases) || !c.cases.length) throw new Error(`${casesPath} needs a non-empty "cases" list.`);
  for (const k of c.cases) {
    if (!k.id || !k.label?.tier || !k.source) throw new Error(`Case ${JSON.stringify(k.id)} needs id, label.tier, and source.`);
  }
  return c;
}

async function main() {
  const argv = process.argv.slice(2);
  const refresh = argv.includes('--refresh');
  const prefill = argv.includes('--prefill');
  const only = argv.filter((a) => !a.startsWith('--'));
  const rules = loadRules();
  const data = loadCases();
  mkdirSync(snapDir, { recursive: true });
  const hash = promptHash();
  const allCalls = [];

  if (refresh) {
    for (const c of data.cases.filter((k) => !only.length || only.includes(k.id))) {
      const src = { ...c.source };
      if (src.jdFile && !isAbsolute(src.jdFile)) src.jdFile = join(dataDir, src.jdFile);
      process.stdout.write(`refreshing ${c.id} … `);
      const { facts, calls, companyNote } = await gatherFacts(src, { dataDir, rules });
      allCalls.push(...calls);
      writeFileSync(join(snapDir, `${c.id}.json`), `${JSON.stringify({ prompt_hash: hash, extracted_at: new Date().toISOString(), company_source: companyNote, calls, facts }, null, 2)}\n`);
      console.log(`done (${calls.length} AI call${calls.length === 1 ? '' : 's'})`);
    }
  }

  const watchlist = loadWatchlist(watchlistPath(dataDir));
  const rows = [];
  for (const c of data.cases) {
    const snapPath = join(snapDir, `${c.id}.json`);
    if (!existsSync(snapPath)) throw new Error(`No snapshot for ${c.id}. Run with --refresh ${c.id}.`);
    const snap = JSON.parse(readFileSync(snapPath, 'utf-8'));
    // Company: re-read the watchlist so your edits there count, with no AI call.
    const entry = findCompany(watchlist, snap.facts.company.name, snap.facts.posting.company);
    const facts = { ...snap.facts, company: entry ? toCompanyFacts(entry, snap.facts.company.name) : snap.facts.company };
    const result = decideTier(facts, rules);
    if (prefill && !c.key_facts) { c.key_facts = keyFactsOf(facts); c.key_facts_confirmed = false; }
    rows.push({ c, result, cmp: compareCase(c.label, facts, result), stale: snap.prompt_hash !== hash });
  }
  if (prefill) writeFileSync(casesPath, `${JSON.stringify(data, null, 2)}\n`);

  const lines = [`# Calibration — ${new Date().toISOString().slice(0, 10)}`, '', `**${summarize(rows)}**`, '',
    '| Case | Label | Pipeline | Result | Detail |', '|---|---|---|---|---|'];
  for (const r of rows) {
    const res = r.cmp.match ? '✅' : r.cmp.kind === 'extraction' ? '❌ AI misread' : r.cmp.kind === 'rule' ? '❌ rule miss' : '❌ unclassified';
    const detail = [...r.cmp.diffs, r.result.flags.join('; '), r.stale ? '⚠️ snapshot from older instructions: --refresh' : ''].filter(Boolean).join(' · ');
    lines.push(`| ${r.c.id} | ${r.c.label.tier} | ${r.result.tier} | ${res} | ${detail.replace(/\|/g, '/')} |`);
  }
  if (allCalls.length) lines.push('', `AI calls this run: ${describeCalls(allCalls)}`);
  else lines.push('', 'AI calls this run: 0 (all cases tiered from frozen snapshots)');
  const report = lines.join('\n');
  mkdirSync(join(evalDir, 'reports'), { recursive: true });
  const out = join(evalDir, 'reports', `${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(out, `${report}\n`);
  console.log(`\n${report}\n\nSaved: ${out}`);
}

main().catch((err) => { console.error(`evals: ${err.message}`); process.exit(1); });

#!/usr/bin/env node
// Job link → hard facts (code) → judgment facts (model, no tools) → company bar
// (watchlist, else web research only when the role could reach S/A) → tier (code).
//
// Usage (via scripts/tier.sh, which sets CAREER_OPS_DATA_DIR):
//   scripts/tier.sh <ashby|greenhouse|lever job URL> [--model sonnet] [--no-research]
//   scripts/tier.sh --jd-file <file> --company "<name>" [--location "<city>"]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadRules } from '../engine/rules.mjs';
import { decideTier, explain } from '../engine/tier-engine.mjs';
import { fetchPosting } from '../extractor/ats.mjs';
import { extractJudgment, markdownSection } from '../extractor/extract.mjs';
import { watchlistPath, loadWatchlist, findCompany, toCompanyFacts, researchCompany, saveResearch } from '../extractor/research.mjs';

function parseArgs(argv) {
  const opts = { research: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--jd-file') opts.jdFile = argv[++i];
    else if (a === '--company') opts.company = argv[++i];
    else if (a === '--location') opts.location = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--no-research') opts.research = false;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else opts.url = a;
  }
  if (!opts.url && !opts.jdFile) throw new Error('Give a job URL, or --jd-file <file> --company "<name>".');
  if (opts.jdFile && !opts.company) throw new Error('--jd-file needs --company "<name>".');
  return opts;
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const payStr = (p) => `${p.min ?? '?'}-${p.max ?? '?'} ${p.currency ?? '?'}/${p.interval}`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dataDir = process.env.CAREER_OPS_DATA_DIR;
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set. Run through scripts/tier.sh.');
  const rules = loadRules();
  const targets = markdownSection(readFileSync(join(dataDir, 'modes', '_profile.md'), 'utf-8'), 'Target Role Definition');
  const cv = readFileSync(join(dataDir, 'cv.md'), 'utf-8');
  const calls = [];

  // 1. Hard facts (code).
  let posting, jdText;
  if (opts.url) {
    ({ posting, jdText } = await fetchPosting(opts.url));
  } else {
    jdText = readFileSync(opts.jdFile, 'utf-8');
    posting = { url: null, source: 'file', title: basename(opts.jdFile), company: opts.company, locations: opts.location ? [opts.location] : [],
      workplace: 'unclear', posted_at: null, pay: null, equity_offered: null, pay_conflict: null };
  }

  // 2. Judgment facts (model, no tools).
  const { judgment, usage } = await extractJudgment({ jdText, targets, cv, model: opts.model });
  calls.push({ step: 'extract', ...usage });

  // Pay: ATS wins; text fills a gap; disagreement is flagged, never resolved silently.
  const t = judgment.pay_in_text;
  if (t && (t.min != null || t.max != null)) {
    const textPay = { min: t.min, max: t.max, currency: t.currency, interval: t.interval, kind: 'unknown', source: 'text' };
    if (!posting.pay) posting.pay = textPay;
    else if (posting.pay.max !== t.max || posting.pay.min !== t.min) posting.pay_conflict = { ats: payStr(posting.pay), text: payStr(textPay) };
  }

  // 3. Company bar: watchlist → research (only if the role could reach S/A) → unknown.
  const wlPath = watchlistPath(dataDir);
  const watchlist = loadWatchlist(wlPath);
  const name = judgment.company_name.value || posting.company;
  let entry = findCompany(watchlist, name, posting.company);
  let companyNote = entry ? `watchlist (${entry.origin ?? 'watchlist'})` : null;
  if (!entry) {
    const optimistic = decideTier({ posting, judgment, company: { ...toCompanyFacts(null, name), status: 'strong', origin: 'watchlist', verified: true } }, rules);
    if (!['S', 'A'].includes(optimistic.tier)) companyNote = `research skipped: best case is ${optimistic.tier}`;
    else if (!opts.research) companyNote = 'research skipped: --no-research';
    else {
      const { company, usage: rUsage } = await researchCompany(name, { model: opts.model });
      calls.push({ step: 'company-research', ...rUsage });
      entry = saveResearch(wlPath, watchlist, company, [posting.company, name]);
      companyNote = 'researched now (saved to watchlist, unverified)';
    }
  }
  const company = toCompanyFacts(entry, name);

  // 4. Tier (code).
  const facts = { posting, judgment, company };
  const result = decideTier(facts, rules);

  const outDir = join(dataDir, 'tiers');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${new Date().toISOString().slice(0, 10)}-${slug(name)}-${slug(posting.title)}.json`);
  writeFileSync(outFile, `${JSON.stringify({ facts, result, company_source: companyNote, calls }, null, 2)}\n`);

  console.log(`${name} — ${posting.title}`);
  console.log(explain(result));
  console.log(`\nCompany bar source: ${companyNote}`);
  console.log(`AI calls: ${calls.length} (${calls.map((c) => `${c.step}: ${(c.input_tokens ?? 0) + (c.cache_read_tokens ?? 0) + (c.cache_write_tokens ?? 0)} in (incl. cache) / ${c.output_tokens ?? '?'} out tokens${c.cost_usd_equivalent != null ? `, ~$${c.cost_usd_equivalent.toFixed(4)} API-equivalent` : ''}`).join('; ')})`);
  console.log(`Saved: ${outFile}`);
}

main().catch((err) => {
  console.error(`tier: ${err.message}`);
  process.exit(1);
});

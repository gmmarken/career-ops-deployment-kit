#!/usr/bin/env node
// Tier one job: hard facts (code) → judgment facts (model, no tools) → company bar → tier (code).
//
// Usage (via scripts/tier.sh, which sets CAREER_OPS_DATA_DIR):
//   scripts/tier.sh <ashby|greenhouse|lever job URL> [--model sonnet] [--no-research]
//   scripts/tier.sh --jd-file <file> --company "<name>" [--title "<role>"] [--location "<city>" ...] [--pay 135000-180000]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRules } from '../engine/rules.mjs';
import { decideTier, explain } from '../engine/tier-engine.mjs';
import { gatherFacts, checkSource, describeCalls } from './pipeline.mjs';
import { openStore } from '../market/store.mjs';
import { recordTiered } from '../market/record.mjs';

function parseArgs(argv) {
  const opts = { research: true, src: { locations: [] } };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--jd-file') opts.src.jdFile = argv[++i];
    else if (a === '--company') opts.src.company = argv[++i];
    else if (a === '--title') opts.src.title = argv[++i];
    else if (a === '--location') opts.src.locations.push(argv[++i]);
    else if (a === '--pay') opts.src.pay = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--no-research') opts.research = false;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else opts.src.url = a;
  }
  checkSource(opts.src);
  return opts;
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dataDir = process.env.CAREER_OPS_DATA_DIR;
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set. Run through scripts/tier.sh.');
  const rules = loadRules();
  const { facts, calls, companyNote } = await gatherFacts(opts.src, { dataDir, rules, model: opts.model, research: opts.research });
  const result = decideTier(facts, rules);

  const store = openStore();
  const { isNew } = recordTiered(store, facts, result, rules);
  store.close();

  const outDir = join(dataDir, 'tiers');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${new Date().toISOString().slice(0, 10)}-${slug(facts.company.name)}-${slug(facts.posting.title)}.json`);
  writeFileSync(outFile, `${JSON.stringify({ facts, result, company_source: companyNote, calls }, null, 2)}\n`);

  console.log(`${facts.company.name} — ${facts.posting.title}`);
  console.log(explain(result));
  console.log(`\nCompany bar source: ${companyNote}`);
  console.log(`AI calls: ${describeCalls(calls)}`);
  console.log(`Saved: ${outFile}`);
  console.log(`Market database: ${isNew ? 'new posting recorded' : 'existing posting updated (last seen today)'}`);
}

main().catch((err) => {
  console.error(`tier: ${err.message}`);
  process.exit(1);
});

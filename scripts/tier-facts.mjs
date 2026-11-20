#!/usr/bin/env node
// Grade a saved facts file with the tier engine alone: no AI, no network (D4).
// The facts are what extraction would return for a posting; the tier is decided by code.
//   node scripts/tier-facts.mjs <facts.json> [--rules <tier-rules.json>] [--today YYYY-MM-DD]
//   e.g. node scripts/tier-facts.mjs examples/deployment-strategist.facts.json --rules engine/tier-rules.example.json
// Without --rules it reads <data dir>/config/tier-rules.json (CAREER_OPS_DATA_DIR).
import { readFileSync } from 'node:fs';
import { decideTier, explain } from '../engine/tier-engine.mjs';
import { loadRules } from '../engine/rules.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !['--rules', '--today'].includes(args[i - 1]));
if (!file) { console.error('Usage: node scripts/tier-facts.mjs <facts.json> [--rules <tier-rules.json>] [--today YYYY-MM-DD]'); process.exit(2); }
const today = opt('--today') ? new Date(`${opt('--today')}T12:00:00Z`) : new Date();
if (Number.isNaN(today.getTime())) { console.error(`--today must be a date like 2026-11-20, not "${opt('--today')}".`); process.exit(2); }
let facts;
try { facts = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`${file}: ${e.message}`); process.exit(1); }
const rules = opt('--rules') ? loadRules(opt('--rules')) : loadRules();
const { _about, ...posting } = facts;
console.log(explain(decideTier(posting, rules, { today })));

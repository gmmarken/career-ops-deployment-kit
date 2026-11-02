#!/usr/bin/env node
// Warn when the tier settings (config/tier-rules.json, read by the engine) and the
// prose rules (modes/_custom.md, read by career-ops evaluations) disagree on a number.
// Exit 1 on any mismatch so it can't be missed. Usage (data dir from scripts/co.sh or env):
//   CAREER_OPS_DATA_DIR=../private node engine/check-rules-drift.mjs
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRules } from './rules.mjs';

const usdK = (n) => `$${Math.round(n / 1000)}K`;

/** Every number the prose must mention, with what it is. Exported for tests. */
export function expectedMentions(rules) {
  return [
    [usdK(rules.pay.s_bar_top), 'pay.s_bar_top'],
    [usdK(rules.pay.early_stage_bar_top), 'pay.early_stage_bar_top'],
    [usdK(rules.pay.walkaway_top), 'pay.walkaway_top'],
    [usdK(rules.pay.borderline_floor_top), 'pay.borderline_floor_top'],
    [`${rules.old_posting_days} days`, 'old_posting_days'],
  ];
}

export function findDrift(rules, prose) {
  return expectedMentions(rules).filter(([text]) => !prose.includes(text)).map(([text, field]) => `${field} = ${text} is not in _custom.md`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dataDir = process.env.CAREER_OPS_DATA_DIR;
  if (!dataDir) { console.error('CAREER_OPS_DATA_DIR is not set.'); process.exit(1); }
  const drift = findDrift(loadRules(), readFileSync(join(dataDir, 'modes', '_custom.md'), 'utf-8'));
  if (drift.length) {
    console.error(`Rules drift between config/tier-rules.json and modes/_custom.md:\n  - ${drift.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('No drift: tier-rules.json and _custom.md agree on every number checked.');
}

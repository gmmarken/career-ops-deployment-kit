// Load and check the tier settings file. Fails loudly: a missing or malformed
// setting stops the run with a message naming the field, never a silent default.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const TIERS = ['S', 'A', 'B', 'C'];

/** Default location of the private settings file inside the data dir. */
export function defaultRulesPath() {
  const dataDir = process.env.CAREER_OPS_DATA_DIR;
  if (!dataDir) {
    throw new Error('CAREER_OPS_DATA_DIR is not set. Run through scripts/co.sh or scripts/tier.sh, or pass --rules <file>.');
  }
  return join(dataDir, 'config', 'tier-rules.json');
}

export function loadRules(path = defaultRulesPath()) {
  if (!existsSync(path)) {
    throw new Error(`Tier settings not found at ${path}. Copy engine/tier-rules.example.json there and fill in your values.`);
  }
  let rules;
  try {
    rules = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`Tier settings at ${path} are not valid JSON: ${err.message}`);
  }
  validateRules(rules, path);
  return rules;
}

export function validateRules(r, where = 'tier settings') {
  const problems = [];
  const num = (v, name) => { if (typeof v !== 'number' || !Number.isFinite(v)) problems.push(`${name} must be a number`); };
  const str = (v, name) => { if (typeof v !== 'string' || !v.trim()) problems.push(`${name} must be a non-empty string`); };
  const tier = (v, name) => { if (!TIERS.includes(v)) problems.push(`${name} must be one of ${TIERS.join('/')}`); };
  const list = (v, name) => { if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) problems.push(`${name} must be a list of strings`); };

  if (!r || typeof r !== 'object') throw new Error(`${where}: settings must be a JSON object`);
  str(r.candidate?.experience_start, 'candidate.experience_start');
  if (r.candidate?.experience_start && Number.isNaN(Date.parse(r.candidate.experience_start))) problems.push('candidate.experience_start must be a date (YYYY-MM-DD)');
  str(r.candidate?.home_metro, 'candidate.home_metro');
  list(r.candidate?.home_metro_aliases, 'candidate.home_metro_aliases');
  list(r.families, 'families');
  str(r.priority_family, 'priority_family');
  str(r.pay?.currency, 'pay.currency');
  num(r.pay?.s_bar_top, 'pay.s_bar_top');
  num(r.pay?.early_stage_bar_top, 'pay.early_stage_bar_top');
  list(r.pay?.early_stages, 'pay.early_stages');
  num(r.pay?.walkaway_top, 'pay.walkaway_top');
  num(r.pay?.borderline_floor_top, 'pay.borderline_floor_top');
  num(r.seniority?.reach_max_extra_years, 'seniority.reach_max_extra_years');
  num(r.seniority?.below_level_years, 'seniority.below_level_years');
  for (const k of ['reach', 'reach_1_year', 'tactical', 'mbb', 'borderline_equity', 'unclear_judgment', 'below_level', 'pay_not_posted', 'pay_not_posted_not_ai_native']) tier(r.caps?.[k], `caps.${k}`);
  if (![...TIERS, 'Excluded'].includes(r.location?.outside_home_metro)) problems.push('location.outside_home_metro must be one of S/A/B/C/Excluded');
  num(r.old_posting_days, 'old_posting_days');
  list(r.excluded_categories, 'excluded_categories');
  if (r.pay && r.pay.borderline_floor_top > r.pay.walkaway_top) problems.push('pay.borderline_floor_top must be ≤ pay.walkaway_top');

  if (problems.length) throw new Error(`${where} has problems:\n  - ${problems.join('\n  - ')}`);
  return r;
}

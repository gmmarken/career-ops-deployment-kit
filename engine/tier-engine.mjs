// Deterministic tier engine: facts + settings -> S/A/B/C (or Excluded / Walk-away),
// with flags and a step-by-step "why this tier". No AI, no network, no randomness:
// the same input always gives the same output.
//
// The facts shape is defined in extractor/facts.schema.json. The rules follow
// modes/_custom.md steps 1-8 (see engine/README.md for the mapping).
import { TIERS } from './rules.mjs';
import { inHomeMetro } from '../market/classify.mjs';

const lower = (tier, n = 1) => TIERS[Math.min(TIERS.indexOf(tier) + n, TIERS.length - 1)];
const capAt = (tier, cap) => (TIERS.indexOf(tier) < TIERS.indexOf(cap) ? cap : tier);
const q = (quote) => (quote ? ` — "${quote}"` : '');

// Requirements the candidate can't meet, read straight from the title as well, so a miss by the
// model can't let them through (D94). "Portuguese Speaking", "Bilingual Spanish", "TS/SCI".
const LANGUAGES = ['Spanish', 'Portuguese', 'French', 'German', 'Italian', 'Dutch', 'Japanese', 'Mandarin', 'Chinese', 'Cantonese', 'Korean', 'Arabic', 'Hebrew', 'Russian', 'Hindi', 'Polish', 'Turkish', 'Vietnamese', 'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Greek', 'Thai', 'Indonesian', 'Tagalog', 'Ukrainian', 'Czech', 'Romanian', 'Hungarian'];
const LANG_RE = new RegExp(`\\b(?:bilingual\\s+(?:\\w+\\s+)?(${LANGUAGES.join('|')})|(${LANGUAGES.join('|')})[\\s-]+(?:speaking|speaker|fluent|native))\\b`, 'i');
const NOT_FULL_TIME_RE = /\b(part[- ]time|contract[- ]to[- ]hire|contractor|temporary|fixed[- ]term|internship|intern)\b|\((?:contract|temp)\)|[-–] (?:contract|temp)\b/i;
const CLEARANCE_RE = /\b(TS\/SCI|top secret|secret clearance|security clearance|cleared)\b/i;

/** Languages a title requires ("AI Strategist - Portuguese Speaking" → ["Portuguese"]). */
export function titleLanguages(title) {
  const m = String(title ?? '').match(LANG_RE);
  return m ? [m[1] ?? m[2]].map((l) => l[0].toUpperCase() + l.slice(1).toLowerCase()) : [];
}
/** True if the title itself asks for a clearance. */
export const titleClearance = (title) => CLEARANCE_RE.test(String(title ?? ''));
/** True if the title says the role isn't permanent full-time ("Contractor", "Part-time", "(Contract)"). */
export const titleNotFullTime = (title) => NOT_FULL_TIME_RE.test(String(title ?? ''));

/** Whole years of experience on `today`, from the start date in the settings. */
export function yearsOfExperience(startIso, today) {
  const start = new Date(startIso);
  let years = today.getUTCFullYear() - start.getUTCFullYear();
  const beforeAnniversary =
    today.getUTCMonth() < start.getUTCMonth() ||
    (today.getUTCMonth() === start.getUTCMonth() && today.getUTCDate() < start.getUTCDate());
  if (beforeAnniversary) years -= 1;
  return years;
}

/**
 * @param {object} facts   { posting, judgment, company } — see extractor/facts.schema.json
 * @param {object} rules   validated settings (engine/rules.mjs)
 * @param {{today?: Date}} [opts]
 * @returns {{ tier: string, flags: string[], steps: object[], sortKey: object }}
 */
export function decideTier(facts, rules, { today = new Date() } = {}) {
  const { posting, judgment: j, company } = facts;
  const steps = [];
  const flags = [];
  const step = (name, result, detail) => steps.push({ step: name, result, detail });
  const done = (tier) => ({
    tier,
    flags,
    steps,
    sortKey: {
      priority_family: j.role_family?.value === rules.priority_family,
      ai_native: company.ai_native ?? null,
      gm_path: Boolean(j.tags?.gm_path),
      product_path: Boolean(j.tags?.product_path),
      office_days: j.work_model?.office_days ?? null,
    },
  });

  // Flags that never change the tier (step 7), collected up front so every outcome carries them.
  if (j.quota_path?.present) flags.push(`Watch: quota path${q(j.quota_path.quote)}`);
  if (posting.posted_at) {
    const days = Math.floor((today - new Date(posting.posted_at)) / 86_400_000);
    if (days > rules.old_posting_days) flags.push(`Old posting: posted ${posting.posted_at.slice(0, 10)}, ${days} days`);
  }
  if (posting.pay_conflict) flags.push(`Pay conflict: ATS says ${posting.pay_conflict.ats}, JD text says ${posting.pay_conflict.text}`);
  if (j.injection_suspected?.value) flags.push(`Posting contains instructions aimed at AI (ignored)${q(j.injection_suspected.quote)}`);

  // Step 1 — exclusions (ownership, not investment).
  const excludedBy = (company.owner_categories || []).filter((c) => rules.excluded_categories.includes(c));
  if (excludedBy.length) {
    step('1. Exclusions', 'Excluded', `${company.name}: ${excludedBy.join(', ')}${company.parent ? ` (parent: ${company.parent})` : ''}`);
    return done('Excluded');
  }
  step('1. Exclusions', 'none', `${company.name}: no excluded owner category`);

  // Step 1a — requirements the candidate can't meet (D94): a language he doesn't speak, or an
  // active security clearance. Excluded, from the posting's text or its title.
  const speaks = new Set(rules.candidate.languages.map((l) => l.toLowerCase()));
  const langs = [
    ...(j.languages_required || []).map((l) => ({ language: l.language, quote: l.quote })),
    ...titleLanguages(posting.title).map((language) => ({ language, quote: posting.title })),
  ].filter((l) => !speaks.has(String(l.language).toLowerCase().replace(/^(brazilian|european|latin american|mexican|castilian)\s+/, '')));
  if (langs.length) {
    flags.push(`Requires ${langs[0].language}`);
    step('1a. Requirements', 'Excluded', `requires ${[...new Set(langs.map((l) => l.language))].join(', ')}${q(langs[0].quote)}`);
    return done('Excluded');
  }
  if (j.clearance?.value === 'active_required' || titleClearance(posting.title)) {
    flags.push('Requires security clearance');
    step('1a. Requirements', 'Excluded', `active security clearance required${q(j.clearance?.quote ?? posting.title)}`);
    return done('Excluded');
  }
  const empType = j.employment_type?.value;
  if ((empType && !['full_time', 'unclear'].includes(empType)) || titleNotFullTime(posting.title)) {
    const what = empType && !['full_time', 'unclear'].includes(empType) ? empType.replace(/_/g, '-') : 'not full-time (title)';
    flags.push(`Not full-time: ${what}`);
    step('1a. Requirements', 'Excluded', `${what}${q(j.employment_type?.quote ?? posting.title)}`);
    return done('Excluded');
  }
  const badIndustry = (j.industry_flags || []).filter((f) => rules.excluded_industries.includes(f.industry));
  if (badIndustry.length) {
    flags.push(`Excluded industry: ${badIndustry[0].industry}`);
    step('1a. Requirements', 'Excluded', `${badIndustry.map((f) => f.industry).join(', ')}${q(badIndustry[0].quote)}`);
    return done('Excluded');
  }
  if (j.clearance?.value === 'obtain_required') flags.push(`Clearance: must be able to obtain one${q(j.clearance.quote)}`);
  if (j.travel_vague_heavy?.value) flags.push(`Travel: significant, amount not stated${q(j.travel_vague_heavy.quote)}`);
  if ((j.work_model?.office_days ?? 0) >= 5) flags.push(`5 days in office${q(j.work_model.quote)}`);
  if (j.degree_required?.value && j.degree_required.met === false) flags.push(`Degree: required, not on your CV${q(j.degree_required.quote)}`);
  if (j.staffing_agency?.value) flags.push(`Staffing agency posting${q(j.staffing_agency.quote)}`);
  step('1a. Requirements', 'none', '');

  // Step 1b — walk-away pay.
  const pay = posting.pay;
  const top = pay && pay.currency === rules.pay.currency && pay.interval === 'year' ? pay.max ?? pay.min : null;
  if (pay && top === null) flags.push(`Pay not comparable: ${pay.min ?? '?'}-${pay.max ?? '?'} ${pay.currency}/${pay.interval}`);
  let borderlineCap = false;
  if (top !== null && top <= rules.pay.walkaway_top) {
    const equity = j.equity_substantial?.value === true;
    if (top >= rules.pay.borderline_floor_top && equity) {
      borderlineCap = true;
      flags.push(`Below walk-away: equity-heavy${q(j.equity_substantial.quote)}`);
      step('1b. Walk-away pay', 'borderline with equity', `top of range ${top} ≤ ${rules.pay.walkaway_top}; substantial equity stated → scored, capped at ${rules.caps.borderline_equity}`);
    } else {
      step('1b. Walk-away pay', 'Walk-away', `top of range ${top} ≤ ${rules.pay.walkaway_top}`);
      return done('Walk-away');
    }
  } else {
    step('1b. Walk-away pay', 'clear', top === null ? 'no comparable posted pay' : `top of range ${top}`);
  }

  // Step 1d — location eligibility (home metro or remote). Outside → configured tier.
  const locs = posting.locations || [];
  const workModel = j.work_model?.value ?? posting.workplace ?? 'unclear';
  const inMetro = inHomeMetro(locs, rules.candidate);
  if (locs.length && !inMetro && workModel !== 'remote') {
    step('Location', rules.location.outside_home_metro, `locations: ${locs.join('; ')} — not ${rules.candidate.home_metro}, not remote`);
    flags.push(`Outside ${rules.candidate.home_metro}`);
    return done(rules.location.outside_home_metro);
  }

  // Step 2 — traps.
  if (j.traps?.length) {
    const t = j.traps[0];
    for (const trap of j.traps) flags.push(`Trap: ${trap.trap}${q(trap.quote)}`);
    step('2. Traps', 'C', `${t.trap}${q(t.quote)}`);
    return done('C');
  }
  step('2. Traps', 'none', '');

  // Step 3 — count the S criteria.
  const misses = [];
  const unclear = [];
  const family = j.role_family?.value;
  if (family === 'other') {
    step('3a. Right family', 'C', `not a target family${q(j.role_family.quote)}`);
    return done('C');
  }
  if (!family || family === 'unclear') unclear.push('family');
  step('3a. Right family', family && family !== 'unclear' ? 'met' : 'unclear', `${family ?? 'missing'}${q(j.role_family?.quote)}`);

  const cStatus = company.status ?? 'unknown';
  if (cStatus === 'not_strong') misses.push('company');
  if (cStatus === 'unknown') unclear.push('company');
  step('3b. Strong company', cStatus === 'strong' || cStatus === 'exceptional' ? 'met' : cStatus === 'not_strong' ? 'miss' : 'unclear',
    `${company.name}: ${cStatus} (${company.origin ?? 'no source'}${company.verified ? '' : ', unverified'})${company.reason ? ` — ${company.reason}` : ''}`);
  if (company.origin === 'research' && !company.verified) flags.push('Company bar: web research, unverified');

  const shape = j.role_shape?.value;
  const shapeMet = shape === 'strategic' || (shape === 'mixed' && cStatus === 'exceptional');
  if (shape === 'mixed' || shape === 'tactical') { if (!shapeMet) misses.push('shape'); }
  else if (shape !== 'strategic') unclear.push('shape');
  step('3c. Strategic shape', shapeMet ? 'met' : shape === 'mixed' || shape === 'tactical' ? 'miss' : 'unclear',
    `${shape ?? 'missing'}${shape === 'mixed' && cStatus === 'exceptional' ? ' at an exceptional company' : ''}${q(j.role_shape?.quote)}`);

  if (top === null) {
    if (!pay) flags.push('Pay not posted: verify');
    step('3d. Pay bar', 'not posted (not a miss)', '');
  } else {
    const early = rules.pay.early_stages.includes(company.stage);
    const met = top >= rules.pay.s_bar_top || (early && top >= rules.pay.early_stage_bar_top);
    if (!met) misses.push('pay');
    step('3d. Pay bar', met ? 'met' : 'miss',
      `top ${top} vs ${rules.pay.s_bar_top}${early ? ` (early-stage bar ${rules.pay.early_stage_bar_top})` : ''} [${pay.source}]`);
  }

  const fit = j.fit?.value;
  if (fit === 'weak') {
    step('3e. Fit', 'C', `weak — ${j.fit.reason ?? ''}`);
    return done('C');
  }
  if (fit !== 'strong' && fit !== 'possible') unclear.push('fit');
  step('3e. Fit', fit === 'strong' || fit === 'possible' ? 'met' : 'unclear', `${fit ?? 'missing'}${j.fit?.reason ? ` — ${j.fit.reason}` : ''}`);

  let tier = TIERS[Math.min(misses.length, 3)];
  step('3. Criteria', tier, `${misses.length} missed${misses.length ? `: ${misses.join(', ')}` : ''}`);

  // Step 4 — seniority.
  const yrs = yearsOfExperience(rules.candidate.experience_start, today);
  const ask = j.years_required?.min;
  let reach = false;
  let belowLevel = false;
  if (j.years_required?.hard_gate && j.years_required.hard_gate_met === false) {
    step('4. Seniority', 'Reference only → C', `hard gate${q(j.years_required.quote)}`);
    return done('C');
  }
  if (typeof ask === 'number') {
    const extra = ask - yrs;
    if (extra > rules.seniority.reach_max_extra_years) {
      step('4. Seniority', 'Reference only → C', `asks ${ask}, has ${yrs}${q(j.years_required.quote)}`);
      return done('C');
    }
    reach = extra >= 1;
    belowLevel = yrs - ask >= rules.seniority.below_level_years;
    step('4. Seniority', reach ? 'Reach' : belowLevel ? 'Below level' : 'fits', `asks ${ask}, has ${yrs}`);
  } else {
    step('4. Seniority', 'not stated', `has ${yrs}`);
  }

  // Step 5 — caps.
  const caps = [];
  const applyCap = (cap, why) => { const before = tier; tier = capAt(tier, cap); caps.push(`${why} → max ${cap}${before !== tier ? ` (${before}→${tier})` : ''}`); };
  if (reach) applyCap(ask - yrs === 1 ? rules.caps.reach_1_year : rules.caps.reach, `Reach (+${ask - yrs})`);
  if (belowLevel) { applyCap(rules.caps.below_level, 'Below level'); flags.push(`Below level: asks ${ask} years, has ${yrs}`); }
  if (shape === 'tactical') applyCap(rules.caps.tactical, 'Tactical shape');
  if (company.is_mbb) applyCap(rules.caps.mbb, 'MBB');
  if (borderlineCap) applyCap(rules.caps.borderline_equity, 'Borderline walk-away with equity');
  if (unclear.length) {
    applyCap(rules.caps.unclear_judgment, `Unclear: ${unclear.join(', ')}`);
    flags.push(`Verify before S: ${unclear.join(', ')} unclear`);
  }
  step('5. Caps', caps.length ? tier : 'none', caps.join('; '));

  // Step 6 — drops (one tier each, never below C).
  const drops = [];
  if (workModel === 'remote') drops.push('Remote role');
  if (j.back_office?.value) drops.push(`Back office${q(j.back_office.quote)}`);
  if (j.people_management?.required) drops.push(`Manages people${j.people_management.team_size ? `: team of ${j.people_management.team_size}` : ''}${q(j.people_management.quote)}`);
  if (j.off_hours?.value) drops.push(`Off-hours or another region's hours${q(j.off_hours.quote)}`);
  // One drop per red-flag TYPE, however many quotes back it up.
  const byFlag = new Map();
  for (const rf of j.red_flags || []) byFlag.set(rf.flag, [...(byFlag.get(rf.flag) || []), rf.quote]);
  for (const [flag, quotes] of byFlag) drops.push(`Red flag: ${flag}${quotes.filter(Boolean).map((x) => ` — "${x}"`).join('')}`);
  if (drops.length) {
    const before = tier;
    tier = lower(tier, drops.length);
    flags.push(...drops);
    step('6. Drops', tier, `${drops.length} drop(s) ${before}→${tier}: ${drops.join('; ')}`);
  } else {
    step('6. Drops', 'none', '');
  }

  // Step 6b — ceiling for missing pay (D62). Applied AFTER drops: it is "no higher than A
  // without pay", not a penalty on top of other drops. Also not AI-native → no higher than B.
  // Unknown AI-native status (null) is not treated as "no": only the first ceiling applies.
  if (!pay) {
    const notAi = company.ai_native === false;
    const cap = notAi ? rules.caps.pay_not_posted_not_ai_native : rules.caps.pay_not_posted;
    const before = tier;
    tier = capAt(tier, cap);
    step('6b. Pay ceiling', tier, `Pay not posted${notAi ? ', not AI-native' : ''} → max ${cap}${before !== tier ? ` (${before}→${tier})` : ''}`);
  }

  // Step 7 — tags (no tier effect).
  const tags = [j.tags?.gm_path && 'GM path', j.tags?.product_path && 'Product path'].filter(Boolean);
  step('7. Tags', tags.length ? tags.join(', ') : 'none', '');
  return done(tier);
}

/** Plain-text "why this tier" for reports and alerts. */
export function explain(result) {
  const lines = [`Tier: ${result.tier}`];
  for (const s of result.steps) lines.push(`  ${s.step}: ${s.result}${s.detail ? ` — ${s.detail}` : ''}`);
  if (result.flags.length) lines.push(`Flags: ${result.flags.join(' | ')}`);
  return lines.join('\n');
}

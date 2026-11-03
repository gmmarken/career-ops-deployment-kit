// One test (at least) per tier rule. Uses the public example settings, never private values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideTier, explain, yearsOfExperience } from './tier-engine.mjs';
import { validateRules } from './rules.mjs';

const rules = validateRules(JSON.parse(readFileSync(new URL('./tier-rules.example.json', import.meta.url))));
// Example settings: experience_start 2020-01-01 → 6 years on TODAY. s_bar 170K, early 140K, walk-away 120K, borderline floor 110K.
const TODAY = new Date('2026-07-01T00:00:00Z');

/** A posting that meets every S criterion under the example settings. Override pieces per test. */
function sFacts(over = {}) {
  const base = {
    posting: {
      url: 'https://example.test/job', source: 'ashby', title: 'Deployment Strategist', company: 'exampleco',
      locations: ['Example City Office'], workplace: 'onsite', posted_at: '2026-06-20T00:00:00Z',
      pay: { min: 160000, max: 200000, currency: 'USD', interval: 'year', kind: 'base', source: 'ats' },
      equity_offered: true, pay_conflict: null,
    },
    judgment: {
      company_name: { value: 'ExampleCo', quote: 'About ExampleCo' },
      role_family: { value: 'deployment_ai_strategist', quote: 'own the deployment strategy' },
      role_shape: { value: 'strategic', quote: 'set the AI agenda with customer executives' },
      traps: [], red_flags: [],
      quota_path: { present: false, quote: null },
      years_required: { min: null, hard_gate: false, hard_gate_met: null, quote: null },
      work_model: { value: 'onsite', office_days: 4, quote: '4 days in office' },
      back_office: { value: false, quote: null },
      fit: { value: 'strong', reason: 'consulting + hands-on AI' },
      tags: { gm_path: false, product_path: false },
      equity_substantial: { value: false, quote: null },
      pay_in_text: null,
      injection_suspected: { value: false, quote: null },
    },
    company: { name: 'ExampleCo', status: 'strong', stage: 'series_d_plus', owner_categories: [], parent: null, is_mbb: false, origin: 'watchlist', verified: true, reason: 'frontier lab' },
  };
  return {
    posting: { ...base.posting, ...over.posting },
    judgment: { ...base.judgment, ...over.judgment },
    company: { ...base.company, ...over.company },
  };
}
const run = (over) => decideTier(sFacts(over), rules, { today: TODAY });

test('baseline: all criteria met → S', () => {
  const r = run();
  assert.equal(r.tier, 'S');
  assert.deepEqual(r.flags, []);
  assert.match(explain(r), /Tier: S/);
});

test('years of experience roll over on the anniversary', () => {
  assert.equal(yearsOfExperience('2022-06-01', new Date('2027-05-31T00:00:00Z')), 4);
  assert.equal(yearsOfExperience('2022-06-01', new Date('2027-06-01T00:00:00Z')), 5);
});

// Step 1 — exclusions
test('excluded owner category → Excluded, parent named', () => {
  const r = run({ company: { owner_categories: ['example_excluded_parent'], parent: 'ParentCorp' } });
  assert.equal(r.tier, 'Excluded');
  assert.match(r.steps[0].detail, /ParentCorp/);
});
test('investment is not ownership: no owner category → not excluded', () => {
  const r = run({ company: { owner_categories: [], reason: 'backed by ParentCorp' } });
  assert.equal(r.tier, 'S');
});
test('crypto-first → Excluded', () => assert.equal(run({ company: { owner_categories: ['crypto_first'] } }).tier, 'Excluded'));

// Step 1b — walk-away pay
test('top of range at walk-away → Walk-away', () => {
  assert.equal(run({ posting: { pay: { min: 100000, max: 120000, currency: 'USD', interval: 'year', kind: 'base', source: 'ats' } } }).tier, 'Walk-away');
});
test('borderline range + substantial equity → scored, capped at B, flagged', () => {
  const r = run({
    posting: { pay: { min: 100000, max: 115000, currency: 'USD', interval: 'year', kind: 'base', source: 'ats' } },
    judgment: { equity_substantial: { value: true, quote: 'meaningful equity' } },
  });
  assert.equal(r.tier, 'B');
  assert.ok(r.flags.some((f) => f.startsWith('Below walk-away: equity-heavy')));
});
test('below borderline floor + equity → still Walk-away', () => {
  const r = run({
    posting: { pay: { min: 90000, max: 105000, currency: 'USD', interval: 'year', kind: 'base', source: 'ats' } },
    judgment: { equity_substantial: { value: true, quote: 'meaningful equity' } },
  });
  assert.equal(r.tier, 'Walk-away');
});
test('no posted pay → not a miss, flagged, can still be S', () => {
  const r = run({ posting: { pay: null } });
  assert.equal(r.tier, 'S');
  assert.ok(r.flags.includes('Pay not posted: verify'));
});
test('hourly pay is not compared, flagged', () => {
  const r = run({ posting: { pay: { min: 80, max: 100, currency: 'USD', interval: 'hour', kind: 'base', source: 'ats' } } });
  assert.ok(r.flags.some((f) => f.startsWith('Pay not comparable')));
});

// Step 2 — traps
for (const trap of ['engineer_in_disguise', 'internal_deployment_infra', 'workflow_builder_only', 'quota_sales']) {
  test(`trap ${trap} → C with quote`, () => {
    const r = run({ judgment: { traps: [{ trap, quote: 'evidence' }] } });
    assert.equal(r.tier, 'C');
    assert.ok(r.flags.includes(`Trap: ${trap} — "evidence"`));
  });
}

// Location
test('outside home metro and not remote → configured tier', () => {
  const r = run({ posting: { locations: ['Other City Office'] }, judgment: { work_model: { value: 'onsite', office_days: 5, quote: null } } });
  assert.equal(r.tier, rules.location.outside_home_metro);
});
test('outside home metro can be set to Excluded', () => {
  const r = decideTier(sFacts({ posting: { locations: ['Other City Office'] } }), { ...rules, location: { outside_home_metro: 'Excluded' } }, { today: TODAY });
  assert.equal(r.tier, 'Excluded');
  assert.ok(r.flags.includes('Outside Example City'));
});
test('remote role outside home metro is still eligible (drops one tier)', () => {
  assert.equal(run({ posting: { locations: ['Other City'] }, judgment: { work_model: { value: 'remote', office_days: 0, quote: 'remote' } } }).tier, 'A');
});
test('home-metro aliases count as in the metro (e.g. a borough name)', () => {
  assert.equal(run({ posting: { locations: ['Example Borough, EX'] } }).tier, 'S');
  assert.equal(run({ posting: { locations: ['EXC'] } }).tier, 'S');
});
test('in "City, State" only the city counts', () => {
  assert.equal(run({ posting: { locations: ['Example City, EX'] } }).tier, 'S');
  assert.equal(run({ posting: { locations: ['Othertown, Example City'] } }).tier, rules.location.outside_home_metro);
});
test('aliases match whole words only', () => {
  assert.equal(run({ posting: { locations: ['Texclusive Town'] } }).tier, rules.location.outside_home_metro);
});
test('location is checked before traps (outside + trap → outside rule wins)', () => {
  const r = run({ posting: { locations: ['Other City Office'] }, judgment: { traps: [{ trap: 'quota_sales', quote: 'x' }] } });
  assert.equal(r.tier, rules.location.outside_home_metro);
});
test('multi-office posting including home metro is eligible', () => {
  assert.equal(run({ posting: { locations: ['Other City Office', 'Example City Office'] } }).tier, 'S');
});

// Step 3 — criteria count
test('wrong family → C', () => assert.equal(run({ judgment: { role_family: { value: 'other', quote: 'x' } } }).tier, 'C'));
test('one miss (company not strong) → A', () => assert.equal(run({ company: { status: 'not_strong' } }).tier, 'A'));
test('two misses (company + pay) → B', () => {
  assert.equal(run({ company: { status: 'not_strong' }, posting: { pay: { min: 130000, max: 150000, currency: 'USD', interval: 'year', kind: 'base', source: 'ats' } } }).tier, 'B');
});
test('three misses → C', () => {
  assert.equal(run({
    company: { status: 'not_strong' },
    posting: { pay: { min: 130000, max: 150000, currency: 'USD', interval: 'year', kind: 'base', source: 'ats' } },
    judgment: { role_shape: { value: 'mixed', quote: 'x' } },
  }).tier, 'C');
});
test('pay below S bar but early-stage bar met → pay met', () => {
  assert.equal(run({ company: { stage: 'series_a' }, posting: { pay: { min: 120000, max: 145000, currency: 'USD', interval: 'year', kind: 'base', source: 'ats' } } }).tier, 'S');
});
test('same pay at a late-stage company → one miss → A', () => {
  assert.equal(run({ posting: { pay: { min: 120000, max: 145000, currency: 'USD', interval: 'year', kind: 'base', source: 'ats' } } }).tier, 'A');
});
test('mixed shape at a strong (not exceptional) company → miss → A', () => {
  assert.equal(run({ judgment: { role_shape: { value: 'mixed', quote: 'x' } } }).tier, 'A');
});
test('mixed shape at an exceptional company → met → S', () => {
  assert.equal(run({ judgment: { role_shape: { value: 'mixed', quote: 'x' } }, company: { status: 'exceptional' } }).tier, 'S');
});
test('weak fit → C', () => assert.equal(run({ judgment: { fit: { value: 'weak', reason: 'no overlap' } } }).tier, 'C'));

// Decision 5C — unclear judgment blocks S but isn't a miss
for (const [label, over] of [
  ['family', { judgment: { role_family: { value: 'unclear', quote: null } } }],
  ['shape', { judgment: { role_shape: { value: 'unclear', quote: null } } }],
  ['fit', { judgment: { fit: { value: 'unclear', reason: 'thin JD' } } }],
  ['company', { company: { status: 'unknown', origin: 'research', verified: false } }],
]) {
  test(`unclear ${label} → capped at A and flagged`, () => {
    const r = run(over);
    assert.equal(r.tier, 'A');
    assert.ok(r.flags.some((f) => f.startsWith('Verify before S')));
  });
}

// Step 4 — seniority (example candidate has 6 years on TODAY)
test('asks for same years → fits → S', () => assert.equal(run({ judgment: { years_required: { min: 6, hard_gate: false, hard_gate_met: null, quote: '6+ years' } } }).tier, 'S'));
test('asks +1 year → Reach by 1 → capped at caps.reach_1_year (A)', () => {
  const r = run({ judgment: { years_required: { min: 7, hard_gate: false, hard_gate_met: null, quote: '7+ years' } } });
  assert.equal(r.tier, 'A');
  assert.match(r.steps.find((s) => s.step.startsWith('5.')).detail, /Reach \(\+1\)/);
});
test('settings without caps.reach_1_year are rejected', () => {
  const bad = structuredClone(rules); delete bad.caps.reach_1_year;
  assert.throws(() => validateRules(bad), /caps\.reach_1_year/);
});
test('asks +2 years → Reach → capped at B', () => assert.equal(run({ judgment: { years_required: { min: 8, hard_gate: false, hard_gate_met: null, quote: '8+ years' } } }).tier, 'B'));
test('asks +3 years → Reference only → C', () => assert.equal(run({ judgment: { years_required: { min: 9, hard_gate: false, hard_gate_met: null, quote: '9+ years' } } }).tier, 'C'));
test('asks 3+ years below the candidate → Below level, capped at A, flagged', () => {
  const r = run({ judgment: { years_required: { min: 3, hard_gate: false, hard_gate_met: null, quote: '1-3 years' } } });
  assert.equal(r.tier, 'A');
  assert.ok(r.flags.includes('Below level: asks 3 years, has 6'));
});
test('asks 2 years below → not below level → S', () => {
  assert.equal(run({ judgment: { years_required: { min: 4, hard_gate: false, hard_gate_met: null, quote: '4+ years' } } }).tier, 'S');
});
test('below level is a cap, not a drop: a B role stays B', () => {
  assert.equal(run({ company: { status: 'not_strong' }, posting: { pay: { min: 100000, max: 150000, currency: 'USD', interval: 'year', kind: 'base', source: 'ats' } },
    judgment: { years_required: { min: 1, hard_gate: false, hard_gate_met: null, quote: '1+ year' } } }).tier, 'B');
});
test('unmet hard gate → C', () => assert.equal(run({ judgment: { years_required: { min: null, hard_gate: true, hard_gate_met: false, quote: 'must have managed 10 people' } } }).tier, 'C'));
test('years not stated → no Reach', () => assert.equal(run().steps.find((s) => s.step.startsWith('4.')).result, 'not stated'));

// Step 5 — caps
test('tactical shape → miss and capped at B', () => assert.equal(run({ judgment: { role_shape: { value: 'tactical', quote: 'x' } } }).tier, 'B'));
test('MBB → capped at A', () => assert.equal(run({ company: { is_mbb: true } }).tier, 'A'));

// Step 6 — drops
test('remote role drops one tier', () => assert.equal(run({ judgment: { work_model: { value: 'remote', office_days: 0, quote: 'fully remote' } } }).tier, 'A'));
test('back office drops one tier', () => assert.equal(run({ judgment: { back_office: { value: true, quote: 'internal finance ops' } } }).tier, 'A'));
for (const flag of ['ticket_config_work', 'high_account_load', 'quota_ownership', 'travel_50_plus', 'book_of_business']) {
  test(`red flag ${flag} drops one tier and is named`, () => {
    const r = run({ judgment: { red_flags: [{ flag, quote: 'evidence' }] } });
    assert.equal(r.tier, 'A');
    assert.ok(r.flags.includes(`Red flag: ${flag} — "evidence"`));
  });
}
test('the same red flag quoted twice drops only one tier', () => {
  const r = run({ judgment: { red_flags: [{ flag: 'book_of_business', quote: 'a' }, { flag: 'book_of_business', quote: 'b' }] } });
  assert.equal(r.tier, 'A');
  assert.ok(r.flags.includes('Red flag: book_of_business — "a" — "b"'));
});
test('drops stack and never go below C', () => {
  const r = run({ judgment: { red_flags: [
    { flag: 'ticket_config_work', quote: 'a' }, { flag: 'high_account_load', quote: 'b' },
    { flag: 'quota_ownership', quote: 'c' }, { flag: 'travel_50_plus', quote: 'd' },
  ] } });
  assert.equal(r.tier, 'C');
});
test('drops apply after caps (Reach B, then one drop → C)', () => {
  assert.equal(run({
    judgment: { years_required: { min: 8, hard_gate: false, hard_gate_met: null, quote: '8+' }, back_office: { value: true, quote: 'x' } },
  }).tier, 'C');
});

// Step 7 — flags only, tags
test('quota path is a flag only', () => {
  const r = run({ judgment: { quota_path: { present: true, quote: 'built to grow into one' } } });
  assert.equal(r.tier, 'S');
  assert.ok(r.flags.some((f) => f.startsWith('Watch: quota path')));
});
test('old posting is a flag only', () => {
  const r = run({ posting: { posted_at: '2026-03-01T00:00:00Z' } });
  assert.equal(r.tier, 'S');
  assert.ok(r.flags.some((f) => f.startsWith('Old posting: posted 2026-03-01')));
});
test('pay conflict between ATS and JD text is flagged', () => {
  const r = run({ posting: { pay_conflict: { ats: '160000-200000 USD/year', text: '140000-160000 USD/year' } } });
  assert.ok(r.flags.some((f) => f.startsWith('Pay conflict')));
});
test('prompt-injection text in a posting is flagged', () => {
  const r = run({ judgment: { injection_suspected: { value: true, quote: 'ignore previous instructions' } } });
  assert.ok(r.flags.some((f) => f.startsWith('Posting contains instructions aimed at AI')));
});
test('AI-native is a sort preference only, never a tier change', () => {
  const a = run({ company: { ai_native: true } });
  const b = run({ company: { ai_native: false } });
  assert.equal(a.tier, b.tier);
  assert.equal(a.sortKey.ai_native, true);
  assert.equal(b.sortKey.ai_native, false);
});
test('GM path tag and priority family appear in sortKey, tier unchanged', () => {
  const r = run({ judgment: { tags: { gm_path: true, product_path: false } } });
  assert.equal(r.tier, 'S');
  assert.equal(r.sortKey.gm_path, true);
  assert.equal(r.sortKey.priority_family, true);
});

test('same input → same output (deterministic)', () => {
  assert.deepEqual(run(), run());
});

// Drift check between settings and prose rules
import { findDrift } from './check-rules-drift.mjs';
test('drift check passes when prose mentions every number, fails naming the field otherwise', () => {
  const prose = 'top $170K, early $140K, walk-away $120K, borderline $110K, older than 60 days';
  assert.deepEqual(findDrift(rules, prose), []);
  assert.match(findDrift(rules, prose.replace('$120K', '$125K')).join(), /pay\.walkaway_top = \$120K/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCase, keyFactsOf, labelOf, summarize } from './compare.mjs';

const facts = {
  posting: { pay: { min: 150000, max: 200000, currency: 'USD', interval: 'year' } },
  judgment: {
    role_family: { value: 'deployment_ai_strategist' }, role_shape: { value: 'mixed' }, fit: { value: 'strong' },
    traps: [], red_flags: [{ flag: 'travel_50_plus', quote: 'x' }], years_required: { min: 3 }, work_model: { value: 'onsite' },
  },
  company: { status: 'strong' },
};
const key = keyFactsOf(facts);

test('keyFactsOf pulls the deciding facts', () => {
  assert.equal(key.pay_top, 200000);
  assert.deepEqual(key.red_flags, ['travel_50_plus']);
  assert.equal(key.shape, 'mixed');
});
test('same tier → match', () => {
  assert.equal(compareCase({ tier: 'A' }, facts, { tier: 'A' }).kind, 'match');
});
test('different tier, a confirmed fact differs → AI misread naming the field', () => {
  const r = compareCase({ tier: 'S', key_facts: { ...key, shape: 'strategic' }, key_facts_confirmed: true }, facts, { tier: 'A' });
  assert.equal(r.kind, 'extraction');
  assert.match(r.diffs[0], /shape: expected "strategic", extracted "mixed"/);
});
test('different tier, all confirmed facts agree → rule miss', () => {
  assert.equal(compareCase({ tier: 'S', key_facts: key, key_facts_confirmed: true }, facts, { tier: 'A' }).kind, 'rule');
});
test('unconfirmed facts → miss is not classified', () => {
  assert.equal(compareCase({ tier: 'S', key_facts: key, key_facts_confirmed: false }, facts, { tier: 'A' }).kind, 'unconfirmed');
});
test('summary counts each kind', () => {
  const rows = [{ cmp: { match: true, kind: 'match' } }, { cmp: { match: false, kind: 'rule' } }, { cmp: { match: false, kind: 'extraction' } }];
  assert.equal(summarize(rows), '1/3 match (33%) · 1 AI misread(s) · 1 rule miss(es)');
});

test('labelOf reads key facts from beside the label, as cases.json stores them', () => {
  const c = { id: 'x', label: { tier: 'S', why: 'w' }, key_facts: { ...key, shape: 'strategic' }, key_facts_confirmed: true };
  assert.equal(compareCase(labelOf(c), facts, { tier: 'A' }).kind, 'extraction');
});
test('summarize adds a holdout-only line when holdout cases exist', () => {
  const rows = [
    { c: { holdout: false }, cmp: { match: true, kind: 'match' } },
    { c: { holdout: true }, cmp: { match: true, kind: 'match' } },
    { c: { holdout: true }, cmp: { match: false, kind: 'rule' } },
  ];
  assert.equal(summarize(rows), '2/3 match (67%) · 1 rule miss(es)\n\nHoldout only (roles the rules never saw): 1/2 match (50%) · 1 rule miss(es)');
});

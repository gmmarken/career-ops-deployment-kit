import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentFit } from './fit.mjs';

const facts = (b2b, ent, rollout) => ({
  sells_to_businesses: { value: b2b, evidence: null }, enterprise_customers: { value: ent, evidence: null },
  hands_on_rollout: { value: rollout, evidence: rollout ? 'Each customer gets a dedicated implementation team' : null },
});

test('never researched with the fit questions → no fit', () => {
  assert.equal(deploymentFit({ name: 'X' }), null);
});

test('open deployment roles make it Strong whatever the facts', () => {
  const r = deploymentFit({ ai_native: false, fit_facts: facts(false, false, false) }, { openDeployment: 2 });
  assert.equal(r.fit, 'Strong');
  assert.match(r.reason, /Hiring now: 2 open deployment roles/);
});

test('enterprise AI product with hands-on rollout is Strong, with the quote', () => {
  const r = deploymentFit({ ai_native: true, fit_facts: facts(true, true, true) });
  assert.equal(r.fit, 'Strong');
  assert.match(r.reason, /dedicated implementation team/);
});

test('business customers and one of AI / rollout is Possible', () => {
  assert.equal(deploymentFit({ ai_native: true, fit_facts: facts(true, false, null) }).fit, 'Possible');
  assert.equal(deploymentFit({ ai_native: false, fit_facts: facts(true, true, true) }).fit, 'Possible');
});

test('consumer companies, and self-serve non-AI products, are Unlikely', () => {
  assert.equal(deploymentFit({ ai_native: true, fit_facts: facts(false, null, true) }).fit, 'Unlikely');
  assert.equal(deploymentFit({ ai_native: false, fit_facts: facts(true, true, false) }).fit, 'Unlikely');
});

test('unknown facts stay Unclear, never guessed', () => {
  const r = deploymentFit({ ai_native: null, fit_facts: facts(null, null, null) });
  assert.equal(r.fit, 'Unclear');
  assert.match(r.reason, /Sells to businesses \? · AI is the product \?/);
});

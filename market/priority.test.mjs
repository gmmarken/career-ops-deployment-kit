import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBatch } from './priority.mjs';

const role = (id, company, title_family) => ({ id, company, title_family });

test('pickBatch: best families first, oldest first within a family, capped per company and in all', () => {
  const todo = [
    role(1, 'DoorDash', 'bizops_so'), role(2, 'DoorDash', 'bizops_so'), role(3, 'DoorDash', 'bizops_so'),
    role(4, 'Pace', 'deployment_ai_strategist'), role(5, 'Acme', 'chief_of_staff'),
    role(6, 'Beta', 'borderline'), role(7, 'Ode', 'forward_deployed_pm'), role(8, 'doordash', 'deployment_ai_strategist'),
  ];
  assert.deepEqual(pickBatch(todo, { limit: 5, perCompany: 2 }).map((p) => p.id), [4, 8, 7, 5, 1]);
  assert.deepEqual(pickBatch(todo, { limit: 100, perCompany: 2 }).map((p) => p.id), [4, 8, 7, 5, 1, 6]);
  assert.equal(pickBatch(todo).length, 8); // no caps: everything
});

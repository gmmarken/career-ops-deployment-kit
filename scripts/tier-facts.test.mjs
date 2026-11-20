import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const grade = (file, today = '2026-11-20') => spawnSync(process.execPath, ['scripts/tier-facts.mjs', file, '--rules', 'engine/tier-rules.example.json', '--today', today], { cwd: KIT, encoding: 'utf8' });

test('the README examples grade as shown: a real deployment role is S, an engineer in disguise is C', () => {
  const s = grade('examples/deployment-strategist.facts.json');
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /^Tier: S\n/);
  const c = grade('examples/forward-deployed-engineer.facts.json');
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /^Tier: C\n/);
  assert.match(c.stdout, /Traps: C — engineer_in_disguise/);
});

test('a bad --today is refused, not guessed', () => {
  const r = grade('examples/deployment-strategist.facts.json', 'soon');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--today must be a date/);
});

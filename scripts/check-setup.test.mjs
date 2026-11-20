import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkSetup, PINNED_CAREER_OPS, envHas, exampleLeft, placeholdersLeft } from './check-setup.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The same template → private file map install.sh uses (kept in step by the test below).
const SEEDS = [
  ['.env.example', '.env'],
  ['packs/cv.example.md', 'cv.md'],
  ['rules/_profile.template.md', 'modes/_profile.md'],
  ['rules/_custom.template.md', 'modes/_custom.md'],
  ['engine/tier-rules.example.json', 'config/tier-rules.json'],
  ['market/sources.example.json', 'config/sources.json'],
  ['scripts/daily.example.json', 'config/daily.json'],
  ['packs/cv-rules.example.json', 'config/cv-rules.json'],
  ['packs/tailoring-rules.example.md', 'config/tailoring-rules.md'],
  ['packs/keyword-bank.example.md', 'config/keyword-bank.md'],
  ['packs/cv-facts.example.json', 'config/cv-facts.json'],
  ['evals/cases.example.json', 'evals/cases.json'],
];

function freshInstall() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-setup-'));
  for (const d of ['modes', 'config', 'evals']) mkdirSync(join(dir, d));
  for (const [src, dest] of SEEDS) copyFileSync(join(KIT, src), join(dir, dest));
  writeFileSync(join(dir, 'config', 'profile.yml'), 'candidate: {}\n');
  return dir;
}

test('install.sh seeds exactly the templates this test checks', () => {
  const sh = readFileSync(join(KIT, 'install.sh'), 'utf8');
  for (const [src, dest] of SEEDS) assert.match(sh, new RegExp(`seed "\\$KIT_DIR/${src.replace(/\./g, '\\.')}"\\s+${dest.replace(/\./g, '\\.')}\\n`), `${src} -> ${dest}`);
});

test('install.sh and the setup check pin the same career-ops commit', () => {
  assert.match(readFileSync(join(KIT, 'install.sh'), 'utf8'), new RegExp(`^CAREER_OPS_COMMIT="${PINNED_CAREER_OPS}"$`, 'm'));
});

test('envHas tells set from empty without returning the value', () => {
  const env = 'NOTION_ACCESS_TOKEN=\nSERPER_API_KEY=abc123\nQUOTED=""\n';
  assert.equal(envHas(env, 'NOTION_ACCESS_TOKEN'), false);
  assert.equal(envHas(env, 'SERPER_API_KEY'), true);
  assert.equal(envHas(env, 'QUOTED'), false);
  assert.equal(envHas(env, 'MISSING'), false);
});

test('example markers and placeholders are found by name only', () => {
  assert.deepEqual(exampleLeft('Works at Example Corp in Brooklyn'), ['Example Corp']);
  assert.deepEqual(placeholdersLeft('Hi {name}, see {name} and {home_metro}'), ['{name}', '{home_metro}']);
  assert.deepEqual(placeholdersLeft('JSON like {"a": 1} is not a placeholder'), []);
});

test('a fresh install fails only on example values, placeholders, keys and Notion, never on a broken template', () => {
  const dir = freshInstall();
  try {
    const results = checkSetup(dir, { which: () => true });
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    const allowed = /example values|placeholder|no value for|notion\.json not found|too old|career-ops/;
    for (const r of results) if (!r.ok) assert.match(r.problem, allowed, `${r.name}: ${r.problem}`);
    assert.equal(byName['CV (cv.md)'].ok, false);
    assert.match(byName['CV (cv.md)'].problem, /example values \(Alex Example/);
    assert.match(byName['Keys in .env'].problem, /NOTION_ACCESS_TOKEN, SERPER_API_KEY/);
    assert.equal(byName['career-ops profile (config/profile.yml)'].ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing file names the file and how to create it', () => {
  const dir = freshInstall();
  try {
    rmSync(join(dir, 'cv.md'));
    const cv = checkSetup(dir, { which: () => true }).find((r) => r.name === 'CV (cv.md)');
    assert.equal(cv.ok, false);
    assert.match(cv.problem, /cv\.md not found\. Run \.\/install\.sh/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing tool is named', () => {
  const dir = freshInstall();
  try {
    const tools = checkSetup(dir, { which: (c) => c !== 'claude' }).find((r) => r.name.startsWith('Tools'));
    assert.match(tools.problem, /Not found on PATH: claude/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

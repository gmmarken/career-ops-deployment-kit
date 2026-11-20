#!/usr/bin/env node
// Setup check (D128): reads every private file through the same checks the runs use and lists
// every problem at once, with how to fix it. Prints no key values or contact details.
//   node scripts/check-setup.mjs [--data-dir DIR]     (default: ../private next to the kit)
// Exit 0 = ready for the daily run; 1 = something to fix.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseCv, sourceLines } from '../packs/cvsource.mjs';
import { loadRules } from '../engine/rules.mjs';
import { findDrift } from '../engine/check-rules-drift.mjs';
import { loadSourcesFile } from '../market/discover.mjs';
import { checkRadarConfig } from '../market/radar.mjs';
import { loadConfig } from './daily.mjs';
import { loadCvRules, lockedIds } from '../packs/check.mjs';
import { markdownSection } from '../extractor/extract.mjs';

// Keep in step with CAREER_OPS_COMMIT in install.sh (a test checks).
export const PINNED_CAREER_OPS = 'a068b716f9f351d3656a015e591ff969f39bc236';
const KIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Values copied from the templates. Finding one means a file still holds example data.
export const EXAMPLE_MARKERS = ['Alex Example', 'you@example.com', 'you+sec@example.com', '+15555550100', 'Example City', 'Example Corp'];

/** Read a key from a .env file's text without returning its value: true if set and non-empty. */
export function envHas(text, name) {
  const m = String(text).match(new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*(.*)$`, 'm'));
  return Boolean(m && m[1].replace(/^["']|["']$/g, '').trim());
}

/** Example values still in a text, by marker (never the surrounding text). */
export const exampleLeft = (text) => EXAMPLE_MARKERS.filter((m) => String(text).includes(m));

/** Template placeholders like {name} still in a markdown file. */
export const placeholdersLeft = (text) => [...new Set(String(text).match(/\{[a-z_][a-z0-9_ -]*\}/gi) ?? [])];

/** Run every check. Returns [{ name, ok, problem? }]; never throws. */
export function checkSetup(dataDir, { kitDir = KIT_DIR, which = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0 } = {}) {
  const results = [];
  const check = (name, fn) => {
    try { const note = fn(); results.push({ name, ok: true, ...(note ? { note } : {}) }); }
    catch (e) { results.push({ name, ok: false, problem: e.message }); }
  };
  const file = (...p) => join(dataDir, ...p);
  const read = (...p) => {
    const f = file(...p);
    if (!existsSync(f)) throw new Error(`${f} not found. Run ./install.sh to copy the templates, then fill it in (/onboard in Claude Code walks you through it).`);
    return readFileSync(f, 'utf8');
  };
  const noExamples = (text, where) => {
    const left = exampleLeft(text);
    if (left.length) throw new Error(`${where} still has example values (${left.join(', ')}). Replace them with your own.`);
  };

  check('Tools: node, git, claude', () => {
    const [maj, min] = process.versions.node.split('.').map(Number);
    if (maj < 22 || (maj === 22 && min < 13)) throw new Error(`Node ${process.versions.node} is too old; the kit needs 22.13 or newer (it uses the built-in SQLite).`);
    const missing = ['git', 'claude'].filter((c) => !which(c));
    if (missing.length) throw new Error(`Not found on PATH: ${missing.join(', ')}. Install the Claude Code CLI from https://claude.com/claude-code and sign in.`);
  });
  check(`career-ops at the pinned commit (${PINNED_CAREER_OPS.slice(0, 7)})`, () => {
    const co = join(kitDir, '..', 'career-ops');
    if (!existsSync(co)) throw new Error(`${co} not found. Run ./install.sh.`);
    const head = spawnSync('git', ['-C', co, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (head.status !== 0) throw new Error(`${co} isn't a git checkout, so its version can't be checked. Move it aside and run ./install.sh.`);
    const have = head.stdout.trim();
    if (have !== PINNED_CAREER_OPS) throw new Error(`career-ops is at commit ${have.slice(0, 7)}, but the kit is pinned to ${PINNED_CAREER_OPS.slice(0, 7)}. Move it aside and run ./install.sh.`);
    if (!existsSync(join(co, 'node_modules'))) throw new Error(`career-ops has no node_modules. Run: (cd ${co} && npm install)`);
  });
  check('Keys in .env', () => {
    const env = read('.env');
    const missing = ['NOTION_ACCESS_TOKEN', 'SERPER_API_KEY'].filter((k) => !envHas(env, k));
    if (missing.length) throw new Error(`${file('.env')}: no value for ${missing.join(', ')}. See the comments in that file for where to get each one.`);
  });
  let cv = null;
  check('CV (cv.md)', () => {
    const text = read('cv.md');
    cv = parseCv(text);
    noExamples(text, 'cv.md');
    return `${cv.experience.length} jobs, ${sourceLines(cv).size} lines`;
  });
  check('Profile (modes/_profile.md)', () => {
    const text = read('modes', '_profile.md');
    for (const h of ['Target Role Definition', 'Your Adaptive Framing']) markdownSection(text, h);
    const ph = placeholdersLeft(text);
    if (ph.length) throw new Error(`modes/_profile.md still has ${ph.length} placeholder(s), e.g. ${ph.slice(0, 3).join(', ')}.`);
  });
  check('Tier rules (config/tier-rules.json + modes/_custom.md)', () => {
    const rules = loadRules(file('config', 'tier-rules.json'));
    const custom = read('modes', '_custom.md');
    const ph = placeholdersLeft(custom);
    if (ph.length) throw new Error(`modes/_custom.md still has ${ph.length} placeholder(s), e.g. ${ph.slice(0, 3).join(', ')}.`);
    const drift = findDrift(rules, custom);
    if (drift.length) throw new Error(`tier-rules.json and _custom.md disagree:\n      - ${drift.join('\n      - ')}`);
    noExamples(JSON.stringify(rules), 'config/tier-rules.json');
  });
  check('Sources (config/sources.json)', () => {
    const path = file('config', 'sources.json');
    const cfg = loadSourcesFile(path);
    checkRadarConfig(cfg, path);
    noExamples(readFileSync(path, 'utf8'), 'config/sources.json');
  });
  check('Daily run (config/daily.json)', () => {
    loadConfig(dataDir);
    noExamples(read('config', 'daily.json'), 'config/daily.json');
  });
  check('Prep packs (cv-rules, tailoring rules, keyword bank, cv-facts)', () => {
    const rules = loadCvRules(file('config', 'cv-rules.json'));
    const tr = read('config', rules.tailoring_rules);
    for (const h of ['5. Role archetypes', '6. Allowed vocabulary translations']) markdownSection(tr, h);
    read('config', rules.keyword_bank);
    if (cv) lockedIds(rules, sourceLines(cv));
    const facts = JSON.parse(read('config', 'cv-facts.json'));
    for (const k of ['allow_metrics', 'allow_facts', 'forbidden_phrases', 'warn_phrases']) {
      if (!Array.isArray(facts[k])) throw new Error(`config/cv-facts.json needs a "${k}" list ([] for none).`);
    }
    noExamples(JSON.stringify(facts), 'config/cv-facts.json');
  });
  check('career-ops profile (config/profile.yml)', () => { read('config', 'profile.yml'); });
  check('Notion databases (config/notion.json)', () => {
    if (!existsSync(file('config', 'notion.json'))) throw new Error('config/notion.json not found. Share one Notion page with your integration, then run scripts/notion.sh setup <page link>.');
  });
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const i = process.argv.indexOf('--data-dir');
  const dataDir = resolve(i > 0 ? process.argv[i + 1] : join(KIT_DIR, '..', 'private'));
  if (!existsSync(dataDir)) { console.error(`check-setup: ${dataDir} not found. Run ./install.sh first.`); process.exit(1); }
  process.env.CAREER_OPS_DATA_DIR = dataDir;
  console.log(`Checking setup in ${dataDir}\n`);
  const results = checkSetup(dataDir);
  for (const r of results) console.log(r.ok ? `  ✓ ${r.name}${r.note ? ` (${r.note})` : ''}` : `  ✗ ${r.name}\n      ${r.problem}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `\n${bad} thing(s) to fix.` : '\nReady. Next: scripts/install-daily.sh --load to schedule the daily run.');
  process.exit(bad ? 1 : 0);
}

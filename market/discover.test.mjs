import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildQueries, boardsFromLinks, readSerperKey, search } from '../extractor/serper.mjs';
import { checkSerperConfig, discoveryDue, planQueries, runDiscovery, ROTATE_KEY } from './discover.mjs';
import { openStore } from './store.mjs';

const cfg = { every_days: 7, max_credits_per_run: 50, max_pages: 2, core_titles: ['deployment strategist'], rotating_titles: ['chief of staff'], places: ['New York', 'NYC', 'Brooklyn'] };
const q = { titles: ['deployment strategist', 'chief of staff'], places: cfg.places };

test('buildQueries: each title on each site, places joined with OR in one search', () => {
  const qs = buildQueries(q);
  assert.equal(qs.length, 8); // 2 titles × 4 sites
  assert.equal(qs[0].q, 'site:jobs.ashbyhq.com "deployment strategist" ("New York" OR NYC OR Brooklyn)');
  assert.equal(qs[1].q, '(site:job-boards.greenhouse.io OR site:boards.greenhouse.io) "deployment strategist" ("New York" OR NYC OR Brooklyn)');
  assert.throws(() => buildQueries({ ...q, titles: [] }), /titles/);
});

test('boardsFromLinks: readable boards only, each once', () => {
  assert.deepEqual(boardsFromLinks([
    'https://jobs.ashbyhq.com/Acme/123', 'https://jobs.ashbyhq.com/acme/456',
    'https://job-boards.greenhouse.io/beta/jobs/9', 'https://www.linkedin.com/jobs/view/1',
  ]), ['ashby:acme', 'greenhouse:beta']);
});

test('checkSerperConfig: missing or bad settings are a clear error', () => {
  assert.throws(() => checkSerperConfig({}), /"serper" settings are missing/);
  assert.throws(() => checkSerperConfig({ serper: { ...cfg, max_pages: 0 } }), /max_pages/);
  assert.equal(checkSerperConfig({ serper: cfg }).every_days, 7);
  assert.throws(() => checkSerperConfig({ serper: { ...cfg, titles: ['x'] } }), /split in two/);
  assert.throws(() => checkSerperConfig({ serper: { ...cfg, core_titles: [] } }), /core_titles/);
  assert.throws(() => checkSerperConfig({ serper: { ...cfg, rotating_titles: ['Deployment Strategist'] } }), /listed twice/);
  assert.equal(checkSerperConfig({ serper: { ...cfg, rotating_titles: [] } }).core_titles.length, 1);
});

test('discoveryDue: due with no OK run, or once every_days have passed', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  assert.deepEqual(discoveryDue(null, 7, now), { due: true, nextInDays: 0 });
  assert.deepEqual(discoveryDue('2026-11-04T12:00:00Z', 7, now), { due: false, nextInDays: 1 });
  assert.equal(discoveryDue('2026-11-03T12:00:00Z', 7, now).due, true);
});

test('runDiscovery: adds new boards, takes page 2 only after a full page with a new board', async () => {
  const store = openStore(':memory:');
  const full = (prefix) => Array.from({ length: 10 }, (_, i) => `https://jobs.ashbyhq.com/${prefix}${i}/x`);
  const calls = [];
  const fake = async (q, page) => {
    calls.push([q, page]);
    if (q.startsWith('site:jobs.ashbyhq.com "deployment')) return page === 1 ? full('a') : ['https://jobs.ashbyhq.com/zz/1'];
    return [];
  };
  const r = await runDiscovery(store, cfg, fake);
  assert.equal(r.searches, 8);
  assert.equal(r.credits, 9); // 8 first pages + 1 second page
  assert.equal(r.added.length, 11);
  assert.equal(store.boards().find((b) => b.board === 'ashby:a0').source, 'serper');
  // A second run finds nothing new, so no second pages.
  const again = await runDiscovery(store, cfg, fake);
  assert.equal(again.added.length, 0);
  assert.equal(again.credits, 8);
});

test('runDiscovery: stops at the credit cap', async () => {
  const store = openStore(':memory:');
  const r = await runDiscovery(store, { ...cfg, max_credits_per_run: 3 }, async () => []);
  assert.equal(r.credits, 3);
  assert.equal(r.capped, true);
});

test('runDiscovery: a bad key or no credits stops the whole run and is reported', async () => {
  const store = openStore(':memory:');
  let n = 0;
  const r = await runDiscovery(store, cfg, async () => { n++; const e = new Error('Serper returned HTTP 403'); e.status = 403; throw e; });
  assert.equal(n, 1);
  assert.equal(r.stopped, true);
  assert.match(r.errors[0], /403/);
});

test('runDiscovery: one failed search is reported; the others still run', async () => {
  const store = openStore(':memory:');
  let n = 0;
  const r = await runDiscovery(store, cfg, async () => { n++; if (n === 2) throw new Error('Could not reach Serper: timeout'); return []; });
  assert.equal(r.errors.length, 1);
  assert.equal(r.searches, 7);
});

test('readSerperKey: missing key is a clear error; the key is read, never printed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'serper-'));
  assert.throws(() => readSerperKey(dir), /No .*\.env/);
  writeFileSync(join(dir, '.env'), 'NOTION_ACCESS_TOKEN=x\n');
  assert.throws(() => readSerperKey(dir), /SERPER_API_KEY is missing/);
  writeFileSync(join(dir, '.env'), 'SERPER_API_KEY="abc123"\n');
  assert.equal(readSerperKey(dir), 'abc123');
});

test('search: sends the query, returns links; HTTP errors carry the status', async () => {
  let sent;
  const ok = async (url, opts) => { sent = { url, opts }; return { ok: true, json: async () => ({ organic: [{ link: 'https://jobs.lever.co/acme/1' }, {}] }) }; };
  assert.deepEqual(await search('k', 'q1', 2, ok), ['https://jobs.lever.co/acme/1']);
  assert.equal(sent.opts.headers['X-API-KEY'], 'k');
  assert.deepEqual(JSON.parse(sent.opts.body), { q: 'q1', num: 10, page: 2 });
  await assert.rejects(search('k', 'q1', 1, async () => ({ ok: false, status: 403 })), (e) => e.status === 403 && /SERPER_API_KEY/.test(e.message));
  await assert.rejects(search('k', 'q1', 1, async () => ({ ok: true, json: async () => ({}) })), /no results list/);
});

test('runDiscovery: a board that cannot be read is listed, not added; known boards are not re-read', async () => {
  const store = openStore(':memory:');
  store.addBoard('ashby:old', 'Old', 'you');
  const tried = [];
  const r = await runDiscovery(store, { ...cfg, core_titles: ['x'], rotating_titles: [] }, async () => ['https://jobs.ashbyhq.com/old/1', 'https://jobs.ashbyhq.com/dead/1', 'https://jobs.ashbyhq.com/good/1', 'https://jobs.lever.co/viaposting/2'], {
    readable: async (b) => { tried.push(b); if (b === 'ashby:dead') throw new Error('HTTP 404'); },
    known: new Set(['lever:viaposting']),
  });
  assert.deepEqual(tried, ['ashby:dead', 'ashby:good']);
  assert.deepEqual(r.added.map((a) => a.board), ['ashby:good']);
  assert.deepEqual(r.unreadable, [{ board: 'ashby:dead', why: 'HTTP 404' }]);
  assert.equal(r.found, 4);
});

const rot = { ...cfg, core_titles: ['core a', 'core b'], rotating_titles: ['r1', 'r2', 'r3'] };

test('planQueries: core searches first, then the rotating ones from the saved position, wrapping', () => {
  const titles = (qs) => [...new Set(qs.map((x) => x.title))];
  assert.deepEqual(titles(planQueries(rot, 0)), ['core a', 'core b', 'r1', 'r2', 'r3']);
  assert.deepEqual(titles(planQueries(rot, 4)), ['core a', 'core b', 'r2', 'r3', 'r1']); // 4 sites a title: position 4 = r2
  assert.deepEqual(titles(planQueries(rot, 12)), titles(planQueries(rot, 0))); // wraps
  assert.equal(planQueries(rot, null).length, 20);
});

test('runDiscovery: core titles every run; rotating titles continue where the last run stopped', async () => {
  const store = openStore(':memory:');
  const tight = { ...rot, max_credits_per_run: 12 }; // 8 core + 4 rotating searches a run
  const seen = [];
  const fake = async (qq) => { seen.push(qq); return []; };
  const r1 = await runDiscovery(store, tight, fake);
  assert.equal(r1.capped, true);
  assert.deepEqual(r1.rotation, { total: 12, done: 4, nextTitle: 'r2' });
  assert.equal(store.getMeta(ROTATE_KEY), '4');
  seen.length = 0;
  const r2 = await runDiscovery(store, tight, fake);
  assert.equal(seen.filter((x) => x.includes('"core a"')).length, 4); // core again
  assert.equal(seen.filter((x) => x.includes('"r2"')).length, 4);   // then r2, not r1
  assert.equal(seen.filter((x) => x.includes('"r1"')).length, 0);
  assert.equal(r2.rotation.nextTitle, 'r3');
  await runDiscovery(store, tight, fake);
  assert.equal(store.getMeta(ROTATE_KEY), '0'); // r3 done: wraps back to r1
});

test('runDiscovery: a stopped run saves only the rotating searches it actually tried', async () => {
  const store = openStore(':memory:');
  let n = 0;
  const r = await runDiscovery(store, rot, async () => { n++; if (n === 10) { const e = new Error('HTTP 400'); e.status = 400; throw e; } return []; });
  assert.equal(r.stopped, true);
  assert.equal(r.rotation.done, 1); // search 9 (first rotating) ran; search 10 failed and is tried again next run
  assert.equal(store.getMeta(ROTATE_KEY), '1');
});

test('store meta: saved settings, and schema_version is protected', () => {
  const store = openStore(':memory:');
  assert.equal(store.getMeta('x'), null);
  store.setMeta('x', 3); store.setMeta('x', 5);
  assert.equal(store.getMeta('x'), '5');
  assert.throws(() => store.setMeta('schema_version', 9), /managed/);
});

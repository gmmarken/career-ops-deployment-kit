// Offline tests for Notion mapping and the client (fake fetch; no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, readToken, notionId, readProp, text } from './client.mjs';
import { flagLabel, whyText, postingProps, companyProps, syncCarrying, CARRY_KEYS } from './sync.mjs';
import { openStore } from '../market/store.mjs';
import { OWNED_BY_YOU, jobsProperties, radarProperties } from './schema.mjs';

test('notionId accepts URLs with slugs and bare ids', () => {
  assert.equal(notionId('https://app.notion.com/p/Job-Search-HQ-3eefbc3d9ca881049a58fec7cc59fc18'), '3eefbc3d-9ca8-8104-9a58-fec7cc59fc18');
  assert.equal(notionId('3eefbc3d-9ca8-8104-9a58-fec7cc59fc18'), '3eefbc3d-9ca8-8104-9a58-fec7cc59fc18');
  assert.throws(() => notionId('https://example.com'), /No Notion id/);
});

test('readToken fails loudly when the key is missing, never prints it', () => {
  const d = mkdtempSync(join(tmpdir(), 'kit-'));
  assert.throws(() => readToken(d), /Add NOTION_ACCESS_TOKEN/);
  writeFileSync(join(d, '.env'), 'OTHER=1\n');
  assert.throws(() => readToken(d), /missing or empty/);
  writeFileSync(join(d, '.env'), 'NOTION_ACCESS_TOKEN="secret_abc"\n');
  assert.equal(readToken(d), 'secret_abc');
});

test('client: errors carry Notion\'s message and a next step; no retry', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return { ok: false, status: 404, json: async () => ({ code: 'object_not_found', message: 'Could not find page' }) }; };
  const c = createClient('t', { fetchFn, sleep: async () => {} });
  await assert.rejects(c.api('pages/x'), /404 object_not_found.*Could not find page.*Connections/);
  assert.equal(calls, 1);
});
test('client: queryAll follows pagination', async () => {
  const pages = [{ results: [1, 2], has_more: true, next_cursor: 'c' }, { results: [3], has_more: false }];
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => pages.shift() });
  const c = createClient('t', { fetchFn, sleep: async () => {} });
  assert.deepEqual(await c.queryAll('ds'), [1, 2, 3]);
});

test('flag labels are short and stable', () => {
  assert.equal(flagLabel('Old posting: posted 2026-01-01, 300 days'), 'Old posting');
  assert.equal(flagLabel('Red flag: travel_50_plus — "Travel 50%"'), 'Red flag: travel_50_plus');
  assert.equal(flagLabel('Trap: quota_sales — "x"'), 'Trap: quota_sales');
  assert.equal(flagLabel('Watch: quota path — "x"'), 'Watch: quota path');
  assert.equal(flagLabel('Company bar: web research, unverified'), 'Company unverified');
  assert.equal(flagLabel('Below level: asks 1 years, has 4'), 'Below level');
});
test('why text keeps only steps that weren\'t a plain pass', () => {
  const w = whyText({ tier: 'A', steps: [{ step: '1. Exclusions', result: 'none', detail: '' }, { step: '3d. Pay bar', result: 'miss', detail: 'top 170000' }] });
  assert.equal(w, 'Tier A\n3d. Pay bar: miss — top 170000');
});

const posting = { title: 'AI Strategist', title_family: 'deployment_ai_strategist', locations: ['New York, NY'], in_home_metro: true, workplace: 'onsite',
  pay_min: 150000, pay_max: 200000, pay_interval: 'year', pay_source: 'ats', posted_at: '2026-10-01', first_seen: '2026-11-01', last_seen: '2026-11-02',
  closed_at: null, board: 'ashby:acme', url: 'https://jobs.ashbyhq.com/acme/1', url_key: 'jobs.ashbyhq.com/acme/1' };
const decision = { tier: 'S', ai_family: 'deployment_ai_strategist', flags: [], steps: [], facts: { judgment: { role_shape: { value: 'strategic' }, fit: { value: 'strong' }, tags: { gm_path: true }, work_model: { office_days: 4 }, years_required: { min: 2 } } } };

test('your posting columns are set on create and never on update', () => {
  const created = postingProps(posting, decision, 'page-1', { create: true });
  for (const k of OWNED_BY_YOU.jobs) assert.ok(k in created, `${k} set on create`);
  assert.equal(created.Status.select.name, 'To review');
  const updated = postingProps(posting, decision, 'page-1', { create: false });
  for (const k of OWNED_BY_YOU.jobs) assert.ok(!(k in updated), `${k} not touched on update`);
  assert.equal(updated.Tier.select.name, 'S');
  assert.equal(updated['Pay max'].number, 200000);
  assert.equal(updated['GM path'].checkbox, true);
  assert.deepEqual(updated.Company.relation, [{ id: 'page-1' }]);
});
test('non-yearly pay is not written as a yearly number', () => {
  assert.equal(postingProps({ ...posting, pay_interval: 'hour' }, decision, null, { create: false })['Pay max'].number, null);
});
test('your company calls are set on create only', () => {
  const entry = { name: 'Acme', status: 'strong', verified: false, ai_native: true, stage: 'series_b', investors: ['X'], sources: [{ url: 'u' }] };
  const created = companyProps('Acme', entry, '2026-11-01', { create: true });
  for (const k of OWNED_BY_YOU.radar) assert.ok(k in created);
  assert.equal(created.Verified.checkbox, false);
  const updated = companyProps('Acme', entry, '2026-11-01', { create: false });
  for (const k of OWNED_BY_YOU.radar) assert.ok(!(k in updated));
});
test('every owned property exists in the schemas', () => {
  const jobs = jobsProperties('ds');
  const radar = radarProperties();
  for (const k of OWNED_BY_YOU.jobs) assert.ok(k in jobs, k);
  for (const k of OWNED_BY_YOU.radar) assert.ok(k in radar, k);
});
test('text values are trimmed under Notion\'s 2000-char limit; readProp reads them back', () => {
  const v = text('x'.repeat(3000));
  assert.ok(v.rich_text[0].text.content.length < 2000);
  assert.equal(readProp({ type: 'rich_text', rich_text: [{ plain_text: 'a' }, { plain_text: 'b' }] }), 'ab');
  assert.equal(readProp({ type: 'checkbox', checkbox: true }), true);
});

// --- three-way reconciliation of your company columns
import { reconcile, OWNED_DEFAULTS, companyCounts } from './sync.mjs';
const D = OWNED_DEFAULTS;
test('your edit in Notion wins (Notion differs from what the kit last wrote)', () => {
  const r = reconcile({ ...D, ai_native: true }, D, D);
  assert.deepEqual(r.yourEdits, { ai_native: true });
  assert.deepEqual(r.kitUpdates, {});
  assert.ok(!('ai_native' in r.agreed));
});
test('research after the page existed updates untouched columns (the bug from review)', () => {
  const r = reconcile(D, D, { ...D, status: 'strong', ai_native: true });
  assert.deepEqual(r.kitUpdates, { status: 'strong', ai_native: true });
  assert.deepEqual(r.yourEdits, {});
});
test('your edit and newer kit info on the same column: your edit wins', () => {
  const r = reconcile({ ...D, status: 'not_strong' }, D, { ...D, status: 'strong' });
  assert.deepEqual(r.yourEdits, { status: 'not_strong' });
  assert.deepEqual(r.kitUpdates, {});
});
test('values already in agreement are recorded as last written', () => {
  const r = reconcile({ ...D, status: 'strong' }, D, { ...D, status: 'strong' });
  assert.deepEqual([r.yourEdits, r.kitUpdates, r.agreed.status], [{}, {}, 'strong']);
});
test('company counts: open postings, and deployment family by AI label then title', () => {
  const ps = [
    { company_id: 1, closed_at: null, ai_family: 'deployment_ai_strategist', title_family: 'other' },
    { company_id: 1, closed_at: null, ai_family: null, title_family: 'deployment_ai_strategist' },
    { company_id: 1, closed_at: null, ai_family: null, title_family: 'other' },
    { company_id: 1, closed_at: '2026-01-01', ai_family: null, title_family: 'deployment_ai_strategist' },
  ];
  assert.deepEqual(companyCounts(ps).get(1), { open: 3, deployment: 2 });
});
test('a pull that applies nothing must not record kit updates as written (the ping-pong bug)', () => {
  // Pull sees an update the kit still has to write; it records only agreed fields.
  const pushed = { ...D };
  const { agreed, yourEdits } = reconcile(D, pushed, { ...D, status: 'strong' });
  const afterPull = { ...D, ...pushed, ...agreed, ...yourEdits };
  assert.equal(afterPull.status, 'unknown');
  // So the next sync still sees Notion = last written and pushes the update.
  assert.deepEqual(reconcile(D, afterPull, { ...D, status: 'strong' }).kitUpdates, { status: 'strong' });
});

test('Company Radar (Phase 6): funding, leaders, NYC presence, fit and how the company was found', () => {
  const entry = {
    name: 'Example Robotics', found_via: 'Form D', fit: 'Possible', fit_reason: 'Business customers, partly matches',
    last_raise: { amount_usd: 15e6, date: '2026-10-20', round: null, source_url: 'https://www.sec.gov/x' },
    leaders: [{ name: 'Ada Example', title: 'CEO', source_url: 'u' }], nyc_presence: true, nyc_evidence: 'Form D business address: Brooklyn, NY',
    careers_url: 'https://jobs.ashbyhq.com/example',
  };
  const p = companyProps('Example Robotics', entry, '2026-11-04', { create: false });
  assert.equal(p['Funding amount'].number, 15e6);
  assert.equal(p['Funding date'].date.start, '2026-10-20');
  assert.equal(p['Funding source'].url, 'https://www.sec.gov/x');
  assert.equal(p['Found via'].select.name, 'Form D');
  assert.equal(p.Leaders.rich_text[0].text.content, 'Ada Example (CEO)');
  assert.equal(p['NYC presence'].select.name, 'Yes');
  assert.equal(p['Deployment fit'].select.name, 'Possible');
  for (const k of Object.keys(p)) assert.ok(k in radarProperties(), `${k} is a Radar column`);
  const bare = companyProps('Unknown Co', null, '2026-11-04', { create: false });
  assert.equal(bare['NYC presence'].select.name, 'Unknown'); // not "No"
  assert.equal(bare['Deployment fit'].select, null);
  assert.equal(bare['Found via'].select.name, 'Job board');
  assert.equal(companyProps('X', { name: 'X', origin: 'you' }, null, { create: false })['Found via'].select.name, 'You');
});

import { duplicatePlan, cleanDuplicatePages } from './sync.mjs';
const radarPage = (id, name, { status = 'unknown', watch = false } = {}) => ({ id, properties: {
  Name: { type: 'title', title: [{ plain_text: name }] },
  Status: { type: 'select', select: { name: status } },
  Watch: { type: 'checkbox', checkbox: watch },
  Verified: { type: 'checkbox', checkbox: false },
  'AI-native': { type: 'checkbox', checkbox: false },
} });
const dupWl = { companies: [
  { name: 'Squad', aliases: ['squadai'] },
  { name: 'Method Financial (Method)', aliases: ['method', 'Method'] },
  { name: 'Clay', aliases: ['claylabs'] },
] };

test('a duplicate Radar page still at the defaults goes to the trash; the page named like the company stays (D110)', () => {
  const keep = radarPage('p1', 'Squad', { status: 'strong' });
  const extra = radarPage('p2', 'squadai');
  const { trash, stuck } = duplicatePlan([keep, extra, radarPage('p3', 'Clay'), radarPage('p4', 'Unknown Co')], dupWl);
  assert.deepEqual(trash.map((t) => [t.page.id, t.keep.id, t.company]), [['p2', 'p1', 'Squad']]);
  assert.deepEqual(stuck, []);
});

test('a duplicate page holding an edit of yours, or no page named like the company, is never trashed (D110)', () => {
  const edited = duplicatePlan([radarPage('p1', 'Method Financial (Method)'), radarPage('p2', 'Method', { watch: true })], dupWl);
  assert.deepEqual(edited.trash, []);
  assert.deepEqual(edited.stuck, [{ company: 'Method Financial (Method)', pages: ['Method Financial (Method)', 'Method'] }]);
  const unnamed = duplicatePlan([radarPage('p1', 'method'), radarPage('p2', 'Method')], dupWl);
  assert.equal(unnamed.trash.length, 0);
  assert.equal(unnamed.stuck.length, 1);
});

test('cleaning a duplicate relinks its roles, trashes it, and logs it; a stuck one fails loudly (D110)', async () => {
  const calls = [];
  const client = {
    queryAll: async (ds, body) => { calls.push(['query', ds, body.filter.relation.contains]); return [{ id: 'job1' }]; },
    api: async (path, method, body) => { calls.push([path, method, body]); return {}; },
  };
  const logs = [];
  const left = await cleanDuplicatePages(client, { jobs_data_source_id: 'jobs' }, [radarPage('p1', 'Squad'), radarPage('p2', 'squadai')], dupWl, (m) => logs.push(m));
  assert.deepEqual(left.map((p) => p.id), ['p1']);
  assert.deepEqual(calls[0], ['query', 'jobs', 'p2']);
  assert.deepEqual(calls[1], ['pages/job1', 'PATCH', { properties: { Company: { relation: [{ id: 'p1' }] } } }]);
  assert.deepEqual(calls[2], ['pages/p2', 'PATCH', { in_trash: true }]);
  assert.match(logs[0], /moved duplicate page "squadai" to the Notion trash .*1 role\(s\) relinked to "Squad"/);
  await assert.rejects(cleanDuplicatePages(client, {}, [radarPage('p1', 'Squad'), radarPage('p2', 'squadai', { status: 'strong' })], dupWl, () => {}), /holds an edit of yours.*Squad: pages "Squad", "squadai"/s);
});

// --- D119: a Notion call with no answer is tried once more; what didn't sync waits for the next run
test('Notion client: no answer is tried once more after 30 s; an error answer is not', async () => {
  const waits = [];
  const ok = { ok: true, json: async () => ({ id: 'p' }) };
  let n = 0;
  const flaky = async () => { if (n++ === 0) throw new TypeError('fetch failed'); return ok; };
  const c = createClient('t', { fetchFn: flaky, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(await c.api('pages/p'), { id: 'p' });
  assert.ok(waits.includes(30_000));
  const down = createClient('t', { fetchFn: async () => { throw new TypeError('fetch failed'); }, sleep: async () => {} });
  await assert.rejects(down.api('pages/p', 'PATCH', {}), /Notion PATCH pages\/p: fetch failed \(no answer, even on a retry 30 seconds later\)/);
  let calls = 0;
  const bad = createClient('t', { fetchFn: async () => { calls++; return { ok: false, status: 400, json: async () => ({ code: 'validation_error', message: 'bad' }) }; }, sleep: async () => {} });
  await assert.rejects(bad.api('pages/p', 'PATCH', {}), /failed \(400 validation_error\)/);
  assert.equal(calls, 1);
  const other = createClient('t', { fetchFn: async () => { calls++; throw new Error('boom'); }, sleep: async () => {} });
  await assert.rejects(other.api('pages/p'), /^Error: boom$/);
  assert.equal(calls, 2);
});

test('syncCarrying: a run stopped in the middle of the sync still leaves its companies for the next run (D130)', async () => {
  const store = openStore(':memory:');
  const open = () => ({ getMeta: (k) => store.getMeta(k), setMeta: (k, v) => store.setMeta(k, v), close() {} });
  let during = null;
  // The step is killed while the sync is running: look at what's saved at that moment.
  const killed = async () => { during = JSON.parse(store.getMeta(CARRY_KEYS.companyNames)); return new Promise(() => {}); };
  syncCarrying('/d', 'companyNames', ['Codex', 'Bluefish'], { sync: killed, open, log: () => {} });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(during, ['Codex', 'Bluefish']);
  store.close();
});

test('syncCarrying: a failed sync keeps its companies for the next run, which syncs them too (D119)', async () => {
  const store = openStore(':memory:');
  const open = () => ({ getMeta: (k) => store.getMeta(k), setMeta: (k, v) => store.setMeta(k, v), close() {} });
  const asked = [];
  const down = async (_d, o) => { asked.push(o.companyNames); throw new Error('Notion PATCH pages/x: fetch failed (no answer, even on a retry 30 seconds later)\nmore'); };
  const r1 = await syncCarrying('/d', 'companyNames', ['Gnau', 'Esger'], { sync: down, open, log: () => {} });
  assert.deepEqual(r1, { error: 'Notion PATCH pages/x: fetch failed (no answer, even on a retry 30 seconds later)', count: 2, carried: 0 });
  assert.deepEqual(JSON.parse(store.getMeta(CARRY_KEYS.companyNames)), ['Gnau', 'Esger']);
  const up = async (_d, o) => { asked.push(o.companyNames); };
  const r2 = await syncCarrying('/d', 'companyNames', ['Esger', 'Atari'], { sync: up, open, log: () => {} });
  assert.deepEqual(r2, { error: null, count: 3, carried: 1 });
  assert.deepEqual(asked[1], ['Gnau', 'Esger', 'Atari']);
  assert.deepEqual(JSON.parse(store.getMeta(CARRY_KEYS.companyNames)), []);
  // Nothing new and nothing waiting: no sync at all.
  assert.deepEqual(await syncCarrying('/d', 'postingIds', [], { sync: up, open, log: () => {} }), { error: null, count: 0, carried: 0 });
  assert.equal(asked.length, 2);
  store.close();
});

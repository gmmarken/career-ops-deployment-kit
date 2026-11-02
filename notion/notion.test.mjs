// Offline tests for Notion mapping and the client (fake fetch; no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, readToken, notionId, readProp, text } from './client.mjs';
import { flagLabel, whyText, postingProps, companyProps } from './sync.mjs';
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

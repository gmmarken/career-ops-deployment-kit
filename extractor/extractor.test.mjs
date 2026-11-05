// Tests for the hard-fact readers, the schema checker, and the settings checker.
// All payloads are synthetic; no real postings or personal values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJobUrl, fromAshby, fromGreenhouse, fromLever, htmlToText } from './ats.mjs';
import { validate, assertValid } from './validate.mjs';
import { validateRules } from '../engine/rules.mjs';

const schema = (name) => JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url)));

// --- URL parsing
test('parses Ashby, Greenhouse, Lever URLs', () => {
  assert.deepEqual(parseJobUrl('https://jobs.ashbyhq.com/acme/abc-123'), { ats: 'ashby', board: 'acme', id: 'abc-123' });
  assert.deepEqual(parseJobUrl('https://job-boards.greenhouse.io/acme/jobs/42'), { ats: 'greenhouse', board: 'acme', id: '42' });
  assert.deepEqual(parseJobUrl('https://jobs.lever.co/acme/uuid-1'), { ats: 'lever', board: 'acme', id: 'uuid-1' });
});
test('unsupported board fails loudly with next step', () => {
  assert.throws(() => parseJobUrl('https://careers.example.com/job/1'), /Unsupported job board.*--jd-file/);
});

// --- Ashby
const ashby = {
  jobs: [{
    id: 'abc-123', title: 'Deployment Strategist', location: 'San Francisco Office',
    secondaryLocations: [{ location: 'New York Office' }], workplaceType: 'OnSite', isRemote: false,
    publishedAt: '2026-05-01T00:00:00Z', descriptionPlain: 'About Acme\nYou will own deployment.',
    compensation: { compensationTiers: [{ components: [
      { compensationType: 'Salary', interval: '1 YEAR', currencyCode: 'USD', minValue: 150000, maxValue: 190000 },
      { compensationType: 'EquityPercentage', interval: 'NONE' },
    ] }] },
  }],
};
test('Ashby: pay, equity, locations, date come from structured fields', () => {
  const { posting, jdText } = fromAshby('acme', 'abc-123', ashby, 'u');
  assert.deepEqual(posting.pay, { min: 150000, max: 190000, currency: 'USD', interval: 'year', kind: 'base', source: 'ats' });
  assert.equal(posting.equity_offered, true);
  assert.deepEqual(posting.locations, ['San Francisco Office', 'New York Office']);
  assert.equal(posting.workplace, 'onsite');
  assert.equal(posting.posted_at, '2026-05-01T00:00:00Z');
  assert.match(jdText, /own deployment/);
});
test('Ashby: no salary component → pay null (not guessed)', () => {
  const p = structuredClone(ashby); p.jobs[0].compensation = null;
  assert.equal(fromAshby('acme', 'abc-123', p, 'u').posting.pay, null);
});
test('Ashby: job missing from board fails loudly', () => {
  assert.throws(() => fromAshby('acme', 'nope', ashby, 'u'), /no listed job nope/);
});

// --- Greenhouse
test('Greenhouse: cents converted, interval only when stated', () => {
  const job = { title: 'FDPM', company_name: 'Acme', location: { name: 'New York, NY' }, first_published: '2026-05-02',
    content: '&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;',
    pay_input_ranges: [{ min_cents: 15000000, max_cents: 20000000, currency_type: 'USD', title: 'Annual base salary' }] };
  const { posting, jdText } = fromGreenhouse('acme', '42', job, 'u');
  assert.equal(posting.pay.min, 150000);
  assert.equal(posting.pay.interval, 'year');
  assert.equal(jdText, 'Hello & welcome');
  job.pay_input_ranges[0].title = 'Range';
  assert.equal(fromGreenhouse('acme', '42', job, 'u').posting.pay.interval, 'unknown');
});

// --- Lever
test('Lever: salaryRange and workplace mapped', () => {
  const job = { text: 'AI Strategist', categories: { location: 'New York', allLocations: ['New York'] }, workplaceType: 'hybrid',
    createdAt: Date.parse('2026-05-03T00:00:00Z'), descriptionPlain: 'About', lists: [{ text: 'You will', content: '<li>lead</li>' }],
    salaryRange: { min: 160000, max: 200000, currency: 'USD', interval: 'per-year-salary' } };
  const { posting, jdText } = fromLever('acme', 'x', job, 'u');
  assert.deepEqual(posting.locations, ['New York']);
  assert.equal(posting.workplace, 'hybrid');
  assert.equal(posting.pay.interval, 'year');
  assert.match(jdText, /- lead/);
});

test('htmlToText strips tags and decodes entities', () => {
  assert.equal(htmlToText('<p>A &amp; B</p><ul><li>one</li></ul>'), 'A & B\n - one');
});

// --- Schema checker
const goodJudgment = {
  company_name: { value: 'Acme', quote: 'About Acme' },
  role_family: { value: 'deployment_ai_strategist', quote: 'own deployment' },
  role_shape: { value: 'strategic', quote: 'set the agenda' },
  traps: [], red_flags: [],
  quota_path: { present: false, quote: null },
  years_required: { min: null, hard_gate: false, hard_gate_met: null, quote: null },
  work_model: { value: 'onsite', office_days: 4, quote: '4 days' },
  back_office: { value: false, quote: null },
  fit: { value: 'possible', reason: 'x' },
  tags: { gm_path: false, product_path: false },
  equity_substantial: { value: false, quote: null },
  pay_in_text: null,
  injection_suspected: { value: false, quote: null },
  languages_required: [],
  clearance: { value: 'none', quote: null },
  travel_vague_heavy: { value: false, quote: null }, employment_type: { value: 'full_time', quote: null }, industry_flags: [], people_management: { required: false, team_size: null, quote: null }, degree_required: { value: false, met: null, quote: null }, off_hours: { value: false, quote: null }, staffing_agency: { value: false, quote: null },
};
test('valid judgment passes the schema', () => assert.deepEqual(validate(goodJudgment, schema('judgment.schema.json')), []));
test('bad enum, missing field, extra field are all reported', () => {
  const bad = { ...goodJudgment, role_shape: { value: 'visionary', quote: null }, surprise: 1 };
  delete bad.fit;
  const problems = validate(bad, schema('judgment.schema.json')).join('\n');
  assert.match(problems, /visionary/);
  assert.match(problems, /missing required field "fit"/);
  assert.match(problems, /unexpected field "surprise"/);
});
test('assertValid throws a readable error', () => {
  assert.throws(() => assertValid({}, schema('judgment.schema.json'), 'Extraction'), /Extraction failed the schema check/);
});
test('company result needs at least one source', () => {
  const c = { name: 'Acme', status: 'strong', reason: 'x', stage: 'series_b', last_raise: null, investors: [], what_they_do: 'x',
    ai_native: true, owner_categories: [], parent: null, is_mbb: false, nyc_presence: true, sources: [] };
  assert.match(validate(c, schema('company.schema.json')).join(), /at least 1/);
});

// --- Settings checker
test('example settings are valid', () => {
  assert.doesNotThrow(() => validateRules(JSON.parse(readFileSync(new URL('../engine/tier-rules.example.json', import.meta.url)))));
});
test('broken settings list every problem', () => {
  assert.throws(() => validateRules({ candidate: {}, pay: {}, caps: { reach: 'Z' } }), /candidate\.experience_start[\s\S]*caps\.reach must be one of/);
});

// --- whole-board readers (D41)
import { ashbyBoard, greenhouseBoard, leverBoard } from './ats.mjs';
test('Ashby board: every listed job, with pay and locations; unlisted skipped', () => {
  const payload = { jobs: [
    { ...ashby.jobs[0], jobUrl: 'https://jobs.ashbyhq.com/acme/abc-123' },
    { ...ashby.jobs[0], id: 'hidden', jobUrl: 'https://jobs.ashbyhq.com/acme/hidden', isListed: false },
  ] };
  const ps = ashbyBoard('acme', payload);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].pay.max, 190000);
  assert.deepEqual(ps[0].locations, ['San Francisco Office', 'New York Office']);
});
test('Greenhouse board: multi-city locations split; pay left to tiering', () => {
  const ps = greenhouseBoard('acme', { jobs: [{ absolute_url: 'u', title: 'AI Strategist', company_name: 'Acme', location: { name: 'New York, NY | San Francisco, CA' }, first_published: '2026-10-01' }] });
  assert.deepEqual(ps[0].locations, ['New York, NY', 'San Francisco, CA']);
  assert.equal(ps[0].pay, null);
});
test('Greenhouse board: links are Greenhouse job links even when the board points at the company site', () => {
  const [p] = greenhouseBoard('databricks', { jobs: [{ id: 88, absolute_url: 'https://databricks.com/careers/job?gh_jid=88', title: 'X', location: { name: 'New York, NY' } }] });
  assert.equal(p.url, 'https://job-boards.greenhouse.io/databricks/jobs/88');
  assert.deepEqual(parseJobUrl(p.url), { ats: 'greenhouse', board: 'databricks', id: '88' });
});
test('Lever board: each posting mapped with its own URL', () => {
  const ps = leverBoard('acme', [{ id: 'x1', hostedUrl: 'https://jobs.lever.co/acme/x1', text: 'Deployment Strategist', categories: { location: 'New York, NY' }, createdAt: Date.parse('2026-10-01'), descriptionPlain: '' }]);
  assert.equal(ps[0].url, 'https://jobs.lever.co/acme/x1');
  assert.equal(ps[0].title, 'Deployment Strategist');
});
test('a board that returns no job list fails loudly (never a partial or empty "success")', () => {
  assert.throws(() => ashbyBoard('acme', {}), /returned no job list/);
  assert.throws(() => greenhouseBoard('acme', { error: 'x' }), /returned no job list/);
  assert.throws(() => leverBoard('acme', { ok: false }), /returned no job list/);
});

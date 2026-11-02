import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFamily, inHomeMetro, TITLE_CLASSIFIER_VERSION, companyKey } from './classify.mjs';
import { openStore, urlKey, CLOSE_AFTER_MISSES } from './store.mjs';
import { monthRange, openInMonth, monthlyByCompany, ranking, toCsv } from './metrics.mjs';

// --- title classifier
for (const [title, family] of [
  ['AI Deployment Strategist', 'deployment_ai_strategist'],
  ['Associate Principal, AI Transformation', 'deployment_ai_strategist'],
  ['Applied AI Strategist', 'deployment_ai_strategist'],
  ['AI Deployment Manager', 'deployment_ai_strategist'],
  ['Forward Deployed Engineer', 'forward_deployed_engineer'],
  ['Forward Deployed Software Engineer, NYC', 'forward_deployed_engineer'],
  ['Forward Deployed Product Manager (SF/NY)', 'forward_deployed_pm'],
  ['Business Operations Manager', 'bizops_so'],
  ['Strategy & Operations Manager - AI', 'bizops_so'],
  ['Chief of Staff to the CEO', 'chief_of_staff'],
  ['Member of Technical Staff (NY)', 'other'],
  ['Account Executive', 'other'],
]) test(`title "${title}" → ${family}`, () => assert.equal(titleFamily(title), family));
test('classifier has a version stamp', () => assert.match(TITLE_CLASSIFIER_VERSION, /^title-v\d+$/));

test('home metro: aliases, whole words, city part only', () => {
  const m = { home_metro: 'New York', home_metro_aliases: ['NYC', 'Brooklyn'] };
  assert.equal(inHomeMetro(['Brooklyn, NY'], m), true);
  assert.equal(inHomeMetro(['SF', 'NYC'], m), true);
  assert.equal(inHomeMetro(['Albany, New York'], m), false);
  assert.equal(inHomeMetro(['Brooklynn Park'], m), false);
  assert.throws(() => inHomeMetro(['x'], {}), /home_metro is not set/);
});

// --- store
test('urlKey ignores query, /application, trailing slash, and Ashby board case', () => {
  assert.equal(urlKey('https://jobs.ashbyhq.com/Distyl/ABC/application?src=x'), urlKey('https://jobs.ashbyhq.com/distyl/abc/'));
  assert.notEqual(urlKey('https://jobs.lever.co/a/ID1'), urlKey('https://jobs.lever.co/a/id1'));
});

const P = (over = {}) => ({ url: 'https://jobs.ashbyhq.com/acme/1', board: 'ashby:acme', company: 'Acme', title: 'AI Deployment Strategist', locations: ['New York, NY'], in_home_metro: true, ...over });

test('seePosting: first sighting, re-sighting bumps last_seen, keeps first_seen', () => {
  const s = openStore(':memory:');
  assert.equal(s.seePosting(P(), '2026-01-05').isNew, true);
  assert.equal(s.seePosting(P(), '2026-02-10').isNew, false);
  const [row] = s.postings();
  assert.equal(row.first_seen, '2026-01-05');
  assert.equal(row.last_seen, '2026-02-10');
  assert.equal(row.title_family, 'deployment_ai_strategist');
  assert.equal(row.company, 'Acme');
});
test('companies are matched case-insensitively', () => {
  const s = openStore(':memory:');
  s.seePosting(P(), '2026-01-01');
  s.seePosting(P({ url: 'https://jobs.ashbyhq.com/acme/2', company: 'ACME' }), '2026-01-01');
  assert.equal(new Set(s.postings().map((p) => p.company_id)).size, 1);
});
test('postings without a URL are keyed by company + title', () => {
  const s = openStore(':memory:');
  s.seePosting(P({ url: null }), '2026-01-01');
  s.seePosting(P({ url: null }), '2026-01-02');
  assert.equal(s.postings().length, 1);
});
test(`closeMissing closes only after ${CLOSE_AFTER_MISSES} complete scans miss a posting, at its last_seen`, () => {
  const s = openStore(':memory:');
  s.seePosting(P(), '2026-01-01');
  s.seePosting(P({ url: 'https://jobs.ashbyhq.com/acme/2' }), '2026-01-01');
  assert.deepEqual(s.closeMissing('ashby:acme', ['https://jobs.ashbyhq.com/acme/2'], '2026-01-02'), { checked: 2, closed: 0 });
  assert.deepEqual(s.closeMissing('ashby:acme', ['https://jobs.ashbyhq.com/acme/2'], '2026-01-03'), { checked: 2, closed: 1 });
  const closed = s.postings().find((p) => p.closed_at);
  assert.equal(closed.closed_at, '2026-01-01');
});
test('a closed posting seen again reopens', () => {
  const s = openStore(':memory:');
  s.seePosting(P(), '2026-01-01');
  s.closeMissing('ashby:acme', [], '2026-01-02'); s.closeMissing('ashby:acme', [], '2026-01-03');
  s.seePosting(P(), '2026-01-10');
  assert.equal(s.postings()[0].closed_at, null);
});
test('tier decisions are kept as history; latest wins in postings()', () => {
  const s = openStore(':memory:');
  const { id } = s.seePosting(P(), '2026-01-01');
  const facts = { judgment: { role_family: { value: 'deployment_ai_strategist' } } };
  s.recordTier(id, { tier: 'A', flags: [], steps: [] }, facts, { at: '2026-01-01T00:00:00Z' });
  s.recordTier(id, { tier: 'S', flags: [], steps: [] }, facts, { at: '2026-02-01T00:00:00Z' });
  assert.equal(s.postings()[0].tier, 'S');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM tier_decisions').get().n, 2);
});
test('scan status must be ok or error', () => {
  const s = openStore(':memory:');
  assert.throws(() => s.finishScan(s.startScan('x'), { status: 'meh' }), /ok or error/);
});

// --- metrics
const row = (o) => ({ company: 'Acme', title_family: 'deployment_ai_strategist', posted_at: null, first_seen: '2026-01-10', last_seen: '2026-03-05', closed_at: null, ...o });
test('monthRange is inclusive and crosses years', () => assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']));
test('open in month uses the interval; posted_at can start it earlier', () => {
  assert.equal(openInMonth(row(), '2026-02'), true);
  assert.equal(openInMonth(row(), '2026-04'), false);
  assert.equal(openInMonth(row({ posted_at: '2025-12-20T00:00:00Z' }), '2025-12'), true);
});
test('monthly rows count open and new per company+family, with scan coverage', () => {
  const ps = [row(), row({ first_seen: '2026-02-01', last_seen: '2026-02-20' }), row({ company: 'Beta' })];
  const scans = [{ started_at: '2026-02-03T00:00:00Z', status: 'ok' }, { started_at: '2026-02-04T00:00:00Z', status: 'error' }];
  const feb = monthlyByCompany(ps, scans, { from: '2026-02', to: '2026-02' });
  const acme = feb.find((r) => r.company === 'Acme');
  assert.deepEqual([acme.open, acme.new, acme.coverage_scans], [2, 1, 1]);
});
test('ranking orders companies by postings in window', () => {
  const ps = [row(), row({ first_seen: '2026-02-01' }), row({ company: 'Beta' })];
  assert.deepEqual(ranking(ps, { from: '2026-01', to: '2026-03' }).map((r) => [r.rank, r.company, r.postings]), [[1, 'Acme', 2], [2, 'Beta', 1]]);
});
test('CSV quotes commas and quotes', () => assert.equal(toCsv([{ a: 'x, y', b: 'say "hi"' }]), 'a,b\n"x, y","say ""hi"""\n'));

test('companyKey ignores common endings but not real name differences', () => {
  assert.equal(companyKey('Distyl AI'), companyKey('Distyl'));
  assert.equal(companyKey('Acme, Inc.'), companyKey('acme'));
  assert.equal(companyKey('Thread AI'), companyKey('Thread'));
  assert.notEqual(companyKey('Ramp'), companyKey('Rampart'));
  assert.equal(companyKey('AI'), 'ai');
});

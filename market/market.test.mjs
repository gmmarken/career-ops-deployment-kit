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

// --- v2: company records and history (D38, D40)
test('saving a company records history: your calls, fact snapshots, funding rounds', () => {
  const s = openStore(':memory:');
  s.saveCompany({ name: 'Acme', status: 'strong', ai_native: true, stage: 'series_a', investors: ['X'], last_raise: { round: 'Series A', amount_usd: 2e7, date: '2026-03-01' }, sources: [{ url: 'u1' }] }, { source: 'research', by: 'kit', at: '2026-03-02T00:00:00Z' });
  s.saveCompany({ name: 'Acme', stage: 'series_b', last_raise: { round: 'Series B', amount_usd: 6e7, date: '2026-09-01' } }, { source: 'research', by: 'kit', at: '2026-09-02T00:00:00Z' });
  s.saveCompany({ name: 'Acme', status: 'exceptional' }, { source: 'notion', by: 'you', at: '2026-09-03T00:00:00Z' });
  const h = s.companyHistory('Acme');
  assert.deepEqual(h.funding.map((f) => f.round), ['Series A', 'Series B']);
  assert.deepEqual(h.snapshots.map((x) => x.data.stage), ['series_a', 'series_b']);
  assert.deepEqual(h.calls.filter((c) => c.field === 'status').map((c) => [c.new_value, c.by]), [['"strong"', 'kit'], ['"exceptional"', 'you']]);
  const [rec] = s.companyRecords();
  assert.deepEqual([rec.status, rec.stage, rec.ai_native], ['exceptional', 'series_b', true]);
});
test('saving the same company record twice adds no history', () => {
  const s = openStore(':memory:');
  const e = { name: 'Acme', status: 'strong', last_raise: { round: 'A', amount_usd: 1, date: '2026-01-01' } };
  s.saveCompany(e, { source: 'x', by: 'kit' });
  assert.equal(s.saveCompany(e, { source: 'x', by: 'kit' }).changed, false);
  assert.equal(s.companyHistory('Acme').funding.length, 1);
});
test('saveCompany refuses to write without saying where the change came from', () => {
  assert.throws(() => openStore(':memory:').saveCompany({ name: 'A' }, {}), /source, by/);
});
test('companies seen only in postings have no record until researched or decided', () => {
  const s = openStore(':memory:');
  s.seePosting(P(), '2026-01-01');
  assert.equal(s.companyRecords().length, 0);
});

// --- v2: posting changes
test('a changed pay range or title is logged with old and new values', () => {
  const s = openStore(':memory:');
  const { id } = s.seePosting(P({ pay: { min: 150000, max: 180000, currency: 'USD', interval: 'year' } }), '2026-01-01');
  s.seePosting(P({ title: 'Senior AI Deployment Strategist', pay: { min: 160000, max: 200000, currency: 'USD', interval: 'year' } }), '2026-02-01');
  const ch = s.postingChanges(id).map((c) => [c.field, c.old_value, c.new_value]);
  assert.deepEqual(ch, [['title', 'AI Deployment Strategist', 'Senior AI Deployment Strategist'], ['pay_min', '150000', '160000'], ['pay_max', '180000', '200000']]);
});

// --- v2: frozen monthly stats (D39)
import { freezable, FREEZE_AFTER_DAYS } from './metrics.mjs';
test(`months freeze ${FREEZE_AFTER_DAYS} days after they end`, () => {
  assert.deepEqual(freezable(['2026-10', '2026-11'], new Date('2026-11-06T00:00:00Z')), []);
  assert.deepEqual(freezable(['2026-10', '2026-11'], new Date('2026-11-08T00:00:00Z')), ['2026-10']);
});
test('frozen months never change; corrections are added alongside with a reason', () => {
  const s = openStore(':memory:');
  s.seePosting(P(), '2026-01-01');
  const cid = s.companies()[0].id;
  const row = { company_id: cid, scope: 'home_metro', family: 'deployment_ai_strategist', open: 1, new: 1, coverage_scans: 0 };
  s.writeProvisional('2026-01', [row], { classifier: 'title-v1' });
  assert.equal(s.monthState('2026-01'), 'provisional');
  s.freezeMonth('2026-01');
  assert.equal(s.monthState('2026-01'), 'frozen');
  assert.throws(() => s.writeProvisional('2026-01', [{ ...row, open: 9 }], { classifier: 'title-v1' }), /frozen; add a correction/);
  assert.throws(() => s.addCorrection('2026-01', { ...row, classifier: 'title-v1', open: 2 }, ''), /needs a reason/);
  s.addCorrection('2026-01', { ...row, classifier: 'title-v1', open: 2 }, 'late-found posting');
  const rows = s.statsRows('2026-01', '2026-01', 'home_metro');
  assert.deepEqual(rows.map((r) => [r.status, r.open]), [['correction', 2], ['frozen', 1]]);
});
test('an empty month can still be frozen', () => {
  const s = openStore(':memory:');
  assert.equal(s.freezeMonth('2025-12'), 0);
  assert.equal(s.monthState('2025-12'), 'frozen');
});
test('a v1 database upgrades to v2 in place, keeping its data', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const path = join(mkdtempSync(join(tmpdir(), 'kit-')), 'm.db');
  const v1 = new DatabaseSync(path);
  v1.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version','1');
    CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, first_seen TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO companies (name, first_seen, updated_at) VALUES ('OldCo', '2026-01-01', '2026-01-01');`);
  v1.close();
  const s = openStore(path);
  assert.equal(s.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, '2');
  assert.equal(s.companies()[0].name, 'OldCo');
  s.saveCompany({ name: 'OldCo', status: 'strong' }, { source: 'x', by: 'kit' });
  assert.equal(s.companyRecords()[0].status, 'strong');
});

import { trackingStartMonth } from './metrics.mjs';
test('tracking begins with the first completed scan; failed scans do not count', () => {
  assert.equal(trackingStartMonth([]), null);
  assert.equal(trackingStartMonth([{ status: 'error', started_at: '2026-10-01T00:00:00Z' }, { status: 'ok', started_at: '2026-11-03T00:00:00Z' }]), '2026-11');
});

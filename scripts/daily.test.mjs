import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { monthName, sortProblems, runDaily, failureDetail, summarize, successSummary, runFacts, shortDate, loadConfig, defaultSteps, runCommand, localDate, sAlerts, alertText, isWeeklyDay, takeLock, sendWeekly, packText, isTemporary, streakFile, creditText, asleepLine, quietProblemLines, ASLEEP_KEY } from './daily.mjs';
import { awakeTimeout } from './awake-timer.mjs';
import { openStore } from '../market/store.mjs';

const ok = (name, out = 'fine\n') => ({ name, go: async () => ({ ok: true, out }) });
const bad = (name, out) => ({ name, go: async () => ({ ok: false, out }) });

function harness(steps) {
  const logs = []; const sent = [];
  return {
    logs, sent,
    run: () => runDaily({ date: '2026-11-03', steps, log: (t) => logs.push(t), notify: async (t) => { sent.push(t); }, logPath: '/x/daily-2026-11-03.log' }),
  };
}

const CFG = { tier_per_day: 30, tier_per_company: 5, research_per_day: 10, weekly_email: { to: 'me@example.com', day: 'Sunday' }, packs: { per_day: 1, max_per_day: 3, max_per_week: 5 }, reminders_list: 'Job Search Alerts' };
const SCAN_OUT = 'Scanning 3 board(s)…\n  ✓ Thrive Capital (Getro): 900 job links; traced 0 new companies, 0 new board(s) to scan\n  ✓ ashby:a (A): 10 open, 2 new, 0 closed\n  ✓ rippling:pace (Pace): 13 open, 1 new, 1 closed\n';
const TIER_OUT = '3 untiered NYC role(s) to tier; tiering 3.\n  [1/3] S         Pace — Deployment Strategist\n  [2/3] C         A — Solutions Consultant\n  [3/3] A         Stripe — GTM Strategy & Operations Analyst\n\nTiered 3: S 1 · C 1 · A 1\n';

test('all steps ok: one calm morning summary is sent (D63)', async () => {
  const h = harness([ok('scan', SCAN_OUT), ok('tier-new', TIER_OUT), ok('backup')]);
  const r = await h.run();
  assert.deepEqual(r.problems, []);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0], /^✅ Job search: morning run done/);
  assert.doesNotMatch(h.sent[0], /FAILED|🚨/);
  assert.match(h.logs.join(''), /Morning summary sent[\s\S]*finished .*: ok/);
});

test('morning summary: counts, tiers in order, S and A roles named, nudge to apply', () => {
  const s = successSummary('2026-11-03', { scan: SCAN_OUT, 'tier-new': TIER_OUT });
  assert.equal(s, [
    '✅ Job search: morning run done (Tue, Nov 3)',
    '3 boards checked · 3 new postings',
    '3 new NYC roles graded: 1 S · 1 A · 1 C',
    '⭐ S: Pace — Deployment Strategist',
    '• A: Stripe — GTM Strategy & Operations Analyst',
    'Time to review in Notion and apply.',
  ].join('\n'));
});
test('morning summary: a quiet day, and output it cannot read is said, never shown as 0', () => {
  const quiet = successSummary('2026-11-03', { scan: SCAN_OUT, 'tier-new': '0 untiered NYC role(s) to tier; tiering 0.\n' });
  assert.match(quiet, /No new NYC roles to grade today\.\nCheck Notion when you have a minute\.$/);
  const unknown = successSummary('2026-11-03', { scan: 'something else', 'tier-new': '' });
  assert.match(unknown, /Boards: couldn't read the count \(see log\)\nNew roles: couldn't read the count/);
  assert.equal(runFacts({ scan: '' }).boards, null);
});
test('morning summary lists at most 6 S&A roles', () => {
  const many = Array.from({ length: 8 }, (_, i) => `  [${i + 1}/8] S         Co${i} — Role`).join('\n');
  const s = successSummary('2026-11-03', { scan: SCAN_OUT, 'tier-new': `8 untiered NYC role(s)\n${many}\n` });
  assert.equal((s.match(/⭐ S:/g) || []).length, 6);
  assert.match(s, /…and 2 more S&A in Notion/);
});
test('shortDate reads the date as a local day', () => assert.equal(shortDate('2026-11-03'), 'Tue, Nov 3'));

test('one board failing is reported by iMessage, and later steps still run', async () => {
  const scanOut = [
    'Scanning 3 board(s)…',
    '  ✓ ashby:a (A): 10 open, 0 new, 0 closed',
    '  ✗ lever:b: Lever page has no job list',
    '  ✓ greenhouse:c (C): 4 open, 1 new, 0 closed',
    'market: 1 board(s) failed and were skipped; their postings were NOT closed:',
    '  lever:b: Lever page has no job list',
  ].join('\n');
  let tierRan = false, backupRan = false;
  const h = harness([
    bad('scan', scanOut),
    { name: 'tier-new', go: async () => { tierRan = true; return { ok: true, out: '' }; } },
    { name: 'backup', go: async () => { backupRan = true; return { ok: true, out: '' }; } },
  ]);
  const r = await h.run();
  assert.ok(tierRan && backupRan);
  assert.equal(r.problems.length, 1);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0], /🚨🚨 JOB SEARCH RUN FAILED 🚨🚨[\s\S]*1 problem\. Action needed/);
  assert.match(h.sent[0], /scan: market: 1 board\(s\) failed/);
  assert.match(h.sent[0], /lever:b: Lever page has no job list/);
  assert.doesNotMatch(h.sent[0], /ashby:a/, 'healthy boards are not in the notice');
  assert.match(h.sent[0], /Full log: \/x\/daily-2026-11-03\.log/);
  assert.match(h.logs.join(''), /✓ ashby:a/, 'the log keeps the full output');
});

test('a step that throws (e.g. backup) is reported like any failure, in one notice', async () => {
  const h = harness([
    bad('scan', 'market: 2 board(s) failed and were skipped'),
    ok('tier-new'),
    { name: 'backup', go: async () => { throw new Error('offsite folder /nope does not exist'); } },
  ]);
  const r = await h.run();
  assert.deepEqual(r.problems.map((p) => p.step), ['scan', 'backup']);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0], /🚨🚨 JOB SEARCH RUN FAILED[\s\S]*2 problems\. Action needed/);
  assert.match(h.sent[0], /backup: backup: offsite folder \/nope does not exist/);
});

test('a failed notice is not swallowed', async () => {
  await assert.rejects(
    runDaily({ date: 'd', steps: [bad('scan', 'market: x')], log: () => {}, notify: async () => { throw new Error('iMessage send failed: no account'); }, logPath: 'l' }),
    /iMessage send failed/,
  );
});

test('failureDetail picks the error block, else the last lines, and caps length', () => {
  assert.equal(failureDetail('noise\ntier-new: 2 role(s) failed\n  A — B: boom'), 'tier-new: 2 role(s) failed\n  A — B: boom');
  assert.equal(failureDetail('1\n2\n3\n4\n5\n6\n7'), '3\n4\n5\n6\n7');
  assert.equal(failureDetail(''), '(no output)');
  assert.ok(failureDetail(`market: ${'x'.repeat(2000)}`).length <= 701);
});

test('failure notice is loud and lists every problem (D63)', () => {
  const s = summarize('2026-11-03', [{ step: 'scan', detail: 'a' }, { step: 'backup', detail: 'b' }], 'L');
  assert.equal(s, '🚨🚨 JOB SEARCH RUN FAILED 🚨🚨\nTue, Nov 3: 2 problems. Action needed.\n❌ scan: a\n❌ backup: b\nFull log: L');
  assert.match(summarize('2026-11-03', [{ step: 'scan', detail: 'a' }], 'L'), /1 problem\. Action needed/);
});

test('config: missing file or field fails loudly', () => {
  const d = mkdtempSync(join(tmpdir(), 'daily-'));
  assert.throws(() => loadConfig(d), /daily\.json not found/);
  mkdirSync(join(d, 'config'));
  writeFileSync(join(d, 'config', 'daily.json'), '{"imessage_to": ""}');
  assert.throws(() => loadConfig(d), /"imessage_to" is missing or empty/);
  writeFileSync(join(d, 'config', 'daily.json'), '{"imessage_to": "x", "icloud_dir": "/y"}');
  assert.throws(() => loadConfig(d), /"icloud_dir" is no longer used/);
  writeFileSync(join(d, 'config', 'daily.json'), '{oops');
  assert.throws(() => loadConfig(d), /not valid JSON/);
  writeFileSync(join(d, 'config', 'daily.json'), '{"imessage_to": "x"}');
  assert.throws(() => loadConfig(d), /"tier_per_day" must be a whole number/);
  writeFileSync(join(d, 'config', 'daily.json'), '{"imessage_to": "x", "tier_per_day": 30, "tier_per_company": 0}');
  assert.throws(() => loadConfig(d), /"tier_per_company" must be a whole number/);
  writeFileSync(join(d, 'config', 'daily.json'), '{"imessage_to": "x", "tier_per_day": 30, "tier_per_company": 5}');
  assert.throws(() => loadConfig(d), /"research_per_day" must be a whole number/);
  writeFileSync(join(d, 'config', 'daily.json'), '{"imessage_to": "x", "tier_per_day": 30, "tier_per_company": 5, "research_per_day": 10}');
  assert.throws(() => loadConfig(d), /"weekly_email" is missing/);
  writeFileSync(join(d, 'config', 'daily.json'), '{"imessage_to": "x", "tier_per_day": 30, "tier_per_company": 5, "research_per_day": 10, "weekly_email": {"to": "me@example.com", "day": "Sun"}}');
  assert.throws(() => loadConfig(d), /day name like "Sunday"/);
  writeFileSync(join(d, 'config', 'daily.json'), '{"imessage_to": "x", "tier_per_day": 30, "tier_per_company": 5, "research_per_day": 10, "weekly_email": {"to": "me@example.com", "day": "Sunday"}}');
  assert.throws(() => loadConfig(d), /"reminders_list" is missing/);
  writeFileSync(join(d, 'config', 'daily.json'), '{"imessage_to": "x", "tier_per_day": 30, "tier_per_company": 5, "research_per_day": 10, "weekly_email": {"to": "me@example.com", "day": "Sunday"}, "reminders_list": "Job Search Alerts"}');
  assert.throws(() => loadConfig(d), /needs a "packs" block/);
  writeFileSync(join(d, 'config', 'daily.json'), '{"imessage_to": "x", "tier_per_day": 30, "tier_per_company": 5, "research_per_day": 10, "weekly_email": {"to": "me@example.com", "day": "Sunday"}, "reminders_list": "Job Search Alerts", "packs": {"per_day": 4, "max_per_day": 3, "max_per_week": 5}}');
  assert.throws(() => loadConfig(d), /per_day can't be more than packs.max_per_day/);
  writeFileSync(join(d, 'config', 'daily.json'), '{"imessage_to": "x", "tier_per_day": 30, "tier_per_company": 5, "research_per_day": 10, "weekly_email": {"to": "me@example.com", "day": "Sunday"}, "reminders_list": "Job Search Alerts", "packs": {"per_day": 1, "max_per_day": 3, "max_per_week": 5}}');
  assert.equal(loadConfig(d).imessage_to, 'x');
});

test('runCommand captures exit code and output, and reports a command that will not start', async () => {
  const r = await runCommand('/bin/sh', ['-c', 'echo hi; echo oops >&2; exit 3']);
  assert.equal(r.code, 3);
  assert.match(r.out, /hi/); assert.match(r.out, /oops/);
  const n = await runCommand('/no/such/thing', []);
  assert.equal(n.code, 127);
  assert.match(n.out, /could not start/);
  const t = await runCommand('/bin/sh', ['-c', 'sleep 5'], { timeoutMs: 100 });
  assert.notEqual(t.code, 0);
  assert.match(t.out, /timed out/);
});

test('default steps: non-zero exit from scan/tier-new is a failure; backup writes a dated copy and names the iCloud folder', async () => {
  const d = mkdtempSync(join(tmpdir(), 'daily-'));
  mkdirSync(join(d, 'data'));
  const db = new DatabaseSync(join(d, 'data', 'market.db'));
  db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1);'); db.close();
  const calls = [];
  const run = async (cmd, args) => { calls.push([cmd.split('/').pop(), ...args]); return cmd.endsWith('market.sh') && args[0] === 'scan' ? { code: 1, out: 'market: 1 board(s) failed' } : { code: 0, out: 'ok' }; };
  const steps = defaultSteps({ dataDir: d, date: '2026-11-03', cfg: CFG, run, icloud: () => '/Users/me/Documents' });
  const results = [];
  for (const s of steps) results.push(await s.go());
  assert.deepEqual(calls, [['market.sh', 'scan'], ['tier-new.sh', '--limit', '30', '--per-company', '5'], ['market.sh', 'radar', '--research', '10'], ['packs.sh', 'build'], ['market.sh', 'stats']]);
  assert.deepEqual(results.map((r) => r.ok), [false, true, true, true, true, true]);
  assert.ok(existsSync(join(d, 'backups', 'market-2026-11-03.db')));
  assert.deepEqual(readdirSync(join(d, 'backups')), ['market-2026-11-03.db']);
  assert.match(results[5].out, /dated backups reach iCloud through the synced \/Users\/me\/Documents folder/);
});

test('backup step fails (and so is reported) when the folder is not iCloud-synced', async () => {
  const d = mkdtempSync(join(tmpdir(), 'daily-'));
  mkdirSync(join(d, 'data'));
  const db = new DatabaseSync(join(d, 'data', 'market.db')); db.exec('CREATE TABLE t (x)'); db.close();
  const step = defaultSteps({ dataDir: d, date: '2026-11-03', cfg: CFG, icloud: () => { throw new Error('backup: x is not in an iCloud-synced folder'); } }).at(-1);
  const sent = [];
  const r = await runDaily({ date: '2026-11-03', steps: [step], log: () => {}, notify: async (t) => { sent.push(t); }, logPath: 'L' });
  assert.equal(r.problems.length, 1);
  assert.match(sent[0], /backup: backup: x is not in an iCloud-synced folder/);
});

test('localDate is YYYY-MM-DD', () => assert.match(localDate(new Date(2026, 10, 3)), /^2026-11-03$/));

test('summary: says how many roles wait for later runs (D67)', () => {
  const out = '231 untiered NYC role(s) to tier (x); tiering 2 (cap: 30 a run, 5 per company).\n201 role(s) wait for a later run.\n  [1/2] A         Pace — Deployment Strategist\n  [2/2] B         Plaid — Business Operations\n';
  const s = successSummary('2026-11-05', { scan: SCAN_OUT, 'tier-new': out });
  assert.match(s, /⏳ 201 more NYC roles waiting; graded over the next runs/);
  assert.doesNotMatch(successSummary('2026-11-05', { scan: SCAN_OUT, 'tier-new': TIER_OUT }), /waiting/);
});

test('summary: a usage-limit pause is flagged but says nothing is broken (D68, D112)', () => {
  const out = '231 untiered NYC role(s) to tier (x); tiering 30 (cap: 30 a run, 5 per company).\n201 role(s) wait for a later run.\n  [1/30] A         Pace — Deployment Strategist\nPaused: Claude usage limit reached after 1 of 30 graded; 29 left for the next run.\n';
  const s = successSummary('2026-11-05', { scan: SCAN_OUT, 'tier-new': out });
  assert.match(s, /^⏳ Job search: grading PAUSED \(/); // nothing is broken, so no 🚨 (D112)
  assert.match(s, /Claude usage limit hit after 1 of 30 roles\. Nothing is broken/);
  assert.match(s, /⏳ 230 more NYC roles waiting/);
  assert.doesNotMatch(s, /✅/);
});

test('summary: newly funded NYC companies get one line; a research pause is mentioned, not alarming (Phase 6)', () => {
  const radar = 'Funding sources:\n  ✓ Form D (SEC): 40 NY filing(s)\nNewly funded NYC companies (4): Minerva BI ($15M, Form D) · Clark ($11M, Seed, News) · Hyphenate ($45M, News) · Acme ($2M, Form D)\nPaused: Claude usage limit reached after 2 of 10 researched; the rest wait for the next run.\n';
  const s = successSummary('2026-11-05', { scan: SCAN_OUT, 'tier-new': TIER_OUT, radar });
  assert.match(s, /🆕 4 newly funded NYC companies: Minerva BI, Clark, Hyphenate, \+1 more \(Company Radar\)/);
  assert.match(s, /⏳ Company research paused/);
  assert.match(s, /^✅/);
  const none = successSummary('2026-11-05', { scan: SCAN_OUT, 'tier-new': TIER_OUT, radar: 'Newly funded NYC companies: none new this run.\n' });
  assert.doesNotMatch(none, /🆕|research paused/);
});

// --- Phase 7: S-tier texts, failed-run roles, midday run, weekly email (D78–D82)
const TIER_WITH_ALERT = '2 untiered NYC role(s) to tier; tiering 2.\n  [1/2] S         Pace — Deployment Strategist\n      ⭐ alert: $140K–$175K/yr · https://ats.rippling.com/pace/jobs/1\n  [2/2] A         Stripe — GTM Strategy\n\nTiered 2: S 1 · A 1\n';

test('S-tier roles: read from the grading output and sent as their own text right after grading (D78)', async () => {
  assert.deepEqual(sAlerts(TIER_WITH_ALERT), [{ role: 'Pace — Deployment Strategist', pay: '$140K–$175K/yr', url: 'https://ats.rippling.com/pace/jobs/1' }]);
  assert.match(alertText(sAlerts(TIER_WITH_ALERT)[0]), /^⭐ New S-tier role: Pace — Deployment Strategist\n\$140K–\$175K\/yr\nhttps:\/\/ats\.rippling\.com\/pace\/jobs\/1/);
  const sent = [];
  const order = [];
  const steps = [
    { name: 'scan', go: async () => { order.push('scan'); return { ok: true, out: SCAN_OUT }; } },
    { name: 'tier-new', go: async () => { order.push('tier'); return { ok: true, out: TIER_WITH_ALERT }; } },
    { name: 'radar', go: async () => { order.push(`radar after ${sent.length} text(s)`); return { ok: true, out: '' }; } },
  ];
  await runDaily({ date: '2026-11-05', steps, log: () => {}, notify: async (t) => { sent.push(t); }, logPath: 'L' });
  assert.deepEqual(order, ['scan', 'tier', 'radar after 1 text(s)']); // the S text goes out before research starts
  assert.equal(sent.length, 2);
  assert.match(sent[0], /^⭐ New S-tier role/);
  assert.match(sent[1], /^✅ Job search: morning run done/);
});

test('a failed run still lists the S and A roles it graded; an unsendable S text is a reported problem (D78)', async () => {
  const msg = summarize('2026-11-05', [{ step: 'scan', detail: 'ashby:x 404' }], 'L', { 'tier-new': TIER_WITH_ALERT });
  assert.match(msg, /^🚨🚨 JOB SEARCH RUN FAILED/);
  assert.match(msg, /Graded this run anyway \(in Notion\):\n⭐ S: Pace — Deployment Strategist\n• A: Stripe — GTM Strategy/);
  assert.doesNotMatch(summarize('2026-11-05', [{ step: 'scan', detail: 'x' }], 'L'), /Graded this run/);
  const sent = [];
  const notify = async (t) => { if (t.startsWith('⭐')) throw new Error('iMessage send failed: no network'); sent.push(t); };
  const { problems } = await runDaily({ date: '2026-11-05', steps: [{ name: 'tier-new', go: async () => ({ ok: true, out: TIER_WITH_ALERT }) }], log: () => {}, notify, logPath: 'L' });
  assert.equal(problems[0].step, 'S-tier text');
  assert.match(sent[0], /JOB SEARCH RUN FAILED[\s\S]*❌ S-tier text: Pace — Deployment Strategist: iMessage send failed/);
});

test('midday run: scan and grade only roles first seen today; a short summary text, or the failure text (D79, D122)', async () => {
  const calls = [];
  const run = async (cmd, args) => { calls.push([cmd.split('/').pop(), ...args]); return { code: 0, out: 'ok' }; };
  const steps = defaultSteps({ dataDir: '/x', date: '2026-11-05', cfg: CFG, run, midday: true });
  assert.deepEqual(steps.map((s) => s.name), ['scan', 'tier-new', 'packs']);
  for (const s of steps) await s.go();
  assert.deepEqual(calls[1], ['tier-new.sh', '--limit', '30', '--per-company', '5', '--seen-since', '2026-11-05']);
  assert.deepEqual(calls[2], ['packs.sh', 'build']);
  const quiet = [];
  await runDaily({ date: '2026-11-05', steps: [{ name: 'tier-new', go: async () => ({ ok: true, out: TIER_OUT.replace(/S {9}/, 'B         ') }) }], log: () => {}, notify: async (t) => { quiet.push(t); }, logPath: 'L', midday: true });
  assert.equal(quiet.length, 1);
  assert.match(quiet[0], /^✅ Job search: midday run done \(Thu, Nov 5\)\n/);
  assert.match(quiet[0], /new NYC roles? graded: .*B/);
  const loud = [];
  await runDaily({ date: '2026-11-05', steps: [{ name: 'scan', go: async () => ({ ok: false, out: 'market: 1 problem(s)' }) }], log: () => {}, notify: async (t) => { loud.push(t); }, logPath: 'L', midday: true });
  assert.match(loud[0], /JOB SEARCH RUN FAILED 🚨🚨\nMidday run, Thu, Nov 5/);
});

test('one run at a time: a live lock blocks, a stale one is cleared (D79)', () => {
  const d = mkdtempSync(join(tmpdir(), 'lock-'));
  const path = join(d, 'daily.lock');
  const release = takeLock(path, 'morning');
  assert.ok(release && existsSync(path));
  assert.equal(takeLock(path, 'midday', { alive: () => true }), null);
  const again = takeLock(path, 'midday', { alive: () => false }); // crashed run left it behind
  assert.ok(again);
  again();
  assert.equal(existsSync(path), false);
});

test('weekly email: only on its day, sent with what the week found; a send failure fails the step (D80–D81)', async () => {
  assert.equal(isWeeklyDay('2026-11-08', 'Sunday'), true);
  assert.equal(isWeeklyDay('2026-11-09', 'Sunday'), false);
  const names = (date) => defaultSteps({ dataDir: '/x', date, cfg: CFG, run: async () => ({ code: 0, out: '' }), weekly: async () => 'weekly: sent "x"\n' }).map((s) => s.name);
  assert.deepEqual(names('2026-11-08'), ['scan', 'tier-new', 'radar', 'packs', 'stats', 'weekly-email', 'backup']);
  assert.deepEqual(names('2026-11-09'), ['scan', 'tier-new', 'radar', 'packs', 'stats', 'backup']);

  const d = mkdtempSync(join(tmpdir(), 'weekly-'));
  mkdirSync(join(d, 'data'));
  const st = openStore(join(d, 'data', 'market.db'));
  st.saveCompany({ name: 'Clark', status: 'unknown', nyc_presence: true, what_they_do: 'AI for auditors', fit: 'Possible', fit_reason: 'Business customers', leaders: [{ name: 'Ada Example', title: 'CEO', source_url: 's' }], sources: [{ url: 's', supports: 'x' }] }, { source: 'research', by: 'kit' });
  st.addFundingRound(st.company('Clark'), { round: 'Seed', amount_usd: 11e6, date: '2026-11-03', source_url: 'https://n/1', found_via: 'news' }, new Date('2026-11-04T12:00:00Z'));
  st.close();
  const mails = [];
  const out = await sendWeekly({ dataDir: d, cfg: CFG, now: new Date('2026-11-08T15:00:00Z'), send: async (to, subject, text) => { mails.push({ to, subject, text }); } });
  assert.match(out, /^weekly: sent /);
  assert.equal(mails[0].to, 'me@example.com');
  assert.match(mails[0].subject, /1 newly funded NYC company, 0 S \+ 0 A roles/);
  assert.match(mails[0].text, /Clark: \$11M, Seed, on 2026-11-03 \(News\)\n  Fit: Possible\. Business customers\n  What they do: AI for auditors\n  Leaders: Ada Example \(CEO\)/);
  await assert.rejects(sendWeekly({ dataDir: d, cfg: CFG, send: async () => { throw new Error('Email send failed: Mail has no email account set up.'); } }), /Mail has no email account/);
  assert.match(successSummary('2026-11-08', { scan: SCAN_OUT + 'Retired 1 job board(s) that no longer exist: Pryzm\n', 'tier-new': TIER_OUT, 'weekly-email': out }), /🗑 Retired 1 job board that no longer exists \(not found 3 days in a row\): Pryzm\n📧 Weekly email sent to you/);
});

// --- Phase 8: prep packs in the daily texts (D85, D89) --------------------------------
const PACKS_OUT = `Prep packs: 3 waiting · 0 built today (cap 3) · 0 in the last 7 days (cap 5) · building 2
📦 Prep pack ready: Pace — Deployment Strategist · /x/private/output/packs/2026-11-05-pace-deployment-strategist
🚫 Prep pack BLOCKED: Sierra — AI Strategist: CV line check: summary: "12" is not in the source line
Prep packs done: 1 ready · 1 blocked · 0 failed · 1 queued
`;

test('packs: the morning summary lists ready packs and the queue; the midday run texts each ready pack', async () => {
  const f = runFacts({ packs: PACKS_OUT });
  assert.deepEqual(f.packsReady, ['Pace — Deployment Strategist']);
  assert.equal(f.packsQueued, 1);
  const text = successSummary('2026-11-05', { packs: PACKS_OUT });
  assert.match(text, /📦 1 prep pack ready: Pace — Deployment Strategist \(Notion → Prep pack\)/);
  assert.match(text, /🗂 1 more prep pack queued/);
  assert.doesNotMatch(successSummary('2026-11-05', {}), /prep pack/);
  const sent = [];
  await runDaily({ date: '2026-11-05', steps: [{ name: 'packs', go: async () => ({ ok: true, out: PACKS_OUT }) }], log: () => {}, notify: async (t) => { sent.push(t); }, logPath: 'L', midday: true });
  assert.equal(sent[0], packText('Pace — Deployment Strategist'));
  assert.match(sent[1], /^✅ Job search: midday run done/);
  assert.doesNotMatch(sent[1], /prep pack ready/); // already texted on its own
  assert.equal(sent.length, 2);
});

test('packs: a blocked pack is a 🚫 line, not a failure; a pack that failed to build is real (D112)', async () => {
  const blockedOut = `${PACKS_OUT}packs: 1 prep pack(s) need a look:\n  BLOCKED Sierra — AI Strategist: CV line check\n`;
  const sent = [];
  const r = await runDaily({ date: '2026-11-05', steps: [{ name: 'packs', go: async () => ({ ok: false, out: blockedOut }) }], log: () => {}, notify: async (t) => { sent.push(t); }, logPath: 'L' });
  assert.equal(r.problems.length, 0);
  assert.match(sent[0], /^✅[\s\S]*🚫 1 prep pack held back by the fact check \(your call; details on the role's Notion page\): Sierra — AI Strategist/);
  const midday = [];
  await runDaily({ date: '2026-11-05', steps: [{ name: 'packs', go: async () => ({ ok: false, out: blockedOut }) }], log: () => {}, notify: async (t) => { midday.push(t); }, logPath: 'L', midday: true });
  assert.ok(midday.some((t) => t.startsWith('🚫 Prep pack held back: Sierra — AI Strategist\nThe fact check found something your CV doesn\'t back up: CV line check')));
  assert.ok(!midday.some((t) => /RUN FAILED/.test(t)));
  const failed = [];
  await runDaily({ date: '2026-11-05', steps: [{ name: 'packs', go: async () => ({ ok: false, out: 'packs: 2 prep pack(s) need a look:\n  BLOCKED Sierra — AI Strategist: CV line check\n  FAILED Pace — Deployment Strategist: fetch failed\n' }) }], log: () => {}, notify: async (t) => { failed.push(t); }, logPath: 'L' });
  // A failed pack stays failed until you requeue it, so it doesn't fix itself: real.
  assert.match(failed[0], /RUN FAILED[\s\S]*❌ packs: packs: 2 prep pack\(s\) need a look:\n  FAILED Pace — Deployment Strategist: fetch failed/);
  assert.match(failed[0], /Not problems \(no action needed for these\):\n🚫 1 prep pack held back/);
});

test('packs: hitting the usage limit shows as paused, not failed', () => {
  const out = 'Prep packs: 2 waiting · 0 built today (cap 3) · 0 in the last 7 days (cap 5) · building 2\nPaused: Claude usage limit reached after 0 of 2 packs; the rest stay queued.\nPrep packs done: 0 ready · 0 blocked · 0 failed · 2 queued\n';
  assert.match(successSummary('2026-11-05', { packs: out }), /⏳ Prep packs paused at the Claude usage limit/);
});

test('not-found boards: day 1 only in the log, a ⚠️ line from day 2 (D93, D115)', () => {
  const scan = 'Scanning 2 board(s)…\n  ✓ ashby:pace (Pace): 3 open, 1 new, 0 closed\nNot found (retired after 3 days in a row): pryzm 2/3 · whatnot 1/3\n';
  assert.deepEqual(runFacts({ scan }).notFound, [{ name: 'pryzm', days: 2, of: 3 }, { name: 'whatnot', days: 1, of: 3 }]);
  const text = successSummary('2026-11-05', { scan });
  assert.match(text, /⚠️ 1 job board not found 2\+ days in a row \(retired on day 3 if still gone\): pryzm 2\/3/);
  assert.doesNotMatch(text, /whatnot/);
  assert.doesNotMatch(successSummary('2026-11-05', { scan: 'Not found (retired after 3 days in a row): whatnot 1/3\n' }), /not found/);
});

test('alerts that matter also become a reminder; a reminder that fails is a reported problem (D95)', async () => {
  const sent = [], reminders = [];
  const notify = async (t) => { sent.push(t); };
  const remind = async (t) => { reminders.push(t); };
  await runDaily({ date: '2026-11-05', steps: [{ name: 'tier-new', go: async () => ({ ok: true, out: TIER_WITH_ALERT }) }, { name: 'packs', go: async () => ({ ok: true, out: PACKS_OUT }) }], log: () => {}, notify, remind, logPath: 'L' });
  assert.match(reminders[0], /^⭐ New S-tier role: Pace — Deployment Strategist/);
  assert.match(reminders[1], /^📦 Prep pack ready: Pace — Deployment Strategist/);
  assert.equal(reminders.length, 2); // a calm ✅ summary is a text only
  assert.ok(!sent.some((t) => t.startsWith('📦'))); // the morning lists packs in its summary
  const failing = [];
  await runDaily({ date: '2026-11-05', steps: [{ name: 'scan', go: async () => ({ ok: false, out: 'market: 1 problem(s)' }) }], log: () => {}, notify, remind: async (t) => { failing.push(t); }, logPath: 'L' });
  assert.match(failing[0], /JOB SEARCH RUN FAILED/);
  const texts = [];
  const r = await runDaily({ date: '2026-11-05', steps: [{ name: 'tier-new', go: async () => ({ ok: true, out: TIER_WITH_ALERT }) }], log: () => {}, notify: async (t) => { texts.push(t); }, remind: async () => { throw new Error('Reminder not created: no permission'); }, logPath: 'L' });
  assert.equal(r.problems[0].step, 'reminder');
  assert.match(texts.at(-1), /❌ reminder: S-tier Pace — Deployment Strategist: Reminder not created/);
});

test('VC job lists that can\'t connect: day 1 only in the log, a ⚠️ line from day 2 (D111, D115)', () => {
  const scan = '  ✓ Scale Venture Partners (Getro): 842 job links; traced 0 new companies, 0 new board(s) to scan (on the retry)\nScanning 1 board(s)…\n  ✓ ashby:pace (Pace): 3 open, 1 new, 0 closed\nVC job lists unreachable after a retry (checked again next run): Thrive Capital (2 days in a row) · Andreessen Horowitz (1 day in a row)\n';
  const f = runFacts({ scan });
  assert.equal(f.newPostings, 1);
  assert.deepEqual(f.vcUnreachable, [{ name: 'Thrive Capital', days: 2 }, { name: 'Andreessen Horowitz', days: 1 }]);
  const text = successSummary('2026-11-09', { scan });
  assert.match(text, /⚠️ 1 VC job list couldn't connect 2\+ days in a row, even on a retry; checked again next run: Thrive Capital \(2 days in a row\)/);
  assert.doesNotMatch(text, /Andreessen/);
});

test('boards that can\'t connect: day 1 only in the log, a ⚠️ line from day 2; a board read on the retry still counts (D108, D115)', () => {
  const scan = 'Scanning 3 board(s)…\n  ✓ ashby:pace (Pace): 3 open, 1 new, 0 closed\n  ✓ ashby:zip (Zip): 9 open, 2 new, 0 closed (on the retry)\nUnreachable after a retry (postings kept open; checked again next run): clasp (1 day in a row) · Datadog (3 days in a row)\n';
  assert.equal(runFacts({ scan }).newPostings, 3);
  assert.match(successSummary('2026-11-06', { scan }), /⚠️ 1 job board couldn't connect 2\+ days in a row, even on a retry; checked again next run: Datadog \(3 days in a row\)/);
  assert.doesNotMatch(successSummary('2026-11-06', { scan }), /clasp/);
  // the older line without day counts reads as day 1
  assert.doesNotMatch(successSummary('2026-11-06', { scan: 'Unreachable after a retry (x): clasp\n' }), /couldn't connect/);
});

// --- D112: only a real problem sends the 🚨 text
const TIER_CUT_OFF = `${TIER_OUT}tier-new: 2 role(s) failed and were skipped:\n  doordashusa — Grocery Merchant S&O: claude exited with code 143.\n  nebex — Business Operations Manager: claude exited with code 143.\n`;
const memStreaks = (start = {}) => { const box = { counts: start }; return { box, read: () => box.counts, write: (c) => { box.counts = c; } }; };

test('temporary problems: connection, server error and cut-off AI calls; anything else is real (D112)', () => {
  for (const e of ['Could not reach https://x: fetch failed', 'The operation was aborted due to timeout', 'https://x returned HTTP 503.', 'claude exited with code 143.', 'claude was stopped (SIGTERM) after 300s']) assert.ok(isTemporary(e), e);
  for (const e of ['returned HTTP 404.', 'Rippling pay details are in a format the kit doesn\'t read yet', 'unreachable 3 runs in a row (fetch failed)', 'claude exited with code 1.']) assert.ok(!isTemporary(e), e);
});

test('two cut-off grading calls on day 1: a calm summary with no flag; the counts are saved by day (D112, D115, the 2026-11-10 run)', async () => {
  const sent = [];
  const st = memStreaks();
  const r = await runDaily({ date: '2026-11-10', steps: [ok('scan', SCAN_OUT), bad('tier-new', TIER_CUT_OFF)], log: () => {}, notify: async (t) => { sent.push(t); }, logPath: 'L', streaks: st });
  assert.equal(r.problems.length, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^✅ Job search: morning run done/);
  assert.doesNotMatch(sent[0], /⚠️/);
  assert.match(sent[0], /⭐ S: Pace — Deployment Strategist/);
  assert.deepEqual(st.box.counts, { 'tier-new|doordashusa — Grocery Merchant S&O': { days: 1, last: '2026-11-10' }, 'tier-new|nebex — Business Operations Manager': { days: 1, last: '2026-11-10' } });
});

test('the same item: ⚠️ on day 2, 🚨 on day 5; midday is the same day; a gap or a good run starts over (D115)', async () => {
  const nebex = 'tier-new|nebex — Business Operations Manager';
  const dd = 'tier-new|doordashusa — Grocery Merchant S&O';
  const st = memStreaks({ [nebex]: { days: 1, last: '2026-11-10' }, [dd]: { days: 4, last: '2026-11-10' }, 'radar|Form D (SEC)': { days: 2, last: '2026-11-10' } });
  const sent = [];
  // Day 2 for nebex, day 5 for DoorDash (midday run: radar doesn't run, so its count is kept).
  const r = await runDaily({ date: '2026-11-11', steps: [bad('tier-new', TIER_CUT_OFF)], log: () => {}, notify: async (t) => { sent.push(t); }, logPath: 'L', streaks: st, midday: true });
  assert.equal(r.problems.length, 1);
  assert.match(sent[0], /RUN FAILED[\s\S]*❌ tier-new: tier-new: 2 role\(s\) failed and were skipped:\n  doordashusa — Grocery Merchant S&O: claude exited with code 143\. \(failing 5 days in a row\)/);
  assert.match(sent[0], /Not problems[\s\S]*⚠️ 1 role failing 2\+ days in a row[\s\S]*nebex — Business Operations Manager \(2 days in a row\)/);
  assert.deepEqual(st.box.counts, { 'radar|Form D (SEC)': { days: 2, last: '2026-11-10' }, [nebex]: { days: 2, last: '2026-11-11' }, [dd]: { days: 5, last: '2026-11-11' } });
  // The morning after: same failure, now day 3 for nebex; a second run the same day doesn't add a day.
  await runDaily({ date: '2026-11-12', steps: [bad('tier-new', TIER_CUT_OFF)], log: () => {}, notify: async () => {}, logPath: 'L', streaks: st, midday: true });
  await runDaily({ date: '2026-11-12', steps: [bad('tier-new', TIER_CUT_OFF)], log: () => {}, notify: async () => {}, logPath: 'L', streaks: st, midday: true });
  assert.equal(st.box.counts[nebex].days, 3);
  // A good run clears the step's counts; a day missed in between starts over at 1.
  await runDaily({ date: '2026-11-12', steps: [ok('tier-new', TIER_OUT)], log: () => {}, notify: async () => {}, logPath: 'L', streaks: st, midday: true });
  assert.deepEqual(Object.keys(st.box.counts), ['radar|Form D (SEC)']);
  const later = memStreaks({ [nebex]: { days: 3, last: '2026-11-08' } });
  await runDaily({ date: '2026-11-12', steps: [bad('tier-new', TIER_CUT_OFF)], log: () => {}, notify: async () => {}, logPath: 'L', streaks: later, midday: true });
  assert.equal(later.box.counts[nebex].days, 1);
  // A count file from D112 (plain numbers) reads as a first day.
  const old = memStreaks({ [nebex]: 2 });
  await runDaily({ date: '2026-11-12', steps: [bad('tier-new', TIER_CUT_OFF)], log: () => {}, notify: async () => {}, logPath: 'L', streaks: old, midday: true });
  assert.equal(old.box.counts[nebex].days, 1);
});

test('a prep pack that failed twice on a connection error is a ⚠️ requeue line, not a 🚨 (D115)', async () => {
  const sent = [];
  const out = 'packs: 1 prep pack(s) need a look:\n  FAILED Pace — Deployment Strategist: fetch failed (failed twice on a connection error)\n';
  const r = await runDaily({ date: '2026-11-12', steps: [bad('packs', out)], log: () => {}, notify: async (t) => { sent.push(t); }, logPath: 'L', streaks: memStreaks() });
  assert.equal(r.problems.length, 0);
  assert.match(sent[0], /^✅[\s\S]*⚠️ 1 prep pack couldn't be built twice \(no connection\); requeue with scripts\/packs\.sh requeue <posting link>: Pace — Deployment Strategist/);
});

test('a whole step that breaks is real even on a connection error: its work may not reach Notion (D112)', async () => {
  for (const out of ['tier-new: fetch failed\n', 'Scanning 3 board(s)…\n\n[daily] step timed out after 120 min and was stopped\n']) {
    const sent = [];
    const r = await runDaily({ date: '2026-11-07', steps: [bad('tier-new', out)], log: () => {}, notify: async (t) => { sent.push(t); }, logPath: 'L', streaks: memStreaks() });
    assert.equal(r.problems.length, 1, out);
    assert.match(sent[0], /RUN FAILED/);
  }
});

test('a Radar source that can\'t connect is temporary (⚠️ from day 2); an unreadable count file is a real problem (D112, D115)', async () => {
  const radar = 'Funding sources:\n  ✗ Form D (SEC): Could not reach the SEC: The operation was aborted due to timeout\nmarket: 1 problem(s); the other sources still ran:\n  Form D (SEC): Could not reach the SEC: The operation was aborted due to timeout\n';
  const sent = [];
  const r = await runDaily({ date: '2026-11-07', steps: [bad('radar', radar)], log: () => {}, notify: async (t) => { sent.push(t); }, logPath: 'L', streaks: memStreaks({ 'radar|Form D (SEC)': { days: 1, last: '2026-11-06' } }) });
  assert.equal(r.problems.length, 0);
  assert.match(sent[0], /⚠️ 1 Radar source failing 2\+ days in a row[\s\S]*checked again next run: Form D \(SEC\) \(2 days in a row\)/);
  const dir = mkdtempSync(join(tmpdir(), 'streaks-'));
  writeFileSync(join(dir, 's.json'), '{not json');
  const bad2 = [];
  const r2 = await runDaily({ date: '2026-11-07', steps: [ok('scan', SCAN_OUT)], log: () => {}, notify: async (t) => { bad2.push(t); }, logPath: 'L', streaks: streakFile(join(dir, 's.json')) });
  assert.equal(r2.problems[0].step, 'alert counts');
  assert.match(bad2[0], /RUN FAILED[\s\S]*s\.json could not be read/);
  assert.equal(streakFile(join(dir, 'none.json')).read().constructor, Object);
});

test('Serper credits low: a 💳 line in the summary or failure text, and a pop-up (D113)', async () => {
  const radar = 'Funding sources:\nSerper credits LOW: 110 left · about 17 a day · about 6 days left. Buy more at serper.dev before they run out.\n';
  assert.match(successSummary('2026-11-12', { scan: SCAN_OUT, radar }), /💳 Serper credits low: 110 left, about 6 days at 17 a day\. Buy the 50k pack at serper\.dev/);
  assert.doesNotMatch(successSummary('2026-11-12', { scan: SCAN_OUT, radar: '  ✓ Serper credits: 2,438 left · about 17 a day · about 143 days left\n' }), /💳/);
  assert.match(summarize('2026-11-12', [{ step: 'scan', detail: 'x' }], 'L', { radar }), /❌ scan: x\n💳 Serper credits low/);
  const reminders = [];
  await runDaily({ date: '2026-11-12', steps: [ok('radar', radar)], log: () => {}, notify: async () => {}, remind: async (t) => { reminders.push(t); }, logPath: 'L' });
  assert.deepEqual(reminders, [creditText({ left: '110', perDay: 17, days: 6 })]);
});

test('a16z company pages get their own name in the ⚠️ line; a lost network and day-counted escalations are real (D115)', async () => {
  const scan = 'market: 1 problem(s); failed boards were skipped and their postings were NOT closed:\n  Andreessen Horowitz → optimism (https://jobs.a16z.com/jobs/optimism): Could not reach https://jobs.a16z.com/jobs/optimism: The operation was aborted due to timeout\n';
  const sent = [];
  await runDaily({ date: '2026-11-13', steps: [bad('scan', scan)], log: () => {}, notify: async (t) => { sent.push(t); }, logPath: 'L', streaks: memStreaks({ 'scan|Andreessen Horowitz → optimism (https://jobs.a16z.com/jobs/optimism)': { days: 1, last: '2026-11-12' } }) });
  assert.match(sent[0], /⚠️ 1 VC company page failing 2\+ days in a row/);
  assert.ok(!isTemporary('ashby:b1: fetch failed (one of 11 boards unreachable after a retry; more than 10 usually means the Mac lost its network)'));
  assert.ok(!isTemporary('ashby:clasp: unreachable 5 days in a row (fetch failed)'));
});

test('a Notion sync with no answer is a temporary problem, and the step\'s other problems still show (D119)', () => {
  const out = `Deployment fit: 9 companies changed.
  ✗ Notion sync: Notion PATCH pages/abc: fetch failed (no answer, even on a retry 30 seconds later)
market: 2 problem(s); the other sources still ran:
  research Gnau: claude exited with code 143.
  Notion sync: Notion PATCH pages/abc: fetch failed (no answer, even on a retry 30 seconds later); 9 companies wait for the next run
`;
  const r = sortProblems('radar', out, {}, '2026-11-16');
  assert.deepEqual(r.real, []);
  assert.deepEqual(r.temporary.map((t) => [t.key, t.days]), [['research Gnau', 1], ['Notion sync', 1]]);
  // Day 2 in a row: a ⚠️ line; an error answer from Notion is real the first time.
  assert.equal(sortProblems('radar', out, { 'radar|Notion sync': { days: 1, last: '2026-11-15' } }, '2026-11-16').temporary[1].days, 2);
  const denied = 'market: 1 problem(s); the other sources still ran:\n  Notion sync: Notion PATCH pages/abc failed (403 restricted_resource): no access.; 9 companies wait for the next run\n';
  assert.match(sortProblems('radar', denied, {}, '2026-11-16').real.join('\n'), /Notion sync: .*403 restricted_resource/);
});

test('successSummary (D120): new untitled roles get a ⚠️ line with their links', () => {
  const scan = `${SCAN_OUT}New roles with no title, left out until they get one: OpenAI https://jobs.ashbyhq.com/openai/abc · Acme https://jobs.ashbyhq.com/acme/9\n`;
  assert.deepEqual(runFacts({ scan }).untitled, ['OpenAI https://jobs.ashbyhq.com/openai/abc', 'Acme https://jobs.ashbyhq.com/acme/9']);
  const s = successSummary('2026-11-03', { scan, 'tier-new': TIER_OUT });
  assert.match(s, /⚠️ 2 new roles with no title on the job board, left out until they get one: OpenAI https:\/\/jobs\.ashbyhq\.com\/openai\/abc, Acme/);
  assert.doesNotMatch(successSummary('2026-11-03', { scan: SCAN_OUT, 'tier-new': TIER_OUT }), /no title/);
});

test('awake time (D130): a long gap between ticks is sleep, not work; the limit fires on awake time only', () => {
  let t = 0; let tick = null; let fired = 0;
  const timer = awakeTimeout(120_000, () => { fired++; }, { tickMs: 30_000, now: () => t, every: (fn) => { tick = fn; return 1; }, stop: () => {} });
  t += 30_000; tick(); t += 30_000; tick();                 // 1 min awake
  t += 90 * 60_000; tick();                                  // the lid was closed for 90 minutes
  assert.equal(fired, 0);
  assert.equal(timer.sleptMs(), 90 * 60_000 - 30_000);
  t += 30_000; tick(); t += 30_000; tick();                  // 2.5 min awake in all
  assert.equal(fired, 1);
  timer.clear();
});

test('a step that ran out of time while the Mac slept is temporary, with a 💤 line; awake timeouts stay real (D130)', () => {
  const out = 'some work\n\n[daily] step timed out after 120 min and was stopped\n';
  const asleep = sortProblems('radar', out, {}, '2026-11-22', { sleptMs: 100 * 60_000 });
  assert.deepEqual(asleep.real, []);
  assert.equal(asleep.temporary[0].key, ASLEEP_KEY);
  assert.match(asleep.temporary[0].error, /asleep for 100 min/);
  const awake = sortProblems('radar', out, {}, '2026-11-22', { sleptMs: 60_000 });
  assert.match(awake.real.join('\n'), /timed out/);
  // Five mornings in a row is a real problem.
  const five = sortProblems('radar', out, { [`radar|${ASLEEP_KEY}`]: { days: 4, last: '2026-11-21' } }, '2026-11-22', { sleptMs: 100 * 60_000 });
  assert.match(five.real.join('\n'), /happening 5 days in a row/);
  assert.match(asleepLine([{ step: 'scan', ms: 20 * 60_000 }, { step: 'radar', ms: 100 * 60_000 }]), /asleep for 120 min/);
  assert.equal(asleepLine([{ step: 'scan', ms: 60_000 }]), null);
  assert.match(quietProblemLines({ asleep: [{ step: 'radar', ms: 100 * 60_000 }] })[0], /^💤/);
});

test('stats step (D131): a month frozen today gets one 📊 line; a quiet refresh adds nothing', () => {
  const frozenOut = 'Monthly stats 2009-12..2026-12: provisional months refreshed. Frozen now: 2026-11.\nTracking began 2026-11 (first completed scan).\n';
  const s = successSummary('2026-12-07', { scan: SCAN_OUT, 'tier-new': TIER_OUT, stats: frozenOut });
  assert.match(s, /📊 November 2026 market numbers frozen; they won't change now/);
  const quiet = successSummary('2026-11-25', { scan: SCAN_OUT, 'tier-new': TIER_OUT, stats: 'Monthly stats 2009-12..2026-11: provisional months refreshed.\n' });
  assert.doesNotMatch(quiet, /📊/);
  assert.deepEqual(runFacts({ stats: 'Monthly stats a..b: provisional months refreshed. Frozen now: 2026-11, 2026-12.\n' }).frozen, ['2026-11', '2026-12']);
});

test('stats step (D131): runs only in the morning, and a non-zero exit is a failure', async () => {
  const run = async (cmd, args) => (args[0] === 'stats' ? { code: 1, out: 'market: database is locked' } : { code: 0, out: '' });
  const morning = defaultSteps({ dataDir: '/x', date: '2026-11-25', cfg: CFG, run });
  const stats = morning.find((s) => s.name === 'stats');
  assert.equal((await stats.go()).ok, false);
  assert.ok(!defaultSteps({ dataDir: '/x', date: '2026-11-25', cfg: CFG, run, midday: true }).some((s) => s.name === 'stats'));
});

test('monthName', () => { assert.equal(monthName('2026-11'), 'November 2026'); assert.equal(monthName('2027-01'), 'January 2027'); });

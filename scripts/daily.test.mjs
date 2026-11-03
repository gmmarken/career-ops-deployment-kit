import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runDaily, failureDetail, summarize, loadConfig, defaultSteps, runCommand, localDate } from './daily.mjs';

const ok = (name, out = 'fine\n') => ({ name, go: async () => ({ ok: true, out }) });
const bad = (name, out) => ({ name, go: async () => ({ ok: false, out }) });

function harness(steps) {
  const logs = []; const sent = [];
  return {
    logs, sent,
    run: () => runDaily({ date: '2026-11-03', steps, log: (t) => logs.push(t), notify: async (t) => { sent.push(t); }, logPath: '/x/daily-2026-11-03.log' }),
  };
}

test('all steps ok: no notice, nothing reported', async () => {
  const h = harness([ok('scan'), ok('tier-new'), ok('backup')]);
  const r = await h.run();
  assert.deepEqual(r.problems, []);
  assert.equal(h.sent.length, 0);
  assert.match(h.logs.join(''), /finished .*: ok/);
});

test('one board failing is reported by iMessage, and later steps still run', async () => {
  const scanOut = [
    'Scanning 3 board(s)…',
    '  ✓ ashby:a (A): 10 open, 0 new, 0 closed',
    '  ✗ lever:b: HTTP 500 from Lever',
    '  ✓ greenhouse:c (C): 4 open, 1 new, 0 closed',
    'market: 1 board(s) failed and were skipped; their postings were NOT closed:',
    '  lever:b: HTTP 500 from Lever',
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
  assert.match(h.sent[0], /1 problem\(s\)/);
  assert.match(h.sent[0], /scan: market: 1 board\(s\) failed/);
  assert.match(h.sent[0], /lever:b: HTTP 500/);
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
  assert.match(h.sent[0], /2 problem\(s\)/);
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

test('summarize lists every problem', () => {
  const s = summarize('2026-11-03', [{ step: 'scan', detail: 'a' }, { step: 'backup', detail: 'b' }], 'L');
  assert.equal(s, 'career-ops daily run 2026-11-03: 2 problem(s).\n• scan: a\n• backup: b\nFull log: L');
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
  const run = async (cmd, args) => { calls.push([cmd.split('/').pop(), ...args]); return cmd.endsWith('market.sh') ? { code: 1, out: 'market: 1 board(s) failed' } : { code: 0, out: 'ok' }; };
  const steps = defaultSteps({ dataDir: d, date: '2026-11-03', run, icloud: () => '/Users/me/Documents' });
  const results = [];
  for (const s of steps) results.push(await s.go());
  assert.deepEqual(calls, [['market.sh', 'scan'], ['tier-new.sh']]);
  assert.deepEqual(results.map((r) => r.ok), [false, true, true]);
  assert.ok(existsSync(join(d, 'backups', 'market-2026-11-03.db')));
  assert.deepEqual(readdirSync(join(d, 'backups')), ['market-2026-11-03.db']);
  assert.match(results[2].out, /dated backups reach iCloud through the synced \/Users\/me\/Documents folder/);
});

test('backup step fails (and so is reported) when the folder is not iCloud-synced', async () => {
  const d = mkdtempSync(join(tmpdir(), 'daily-'));
  mkdirSync(join(d, 'data'));
  const db = new DatabaseSync(join(d, 'data', 'market.db')); db.exec('CREATE TABLE t (x)'); db.close();
  const step = defaultSteps({ dataDir: d, date: '2026-11-03', icloud: () => { throw new Error('backup: x is not in an iCloud-synced folder'); } })[2];
  const sent = [];
  const r = await runDaily({ date: '2026-11-03', steps: [step], log: () => {}, notify: async (t) => { sent.push(t); }, logPath: 'L' });
  assert.equal(r.problems.length, 1);
  assert.match(sent[0], /backup: backup: x is not in an iCloud-synced folder/);
});

test('localDate is YYYY-MM-DD', () => assert.match(localDate(new Date(2026, 10, 3)), /^2026-11-03$/));

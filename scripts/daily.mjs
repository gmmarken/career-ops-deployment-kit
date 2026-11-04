// Daily unattended run (D53): board scan → tier new roles → back up market.db.
// Every step runs even if an earlier one failed (one failing source must not stop the others),
// and every failure is written to the run log AND sent to Gabriel by iMessage. No retries,
// no substitute data. Exit code: 0 all good, 1 something failed, 2 couldn't even report.
//
// Usage (through scripts/daily.sh): daily.sh [--test-message]
import { spawn, execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDb, prune, iCloudRoot, KEEP } from '../market/backup.mjs';

const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STEP_TIMEOUT_MS = 2 * 60 * 60 * 1000; // a hung step is reported as a failure, not waited on forever
const MAX_DETAIL = 700; // keep the iMessage readable; the full text is in the log

/** Today's date on this Mac's clock, YYYY-MM-DD. */
export const localDate = (d = new Date()) => d.toLocaleDateString('en-CA');

/** Read private/config/daily.json. imessage_to is required; nothing is guessed. */
export function loadConfig(dataDir) {
  const path = join(dataDir, 'config', 'daily.json');
  if (!existsSync(path)) throw new Error(`${path} not found. Create it with {"imessage_to": "<your iMessage phone or email>"}.`);
  let cfg;
  try { cfg = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
  if (typeof cfg.imessage_to !== 'string' || !cfg.imessage_to.trim()) throw new Error(`${path}: "imessage_to" is missing or empty.`);
  if ('icloud_dir' in cfg) throw new Error(`${path}: "icloud_dir" is no longer used (D59: backups reach iCloud through the synced workspace folder). Remove it.`);
  for (const k of ['tier_per_day', 'tier_per_company']) {
    if (!Number.isInteger(cfg[k]) || cfg[k] < 1) throw new Error(`${path}: "${k}" must be a whole number of at least 1 (D67: how many roles the daily run grades, in all and per company).`);
  }
  return cfg;
}

/** Run a command, capturing its output. Resolves with {code, out}; never rejects. */
export function runCommand(cmd, args, { cwd = KIT_DIR, timeoutMs = STEP_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { out += `\n[daily] step timed out after ${timeoutMs / 60000} min and was stopped\n`; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: 127, out: `${out}\n[daily] could not start ${cmd}: ${err.message}\n` }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code: code ?? (signal ? 128 : 1), out }); });
  });
}

/** The lines worth showing in a notice: the error block a step printed, else its last lines. */
export function failureDetail(out) {
  const lines = String(out).trimEnd().split('\n');
  const at = lines.findIndex((l) => /^(market|tier-new|backup|daily):|\[daily\]/.test(l));
  const pick = at >= 0 ? lines.slice(at) : lines.slice(-5);
  const text = pick.join('\n').trim() || '(no output)';
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text;
}

/** "Tue Nov 3" from "2026-11-03" (local date, no time zone shifts). */
export function shortDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * The failure text (D63): loud on purpose, so it can't be mistaken for the morning summary.
 */
export function summarize(date, problems, logPath) {
  const head = `🚨🚨 JOB SEARCH RUN FAILED 🚨🚨\n${shortDate(date)}: ${problems.length} problem${problems.length === 1 ? '' : 's'}. Action needed.`;
  const body = problems.map((p) => `❌ ${p.step}: ${p.detail}`).join('\n');
  return `${head}\n${body}\nFull log: ${logPath}`;
}

/**
 * What the morning run found, read from the steps' own output lines. Missing lines stay
 * missing (null): the message then says it couldn't read that count, never a made-up 0.
 */
export function runFacts(outputs) {
  const scan = String(outputs.scan ?? '');
  const tier = String(outputs['tier-new'] ?? '');
  const boardsM = scan.match(/^Scanning (\d+) board/m);
  const boardLines = [...scan.matchAll(/^\s*✓ \S+ \(.*\): \d+ open, (\d+) new, \d+ closed$/gm)];
  const queued = tier.match(/^(\d+) untiered NYC role/m);
  const waiting = tier.match(/^(\d+) role\(s\) wait for a later run/m);
  const paused = tier.match(/^Paused: Claude usage limit reached after (\d+) of (\d+) graded; (\d+) left/m);
  const graded = [...tier.matchAll(/^\s*\[\d+\/\d+\] (S|A|B|C|Walk-away|Excluded)\s+(.+)$/gm)].map((m) => ({ tier: m[1], role: m[2].trim() }));
  return {
    boards: boardsM ? Number(boardsM[1]) : null,
    newPostings: boardLines.length ? boardLines.reduce((n, m) => n + Number(m[1]), 0) : (boardsM ? 0 : null),
    queued: queued ? Number(queued[1]) : null,
    waiting: waiting ? Number(waiting[1]) : 0,
    paused: paused ? { graded: Number(paused[1]), of: Number(paused[2]), left: Number(paused[3]) } : null,
    graded,
  };
}

const TIER_ORDER = ['S', 'A', 'B', 'C', 'Walk-away', 'Excluded'];
const MAX_LISTED = 6;

/** The success text (D63): a calm morning summary and a nudge to go apply. */
export function successSummary(date, outputs) {
  const f = runFacts(outputs);
  // Paused on the Claude usage limit (D68): nothing is broken, but it needs your eye.
  const lines = f.paused
    ? [`🚨 ⏳ Job search: grading PAUSED (${shortDate(date)})`, `Claude usage limit hit after ${f.paused.graded} of ${f.paused.of} roles. Nothing is broken; the rest are graded on the next run.`]
    : [`✅ Job search: morning run done (${shortDate(date)})`];
  lines.push(f.boards == null ? 'Boards: couldn\'t read the count (see log)' : `${f.boards} boards checked · ${f.newPostings} new postings`);
  if (f.queued == null) lines.push('New roles: couldn\'t read the count (see log)');
  else if (!f.graded.length) lines.push('No new NYC roles to grade today.');
  else {
    const counts = TIER_ORDER.map((t) => [t, f.graded.filter((g) => g.tier === t).length]).filter(([, n]) => n);
    lines.push(`${f.graded.length} new NYC role${f.graded.length === 1 ? '' : 's'} graded: ${counts.map(([t, n]) => `${n} ${t}`).join(' · ')}`);
    const top = f.graded.filter((g) => g.tier === 'S' || g.tier === 'A');
    for (const g of top.slice(0, MAX_LISTED)) lines.push(`${g.tier === 'S' ? '⭐ S' : '• A'}: ${g.role}`);
    if (top.length > MAX_LISTED) lines.push(`…and ${top.length - MAX_LISTED} more S&A in Notion`);
  }
  const wait = f.waiting + (f.paused?.left ?? 0);
  if (wait) lines.push(`⏳ ${wait} more NYC role${wait === 1 ? '' : 's'} waiting; graded over the next runs`);
  lines.push(f.graded.some((g) => g.tier === 'S' || g.tier === 'A') ? 'Time to review in Notion and apply.' : 'Check Notion when you have a minute.');
  return lines.join('\n');
}

/** Send an iMessage through Messages.app. The text and handle go in as arguments, never pasted into the script. */
export function sendIMessage(to, text) {
  const script = [
    'on run argv',
    'tell application "Messages"',
    'set svc to 1st account whose service type = iMessage',
    'send (item 1 of argv) to participant (item 2 of argv) of svc',
    'end tell',
    'end run',
  ];
  const args = script.flatMap((l) => ['-e', l]).concat(['--', text, to]);
  return new Promise((resolve, reject) => {
    execFile('osascript', args, { timeout: 60000 }, (err, _o, stderr) => {
      if (err?.killed) reject(new Error('iMessage send failed: Messages did not answer within 60 s. If macOS is asking to let the app control Messages, click Allow (System Settings → Privacy & Security → Automation).'));
      else if (err) reject(new Error(`iMessage send failed: ${(stderr || `osascript exited with code ${err.code}`).trim()}`));
      else resolve();
    });
  });
}

/** The three daily steps. Each returns {ok, out}. */
export function defaultSteps({ dataDir, date, cfg, run = runCommand, icloud = iCloudRoot }) {
  if (!cfg) throw new Error('defaultSteps needs the daily settings (cfg).');
  const tierArgs = ['--limit', String(cfg.tier_per_day), '--per-company', String(cfg.tier_per_company)];
  return [
    { name: 'scan', go: async () => { const r = await run(join(KIT_DIR, 'scripts', 'market.sh'), ['scan']); return { ok: r.code === 0, out: r.out }; } },
    { name: 'tier-new', go: async () => { const r = await run(join(KIT_DIR, 'scripts', 'tier-new.sh'), tierArgs); return { ok: r.code === 0, out: r.out }; } },
    { name: 'backup', go: async () => {
      const dir = join(dataDir, 'backups');
      const file = backupDb(join(dataDir, 'data', 'market.db'), dir, date);
      const gone = prune(dir, KEEP);
      const root = icloud(dir); // throws (reported as a failure) if the folder isn't iCloud-synced
      return { ok: true, out: `backup: wrote ${file}; removed ${gone.length} old cop${gone.length === 1 ? 'y' : 'ies'}; dated backups reach iCloud through the synced ${root} folder\n` };
    } },
  ];
}

/**
 * Run every step, log everything, report any failure. Returns {problems, notified}.
 * `log(text)` appends to the run log; `notify(text)` sends the notice.
 */
export async function runDaily({ date, steps, log, notify, logPath }) {
  const problems = [];
  const outputs = {};
  log(`\n===== daily run ${date} started ${new Date().toISOString()} =====\n`);
  for (const step of steps) {
    log(`\n--- ${step.name} ---\n`);
    let res;
    try { res = await step.go(); } catch (err) { res = { ok: false, out: `${step.name}: ${err.message}\n` }; }
    outputs[step.name] = res.out;
    log(res.out.endsWith('\n') ? res.out : `${res.out}\n`);
    if (!res.ok) problems.push({ step: step.name, detail: failureDetail(res.out) });
    log(`--- ${step.name}: ${res.ok ? 'ok' : 'FAILED'} ---\n`);
  }
  // Every run sends one text (D63): the loud failure notice, or the morning summary.
  if (problems.length) {
    await notify(summarize(date, problems, logPath));
    log(`\nFailure notice sent (${problems.length} problem(s)).\n`);
  } else {
    await notify(successSummary(date, outputs));
    log('\nMorning summary sent.\n');
  }
  const notified = true;
  log(`===== daily run ${date} finished ${new Date().toISOString()}: ${problems.length ? 'FAILED' : 'ok'} =====\n`);
  return { problems, notified };
}

async function main() {
  const dataDir = process.env.CAREER_OPS_DATA_DIR;
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set. Run through scripts/daily.sh.');
  const date = localDate();
  const logDir = join(dataDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `daily-${date}.log`);
  const log = (t) => { appendFileSync(logPath, t); process.stdout.write(t); };
  const cfg = loadConfig(dataDir);
  const notify = (text) => sendIMessage(cfg.imessage_to, text);

  if (process.argv.includes('--test-message')) {
    await notify(`career-ops daily run: test message (${date}). If you see this, the daily texts will reach you.`);
    console.log('Test message sent.');
    return 0;
  }
  if (process.argv.includes('--sample-messages')) {
    // Send one example of each daily text, so you can see how they look side by side.
    const sample = {
      scan: 'Scanning 52 board(s)…\n  ✓ rippling:pace (Pace): 13 open, 1 new, 0 closed\n  ✓ ashby:sierra (Sierra): 219 open, 3 new, 0 closed\n',
      'tier-new': '4 untiered NYC role(s) to tier; tiering 4.\n  [1/4] S         Pace — Deployment Strategist\n  [2/4] A         Stripe — GTM Strategy & Operations Analyst\n  [3/4] C         Notion — Commercial Solutions Consultant\n  [4/4] B         Plaid — Business Operations\n',
    };
    await notify(`(SAMPLE, not a real run)\n${successSummary(date, sample)}`);
    await notify(`(SAMPLE, not a real run)\n${summarize(date, [{ step: 'scan', detail: 'ashby:example: Could not reach https://api.ashbyhq.com/…: fetch failed' }], '/…/private/logs/daily-' + date + '.log')}`);
    console.log('Two sample messages sent.');
    return 0;
  }
  const { problems } = await runDaily({ date, steps: defaultSteps({ dataDir, date, cfg }), log, notify, logPath });
  return problems.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((err) => {
    // Couldn't run or couldn't report: leave it in the log (if possible) and on stderr for launchd's log.
    let msg = `daily: ${err.message}\n`;
    try {
      const d = process.env.CAREER_OPS_DATA_DIR;
      if (d) { mkdirSync(join(d, 'logs'), { recursive: true }); appendFileSync(join(d, 'logs', `daily-${localDate()}.log`), `\n${msg}`); }
    } catch (logErr) { msg += `daily: also could not write the run log: ${logErr.message}\n`; }
    process.stderr.write(msg);
    process.exit(2);
  });
}

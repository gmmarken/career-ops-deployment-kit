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
import { backupDb, prune, offsite, KEEP } from '../market/backup.mjs';

const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STEP_TIMEOUT_MS = 2 * 60 * 60 * 1000; // a hung step is reported as a failure, not waited on forever
const MAX_DETAIL = 700; // keep the iMessage readable; the full text is in the log

/** Today's date on this Mac's clock, YYYY-MM-DD. */
export const localDate = (d = new Date()) => d.toLocaleDateString('en-CA');

/** Read private/config/daily.json. Both fields are required; nothing is guessed. */
export function loadConfig(dataDir) {
  const path = join(dataDir, 'config', 'daily.json');
  if (!existsSync(path)) throw new Error(`${path} not found. Create it with {"imessage_to": "<your iMessage phone or email>", "icloud_dir": "<iCloud Drive folder for the offsite backup>"}.`);
  let cfg;
  try { cfg = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
  for (const k of ['imessage_to', 'icloud_dir']) {
    if (typeof cfg[k] !== 'string' || !cfg[k].trim()) throw new Error(`${path}: "${k}" is missing or empty.`);
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

/** Build the iMessage text for a run with problems. */
export function summarize(date, problems, logPath) {
  const head = `career-ops daily run ${date}: ${problems.length} problem(s).`;
  const body = problems.map((p) => `• ${p.step}: ${p.detail}`).join('\n');
  return `${head}\n${body}\nFull log: ${logPath}`;
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
      if (err) reject(new Error(`iMessage send failed: ${(stderr || err.message).trim()}`));
      else resolve();
    });
  });
}

/** The three daily steps. Each returns {ok, out}. */
export function defaultSteps({ dataDir, cfg, date, run = runCommand }) {
  return [
    { name: 'scan', go: async () => { const r = await run(join(KIT_DIR, 'scripts', 'market.sh'), ['scan']); return { ok: r.code === 0, out: r.out }; } },
    { name: 'tier-new', go: async () => { const r = await run(join(KIT_DIR, 'scripts', 'tier-new.sh'), []); return { ok: r.code === 0, out: r.out }; } },
    { name: 'backup', go: async () => {
      const dir = join(dataDir, 'backups');
      const file = backupDb(join(dataDir, 'data', 'market.db'), dir, date);
      const gone = prune(dir, KEEP);
      const off = offsite(file, cfg.icloud_dir);
      return { ok: true, out: `backup: wrote ${file}; offsite copy ${off}; removed ${gone.length} old cop${gone.length === 1 ? 'y' : 'ies'}\n` };
    } },
  ];
}

/**
 * Run every step, log everything, report any failure. Returns {problems, notified}.
 * `log(text)` appends to the run log; `notify(text)` sends the notice.
 */
export async function runDaily({ date, steps, log, notify, logPath }) {
  const problems = [];
  log(`\n===== daily run ${date} started ${new Date().toISOString()} =====\n`);
  for (const step of steps) {
    log(`\n--- ${step.name} ---\n`);
    let res;
    try { res = await step.go(); } catch (err) { res = { ok: false, out: `${step.name}: ${err.message}\n` }; }
    log(res.out.endsWith('\n') ? res.out : `${res.out}\n`);
    if (!res.ok) problems.push({ step: step.name, detail: failureDetail(res.out) });
    log(`--- ${step.name}: ${res.ok ? 'ok' : 'FAILED'} ---\n`);
  }
  let notified = false;
  if (problems.length) {
    await notify(summarize(date, problems, logPath));
    notified = true;
    log(`\nNotice sent (${problems.length} problem(s)).\n`);
  }
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
    await notify(`career-ops daily run: test message (${date}). If you see this, failure notices will reach you.`);
    console.log('Test message sent.');
    return 0;
  }
  const { problems } = await runDaily({ date, steps: defaultSteps({ dataDir, cfg, date }), log, notify, logPath });
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

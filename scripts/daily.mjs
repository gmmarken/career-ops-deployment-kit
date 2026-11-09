// Daily unattended run (D53): board scan → tier new roles → Company Radar (Form D, funding news,
// company research; Phase 6) → the Sunday email (Phase 7) → back up market.db.
// A midday run (--midday, D79) only scans and grades roles first seen today.
// Every new S-tier role gets its own text as soon as grading finishes (D78).
// Every step runs even if an earlier one failed (one failing source must not stop the others),
// and every failure is written to the run log AND sent to Gabriel by iMessage. No retries,
// no substitute data. Exit code: 0 all good, 1 something failed, 2 couldn't even report.
//
// Usage (through scripts/daily.sh): daily.sh [--midday | --test-message | --sample-messages | --sample-email]
import { spawn, execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDb, prune, iCloudRoot, KEEP } from '../market/backup.mjs';
import { openStore } from '../market/store.mjs';
import { weeklyData, weeklyEmail } from '../delivery/weekly.mjs';
import { sendMail } from '../delivery/mail.mjs';
import { checkPackConfig } from '../packs/queue.mjs';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
  if (!Number.isInteger(cfg.research_per_day) || cfg.research_per_day < 0) throw new Error(`${path}: "research_per_day" must be a whole number, 0 or more (D76: how many companies the daily run researches for Company Radar).`);
  const w = cfg.weekly_email;
  if (!w || typeof w !== 'object') throw new Error(`${path}: "weekly_email" is missing. Add {"to": "<your email>", "day": "Sunday"} (D81).`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(w.to ?? ''))) throw new Error(`${path}: weekly_email.to must be your email address.`);
  if (!WEEKDAYS.includes(w.day)) throw new Error(`${path}: weekly_email.day must be a day name like "Sunday".`);
  if (typeof cfg.reminders_list !== 'string' || !cfg.reminders_list.trim()) throw new Error(`${path}: "reminders_list" is missing. Add "reminders_list": "Job Search Alerts" (D95: the Reminders list that makes alerts pop up on your phone).`);
  try { checkPackConfig(cfg.packs); } catch (e) { throw new Error(`${path}: ${e.message.replace(/^private\/config\/daily\.json /, '')}`); }
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
  const at = lines.findIndex((l) => /^(market|tier-new|backup|weekly|daily):|\[daily\]/.test(l));
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
 * Roles graded in this run are still listed (D78): a broken board shouldn't hide a good role.
 */
export function summarize(date, problems, logPath, outputs = {}, { midday = false } = {}) {
  const head = `🚨🚨 JOB SEARCH RUN FAILED 🚨🚨\n${midday ? 'Midday run, ' : ''}${shortDate(date)}: ${problems.length} problem${problems.length === 1 ? '' : 's'}. Action needed.`;
  const body = problems.map((p) => `❌ ${p.step}: ${p.detail}`).join('\n');
  const top = runFacts(outputs).graded.filter((g) => g.tier === 'S' || g.tier === 'A');
  const roles = top.length
    ? `\nGraded this run anyway (in Notion):\n${top.slice(0, MAX_LISTED).map((g) => `${g.tier === 'S' ? '⭐ S' : '• A'}: ${g.role}`).join('\n')}${top.length > MAX_LISTED ? `\n…and ${top.length - MAX_LISTED} more S&A in Notion` : ''}`
    : '';
  return `${head}\n${body}${roles}\nFull log: ${logPath}`;
}

/** New S-tier roles a grading run found, from the "⭐ alert:" line it prints under each (D78). */
export function sAlerts(tierOut) {
  return [...String(tierOut).matchAll(/^\s*\[\d+\/\d+\] S\s+(.+)\n\s*⭐ alert: (.+) · (\S+)\s*$/gm)]
    .map((m) => ({ role: m[1].trim(), pay: m[2].trim(), url: m[3] }));
}

/** A prep pack built by the midday run gets its own text (D89); the morning summary lists the morning's. */
export function packText(role) {
  return `📦 Prep pack ready: ${role}\nIt's in Notion (open the role's page) and in private/output/packs on your Mac. Read the tailored CV line by line before applying.`;
}

/** One S-tier role's own text (D78). */
export function alertText(a) {
  return `⭐ New S-tier role: ${a.role}\n${a.pay}\n${a.url}\nApply early. It's in Notion with the full grade.`;
}

/**
 * What the morning run found, read from the steps' own output lines. Missing lines stay
 * missing (null): the message then says it couldn't read that count, never a made-up 0.
 */
export function runFacts(outputs) {
  const scan = String(outputs.scan ?? '');
  const tier = String(outputs['tier-new'] ?? '');
  const boardsM = scan.match(/^Scanning (\d+) board/m);
  const boardLines = [...scan.matchAll(/^\s*✓ \S+ \(.*\): \d+ open, (\d+) new, \d+ closed(?: \(on the retry\))?$/gm)];
  const queued = tier.match(/^(\d+) untiered NYC role/m);
  const waiting = tier.match(/^(\d+) role\(s\) wait for a later run/m);
  const paused = tier.match(/^Paused: Claude usage limit reached after (\d+) of (\d+) graded; (\d+) left/m);
  const radar = String(outputs.radar ?? '');
  const funded = radar.match(/^Newly funded NYC companies \((\d+)\): (.+)$/m);
  const researchPaused = /^Paused: Claude usage limit reached after \d+ of \d+ researched/m.test(radar);
  const retired = scan.match(/^Retired (\d+) job board\(s\) that no longer exist: (.+)$/m);
  const notFound = scan.match(/^Not found \(retired after \d+ runs in a row\): (.+)$/m);
  const unreachable = scan.match(/^Unreachable after a retry \(.*?\): (.+)$/m);
  const vcUnreachable = scan.match(/^VC job lists unreachable after a retry \(.*?\): (.+)$/m);
  const weekly = /^weekly: sent /m.test(String(outputs['weekly-email'] ?? ''));
  const packs = String(outputs.packs ?? '');
  const packsReady = [...packs.matchAll(/^📦 Prep pack ready: (.+?) · /gm)].map((m) => m[1]);
  const packsQueued = packs.match(/^Prep packs done: .* (\d+) queued$/m);
  const packsPaused = /^Paused: Claude usage limit reached after \d+ of \d+ packs/m.test(packs);
  const graded = [...tier.matchAll(/^\s*\[\d+\/\d+\] (S|A|B|C|Walk-away|Excluded)\s+(.+)$/gm)].map((m) => ({ tier: m[1], role: m[2].trim() }));
  return {
    boards: boardsM ? Number(boardsM[1]) : null,
    newPostings: boardLines.length ? boardLines.reduce((n, m) => n + Number(m[1]), 0) : (boardsM ? 0 : null),
    queued: queued ? Number(queued[1]) : null,
    waiting: waiting ? Number(waiting[1]) : 0,
    paused: paused ? { graded: Number(paused[1]), of: Number(paused[2]), left: Number(paused[3]) } : null,
    graded,
    funded: funded ? { count: Number(funded[1]), names: funded[2].split(' · ').map((x) => x.replace(/\s*\(.*\)$/, '')) } : null,
    researchPaused,
    retired: retired ? { count: Number(retired[1]), names: retired[2] } : null,
    notFound: notFound ? notFound[1].split(' · ') : [],
    unreachable: unreachable ? unreachable[1].split(' · ') : [],
    vcUnreachable: vcUnreachable ? vcUnreachable[1].split(' · ') : [],
    weekly,
    packsReady,
    packsQueued: packsQueued ? Number(packsQueued[1]) : null,
    packsPaused,
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
  if (f.funded) {
    const shown = f.funded.names.slice(0, 3).join(', ');
    lines.push(`🆕 ${f.funded.count} newly funded NYC compan${f.funded.count === 1 ? 'y' : 'ies'}: ${shown}${f.funded.count > 3 ? `, +${f.funded.count - 3} more` : ''} (Company Radar)`);
  }
  if (f.researchPaused) lines.push('⏳ Company research paused at the Claude usage limit; it continues next run');
  if (f.notFound.length) lines.push(`⚠️ ${f.notFound.length} job board${f.notFound.length === 1 ? '' : 's'} not found (retired after 3 runs in a row): ${f.notFound.join(', ')}`);
  if (f.unreachable.length) lines.push(`⚠️ ${f.unreachable.length} job board${f.unreachable.length === 1 ? '' : 's'} couldn't connect, even on a retry; checked again next run: ${f.unreachable.join(', ')}`);
  if (f.vcUnreachable.length) lines.push(`⚠️ ${f.vcUnreachable.length} VC job list${f.vcUnreachable.length === 1 ? '' : 's'} couldn't connect, even on a retry; checked again next run: ${f.vcUnreachable.join(', ')}`);
  if (f.retired) lines.push(`🗑 Retired ${f.retired.count} job board${f.retired.count === 1 ? '' : 's'} that no longer exist${f.retired.count === 1 ? 's' : ''} (not found 3 runs in a row): ${f.retired.names}`);
  if (f.packsReady.length) lines.push(`📦 ${f.packsReady.length} prep pack${f.packsReady.length === 1 ? '' : 's'} ready: ${f.packsReady.join('; ')} (Notion → Prep pack)`);
  if (f.packsPaused) lines.push('⏳ Prep packs paused at the Claude usage limit; they continue next run');
  if (f.packsQueued) lines.push(`🗂 ${f.packsQueued} more prep pack${f.packsQueued === 1 ? '' : 's'} queued`);
  if (f.weekly) lines.push('📧 Weekly email sent to you');
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

/**
 * Add a reminder, due now, to a Reminders list (D95). Texts to your own number never notify,
 * so the alerts that matter (⭐ S role, 🚨 failure, 📦 pack) also become a reminder, which iCloud
 * syncs to the phone with a notification. The list is created if it doesn't exist.
 */
export function addReminder(list, text) {
  const [title, ...rest] = String(text).split('\n');
  const script = [
    'on run argv',
    'set listName to item 1 of argv',
    'tell application "Reminders"',
    'if not (exists list listName) then make new list with properties {name:listName}',
    'make new reminder at end of list listName with properties {name:(item 2 of argv), body:(item 3 of argv), remind me date:(current date)}',
    'end tell',
    'end run',
  ];
  const args = script.flatMap((l) => ['-e', l]).concat(['--', list, title, rest.join('\n')]);
  return new Promise((resolve, reject) => {
    execFile('osascript', args, { timeout: 60000 }, (err, _o, stderr) => {
      if (err?.killed) reject(new Error('Reminder not created: Reminders did not answer within 60 s. If macOS is asking to let the app control Reminders, click Allow (System Settings → Privacy & Security → Automation).'));
      else if (err) reject(new Error(`Reminder not created: ${(stderr || `osascript exited with code ${err.code}`).trim()}`));
      else resolve();
    });
  });
}

/** Build and send the weekly email (D81). Returns the step's output line. */
export async function sendWeekly({ dataDir, cfg, now = new Date(), send = sendMail, sample = false }) {
  const store = openStore(join(dataDir, 'data', 'market.db'));
  let email;
  try { email = weeklyEmail(weeklyData(store, { now })); } finally { store.close(); }
  const subject = sample ? `(SAMPLE) ${email.subject}` : email.subject;
  await send(cfg.weekly_email.to, subject, email.text);
  return `weekly: sent "${subject}" (${email.text.split('\n').length} lines)\n`;
}

/** Is today the weekly email's day? `date` is YYYY-MM-DD on this Mac's clock. */
export function isWeeklyDay(date, day) {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()] === day;
}

/** The run's steps. Each returns {ok, out}. Midday (D79): scan, then grade roles first seen today. */
export function defaultSteps({ dataDir, date, cfg, run = runCommand, icloud = iCloudRoot, midday = false, weekly = sendWeekly }) {
  if (!cfg) throw new Error('defaultSteps needs the daily settings (cfg).');
  const tierArgs = ['--limit', String(cfg.tier_per_day), '--per-company', String(cfg.tier_per_company), ...(midday ? ['--seen-since', date] : [])];
  const scanAndGrade = [
    { name: 'scan', go: async () => { const r = await run(join(KIT_DIR, 'scripts', 'market.sh'), ['scan']); return { ok: r.code === 0, out: r.out }; } },
    { name: 'tier-new', go: async () => { const r = await run(join(KIT_DIR, 'scripts', 'tier-new.sh'), tierArgs); return { ok: r.code === 0, out: r.out }; } },
  ];
  // Prep packs (D85, D89): after grading and research, in both runs, sharing one daily allowance.
  const packs = { name: 'packs', go: async () => { const r = await run(join(KIT_DIR, 'scripts', 'packs.sh'), ['build']); return { ok: r.code === 0, out: r.out }; } };
  if (midday) return [...scanAndGrade, packs];
  return [
    ...scanAndGrade,
    // After grading, so grading keeps first claim on the Claude plan (D67, D76).
    { name: 'radar', go: async () => { const r = await run(join(KIT_DIR, 'scripts', 'market.sh'), ['radar', '--research', String(cfg.research_per_day)]); return { ok: r.code === 0, out: r.out }; } },
    packs,
    ...(isWeeklyDay(date, cfg.weekly_email.day) ? [{ name: 'weekly-email', go: async () => ({ ok: true, out: await weekly({ dataDir, cfg }) }) }] : []),
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
export async function runDaily({ date, steps, log, notify, logPath, midday = false, remind = null }) {
  // An alert that should pop up on the phone: a reminder as well as the text (D95). A reminder that
  // can't be created is a reported problem, never a quiet one.
  const popUp = async (text, what) => {
    if (!remind) return;
    try { await remind(text); log(`Reminder added: ${what}\n`); } catch (err) { problems.push({ step: 'reminder', detail: `${what}: ${err.message}` }); log(`Reminder FAILED: ${what}: ${err.message}\n`); }
  };
  const problems = [];
  const outputs = {};
  const kind = midday ? 'midday run' : 'daily run';
  log(`\n===== ${kind} ${date} started ${new Date().toISOString()} =====\n`);
  for (const step of steps) {
    log(`\n--- ${step.name} ---\n`);
    let res;
    try { res = await step.go(); } catch (err) { res = { ok: false, out: `${step.name}: ${err.message}\n` }; }
    outputs[step.name] = res.out;
    log(res.out.endsWith('\n') ? res.out : `${res.out}\n`);
    if (!res.ok) problems.push({ step: step.name, detail: failureDetail(res.out) });
    log(`--- ${step.name}: ${res.ok ? 'ok' : 'FAILED'} ---\n`);
    // Each new S-tier role gets its own text right away (D78). A text that can't be sent is a problem, reported below.
    if (step.name === 'tier-new') {
      for (const a of sAlerts(res.out)) {
        try { await notify(alertText(a)); log(`S-tier text sent: ${a.role}\n`); } catch (err) { problems.push({ step: 'S-tier text', detail: `${a.role}: ${err.message}` }); log(`S-tier text FAILED: ${a.role}: ${err.message}\n`); }
        await popUp(alertText(a), `S-tier ${a.role}`);
      }
    }
    if (step.name === 'packs') {
      for (const role of runFacts({ packs: res.out }).packsReady) {
        // The morning summary lists the morning's packs; the midday run texts each one (D89).
        if (midday) { try { await notify(packText(role)); log(`Pack text sent: ${role}\n`); } catch (err) { problems.push({ step: 'pack text', detail: `${role}: ${err.message}` }); log(`Pack text FAILED: ${role}: ${err.message}\n`); } }
        await popUp(packText(role), `pack ${role}`);
      }
    }
  }
  // The morning run sends one summary text (D63); the midday run texts only on a new S role or a failure (D79).
  if (problems.length) {
    const notice = summarize(date, problems, logPath, outputs, { midday });
    await notify(notice);
    log(`\nFailure notice sent (${problems.length} problem(s)).\n`);
    if (remind) { try { await remind(notice); log('Reminder added: failure notice\n'); } catch (err) { log(`Reminder FAILED: failure notice: ${err.message}\n`); } }
  } else if (!midday) {
    const summary = successSummary(date, outputs);
    // A paused run starts with 🚨: worth a pop-up too.
    if (summary.startsWith('🚨')) await popUp(summary, 'paused notice');
    await notify(summary);
    log('\nMorning summary sent.\n');
  } else log('\nMidday run: nothing wrong; no summary text (S-tier texts only).\n');
  const notified = true;
  log(`===== ${kind} ${date} finished ${new Date().toISOString()}: ${problems.length ? 'FAILED' : 'ok'} =====\n`);
  return { problems, notified };
}

/**
 * One run at a time (D79): a lock file with the running process id. Returns a release
 * function, or null if another run is still going. A lock left by a crashed run is cleared.
 */
export function takeLock(path, what, { alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
  if (existsSync(path)) {
    let held = null;
    try { held = JSON.parse(readFileSync(path, 'utf8')); } catch { held = null; } // unreadable = stale
    if (held && Number.isInteger(held.pid) && alive(held.pid)) return null;
  }
  writeFileSync(path, JSON.stringify({ pid: process.pid, what, at: new Date().toISOString() }));
  return () => { try { unlinkSync(path); } catch (err) { if (err.code !== 'ENOENT') throw err; } };
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
  const remind = (text) => addReminder(cfg.reminders_list, text);

  if (process.argv.includes('--test-message')) {
    await notify(`career-ops daily run: test message (${date}). If you see this, the daily texts will reach you.`);
    console.log('Test message sent.');
    await remind(`career-ops test alert (${date})\nIf this popped up on your phone, alerts will reach you. You can delete it.`);
    console.log(`Test reminder added to "${cfg.reminders_list}".`);
    return 0;
  }
  if (process.argv.includes('--sample-email')) {
    // The real weekly email from today's data, marked SAMPLE, to your own address (D81).
    console.log(await sendWeekly({ dataDir, cfg, sample: true }));
    return 0;
  }
  if (process.argv.includes('--sample-messages')) {
    // Send one example of each daily text, so you can see how they look side by side.
    const sample = {
      scan: 'Scanning 52 board(s)…\n  ✓ rippling:pace (Pace): 13 open, 1 new, 0 closed\n  ✓ ashby:sierra (Sierra): 219 open, 3 new, 0 closed\n',
      'tier-new': '4 untiered NYC role(s) to tier; tiering 4.\n  [1/4] S         Pace — Deployment Strategist\n  [2/4] A         Stripe — GTM Strategy & Operations Analyst\n  [3/4] C         Notion — Commercial Solutions Consultant\n  [4/4] B         Plaid — Business Operations\n',
      radar: 'Newly funded NYC companies (2): Minerva BI ($15M, Form D) · Clark ($11M, Seed, News)\n',
    };
    await notify(`(SAMPLE, not a real run)\n${successSummary(date, sample)}`);
    await notify(`(SAMPLE, not a real run)\n${alertText({ role: 'Pace — Deployment Strategist', pay: '$140K–$175K/yr', url: 'https://ats.rippling.com/pace/jobs/…' })}`);
    await notify(`(SAMPLE, not a real run)\n${summarize(date, [{ step: 'scan', detail: 'ashby:example: Could not reach https://api.ashbyhq.com/…: fetch failed' }], '/…/private/logs/daily-' + date + '.log')}`);
    console.log('Three sample messages sent.');
    return 0;
  }
  const midday = process.argv.includes('--midday');
  const release = takeLock(join(logDir, 'daily.lock'), midday ? 'midday' : 'morning');
  if (!release) {
    // Midday: the morning run is still going, so this one has nothing to add. Morning: something is stuck.
    if (midday) { log(`\n[daily] midday run ${date}: another run is still going; skipped.\n`); return 0; }
    throw new Error('another run is still going (private/logs/daily.lock). If none is, delete that file.');
  }
  try {
    const { problems } = await runDaily({ date, steps: defaultSteps({ dataDir, date, cfg, midday }), log, notify, logPath, midday, remind });
    return problems.length ? 1 : 0;
  } finally { release(); }
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

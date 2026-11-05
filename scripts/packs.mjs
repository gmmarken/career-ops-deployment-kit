#!/usr/bin/env node
// Prep packs (Phase 8). Run by the daily and midday runs (`build`), or by hand.
//   build [--dry-run]       refresh the queue (new S roles, Make pack ticks, closed roles), then
//                           build today's packs within the caps (D85) and update Notion
//   status                  list every pack and the queue order
//   requeue <link or key>   put a blocked or failed pack back in the queue
//   notes                   add a section to private/cv-projects.md for every cv.md line without one,
//                           and list the lines whose project notes are still empty (D90)
// Output lines the daily run reads: "📦 Prep pack ready: …", "🚫 Prep pack BLOCKED: …",
// "Prep packs: …", "Paused: Claude usage limit reached after …".
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseCv, sourceLines } from '../packs/cvsource.mjs';
import { loadProjectNotes, addMissingSections, linesWithoutNotes } from '../packs/projects.mjs';
import { openStore, urlKey } from '../market/store.mjs';
import { loadWatchlist } from '../extractor/research.mjs';
import { isUsageLimit } from '../extractor/claude.mjs';
import { createClient, readToken } from '../notion/client.mjs';
import { loadNotionConfig } from '../notion/setup.mjs';
import { loadConfig, localDate } from './daily.mjs';
import { rankQueue, allowance, checkPackConfig } from '../packs/queue.mjs';
import { buildPack, PACK_MODEL } from '../packs/build.mjs';
import { ensureJobsColumns, tickedRoles, jobPageId, setPackStatus, packBlocks, appendBlocks } from '../packs/notion.mjs';

const role = (r) => `${r.company} — ${r.title}`;

/** Queue new S roles and your Make pack ticks; drop queued roles that closed. Returns notes. */
export function refreshQueue(store, ticks) {
  const notes = [];
  const since = store.getMeta('packs_auto_since');
  if (!since) throw new Error('market.db has no packs_auto_since date; the v7 upgrade did not finish.');
  for (const id of store.newSRolesWithoutPack(since)) if (store.queuePack(id, 'auto')) notes.push(`queued (new S role): posting ${id}`);
  for (const t of ticks) {
    const id = store.postingByKey(t.key);
    if (!id) { notes.push(`Make pack is ticked on a Notion row the database doesn't know (${t.key}); skipped`); continue; }
    if (store.queuePack(id, 'you')) notes.push(`queued (you ticked Make pack): posting ${id}`);
  }
  for (const r of store.packs()) {
    if (r.status === 'queued' && r.closed_at) { store.setPack(r.posting_id, { status: 'dropped', detail: `role closed ${r.closed_at}` }); notes.push(`dropped (role closed): ${role(r)}`); }
  }
  return notes;
}

async function build({ dataDir, dry }) {
  const cfg = checkPackConfig(loadConfig(dataDir).packs);
  const notionCfg = loadNotionConfig(dataDir);
  const client = createClient(readToken(dataDir));
  const added = await ensureJobsColumns(client, notionCfg);
  if (added.length) console.log(`Notion: added Job Postings column(s): ${added.join(', ')}`);
  const ticks = await tickedRoles(client, notionCfg);

  const store = openStore();
  const failed = [];
  const blocked = [];
  let paused = null;
  try {
    for (const n of refreshQueue(store, ticks)) console.log(`  · ${n}`);
    const rows = store.packs();
    const a = allowance(rows, cfg);
    const queue = rankQueue(rows.filter((r) => r.status === 'queued'));
    const todo = queue.slice(0, a.build);
    console.log(`Prep packs: ${a.waiting} waiting · ${a.builtToday} built today (cap ${a.dayCap}) · ${a.builtWeek} in the last 7 days (cap ${cfg.max_per_week}) · building ${todo.length}`);
    for (const [i, r] of queue.entries()) console.log(`  ${i < todo.length ? '→' : ' '} ${i + 1}. ${role(r)}${r.reason === 'you' ? ' (you ticked it)' : ''}`);
    if (dry) return 0;

    const wl = loadWatchlist();
    const date = localDate();
    let usage = 0;
    for (const [i, r] of todo.entries()) {
      try {
        const res = await buildPack(r, { dataDir, store, wl, date });
        usage += res.calls.reduce((s, c) => s + (c.cost_usd_equivalent ?? 0), 0);
        store.setPack(r.posting_id, { status: res.status, built_at: new Date().toISOString(), folder: res.folder, detail: res.detail });
        if (res.status === 'ready') console.log(`📦 Prep pack ready: ${role(r)} · ${res.folder}`);
        else { blocked.push(`${role(r)}: ${res.detail}`); console.log(`🚫 Prep pack BLOCKED: ${role(r)}: ${res.detail}`); }
        for (const w of res.warnings) console.log(`    worth a look: ${w}`);
      } catch (err) {
        // Usage limit (D68): the rest would fail too; they stay queued for the next run.
        if (isUsageLimit(err.message)) { paused = { done: i, of: todo.length }; break; }
        store.setPack(r.posting_id, { status: 'failed', detail: err.message.split('\n').slice(0, 3).join(' ') });
        failed.push(`${role(r)}: ${err.message.split('\n')[0]}`);
        console.log(`❌ Prep pack FAILED: ${role(r)}: ${err.message.split('\n')[0]}`);
      }
    }
    if (todo.length) console.log(`Pack AI calls: model ${PACK_MODEL}, ~$${usage.toFixed(2)} API-equivalent`);
    if (paused) console.log(`Paused: Claude usage limit reached after ${paused.done} of ${paused.of} packs; the rest stay queued.`);

    // Notion: status column for every changed row, and the pack's text on newly built ones.
    for (const r of store.packs()) {
      const contentDue = ['ready', 'blocked'].includes(r.status) && (!r.notion_content_at || r.notion_content_at < r.built_at);
      if (r.notion_status === r.status && !contentDue) continue;
      const pageId = await jobPageId(client, notionCfg, r.url_key);
      if (!pageId) throw new Error(`No Job Postings row in Notion for ${role(r)} (${r.url_key}). Run scripts/notion.sh sync, then this again.`);
      if (r.notion_status !== r.status) await setPackStatus(client, pageId, r.status);
      if (contentDue) await appendBlocks(client, pageId, packBlocks({ folder: r.folder, status: r.status, date: r.built_at.slice(0, 10), detail: r.detail }));
      store.setPack(r.posting_id, { notion_status: r.status, ...(contentDue ? { notion_content_at: new Date().toISOString() } : {}) });
    }
    const left = store.packs().filter((r) => r.status === 'queued').length;
    console.log(`Prep packs done: ${todo.length - failed.length - blocked.length - (paused ? paused.of - paused.done : 0)} ready · ${blocked.length} blocked · ${failed.length} failed · ${left} queued`);
  } finally { store.close(); }
  const bad = [...blocked.map((b) => `BLOCKED ${b}`), ...failed.map((f) => `FAILED ${f}`)];
  if (bad.length) throw new Error(`${bad.length} prep pack(s) need a look:\n  ${bad.join('\n  ')}`);
  return 0;
}

function status() {
  const store = openStore();
  try {
    const rows = store.packs();
    if (!rows.length) { console.log('No prep packs yet.'); return 0; }
    const order = rankQueue(rows.filter((r) => r.status === 'queued'));
    console.log(`Queue (${order.length}), in build order:`);
    for (const [i, r] of order.entries()) console.log(`  ${i + 1}. ${role(r)}${r.reason === 'you' ? ' (you ticked it)' : ''}`);
    for (const s of ['ready', 'blocked', 'failed', 'dropped']) {
      const list = rows.filter((r) => r.status === s);
      if (!list.length) continue;
      console.log(`${s[0].toUpperCase()}${s.slice(1)} (${list.length}):`);
      for (const r of list) console.log(`  · ${role(r)}${r.built_at ? ` (${r.built_at.slice(0, 10)})` : ''}${r.folder ? ` · ${r.folder}` : ''}${r.detail ? `\n      ${r.detail}` : ''}`);
    }
    return 0;
  } finally { store.close(); }
}

function requeue(target) {
  if (!target) throw new Error('Give the job link (or its Key from Notion): scripts/packs.sh requeue <link>');
  const store = openStore();
  try {
    let key = target;
    if (/^https?:\/\//.test(target)) key = urlKey(target);
    const id = store.postingByKey(key);
    if (!id) throw new Error(`No posting in the database for ${target}.`);
    store.requeuePack(id);
    console.log(`Queued again: posting ${id}. It's built on the next run, within the daily caps.`);
    return 0;
  } finally { store.close(); }
}

function notes(dataDir) {
  const path = join(dataDir, 'cv-projects.md');
  const lines = sourceLines(parseCv(readFileSync(join(dataDir, 'cv.md'), 'utf8')));
  const added = addMissingSections(path, lines, loadProjectNotes(path));
  if (added) console.log(`Added ${added} empty section(s) to ${path}.`);
  const empty = linesWithoutNotes(lines, loadProjectNotes(path));
  console.log(empty.length ? `${empty.length} cv.md line(s) still need project notes:\n${empty.map((l) => `  · ${l.text.slice(0, 100)}`).join('\n')}` : 'Every cv.md line has project notes.');
  return 0;
}

async function main() {
  const dataDir = process.env.CAREER_OPS_DATA_DIR;
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set. Run through scripts/packs.sh.');
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'build') return build({ dataDir, dry: process.argv.includes('--dry-run') });
  if (cmd === 'status') return status();
  if (cmd === 'requeue') return requeue(arg);
  if (cmd === 'notes') return notes(dataDir);
  throw new Error('Usage: scripts/packs.sh build [--dry-run] | status | requeue <job link> | notes');
}

if (process.argv[1] && join(process.argv[1]).endsWith(join('scripts', 'packs.mjs'))) {
  main().then((c) => process.exit(c)).catch((err) => { console.error(`packs: ${err.message}`); process.exit(1); });
}

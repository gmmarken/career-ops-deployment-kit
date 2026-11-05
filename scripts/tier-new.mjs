#!/usr/bin/env node
// Tier every open home-metro target-family posting that has no tier yet (found by
// market.sh scan). Same pipeline as tier.sh: hard facts (code) → judgment (claude, no
// tools) → company bar → tier (code) → market database → Notion (one sync at the end).
// A failed posting is reported and skipped; the run exits non-zero if any failed.
// Usage: scripts/tier-new.sh [--limit N] [--per-company N] [--seen-since YYYY-MM-DD] [--regrade S,A] [--dry-run]
// --regrade S,A: grade again the open NYC roles whose latest tier is one of these (after a rules or
// question change, D94), instead of untiered ones. Each re-grade is a new decision; history is kept.
// With a limit, the most relevant role families go first, at most --per-company per company (D67).
import { loadRules } from '../engine/rules.mjs';
import { decideTier } from '../engine/tier-engine.mjs';
import { gatherFacts, describeCalls } from './pipeline.mjs';
import { openStore } from '../market/store.mjs';
import { recordTiered } from '../market/record.mjs';
import { TARGET_FAMILIES } from '../market/classify.mjs';
import { pickBatch } from '../market/priority.mjs';
import { isUsageLimit } from '../extractor/claude.mjs';
import { pullCompanyEdits, syncAll } from '../notion/sync.mjs';
import { payText } from '../delivery/format.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const dataDir = process.env.CAREER_OPS_DATA_DIR;
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set. Run through scripts/tier-new.sh.');
  const num = (flag) => {
    if (arg(flag) === undefined) return Infinity;
    const n = Number(arg(flag));
    if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a whole number of at least 1.`);
    return n;
  };
  const limit = num('--limit');
  const perCompany = num('--per-company');
  const dry = process.argv.includes('--dry-run');
  // Midday run (D79): only roles first seen on or after this date, so the morning backlog waits for mornings.
  const since = arg('--seen-since');
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('--seen-since must be a date like 2026-11-05.');
  const rules = loadRules();
  let store = openStore();
  // Target-family titles, plus borderline titles whose text passed the no-AI check (D49).
  const wanted = (p) => TARGET_FAMILIES.has(p.title_family) || (p.title_family === 'borderline' && p.text_check === 'hit');
  const regrade = arg('--regrade')?.split(',').map((t) => t.trim()).filter(Boolean) ?? null;
  if (regrade && (!regrade.length || regrade.some((t) => !['S', 'A', 'B', 'C', 'Excluded', 'Walk-away'].includes(t)))) throw new Error('--regrade takes tiers like S,A');
  const todo = regrade
    ? store.postings().filter((p) => !p.closed_at && p.in_home_metro === true && p.url && regrade.includes(p.tier))
    : store.postings().filter((p) => !p.closed_at && p.in_home_metro === true && wanted(p) && p.url && !store.latestDecision(p.id) && (!since || p.first_seen.slice(0, 10) >= since));
  store.close();
  const batch = pickBatch(todo, { limit, perCompany });
  const caps = [limit < Infinity && `${limit} a run`, perCompany < Infinity && `${perCompany} per company`].filter(Boolean).join(', ');
  console.log(regrade
    ? `${todo.length} open NYC role(s) graded ${regrade.join('/')} to grade again; grading ${batch.length}${caps ? ` (cap: ${caps})` : ''}.`
    : `${todo.length} untiered NYC role(s) to tier (target-family titles + borderline titles that passed the text check); tiering ${batch.length}${caps ? ` (cap: ${caps})` : ''}.`);
  if (todo.length > batch.length) console.log(`${todo.length - batch.length} role(s) wait for a later run.`);
  for (const p of batch) console.log(`  · ${p.company} — ${p.title}`);
  if (dry || !batch.length) return;

  await pullCompanyEdits(dataDir);
  const calls = [];
  const done = [];
  const failed = [];
  let paused = false;
  for (const [i, p] of batch.entries()) {
    try {
      const { facts, calls: c } = await gatherFacts({ url: p.url }, { dataDir, rules });
      calls.push(...c);
      const result = decideTier(facts, rules);
      store = openStore();
      const { id } = recordTiered(store, facts, result, rules);
      store.close();
      done.push({ id, company: facts.company.name, title: facts.posting.title, tier: result.tier, flags: result.flags });
      console.log(`  [${i + 1}/${batch.length}] ${result.tier.padEnd(9)} ${facts.company.name} — ${facts.posting.title}`);
      // The daily run turns this line into its own S-tier text (D78).
      if (result.tier === 'S') console.log(`      ⭐ alert: ${payText(facts.posting.pay)} · ${facts.posting.url ?? p.url}`);
    } catch (err) {
      // Usage limit (D68): every remaining call would fail too, so stop; the rest wait.
      if (isUsageLimit(err.message)) { paused = true; break; }
      failed.push(`${p.company} — ${p.title}: ${err.message.split('\n')[0]}`);
      console.log(`  [${i + 1}/${batch.length}] FAILED   ${p.company} — ${p.title}: ${err.message.split('\n')[0]}`);
    }
  }
  if (done.length) await syncAll(dataDir, { postingIds: done.map((d) => d.id) });
  const byTier = done.reduce((m, d) => ({ ...m, [d.tier]: (m[d.tier] ?? 0) + 1 }), {});
  console.log(`\nTiered ${done.length}: ${Object.entries(byTier).map(([t, n]) => `${t} ${n}`).join(' · ')}`);
  console.log(`AI calls: ${calls.length}, ~$${calls.reduce((s, c) => s + (c.cost_usd_equivalent ?? 0), 0).toFixed(2)} API-equivalent`);
  if (paused) {
    const left = batch.length - done.length - failed.length;
    console.log(`Paused: Claude usage limit reached after ${done.length} of ${batch.length} graded; ${left} left for the next run.`);
  }
  if (failed.length) throw new Error(`${failed.length} role(s) failed and were skipped:\n  ${failed.join('\n  ')}`);
}

main().catch((err) => { console.error(`tier-new: ${err.message}`); process.exit(1); });

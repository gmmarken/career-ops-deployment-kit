#!/usr/bin/env node
// Tier every open home-metro target-family posting that has no tier yet (found by
// market.sh scan). Same pipeline as tier.sh: hard facts (code) → judgment (claude, no
// tools) → company bar → tier (code) → market database → Notion (one sync at the end).
// A failed posting is reported and skipped; the run exits non-zero if any failed.
// Usage: scripts/tier-new.sh [--limit N] [--dry-run]
import { loadRules } from '../engine/rules.mjs';
import { decideTier } from '../engine/tier-engine.mjs';
import { gatherFacts, describeCalls } from './pipeline.mjs';
import { openStore } from '../market/store.mjs';
import { recordTiered } from '../market/record.mjs';
import { TARGET_FAMILIES } from '../market/classify.mjs';
import { pullCompanyEdits, syncAll } from '../notion/sync.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const dataDir = process.env.CAREER_OPS_DATA_DIR;
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set. Run through scripts/tier-new.sh.');
  const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;
  const dry = process.argv.includes('--dry-run');
  const rules = loadRules();
  let store = openStore();
  const todo = store.postings().filter((p) => !p.closed_at && p.in_home_metro === true && TARGET_FAMILIES.has(p.title_family) && p.url && !store.latestDecision(p.id));
  store.close();
  const batch = todo.slice(0, limit);
  console.log(`${todo.length} untiered NYC target-family role(s); tiering ${batch.length}.`);
  for (const p of batch) console.log(`  · ${p.company} — ${p.title}`);
  if (dry || !batch.length) return;

  await pullCompanyEdits(dataDir);
  const calls = [];
  const done = [];
  const failed = [];
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
    } catch (err) {
      failed.push(`${p.company} — ${p.title}: ${err.message.split('\n')[0]}`);
      console.log(`  [${i + 1}/${batch.length}] FAILED   ${p.company} — ${p.title}: ${err.message.split('\n')[0]}`);
    }
  }
  if (done.length) await syncAll(dataDir, { postingIds: done.map((d) => d.id) });
  const byTier = done.reduce((m, d) => ({ ...m, [d.tier]: (m[d.tier] ?? 0) + 1 }), {});
  console.log(`\nTiered ${done.length}: ${Object.entries(byTier).map(([t, n]) => `${t} ${n}`).join(' · ')}`);
  console.log(`AI calls: ${calls.length}, ~$${calls.reduce((s, c) => s + (c.cost_usd_equivalent ?? 0), 0).toFixed(2)} API-equivalent`);
  if (failed.length) throw new Error(`${failed.length} role(s) failed and were skipped:\n  ${failed.join('\n  ')}`);
}

main().catch((err) => { console.error(`tier-new: ${err.message}`); process.exit(1); });

// Record one tiered posting in the market database: the posting (seen today),
// its company, and the tier decision with fingerprints of the settings and the
// extraction instructions that produced it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseJobUrl } from '../extractor/ats.mjs';
import { inHomeMetro } from './classify.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** Fingerprint of the extraction instructions (prompt + schema). */
export const promptHash = () => sha(
  readFileSync(new URL('../extractor/prompt.md', import.meta.url), 'utf-8') +
  readFileSync(new URL('../extractor/judgment.schema.json', import.meta.url), 'utf-8'));

/** Fingerprint of the tier settings (key order normalized). */
export const rulesHash = (rules) => sha(JSON.stringify(rules, Object.keys(rules).sort()));

/** "ashby:acme" for ATS links, "file" for pasted JDs. */
export function boardOf(posting) {
  if (!posting.url || posting.source === 'file') return 'file';
  try { const { ats, board } = parseJobUrl(posting.url); return `${ats}:${board.toLowerCase()}`; } catch { return `web:${new URL(posting.url).hostname}`; }
}

export function recordTiered(store, facts, result, rules, { at = new Date(), promptHashValue = promptHash() } = {}) {
  const p = facts.posting;
  const { id, isNew } = store.seePosting({
    url: p.url, board: boardOf(p), company: facts.company.name, title: p.title, locations: p.locations,
    in_home_metro: (p.locations || []).length ? inHomeMetro(p.locations, rules.candidate) : null,
    workplace: facts.judgment?.work_model?.value ?? p.workplace, pay: p.pay, posted_at: p.posted_at,
  }, at);
  store.recordTier(id, result, facts, { at, rulesHash: rulesHash(rules), promptHash: promptHashValue });
  return { id, isNew };
}

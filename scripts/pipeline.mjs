// Shared pipeline: hard facts (code) → judgment facts (model, no tools) → company bar
// (watchlist, else web research only when the role could reach S/A). Used by
// scripts/tier.mjs and evals/run-evals.mjs so both run exactly the same steps.
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { decideTier } from '../engine/tier-engine.mjs';
import { fetchPosting } from '../extractor/ats.mjs';
import { extractJudgment, markdownSection } from '../extractor/extract.mjs';
import { watchlistPath, loadWatchlist, findCompany, toCompanyFacts, researchCompany, saveResearch } from '../extractor/research.mjs';

const payStr = (p) => `${p.min ?? '?'}-${p.max ?? '?'} ${p.currency ?? '?'}/${p.interval}`;

/** Check a job source spec: { url } or { jdFile, company, locations?, pay?, title? }. */
export function checkSource(src) {
  if (!src.url && !src.jdFile) throw new Error('Give a job URL, or a JD file with a company name.');
  if (src.jdFile && !src.company) throw new Error('A JD file needs a company name.');
  if (src.pay && !/^\d+-\d+$/.test(src.pay)) throw new Error('pay must look like 135000-180000 (USD per year, read from the posting).');
  if (src.pay && !src.jdFile) throw new Error('pay is only for JD-file runs; ATS links read pay themselves.');
  return src;
}

/**
 * @param {object} src   { url } or { jdFile, company, locations, pay, title }
 * @param {object} ctx   { dataDir, rules, model?, research? (default true) }
 * @returns {Promise<{ facts, calls, companyNote }>}
 */
export async function gatherFacts(src, { dataDir, rules, model, research = true }) {
  checkSource(src);
  const targets = markdownSection(readFileSync(join(dataDir, 'modes', '_profile.md'), 'utf-8'), 'Target Role Definition');
  const cv = readFileSync(join(dataDir, 'cv.md'), 'utf-8');
  const calls = [];

  // 1. Hard facts (code).
  let posting, jdText;
  if (src.url) {
    ({ posting, jdText } = await fetchPosting(src.url));
  } else {
    jdText = readFileSync(src.jdFile, 'utf-8');
    const [min, max] = src.pay ? src.pay.split('-').map(Number) : [];
    posting = {
      url: src.sourceUrl ?? null, source: 'file', title: src.title ?? basename(src.jdFile), company: src.company,
      locations: src.locations ?? [], workplace: 'unclear', posted_at: null, equity_offered: null, pay_conflict: null,
      pay: src.pay ? { min, max, currency: 'USD', interval: 'year', kind: 'base', source: 'page-data' } : null,
    };
  }

  // 2. Judgment facts (model, no tools).
  const { judgment, usage } = await extractJudgment({ jdText, targets, cv, model });
  calls.push({ step: 'extract', ...usage });

  // Pay: ATS wins; text fills a gap; disagreement is flagged, never resolved silently.
  const t = judgment.pay_in_text;
  if (t && (t.min != null || t.max != null)) {
    const textPay = { min: t.min, max: t.max, currency: t.currency, interval: t.interval, kind: 'unknown', source: 'text' };
    if (!posting.pay) posting.pay = textPay;
    else if (posting.pay.max !== t.max || posting.pay.min !== t.min) posting.pay_conflict = { ats: payStr(posting.pay), text: payStr(textPay) };
  }

  // 3. Company bar: watchlist → research (only if the role could reach S/A) → unknown.
  const wlPath = watchlistPath(dataDir);
  const watchlist = loadWatchlist(wlPath);
  const name = judgment.company_name.value || posting.company;
  let entry = findCompany(watchlist, name, posting.company);
  let companyNote = entry ? `watchlist (${entry.origin ?? 'watchlist'})` : null;
  if (!entry) {
    const optimistic = decideTier({ posting, judgment, company: { ...toCompanyFacts(null, name), status: 'strong', origin: 'watchlist', verified: true } }, rules);
    if (!['S', 'A'].includes(optimistic.tier)) companyNote = `research skipped: best case is ${optimistic.tier}`;
    else if (!research) companyNote = 'research skipped: research turned off';
    else {
      const { company, usage: rUsage } = await researchCompany(name, { model });
      calls.push({ step: 'company-research', ...rUsage });
      entry = saveResearch(wlPath, watchlist, company, [posting.company, name]);
      companyNote = 'researched now (saved to watchlist, unverified)';
    }
  }
  return { facts: { posting, judgment, company: toCompanyFacts(entry, name) }, calls, companyNote };
}

export function describeCalls(calls) {
  return `${calls.length} (${calls.map((c) => `${c.step}: ${(c.input_tokens ?? 0) + (c.cache_read_tokens ?? 0) + (c.cache_write_tokens ?? 0)} in (incl. cache) / ${c.output_tokens ?? '?'} out tokens${c.cost_usd_equivalent != null ? `, ~$${c.cost_usd_equivalent.toFixed(4)} API-equivalent` : ''}`).join('; ')})`;
}

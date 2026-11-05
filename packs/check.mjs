// Line-by-line checks on a tailored CV (D84), run before career-ops' whole-document fact
// gate (verify-cv-facts.mjs). The model may reword bullets toward the posting; code then
// checks every line against the cv.md lines it says it came from. Any problem blocks the
// pack (D88): no retry, no silent repair.

// A number with what's around it: "~40", "$200K+", "nearly 300", "30%", "2-4".
const QUAL = '(~|an estimated |estimated |about |approximately |approx\\. |roughly |nearly |almost |over |under |more than |less than |up to |at least )';
const NUM = new RegExp(`${QUAL}?\\$?(\\d[\\d,]*(?:\\.\\d+)?)([KMB](?![a-z])|%|\\s(?:million|billion)\\b)?(\\+)?`, 'gi');
const UNIT = { k: 'K', m: 'M', b: 'B', million: 'M', billion: 'B', '%': '%' };

/** Every number in a text: { key: "200K", hedged: bool, plus: bool, raw }. */
export function numbers(text) {
  const out = [];
  for (const m of String(text).matchAll(NUM)) {
    const unit = m[3] ? UNIT[m[3].trim().toLowerCase()] : '';
    out.push({ key: `${m[2].replace(/,/g, '')}${unit}`, hedged: Boolean(m[1]), plus: Boolean(m[4]), raw: m[0].trim() });
  }
  return out;
}

/**
 * Numbers in `target` checked against `source` text:
 *  - every number must appear in the source;
 *  - a number the source always hedges ("~40", "nearly 300", "under 30") must stay hedged (D10's "~" gap);
 *  - a "+" ("6+") may be dropped but never added.
 * Returns problem strings.
 */
export function numberProblems(target, source) {
  const src = numbers(source);
  const problems = [];
  for (const n of numbers(target)) {
    const same = src.filter((s) => s.key === n.key);
    if (!same.length) { problems.push(`"${n.raw}" is not in the source line`); continue; }
    if (!n.hedged && same.every((s) => s.hedged)) problems.push(`"${n.raw}" drops the source's approximation ("${same[0].raw}")`);
    if (n.plus && !same.some((s) => s.plus)) problems.push(`"${n.raw}" adds a "+" the source doesn't have`);
  }
  return problems;
}

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Check the model's tailored CV against the parsed cv.md.
 * tailored: { headline, summary, experience: [{ entry_id, bullets: [{ text, source_ids }] }], skills: [{ category, items }] }
 * Returns { problems: string[] } — any problem blocks the pack.
 */
export function checkTailored(cv, lines, tailored, { maxBullets = 8 } = {}) {
  const problems = [];
  const allText = [...lines.values()].map((l) => l.text).join('\n');
  // Every job stays, in cv.md's order (career-ops also guards section order).
  const ids = tailored.experience.map((e) => e.entry_id);
  const want = cv.experience.map((j) => j.id);
  if (JSON.stringify(ids) !== JSON.stringify(want)) problems.push(`jobs must be ${want.join(', ')} in that order; got ${ids.join(', ') || 'none'}`);
  for (const e of tailored.experience) {
    const job = cv.experience.find((j) => j.id === e.entry_id);
    if (!job) continue;
    if (!e.bullets.length) problems.push(`${job.company}: no bullets`);
    if (e.bullets.length > maxBullets) problems.push(`${job.company}: ${e.bullets.length} bullets (at most ${maxBullets})`);
    for (const [i, b] of e.bullets.entries()) {
      const where = `${job.company} bullet ${i + 1}`;
      if (!b.source_ids?.length) { problems.push(`${where}: names no cv.md line`); continue; }
      const srcs = b.source_ids.map((id) => lines.get(id));
      const bad = b.source_ids.filter((id, k) => !srcs[k] || srcs[k].entry !== job.id);
      if (bad.length) { problems.push(`${where}: source ${bad.join(', ')} is not a ${job.company} line in cv.md`); continue; }
      for (const p of numberProblems(b.text, srcs.map((s) => s.text).join('\n'))) problems.push(`${where}: ${p}`);
    }
  }
  // The summary may draw on any line of cv.md.
  for (const p of numberProblems(tailored.summary, allText)) problems.push(`summary: ${p}`);
  if (/\d/.test(tailored.headline ?? '')) problems.push(`headline has a number: "${tailored.headline}"`);
  if ((tailored.headline ?? '').split(/\s+/).length > 6) problems.push(`headline is over 6 words: "${tailored.headline}"`);
  // Skills: chosen and ordered from cv.md's own list, never added.
  const known = new Map(cv.skills.map((s) => [norm(s.category), new Set(s.items.map(norm))]));
  for (const s of tailored.skills) {
    const items = known.get(norm(s.category));
    if (!items) { problems.push(`skills: "${s.category}" is not a cv.md skills category`); continue; }
    for (const it of s.items) if (!items.has(norm(it))) problems.push(`skills: "${it}" is not listed under ${s.category} in cv.md`);
  }
  return { problems };
}

/** Words in a text (for length limits). */
export const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

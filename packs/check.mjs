// Line-by-line checks on a tailored CV (D84), run before career-ops' whole-document fact
// gate (verify-cv-facts.mjs). The model may reword bullets toward the posting; code then
// checks every line against the cv.md lines it says it came from. Any problem blocks the
// pack (D88): no retry, no silent repair.
import { readFileSync, existsSync } from 'node:fs';

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
 * tailored: { archetype, summary, experience: [{ entry_id, bullets: [{ text, source_ids }] }], skills: [{ category, items }] }
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

// --- CV rules (D98–D99): locked lines, and words that may not describe one line ---------------


/** Read private/config/cv-rules.json. Every field is required; a missing file stops the pack. */
export function loadCvRules(path) {
  if (!existsSync(path)) throw new Error(`${path} not found. Copy packs/cv-rules.example.json there (D98).`);
  let r;
  try { r = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
  if (!Array.isArray(r.locked) || !Array.isArray(r.line_rules) || typeof r.tailoring_rules !== 'string') throw new Error(`${path} needs "locked" (list), "line_rules" (list) and "tailoring_rules" (file name).`);
  for (const l of r.locked) if (!l.name || !Array.isArray(l.any_of) || !l.any_of.length) throw new Error(`${path}: each locked entry needs "name" and "any_of".`);
  for (const l of r.line_rules) if (!l.name || !l.line_starts || !Array.isArray(l.forbidden) || !Array.isArray(l.mention)) throw new Error(`${path}: each line rule needs "name", "line_starts", "mention" and "forbidden".`);
  return r;
}

const starts = (text, prefix) => String(text).toLowerCase().startsWith(String(prefix).toLowerCase());
const wordRe = (w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

/** cv.md line ids for each locked group. A group that matches no line is a settings error. */
export function lockedIds(rules, lines) {
  return rules.locked.map((g) => {
    const ids = [...lines.values()].filter((l) => g.any_of.some((p) => starts(l.text, p))).map((l) => l.id);
    if (!ids.length) throw new Error(`cv-rules.json: locked "${g.name}" matches no cv.md line (${g.any_of.join(' / ')}). Fix the rule or cv.md.`);
    return { name: g.name, ids };
  });
}

/** Problems: locked groups the tailored CV left out, and forbidden words on a line-ruled bullet. */
export function cvRuleProblems(rules, lines, tailored) {
  const problems = [];
  const used = new Set(tailored.experience.flatMap((e) => e.bullets.flatMap((b) => b.source_ids)));
  for (const g of lockedIds(rules, lines)) if (!g.ids.some((id) => used.has(id))) problems.push(`locked line left out: ${g.name}`);
  for (const r of rules.line_rules) {
    const ids = new Set([...lines.values()].filter((l) => starts(l.text, r.line_starts)).map((l) => l.id));
    for (const e of tailored.experience) for (const b of e.bullets) {
      if (!b.source_ids.some((id) => ids.has(id))) continue;
      const bad = r.forbidden.filter((w) => wordRe(w).test(b.text));
      if (bad.length) problems.push(`${r.name}: "${bad.join('", "')}" in "${b.text.slice(0, 60)}…"`);
    }
  }
  return problems;
}

/** Problems: a draft sentence that mentions a line-ruled subject and uses one of its forbidden words. */
export function draftRuleProblems(rules, text, where) {
  const problems = [];
  for (const sentence of String(text).split(/(?<=[.!?])\s+|\n+/)) {
    for (const r of rules.line_rules) {
      if (!r.mention.some((m) => wordRe(m).test(sentence))) continue;
      const bad = r.forbidden.filter((w) => wordRe(w).test(sentence));
      if (bad.length) problems.push(`${where}: ${r.name}: "${bad.join('", "')}" in "${sentence.slice(0, 70)}…"`);
    }
  }
  return problems;
}

/** The posting's title as the CV headline (D98): location and work-model tags removed, nothing added. */
export function headlineFromTitle(title) {
  const place = /\b(new york|nyc|ny|remote|hybrid|on-?site|us|usa|united states|manhattan|brooklyn)\b/i;
  let t = String(title).trim();
  t = t.replace(/\s*\(([^)]*)\)\s*/g, (m, inner) => (place.test(inner) ? ' ' : m));
  t = t.replace(/\s*[-–|,]\s*([^-–|,]*)$/, (m, tail) => (place.test(tail) && tail.split(/\s+/).length <= 4 ? '' : m));
  return t.replace(/\s+/g, ' ').trim();
}

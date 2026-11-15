// Line-by-line checks on a tailored CV (D84), run before career-ops' whole-document fact
// gate (verify-cv-facts.mjs). The model may reword bullets toward the posting; code then
// checks every line against the cv.md lines it says it came from. Any problem blocks the
// pack (D88): no retry, no silent repair.
import { readFileSync, existsSync } from 'node:fs';

// A number with what's around it: "~40", "$200K+", "nearly 300", "30%", "2-4".
const QUAL = '(~|an estimated |estimated |about |approximately |approx\\. |roughly |nearly |almost |over |under |more than |less than |up to |at least )';
// A number glued to a letter is part of a name, not a claim: "B2B", "S3", "Q4" (D107).
const NUM = new RegExp(`${QUAL}?(?<![A-Za-z])\\$?(\\d[\\d,]*(?:\\.\\d+)?)([KMB](?![a-z])|%|\\s(?:million|billion)\\b)?(\\+)?`, 'gi');
const UNIT = { k: 'K', m: 'M', b: 'B', million: 'M', billion: 'B', '%': '%' };

// Names that contain a number aren't claims ("a Fortune 500 go-live" isn't "500 deployments"). Checks read
// a copy with them spelled out; documents are unchanged (D98).
// A role's opening time frame ("the first 90 days", "a 30-60-90 plan") is a common phrase, not a claim (D118).
const DAYS = { 30: 'thirty', 60: 'sixty', 90: 'ninety', 100: 'hundred' };
const NUMBER_NAMES = [[/\bFortune (500|100|1000)\b/g, 'Fortune-list'], [/\bS&P 500\b/g, 'S&P-index'], [/\bInc\. 5000\b/g, 'Inc-list'],
  [/\b(first|next|initial) (30|60|90|100)(?=[- ]days?\b)/gi, (_, w, n) => `${w} ${DAYS[n]}`],
  [/\b30[-/]60[-/]90\b/g, 'thirty-sixty-ninety']];
export const spellNumberNames = (text) => NUMBER_NAMES.reduce((t, [re, name]) => t.replace(re, name), String(text));

/** Every number in a text: { key: "200K", hedged: bool, plus: bool, raw }. */
export function numbers(text) {
  const out = [];
  for (const m of spellNumberNames(text).matchAll(NUM)) {
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
  // A bullet that cites a whole job ("e1") is read as citing that job's description line ("e1c").
  for (const e of tailored.experience) for (const b of e.bullets) b.source_ids = (b.source_ids ?? []).map((id) => (!lines.has(id) && lines.has(`${id}c`) ? `${id}c` : id));
  const allText = [...lines.values()].map((l) => l.text).join('\n');
  // Every job stays, in cv.md's order (career-ops also guards section order).
  const ids = tailored.experience.map((e) => e.entry_id);
  const want = cv.experience.map((j) => j.id);
  if (JSON.stringify(ids) !== JSON.stringify(want)) problems.push(`jobs must be ${want.join(', ')} in that order; got ${ids.join(', ') || 'none'}`);
  for (const e of tailored.experience) {
    const job = cv.experience.find((j) => j.id === e.entry_id);
    if (!job) continue;
    // A tailored description line keeps the facts of cv.md's description line (D104).
    if (e.context) {
      if (!job.context) problems.push(`${job.company}: a description line was written, but cv.md has none for this job`);
      else for (const p of numberProblems(e.context, job.context)) problems.push(`${job.company} description: ${p}`);
    }
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
  // A skill may move between groups (it's still on your list); it may never be new (D106).
  const categories = new Set(cv.skills.map((s) => norm(s.category)));
  const allItems = new Set(cv.skills.flatMap((s) => s.items.map(norm)));
  for (const s of tailored.skills) {
    if (!categories.has(norm(s.category))) { problems.push(`skills: "${s.category}" is not a cv.md skills category`); continue; }
    for (const it of s.items) if (!allItems.has(norm(it))) problems.push(`skills: "${it}" is not in cv.md's skills list`);
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
  if (!Array.isArray(r.name_notes) || r.name_notes.some((n) => typeof n !== 'string')) throw new Error(`${path} needs "name_notes": a list of plain-text notes (e.g. which client names look like other companies), [] for none.`);
  if (typeof r.keyword_bank !== 'string' || !r.keyword_bank.trim()) throw new Error(`${path} needs "keyword_bank": the file in config/ with your approved keywords (D103).`);
  if (typeof r.ai_native_sentence !== 'string' || !r.ai_native_sentence.trim()) throw new Error(`${path} needs "ai_native_sentence": the fixed summary sentence about your AI project, added for AI-native companies (D101).`);
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

/** Terms in the keyword bank (D103): "- term, term — why it's true". The "Never" section is left out. */
export function bankTerms(md) {
  const terms = [];
  let never = false;
  for (const l of String(md).split('\n')) {
    if (l.startsWith('## ')) { never = /^##\s+never/i.test(l); continue; }
    if (never || !l.startsWith('- ')) continue;
    const head = l.slice(2).split(/\s+—\s+/)[0];
    for (const t of head.split(',').map((x) => x.trim()).filter(Boolean)) terms.push(t);
  }
  return [...new Set(terms)];
}

/** Bank terms the posting itself uses (case-insensitive, whole words; a plural "s" counts), as the posting writes them. */
export function postingBankTerms(terms, jdText) {
  const out = [];
  for (const t of terms) {
    const m = String(jdText).match(new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?![a-z0-9])`, 'i'));
    if (m) out.push(m[0]);
  }
  return [...new Set(out.map((x) => x.toLowerCase()))].map((lc) => out.find((x) => x.toLowerCase() === lc));
}

/** The posting's title as the CV headline (D98): location and work-model tags removed, nothing added. */
export function headlineFromTitle(title) {
  const place = /\b(new york|nyc|ny|remote|hybrid|on-?site|us|usa|united states|manhattan|brooklyn)\b/i;
  let t = String(title).trim();
  t = t.replace(/\s*\(([^)]*)\)\s*/g, (m, inner) => (place.test(inner) ? ' ' : m));
  t = t.replace(/\s*[-–|,]\s*([^-–|,]*)$/, (m, tail) => (place.test(tail) && tail.split(/\s+/).length <= 4 ? '' : m));
  return t.replace(/\s+/g, ' ').trim();
}

// --- What a number counts (D104): "10K clients" when cv.md says "10K+ customer estimates" -------
const SKIP = new Set(['to', 'and', 'in', 'of', 'a', 'an', 'the', 'each', 'per', 'across', 'from', 'or', 'for', 'at', 'on', 'with', 'by', 'over', 'under', 'than', 'between', 'total', 'end', 'into', 'as']);
const lemma = (w) => { const x = w.toLowerCase(); if (x === 'person' || x === 'people') return 'people'; return x.length > 3 && x.endsWith('s') ? x.slice(0, -1) : x; };

/** Each number with the few words after it: [{ key, raw, words: [lemmas], phrase }]. */
export function countedWords(text) {
  const t = spellNumberNames(text);
  const out = [];
  for (const m of t.matchAll(NUM)) {
    const unit = m[3] ? UNIT[m[3].trim().toLowerCase()] : '';
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 60).split(/[.;:!?\n]/)[0];
    const words = (after.match(/[A-Za-z]+/g) ?? []).slice(0, 3);
    out.push({ key: `${m[2].replace(/,/g, '')}${unit}`, raw: m[0].trim(), words: words.map(lemma), phrase: `${m[0].trim()} ${words.join(' ')}`.trim() });
  }
  return out;
}

/**
 * Warnings: a number the source has, but next to different words ("10K clients" vs "10K+ customer
 * estimates"). A flag, not a block: cv.md sometimes names the counted thing earlier in the sentence.
 */
export function countedNounWarnings(target, source, where) {
  const src = countedWords(source);
  const warnings = [];
  for (const n of countedWords(target)) {
    const same = src.filter((s) => s.key === n.key);
    const mine = n.words.filter((w) => !SKIP.has(w));
    if (!same.length || !mine.length || SKIP.has(n.words[0])) continue;
    if (same.some((s) => !s.words.length || SKIP.has(s.words[0]))) continue; // source doesn't say what it counts
    if (same.some((s) => s.words.some((w) => mine.includes(w)))) continue;
    warnings.push(`⚠️ check this number (${where}): "${n.phrase}", but your CV says "${same.map((s) => s.phrase).join('" / "')}"`);
  }
  return warnings;
}

// --- Placement (D105): a bank term with a [where: …] tag may only describe those jobs or lines -------

/** Bank entries: [{ terms, where: [{ kind: 'job'|'line'|'projects', value }] | null }]. "Never" is left out. */
export function bankEntries(md) {
  const out = [];
  let never = false;
  for (const l of String(md).split('\n')) {
    if (l.startsWith('## ')) { never = /^##\s+never/i.test(l); continue; }
    if (never || !l.startsWith('- ')) continue;
    const terms = l.slice(2).split(/\s+—\s+/)[0].split(',').map((x) => x.trim()).filter(Boolean);
    const tag = l.match(/\[where:\s*([^\]]+)\]/i);
    const where = tag ? [...tag[1].matchAll(/line\s+"([^"]+)"|([^,]+)/gi)].map((m) => (m[1] ? { kind: 'line', value: m[1].trim() } : m[2].trim().toLowerCase() === 'projects' ? { kind: 'projects', value: 'projects' } : { kind: 'job', value: m[2].trim() })).filter((w) => w.value) : null;
    out.push({ terms, where });
  }
  return out;
}

const termRe = (t) => new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?![a-z0-9])`, 'i');

/**
 * Problems: a [where]-limited bank term used on a CV line outside its jobs or lines. A bullet's lines are
 * its source lines; a description line is its job's. The summary may draw on any experience.
 */
export function placementProblems(entries, cv, lines, tailored) {
  const problems = [];
  const limited = entries.filter((e) => e.where);
  const allowed = (where, job, srcTexts) => where.some((w) =>
    (w.kind === 'job' && job.company.toLowerCase().startsWith(w.value.toLowerCase()))
    || (w.kind === 'line' && srcTexts.some((t) => t.toLowerCase().startsWith(w.value.toLowerCase()))));
  for (const e of tailored.experience) {
    const job = cv.experience.find((j) => j.id === e.entry_id);
    if (!job) continue;
    const pieces = [...e.bullets.map((b) => ({ text: b.text, src: b.source_ids.map((id) => lines.get(id)?.text ?? '') })),
      ...(e.context ? [{ text: e.context, src: [job.context ?? ''] }] : [])];
    for (const piece of pieces) for (const entry of limited) for (const t of entry.terms) {
      if (!termRe(t).test(piece.text)) continue;
      // Already in the source line itself (e.g. "Coupa" in the Leo line): fine wherever that line goes.
      if (piece.src.some((s) => termRe(t).test(s))) continue;
      if (!allowed(entry.where, job, piece.src)) problems.push(`"${t}" can't describe this ${job.company} line (bank: only ${entry.where.map((w) => (w.kind === 'line' ? `"${w.value}…"` : w.value)).join(', ')}): "${piece.text.slice(0, 60)}…"`);
    }
  }
  return problems;
}

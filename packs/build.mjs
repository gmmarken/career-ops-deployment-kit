// Build one prep pack (Phase 8): tailored CV (PDF), cover letter, interview prep, outreach
// drafts, and a "research next" page with a ready-to-paste research prompt.
//   1. Code reads cv.md, the posting (fresh from its job board) and the company research.
//   2. Model call 1 tailors the CV (no tools). Code checks every line (D84), then career-ops'
//      fact gate checks the whole CV, then career-ops renders the PDF.
//   3. Model call 2 drafts the other documents (no tools). Code and the fact gate check them.
// Any check failing blocks the pack (D88): no retry, the reasons go in the pack and the text.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude } from '../extractor/claude.mjs';
import { fetchPosting } from '../extractor/ats.mjs';
import { markdownSection } from '../extractor/extract.mjs';
import { findCompany } from '../extractor/research.mjs';
import { parseCv, sourceLines } from './cvsource.mjs';
import { checkTailored, numberProblems, wordCount } from './check.mjs';
import { cvPayload, cvMarkdown, renderCv, runCo } from './render.mjs';
import { usd, payText } from '../delivery/format.mjs';
import { loadProjectNotes, mapMarkdown } from './projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (f) => readFileSync(join(HERE, f), 'utf8');
export const PACK_MODEL = process.env.KIT_PACK_MODEL || 'sonnet';
export const COVER_MAX_WORDS = 250;
export const NOTE_MAX_WORDS = 120;

export const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** What the kit knows about a company, as markdown (also a fact source for the drafts). Missing stays missing. */
export function companyMarkdown(name, entry, rounds = []) {
  if (!entry) return `# ${name}\n\nNo Company Radar research yet.\n`;
  const e = entry;
  const out = [`# ${e.name}`, ''];
  const add = (label, v) => out.push(`- **${label}:** ${v == null || v === '' || (Array.isArray(v) && !v.length) ? 'unknown' : v}`);
  add('What they do', e.what_they_do);
  add('Stage', e.stage && e.stage !== 'unknown' ? e.stage : null);
  add('Last raise', e.last_raise ? [e.last_raise.round, e.last_raise.amount_usd != null ? usd(e.last_raise.amount_usd) : null, e.last_raise.date].filter(Boolean).join(', ') : null);
  if (rounds.length) add('Funding rounds on record', rounds.map((r) => [r.round, r.amount_usd != null ? usd(r.amount_usd) : null, r.announced].filter(Boolean).join(' ')).join('; '));
  add('Investors', (e.investors ?? []).join(', '));
  add('Leaders', (e.leaders ?? []).map((l) => `${l.name} (${l.title})`).join('; '));
  add('NYC presence', e.nyc_presence === true ? `yes${e.nyc_evidence ? `: ${e.nyc_evidence}` : ''}` : e.nyc_presence === false ? 'no' : null);
  add('Deployment fit (kit\'s read)', e.fit ? `${e.fit}${e.fit_reason ? `: ${e.fit_reason}` : ''}` : null);
  add('Careers page', e.careers_url);
  add('Your call in Company Radar', `${e.status ?? 'unknown'}${e.verified ? ', verified' : ', not verified'}`);
  add('Sources', (e.sources ?? []).map((s) => s.url).join(' · '));
  return `${out.join('\n')}\n`;
}

/** Run career-ops' fact gate on one file. Returns { verdict, problems[], warnings[] }. */
export async function factGate(file, sources, { run = runCo } = {}) {
  const args = ['verify-cv-facts.mjs', file, ...sources.flatMap((s) => ['--source', s]), '--json'];
  const r = await run(args);
  const jsonLine = r.out.split('\n').find((l) => l.trim().startsWith('{'));
  if (!jsonLine) throw new Error(`career-ops fact check gave no result for ${file}:\n${r.out.slice(0, 500)}`);
  const v = JSON.parse(jsonLine);
  if (v.configMissing) throw new Error('career-ops fact check could not find private/config/cv-facts.json.');
  const problems = [
    ...v.invented.map((x) => `number not in the sources: ${x}`),
    ...v.unsupportedFacts.map((x) => `${x.kind ?? 'fact'} not in the sources: ${x.value}`),
    ...v.forbidden.map((x) => `banned phrase: ${x}`),
  ];
  const warnings = [...v.warnings.map((x) => `review wording: ${x}`), ...v.advisoryFacts.map((x) => `review: ${x.value}`), ...(v.coverage ? [`fact check coverage: ${v.coverage.message}`] : [])];
  return { verdict: v.verdict, problems, warnings };
}

// --- writing the documents -----------------------------------------------------------

export function prepMarkdown(role, prep, lines) {
  const out = [`# Interview prep: ${role}`, '', prep.role_in_one_line, '', '## Company brief', '', ...prep.company_brief.map((b) => `- ${b}`), '', '## Likely questions', ''];
  for (const q of prep.likely_questions) {
    out.push(`### ${q.question}`, '');
    if (q.posting_quote) out.push(`> ${q.posting_quote}`, '');
    out.push(q.answer_outline, '');
    const used = q.cv_source_ids.map((id) => lines.get(id)).filter(Boolean);
    if (used.length) out.push(`From your CV: ${used.map((l) => `"${l.text.slice(0, 90)}${l.text.length > 90 ? '…' : ''}"`).join(' · ')}`, '');
  }
  out.push('## Gaps to prepare for', '');
  if (!prep.gaps.length) out.push('None found.', '');
  for (const g of prep.gaps) out.push(`- **${g.gap}** (posting: "${g.posting_quote}"): ${g.how_to_address}`);
  out.push('', '## Questions to ask them', '', ...prep.questions_to_ask.map((q) => `- ${q}`), '');
  return out.join('\n');
}

export function outreachMarkdown(role, o) {
  const out = [`# Outreach drafts: ${role}`, '', 'Drafts only. You choose the channel and send them yourself.', ''];
  if (o.leader_name) out.push(`## To ${o.leader_name} (${o.leader_title})`, '', o.leader_note, '');
  else out.push('## To a company leader', '', 'No leaders on record in Company Radar yet, so no named note. See research-next.md.', '');
  out.push('## To the hiring manager', '', o.hiring_manager_note, '');
  return out.join('\n');
}

export function researchMarkdown(role, r) {
  return [`# Research next: ${role}`, '', '## What the research doesn\'t tell you yet', '', ...r.missing.map((m) => `- ${m}`), '',
    '## Prompt for a Claude research session (paste into Claude Cowork)', '', '```', r.cowork_prompt, '```', ''].join('\n');
}

/** The parts of the interview prep that are claims about you (what you'd say), for the fact gate. */
export function prepClaims(prep) {
  return [...prep.likely_questions.map((q) => q.answer_outline), ...prep.gaps.map((g) => g.how_to_address)].map((t) => `- ${t}`).join('\n') + '\n';
}

/** Words the candidate never wants in a document (cv-facts.json forbidden_phrases), told to the model up front. */
export function bannedPhrases(dataDir) {
  const f = JSON.parse(readFileSync(join(dataDir, 'config', 'cv-facts.json'), 'utf8'));
  if (!Array.isArray(f.forbidden_phrases)) throw new Error('private/config/cv-facts.json has no forbidden_phrases list.');
  return f.forbidden_phrases.map((p) => String(p).trim()).filter(Boolean);
}

/** Checks on the drafted documents that code can do on its own (D86-D88). Returns problem strings. */
export function checkDocs(docs, { lines, cvText, companyText, jdText, leaders }) {
  const problems = [];
  const words = wordCount(docs.cover_letter);
  if (words > COVER_MAX_WORDS + 50) problems.push(`cover letter is ${words} words (limit ${COVER_MAX_WORDS})`);
  for (const p of numberProblems(docs.cover_letter, `${cvText}\n${companyText}`)) problems.push(`cover letter: ${p}`);
  const o = docs.outreach;
  if (o.leader_name) {
    if (!leaders.some((l) => l.name === o.leader_name)) problems.push(`outreach: "${o.leader_name}" is not a leader in Company Radar`);
    if (!o.leader_note) problems.push('outreach: a leader was picked but there is no note');
  }
  for (const [k, t] of [['leader note', o.leader_note], ['hiring manager note', o.hiring_manager_note]]) {
    if (!t) continue;
    if (wordCount(t) > NOTE_MAX_WORDS + 30) problems.push(`outreach ${k} is ${wordCount(t)} words (limit ${NOTE_MAX_WORDS})`);
    for (const p of numberProblems(t, `${cvText}\n${companyText}`)) problems.push(`outreach ${k}: ${p}`);
  }
  for (const [i, q] of docs.interview_prep.likely_questions.entries()) {
    const bad = q.cv_source_ids.filter((id) => !lines.has(id));
    if (bad.length) problems.push(`interview question ${i + 1}: unknown CV line ${bad.join(', ')}`);
    for (const p of numberProblems(q.answer_outline, `${cvText}\n${companyText}\n${jdText}`)) problems.push(`interview question ${i + 1}: ${p}`);
  }
  return problems;
}

/**
 * Build one pack. `p` is a posting row ({ posting_id, company, title, url, pay_* }).
 * Returns { status: 'ready' | 'blocked', folder, detail, warnings, calls }. Throws on a broken
 * step (posting unreadable, claude error, render error): the caller records it as failed.
 */
export async function buildPack(p, { dataDir, store, wl, date, claude = runClaude, fetch = fetchPosting, run = runCo, render = renderCv }) {
  const role = `${p.company} — ${p.title}`;
  const folder = join(dataDir, 'output', 'packs', `${date}-${slug(p.company)}-${slug(p.title)}`);
  mkdirSync(folder, { recursive: true });
  const file = (n) => join(folder, n);
  const cvPath = join(dataDir, 'cv.md');
  const cvText = readFileSync(cvPath, 'utf8');
  const cv = parseCv(cvText);
  const lines = sourceLines(cv);
  const profile = readFileSync(join(dataDir, 'modes', '_profile.md'), 'utf8');
  const calls = [];
  const banned = `<banned_phrases>\nNever use these words or phrases anywhere, even inside a longer word or about someone else:\n${bannedPhrases(dataDir).map((b) => `- ${b}`).join('\n')}\n</banned_phrases>`;

  // 1. Inputs, all saved in the pack so you can see what it was built from.
  const { posting, jdText } = await fetch(p.url);
  writeFileSync(file('posting.md'), `# ${role}\n\n${p.url}\nPay: ${payText(posting.pay)}\n\n${jdText}\n`);
  const entry = findCompany(wl, p.company);
  const companyId = store.db.prepare('SELECT id FROM companies WHERE name = ?').get(p.company)?.id;
  const companyText = companyMarkdown(p.company, entry, companyId ? store.fundingByCompany().get(companyId) ?? [] : []);
  writeFileSync(file('company.md'), companyText);
  const cvLinesJson = JSON.stringify({ candidate: cv.candidate.name, summary: cv.summary, experience: cv.experience, skills: cv.skills }, null, 1);
  const finish = (status, detail, warnings = []) => {
    writeFileSync(file('README.md'), readme(role, p, { status, detail, warnings, date }));
    return { status, folder, detail, warnings, calls };
  };

  // 2. Tailored CV.
  const t = await claude({
    systemPrompt: load('tailor-prompt.md'), schema: JSON.parse(load('tailor.schema.json')), model: PACK_MODEL,
    input: `${banned}\n\n<cv_source>\n${cvLinesJson}\n</cv_source>\n\n<framing>\n${markdownSection(profile, 'Your Adaptive Framing')}\n</framing>\n\n<posting>\n${jdText}\n</posting>`,
  });
  calls.push({ step: 'tailor', ...t.usage });
  const tailored = t.data;
  writeFileSync(file('cv-changes.md'), `# What was tailored\n\n${tailored.changes.map((c) => `- ${c}`).join('\n')}\n`);
  // The project map (D90): which real project each line comes from, for your review.
  const map = mapMarkdown(role, cv, lines, tailored, loadProjectNotes(join(dataDir, 'cv-projects.md')));
  writeFileSync(file('cv-map.md'), map.markdown);
  const mapWarnings = map.missing ? [`${map.missing} CV line(s) have no project notes yet (see cv-map.md; add them to private/cv-projects.md)`] : [];
  const lineCheck = checkTailored(cv, lines, tailored);
  if (lineCheck.problems.length) return finish('blocked', `CV line check: ${lineCheck.problems.join('; ')}`, mapWarnings);
  const payload = cvPayload(cv, tailored);
  writeFileSync(file('cv-payload.json'), JSON.stringify(payload, null, 2));
  writeFileSync(file('cv.md'), cvMarkdown(cv, payload));
  const cvGate = await factGate(file('cv.md'), [cvPath], { run });
  if (cvGate.verdict === 'block') return finish('blocked', `CV fact check: ${cvGate.problems.join('; ')}`, [...mapWarnings, ...cvGate.warnings]);
  await render(file('cv-payload.json'), file('cv.html'), file('cv.pdf'), { run });

  // 3. Cover letter, interview prep, outreach, research next.
  const d = await claude({
    systemPrompt: load('docs-prompt.md'), schema: JSON.parse(load('docs.schema.json')), model: PACK_MODEL,
    input: [
      banned, `<cv>\n${readFileSync(file('cv.md'), 'utf8')}\n</cv>`, `<cv_lines>\n${cvLinesJson}\n</cv_lines>`,
      `<profile>\n${['Strengths and the examples to tell', 'Your Exit Narrative', 'Your Cross-cutting Advantage', 'Writing Style'].map((h) => markdownSection(profile, h)).join('\n\n')}\n</profile>`,
      `<company>\n${companyText}\n</company>`, `<posting>\nRole: ${role}\nLink: ${p.url}\n\n${jdText}\n</posting>`,
    ].join('\n\n'),
  });
  calls.push({ step: 'docs', ...d.usage });
  const docs = d.data;
  writeFileSync(file('cover-letter.md'), `${docs.cover_letter.trim()}\n`);
  writeFileSync(file('interview-prep.md'), prepMarkdown(role, docs.interview_prep, lines));
  writeFileSync(file('outreach.md'), outreachMarkdown(role, docs.outreach));
  writeFileSync(file('research-next.md'), researchMarkdown(role, docs.research_next));
  const problems = checkDocs(docs, { lines, cvText, companyText, jdText, leaders: entry?.leaders ?? [] });
  const warnings = [...mapWarnings, ...cvGate.warnings];
  if (wordCount(docs.cover_letter) > COVER_MAX_WORDS) warnings.push(`cover letter is ${wordCount(docs.cover_letter)} words; trim to ${COVER_MAX_WORDS}`);
  // The fact gate on each draft you'd send or say: cv.md for you, the research and posting for them.
  // In the interview prep that's the answer outlines and gap answers (questions to ask and quotes aren't claims).
  mkdirSync(file('checks'), { recursive: true });
  writeFileSync(file('checks/interview-answers.md'), prepClaims(docs.interview_prep));
  const srcs = [cvPath, file('company.md'), file('posting.md')];
  for (const name of ['cover-letter.md', 'outreach.md', 'checks/interview-answers.md']) {
    const g = await factGate(file(name), srcs, { run });
    problems.push(...g.problems.map((x) => `${name}: ${x}`));
    warnings.push(...g.warnings.map((x) => `${name}: ${x}`));
  }
  if (problems.length) return finish('blocked', `Draft checks: ${problems.join('; ')}`, warnings);
  return finish('ready', null, warnings);
}

function readme(role, p, { status, detail, warnings, date }) {
  const out = [`# Prep pack: ${role}`, '', `Built ${date} · ${p.url}`, ''];
  if (status === 'blocked') out.push('## 🚫 Blocked', '', 'A fact check failed, so this pack is not ready. Nothing in it should be used as is.', '', detail, '', 'To build it again after fixing the cause: `scripts/packs.sh requeue <posting link>`.', '');
  else out.push('## Before you apply', '', '1. Read `cv.pdf` line by line with `cv-map.md` open: it shows the cv.md line and the project behind each bullet. If you can\'t speak to a line, take it out.', '2. Edit `cover-letter.md` into your own words.', '3. Send the `outreach.md` notes yourself, if you want to.', '');
  if (warnings.length) out.push('## Worth a look', '', ...warnings.map((w) => `- ${w}`), '');
  out.push('## Files', '', '- `cv.pdf` (and `cv.md`): tailored CV · `cv-map.md`: each line → cv.md → the project behind it · `cv-changes.md`: what was tailored and why', '- `cover-letter.md` · `interview-prep.md` · `outreach.md`', '- `research-next.md`: what to find out next, with a prompt for a Claude research session', '- `posting.md`, `company.md`: what the pack was built from', '');
  return out.join('\n');
}

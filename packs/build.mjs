// Build one prep pack (Phase 8): tailored CV (PDF), cover letter, interview prep, outreach
// drafts, and a "research next" page with a ready-to-paste research prompt.
//   1. Code reads cv.md, the posting (fresh from its job board) and the company research.
//   2. Model call 1 tailors the CV (no tools). Code checks every line (D84), then career-ops'
//      fact gate checks the whole CV, then career-ops renders the PDF.
//   3. Model call 2 drafts the other documents (no tools). Code and the fact gate check them.
// Any check failing blocks the pack (D88): no retry, the reasons go in the pack and the text.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude } from '../extractor/claude.mjs';
import { fetchPosting } from '../extractor/ats.mjs';
import { markdownSection } from '../extractor/extract.mjs';
import { findCompany } from '../extractor/research.mjs';
import { parseCv, sourceLines } from './cvsource.mjs';
import { checkTailored, numberProblems, countedNounWarnings, bankEntries, placementProblems, wordCount, spellNumberNames, bankTerms, postingBankTerms, loadCvRules, lockedIds, cvRuleProblems, draftRuleProblems, headlineFromTitle } from './check.mjs';
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
// namedAsWarnings: for private notes (interview prep), a name the checker can't find is a warning, not a
// block; numbers and banned phrases still block (D102). Anything you'd send stays fully strict.
export async function factGate(file, sources, { run = runCo, namedAsWarnings = false } = {}) {
  const gateDir = join(dirname(file), basename(dirname(file)) === 'checks' ? '' : 'checks');
  mkdirSync(gateDir, { recursive: true });
  const gateFile = join(gateDir, `${basename(file)}.gate.md`);
  writeFileSync(gateFile, spellNumberNames(readFileSync(file, 'utf8')));
  const args = ['verify-cv-facts.mjs', gateFile, ...sources.flatMap((s) => ['--source', s]), '--json'];
  const r = await run(args);
  const jsonLine = r.out.split('\n').find((l) => l.trim().startsWith('{'));
  if (!jsonLine) throw new Error(`career-ops fact check gave no result for ${file}:\n${r.out.slice(0, 500)}`);
  const v = JSON.parse(jsonLine);
  if (v.configMissing) throw new Error('career-ops fact check could not find private/config/cv-facts.json.');
  const named = v.unsupportedFacts.map((x) => `${x.kind ?? 'fact'} not in the sources: ${x.value}`);
  // In private notes, career-ops' count check ("2 examples") is a warning too; the kit's own number check
  // (numberProblems) still blocks any number that isn't in cv.md, the research or the posting (D103).
  const counts = v.invented.map((x) => `number not in the sources: ${x}`);
  const problems = [
    ...(namedAsWarnings ? [] : counts),
    ...(namedAsWarnings ? [] : named),
    ...v.forbidden.map((x) => `banned phrase: ${x}`),
  ];
  const warnings = [...(namedAsWarnings ? [...named, ...counts].map((x) => `review: ${x}`) : []), ...v.warnings.map((x) => `review wording: ${x}`), ...v.advisoryFacts.map((x) => `review: ${x.value}`), ...(v.coverage ? [`fact check coverage: ${v.coverage.message}`] : [])];
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
export function checkDocs(docs, { lines, cvText, companyText, jdText, leaders, jobIds = new Set() }) {
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
    const bad = q.cv_source_ids.filter((id) => !lines.has(id) && !jobIds.has(id)); // a whole job (e1) is fine to cite here
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
  const rules = loadCvRules(join(dataDir, 'config', 'cv-rules.json'));
  const locked = lockedIds(rules, lines).map((g) => `- ${g.name}: ${g.ids.map((id) => `${id} ("${lines.get(id).text.slice(0, 70)}…")`).join(' or ')}`).join('\n');
  const trPath = join(dataDir, 'config', rules.tailoring_rules);
  const trMd = readFileSync(trPath, 'utf8');
  const tailoringRules = ['5. Role archetypes', '6. Allowed vocabulary translations'].map((h) => markdownSection(trMd, h)).join('\n\n');
  // The keyword bank (D103): approved terms, each tied to the experience that makes it true.
  const bankPath = join(dataDir, 'config', rules.keyword_bank);
  if (!existsSync(bankPath)) throw new Error(`Keyword bank not found at ${bankPath} (cv-rules.json "keyword_bank").`);
  const bankMd = readFileSync(bankPath, 'utf8');
  const bank = `<keyword_bank>\n${bankMd}\n</keyword_bank>`;
  const nameNotes = `<name_notes>\n${rules.name_notes.map((n) => `- ${n}`).join('\n') || '- none'}\n</name_notes>`;
  const banned = `<banned_phrases>\nNever use these words or phrases anywhere, even inside a longer word or about someone else:\n${bannedPhrases(dataDir).map((b) => `- ${b}`).join('\n')}\n</banned_phrases>`;

  // 1. Inputs, all saved in the pack so you can see what it was built from.
  const { posting, jdText } = await fetch(p.url);
  writeFileSync(file('posting.md'), `# ${role}\n\n${p.url}\nPay: ${payText(posting.pay)}\n\n${jdText}\n`);
  // Bank terms this posting uses (D103): built by code, the same every build. The CV should use each one
  // exactly as written wherever the experience it names appears.
  const targetTerms = postingBankTerms(bankTerms(bankMd), jdText);
  const targets = `<posting_terms>\nTerms from your keyword bank that this posting uses. Use each exactly as written here, wherever the experience it names appears on the CV:\n${targetTerms.map((t) => `- ${t}`).join('\n') || '- none'}\n</posting_terms>`;
  const entry = findCompany(wl, p.company);
  const companyId = store.db.prepare('SELECT id FROM companies WHERE name = ?').get(p.company)?.id;
  const companyText = companyMarkdown(p.company, entry, companyId ? store.fundingByCompany().get(companyId) ?? [] : []);
  writeFileSync(file('company.md'), companyText);
  const cvLinesJson = JSON.stringify({ candidate: cv.candidate.name, summary: cv.summary, experience: cv.experience, skills: cv.skills }, null, 1);
  let scores = null; // the ATS check, once the CV exists (D102)
  const finish = (status, detail, warnings = []) => {
    writeFileSync(file('README.md'), readme(role, p, { status, detail, warnings, date, scores }));
    return { status, folder, detail, warnings, calls };
  };

  // 2. Tailored CV.
  const t = await claude({
    systemPrompt: load('tailor-prompt.md'), schema: JSON.parse(load('tailor.schema.json')), model: PACK_MODEL,
    input: `${banned}\n\n<cv_source>\n${cvLinesJson}\n</cv_source>\n\n<framing>\n${markdownSection(profile, 'Your Adaptive Framing')}\n</framing>\n\n${nameNotes}\n\n${bank}\n\n${targets}\n\n<tailoring_rules>\n${tailoringRules}\n</tailoring_rules>\n\n<locked>\n${locked}\n</locked>\n\n<posting>\n${jdText}\n</posting>`,
  });
  calls.push({ step: 'tailor', ...t.usage });
  const tailored = t.data;
  writeFileSync(file('cv-changes.md'), `# What was tailored\n\n${tailored.changes.map((c) => `- ${c}`).join('\n')}\n`);
  // The project map (D90): which real project each line comes from, for your review.
  const map = mapMarkdown(role, cv, lines, tailored, loadProjectNotes(join(dataDir, 'cv-projects.md')));
  writeFileSync(file('cv-map.md'), map.markdown);
  const mapWarnings = map.missing ? [`${map.missing} CV line(s) have no project notes yet (see cv-map.md; add them to private/cv-projects.md)`] : [];
  const lineCheck = checkTailored(cv, lines, tailored);
  lineCheck.problems.push(...cvRuleProblems(rules, lines, tailored), ...placementProblems(bankEntries(bankMd), cv, lines, tailored));
  if (lineCheck.problems.length) return finish('blocked', `CV line check: ${lineCheck.problems.join('; ')}`, mapWarnings);
  // AI-native companies (your Company Radar tick): the summary always names the job-search agent (D101).
  // If the model left it out, code adds your fixed, pre-checked sentence.
  if (entry?.ai_native === true && !/job-search agent|career-ops/i.test(tailored.summary)) {
    tailored.summary = `${tailored.summary.trim()} ${rules.ai_native_sentence.trim()}`;
    mapWarnings.push('AI-native company: added the job-search agent sentence to the summary');
  }
  const payload = cvPayload(cv, tailored, headlineFromTitle(p.title));
  writeFileSync(file('cv-payload.json'), JSON.stringify(payload, null, 2));
  writeFileSync(file('cv.md'), cvMarkdown(cv, payload));
  // The fact gate also reads the bank as an approved source, with every number removed: approved phrases
  // ("messy operational data") pass, but a number can only ever come from cv.md.
  mkdirSync(file('checks'), { recursive: true });
  writeFileSync(file('checks/keyword-bank.gate-source.md'), bankMd.replace(/\d+/g, ''));
  const bankSource = file('checks/keyword-bank.gate-source.md');
  const cvGate = await factGate(file('cv.md'), [cvPath, bankSource], { run });
  if (cvGate.verdict === 'block') return finish('blocked', `CV fact check: ${cvGate.problems.join('; ')}`, [...mapWarnings, ...cvGate.warnings]);
  const pdfOut = await render(file('cv-payload.json'), file('cv.html'), file('cv.pdf'), { run });
  const pages = Number(String(pdfOut).match(/Pages:\s*(\d+)/)?.[1] ?? NaN) || null;

  // 3. Cover letter, interview prep, outreach, research next.
  const d = await claude({
    systemPrompt: load('docs-prompt.md'), schema: JSON.parse(load('docs.schema.json')), model: PACK_MODEL,
    input: [
      banned, nameNotes, bank, `<cv>\n${readFileSync(file('cv.md'), 'utf8')}\n</cv>`, `<cv_lines>\n${cvLinesJson}\n</cv_lines>`,
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
  const jobIds = new Set(cv.experience.map((j) => j.id));
  const problems = checkDocs(docs, { lines, cvText, companyText, jdText, leaders: entry?.leaders ?? [], jobIds });
  problems.push(...draftRuleProblems(rules, docs.cover_letter, 'cover letter'),
    ...draftRuleProblems(rules, `${docs.outreach.leader_note ?? ''}\n${docs.outreach.hiring_manager_note}`, 'outreach'),
    ...draftRuleProblems(rules, prepClaims(docs.interview_prep), 'interview prep'));
  // What each number counts (D104): flagged first, so they're the first thing you see.
  const numberFlags = [
    ...tailored.experience.flatMap((e) => e.bullets.flatMap((b) => countedNounWarnings(b.text, b.source_ids.map((id) => lines.get(id)?.text ?? '').join('\n'), 'CV'))),
    ...countedNounWarnings(tailored.summary, cvText, 'CV summary'),
    ...countedNounWarnings(docs.cover_letter, cvText, 'cover letter'),
    ...countedNounWarnings(`${docs.outreach.leader_note ?? ''}\n${docs.outreach.hiring_manager_note}`, cvText, 'outreach'),
    ...countedNounWarnings(prepClaims(docs.interview_prep), `${cvText}\n${companyText}`, 'interview prep'),
  ];
  const warnings = [...new Set(numberFlags), ...mapWarnings, ...cvGate.warnings];
  if (pages && pages > 1) warnings.push(`CV is ${pages} pages; one is preferred`);
  // Fit report (D98): measured ATS structure and keyword coverage next to the AI's read.
  mkdirSync(file('checks'), { recursive: true });
  // Keyword coverage, counted by career-ops' checker on the CV: every core term, and the ones a cv.md line supports.
  const kwList = (terms, name) => { writeFileSync(file(`checks/${name}.md`), `# Keywords for ${role}\n\n## Keywords extracted\n\n${terms.join(', ')}\n`); return file(`checks/${name}.md`); };
  const allTerms = tailored.keywords.map((k) => k.term);
  // "Supported" = the bank terms this posting uses (stable across builds), not the AI's own list.
  const supported = targetTerms;
  const coverage = await coJson(['keyword-match.mjs', kwList(allTerms, 'keywords'), '--cv', file('cv.html'), '--json'], 'career-ops keyword check', run);
  const supportedCoverage = supported.length ? await coJson(['keyword-match.mjs', kwList(supported, 'keywords-supported'), '--cv', file('cv.html'), '--json'], 'career-ops keyword check', run) : null;
  if (supportedCoverage?.missing?.length) warnings.push(`bank term(s) the posting uses but the CV doesn't: ${supportedCoverage.missing.join(', ')}`);
  const atsRaw = await coJson(['verify-ats.mjs', file('cv.html'), '--json'], 'career-ops ATS check', run);
  const ats = { score: atsRaw.score, grade: atsRaw.grade, issues: (atsRaw.issues ?? []).map((i) => (typeof i === 'string' ? i : i.message ?? JSON.stringify(i)).slice(0, 120)) };
  const badIds = docs.fit_report.requirements.flatMap((r) => r.cv_source_ids).filter((id) => !lines.has(id) && !jobIds.has(id));
  if (badIds.length) warnings.push(`fit report cites unknown CV line(s) ${[...new Set(badIds)].join(', ')} (the report is advisory)`);
  scores = { ats, coverage, supportedCoverage, pages };
  writeFileSync(file('fit-report.md'), fitReportMarkdown(role, docs.fit_report, { archetype: tailored.archetype, lines, coverage, supportedCoverage, ats, pages }));
  if (wordCount(docs.cover_letter) > COVER_MAX_WORDS) warnings.push(`cover letter is ${wordCount(docs.cover_letter)} words; trim to ${COVER_MAX_WORDS}`);
  // The fact gate on each draft you'd send or say: cv.md for you, the research and posting for them.
  // In the interview prep that's the answer outlines and gap answers (questions to ask and quotes aren't claims).
  writeFileSync(file('checks/interview-answers.md'), prepClaims(docs.interview_prep));
  const srcs = [cvPath, bankSource, file('company.md'), file('posting.md')];
  for (const name of ['cover-letter.md', 'outreach.md', 'checks/interview-answers.md']) {
    const g = await factGate(file(name), srcs, { run, namedAsWarnings: name === 'checks/interview-answers.md' });
    problems.push(...g.problems.map((x) => `${name}: ${x}`));
    warnings.push(...g.warnings.map((x) => `${name}: ${x}`));
  }
  if (problems.length) return finish('blocked', `Draft checks: ${problems.join('; ')}`, warnings);

  // Meaning check (D106): a second, independent read compares every line you'd send with its source in
  // cv.md. The model only reports; code decides: a new claim blocks, a stronger claim is flagged for you.
  const facts = JSON.parse(readFileSync(join(dataDir, 'config', 'cv-facts.json'), 'utf8'));
  const approved = [`Approved facts:\n${(facts.allow_facts ?? []).map((f) => `- ${f}`).join('\n')}`, markdownSection(profile, 'Strengths and the examples to tell')].join('\n\n');
  const meaningLines = meaningPairs({ cv, lines, tailored, docs, approved });
  const m = await claude({
    systemPrompt: load('meaning-prompt.md'), schema: JSON.parse(load('meaning.schema.json')), model: PACK_MODEL,
    input: [`<keyword_bank>\n${bankMd}\n</keyword_bank>`, `<allowed_rewordings>\n${markdownSection(trMd, '6. Allowed vocabulary translations')}\n</allowed_rewordings>`,
      ...meaningLines.map((l) => `<line id="${l.id}" where="${l.where}">\n${l.text}\n</line>\n<source for="${l.id}">\n${l.source}\n</source>`)].join('\n\n'),
  });
  calls.push({ step: 'meaning', ...m.usage });
  const verdicts = meaningVerdicts(meaningLines, m.data);
  writeFileSync(file('meaning-check.md'), meaningMarkdown(role, verdicts));
  const newClaims = verdicts.filter((v) => v.verdict === 'new_claim');
  const stronger = verdicts.filter((v) => v.verdict === 'stronger');
  warnings.unshift(...stronger.map((v) => `⚠️ check this line (${v.where}): ${v.what_changed ?? 'claimed more strongly than your CV'} — "${v.text.slice(0, 80)}…"`));
  if (scores) scores.meaning = { checked: verdicts.length, stronger: stronger.length, newClaims: newClaims.length };
  if (newClaims.length) return finish('blocked', `Meaning check: new claim(s) not in your CV: ${newClaims.map((v) => `${v.where}: ${v.what_changed ?? v.text.slice(0, 60)}`).join('; ')}`, warnings);
  return finish('ready', null, warnings);
}

/** Run a career-ops JSON check; returns the parsed result. Throws with its own message if it can't run. */
async function coJson(args, what, run) {
  const r = await run(args);
  const start = r.out.indexOf('{');
  if (start === -1) throw new Error(`${what} gave no result:\n${r.out.slice(0, 400)}`);
  return JSON.parse(r.out.slice(start, r.out.lastIndexOf('}') + 1));
}

/** The lines the meaning check reads (D106): every line you'd send, with its source text. */
export function meaningPairs({ cv, lines, tailored, docs, approved = '' }) {
  // "All" sources: every cv.md line, the skills list, and your other approved facts (profile stories, allow_facts).
  const all = [...[...lines.values()].map((l) => `- ${l.text}`), ...cv.skills.map((s) => `- Skills, ${s.category}: ${s.items.join(', ')}`), approved].filter(Boolean).join('\n');
  const out = [];
  let n = 0;
  for (const e of tailored.experience) {
    const job = cv.experience.find((j) => j.id === e.entry_id);
    if (!job) continue;
    if (e.context && job.context && e.context !== job.context) out.push({ id: `L${++n}`, where: `CV, ${job.company} description`, text: e.context, source: job.context });
    for (const b of e.bullets) out.push({ id: `L${++n}`, where: `CV, ${job.company}`, text: b.text, source: b.source_ids.map((id) => lines.get(id)?.text).filter(Boolean).join('\n') || all });
  }
  out.push({ id: `L${++n}`, where: 'CV summary', text: tailored.summary, source: all });
  for (const para of String(docs.cover_letter).split(/\n\s*\n/).map((x) => x.trim()).filter((x) => x.length > 40)) out.push({ id: `L${++n}`, where: 'cover letter', text: para, source: all });
  for (const [k, t] of [['outreach to a leader', docs.outreach.leader_note], ['outreach to the hiring manager', docs.outreach.hiring_manager_note]]) if (t) out.push({ id: `L${++n}`, where: k, text: t, source: all });
  return out;
}

/** Join the model's verdicts to the lines. A line it skipped is reported, never assumed fine. */
export function meaningVerdicts(pairs, data) {
  const by = new Map((data.lines ?? []).map((v) => [v.id, v]));
  return pairs.map((p) => {
    const v = by.get(p.id);
    return v ? { ...p, verdict: v.verdict, what_changed: v.what_changed } : { ...p, verdict: 'stronger', what_changed: 'the meaning check returned no verdict for this line; read it yourself' };
  });
}

export function meaningMarkdown(role, verdicts) {
  const flagged = verdicts.filter((v) => v.verdict !== 'same');
  const out = [`# Meaning check: ${role}`, '', `${verdicts.length} lines checked against your CV: ${verdicts.filter((v) => v.verdict === 'same').length} same, ${verdicts.filter((v) => v.verdict === 'stronger').length} stronger, ${verdicts.filter((v) => v.verdict === 'new_claim').length} new claim.`, '',
    'A second AI read compares each line you\'d send with its source in cv.md. New claims block the pack; stronger claims are flagged for you. It can miss things: your own read is still the last check.', ''];
  for (const v of flagged) out.push(`## ${v.verdict === 'new_claim' ? '🚫 New claim' : '⚠️ Stronger'}: ${v.where}`, '', `> ${v.text}`, '', v.what_changed ?? '', '', `From your CV: ${v.source.split('\n').slice(0, 3).join(' / ').slice(0, 400)}`, '');
  if (!flagged.length) out.push('Nothing flagged.', '');
  return out.join('\n');
}

/** fit-report.md: the AI's read of the fit, next to what code measured (D98). */
export function fitReportMarkdown(role, fr, { archetype, lines, coverage, supportedCoverage = null, ats, pages }) {
  const label = { embedded_ai_strategist: 'Embedded AI strategist / forward-deployed', implementation_deployment: 'Implementation / deployment strategist', technical_enablement: 'Technical enablement / training', pilot_led_deployment: 'Pilot-led deployment' }[archetype] ?? archetype;
  const out = [`# Fit report: ${role}`, '', `**Verdict:** ${fr.verdict} · **Role type:** ${label}`, '', '## Scores', '',
    '| Score | Value | How it was found |', '|---|---|---|',
    `| ATS structure | ${ats.score}/100 (${ats.grade}) | measured by career-ops' ATS checker${ats.issues.length ? `: ${ats.issues.join('; ')}` : ''} |`,
    `| Keyword coverage, all core terms | ${coverage.coveragePct}% (${coverage.presentCount} of ${coverage.total}) | the AI's list of the posting's core terms (it varies by build, so treat as rough), counted by code |`,
    `| Keyword coverage, your bank terms this posting uses | ${supportedCoverage ? `${supportedCoverage.coveragePct}% (${supportedCoverage.presentCount} of ${supportedCoverage.total})` : 'n/a (no bank terms in this posting)'} | measured by code, the same list every build; should be near 100% |`,
    `| Recruiter impact | ${fr.recruiter_impact.score}/100 | AI estimate, not a measurement: ${fr.recruiter_impact.why} |`,
    `| Pages | ${pages ?? '?'} | one preferred, two allowed |`, ''];
  const unsupported = (coverage.missing ?? []).filter((t) => !(supportedCoverage?.missing ?? []).includes(t) && !(supportedCoverage?.present ?? []).includes(t));
  if (supportedCoverage?.missing?.length) out.push(`**Supported but not verbatim on the CV:** ${supportedCoverage.missing.join(', ')}. Worth echoing exactly.`, '');
  if (unsupported.length) out.push(`**Terms your CV doesn't support:** ${unsupported.join(', ')}. Gaps to address in the cover letter or interview, not on the CV.`, '');
  out.push('## Requirements', '', '| Requirement | Evidence | From your CV |', '|---|---|---|');
  for (const r of fr.requirements) {
    const used = r.cv_source_ids.map((id) => lines.get(id)?.text?.slice(0, 50)).filter(Boolean);
    out.push(`| ${r.requirement} ("${r.posting_quote.replace(/\|/g, '/')}") | ${r.evidence} | ${used.length ? used.map((u) => `${u}…`).join('<br>') : '-'} |`);
  }
  out.push('', '## Biggest rejection risks', '', ...fr.rejection_risks.map((x) => `- ${x}`), '', '## Questions that could close a gap', '', ...(fr.questions_for_you.length ? fr.questions_for_you.map((x) => `- ${x}`) : ['- None.']), '');
  return out.join('\n');
}

/** The ATS check at the top of every pack README (D102): measured scores, or why there are none. */
export function atsBlock(scores) {
  if (!scores) return ['## ATS check', '', 'Not measured: the pack stopped before the CV was checked (see below).', ''];
  const pct = (c) => (c ? `**${c.coveragePct}%** (${c.presentCount} of ${c.total})` : 'n/a');
  return ['## ATS check', '',
    `- **ATS structure:** **${scores.ats.score}/100** (${scores.ats.grade}), career-ops' checker${scores.ats.issues.length ? `: ${scores.ats.issues.join('; ')}` : ''}`,
    `- **Keyword coverage, your bank terms this posting uses:** ${pct(scores.supportedCoverage)}. Measured by code, the same every build; should be near 100%.`,
    `- **Keyword coverage, all core terms (rough):** ${pct(scores.coverage)}. The AI's list, which varies by build; 70%+ is a strong match.`,
    `- **Pages:** ${scores.pages ?? '?'} (one preferred)`,
    ...(scores.meaning ? [`- **Meaning check:** ${scores.meaning.checked} lines read against your CV; ${scores.meaning.stronger} flagged stronger, ${scores.meaning.newClaims} new claim(s). See \`meaning-check.md\`.`] : []),
    '', 'Details, and which terms are missing: `fit-report.md`.', ''];
}

export function readme(role, p, { status, detail, warnings, date, scores = null }) {
  const out = [`# Prep pack: ${role}`, '', `Built ${date} · ${p.url}`, '', ...atsBlock(scores)];
  if (status === 'blocked') out.push('## 🚫 Blocked', '', 'A fact check failed, so this pack is not ready. Nothing in it should be used as is.', '', detail, '', 'To build it again after fixing the cause: `scripts/packs.sh requeue <posting link>`.', '');
  else out.push('## Before you apply', '', '1. Read `cv.pdf` line by line with `cv-map.md` open: it shows the cv.md line and the project behind each bullet. If you can\'t speak to a line, take it out.', '2. Edit `cover-letter.md` into your own words.', '3. Send the `outreach.md` notes yourself, if you want to.', '');
  if (warnings.length) out.push('## Worth a look', '', ...warnings.map((w) => `- ${w}`), '');
  out.push('## Files', '', '- `fit-report.md`: verdict, ATS and keyword scores, requirement-by-requirement evidence, rejection risks',
    '- `cv.pdf` (and `cv.md`): tailored CV · `cv-map.md`: each line → cv.md → the project behind it · `cv-changes.md`: what was tailored and why', '- `cover-letter.md` · `interview-prep.md` · `outreach.md`', '- `research-next.md`: what to find out next, with a prompt for a Claude research session', '- `posting.md`, `company.md`: what the pack was built from', '');
  return out.join('\n');
}

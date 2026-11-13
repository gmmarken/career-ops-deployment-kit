// Phase 8 prep packs: CV reading, line checks, queue order and pace, project map, Notion text.
// Uses a made-up CV; never the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCv, sourceLines } from './cvsource.mjs';
import { numbers, numberProblems, countedNounWarnings, bankEntries, placementProblems, checkTailored, bankTerms, postingBankTerms, cvRuleProblems, draftRuleProblems, headlineFromTitle, lockedIds, loadCvRules } from './check.mjs';
import { cvPayload, cvMarkdown, projectEntry, educationEntry } from './render.mjs';
import { rankQueue, allowance, checkPackConfig } from './queue.mjs';
import { parseProjectNotes, notesFor, mapMarkdown, addMissingSections, linesWithoutNotes, loadProjectNotes } from './projects.mjs';
import { markdownBlocks, rich, packBlocks } from './notion.mjs';
import { checkDocs, prepClaims, companyMarkdown, slug, fitReportMarkdown, readme, meaningPairs, meaningVerdicts, meaningMarkdown } from './build.mjs';
import { spellNumberNames } from './check.mjs';
import { openStore } from '../market/store.mjs';
import { refreshQueue } from '../scripts/packs.mjs';

const CV = `# CV -- Pat Example

**Location:** Brooklyn, NY
**Email:** pat@example.com
**Phone:** 555-0100
**LinkedIn:** linkedin.com/in/pat-example

## Professional Summary

Operator with 4+ years in consulting and operations.

## Work Experience

### Acme -- New York, NY

**Analyst, Strategy & Operations**
Sep 2025 - Present

Analytics partner to 10+ leaders.

- Built an AI agent that maps files, a task each analyst repeats 2-4 times a month.
- Rolled out a migration kit to the ~40-person team, projected to save ~40 minutes each.
- Uncovered nearly 300 bad codes and $200K+ in revenue.

### Beta Co -- Seattle, WA

**Consultant**
Jun 2022 - Sep 2025

- Cut a daily report from ~3 hours to under 30 minutes.

## Projects

- **Side tool** (personal, 2026) -- Built a small tool for one user.

## Education

- B.A., Business -- Example University (2022). GPA 3.80

## Skills

- **AI:** context engineering, Claude
- **Data:** SQL, Python

## Interests

- Skiing and golf.
`;

const cv = parseCv(CV);
const lines = sourceLines(cv);

test('cv.md is read into numbered lines; an unknown section fails loudly', () => {
  assert.equal(cv.candidate.name, 'Pat Example');
  assert.deepEqual(cv.experience.map((j) => [j.id, j.company, j.role, j.period, j.bullets.length]), [['e1', 'Acme', 'Analyst, Strategy & Operations', 'Sep 2025 - Present', 3], ['e2', 'Beta Co', 'Consultant', 'Jun 2022 - Sep 2025', 1]]);
  assert.equal(cv.experience[0].context, 'Analytics partner to 10+ leaders.');
  assert.equal(lines.get('e1b2').entry, 'e1');
  assert.equal(lines.get('e1c').text, 'Analytics partner to 10+ leaders.');
  // education, projects and interests never share an id with a job (e1, e2…)
  assert.equal(lines.get('ed1').entry, 'education');
  assert.equal(lines.get('p1').entry, 'projects');
  assert.ok(!lines.has('e1') && !lines.has('e2'));
  assert.deepEqual(cv.skills[0], { category: 'AI', items: ['context engineering', 'Claude'] });
  assert.equal(cv.interests[0].text, 'Skiing and golf.');
  assert.throws(() => parseCv(CV.replace('## Projects', '## Hobbies')), /unknown section "Hobbies"/);
  assert.throws(() => parseCv(CV.replace('**Email:** pat@example.com', '')), /no \*\*Email:\*\* line/);
});

test('numbers: approximations and "+" are read, and units don\'t swallow words', () => {
  assert.deepEqual(numbers('~40 minutes, $200K+, nearly 300, 30%, 3 million').map((n) => [n.key, n.hedged, n.plus]),
    [['40', true, false], ['200K', false, true], ['300', true, false], ['30%', false, false], ['3M', false, false]]);
});

test('numberProblems: a new number, a dropped "~" or "nearly", and an added "+" are all caught (D10 gap)', () => {
  const src = 'saves ~40 minutes; nearly 300 codes; 6+ programs; 2-4 times';
  assert.deepEqual(numberProblems('saves about 40 minutes, nearly 300 codes, 6 programs, 2-4 times', src), []);
  const p = numberProblems('saves 40 minutes, 300 codes, 4+ times, 12 hours', src);
  assert.equal(p.length, 4);
  assert.match(p[0], /drops the source's approximation/);
  assert.match(p[2], /adds a "\+"/);
  assert.match(p[3], /"12" is not in the source/);
  // "an estimated" is a hedge like "~"; a follower count not in cv.md is blocked (GabesGridTalk stays "40,000+").
  assert.match(numberProblems('saving 40 minutes each', 'saving an estimated 40 minutes each')[0], /drops the source's approximation/);
  assert.deepEqual(numberProblems('saving an estimated 40 minutes', 'saving an estimated 40 minutes'), []);
  assert.match(numberProblems('an audience of 50K followers', 'an audience of 40,000+ followers')[0], /"50K" is not in the source/);
  assert.deepEqual(numberProblems('an audience of 40,000+ followers', 'an audience of 40,000+ followers'), []);
});

const good = {
  headline: 'AI Deployment Strategist',
  summary: 'Operator with 4+ years in consulting and operations.',
  experience: [
    { entry_id: 'e1', bullets: [{ text: 'Built an AI agent that maps files, used 2-4 times a month by each analyst.', source_ids: ['e1b1'] }, { text: 'Rolled out a kit to a ~40-person team.', source_ids: ['e1b2'] }] },
    { entry_id: 'e2', bullets: [{ text: 'Cut a daily report from ~3 hours to under 30 minutes.', source_ids: ['e2b1'] }] },
  ],
  skills: [{ category: 'AI', items: ['Claude', 'context engineering'] }],
  changes: [],
};

test('checkTailored: a faithful rewrite passes', () => {
  assert.deepEqual(checkTailored(cv, lines, good).problems, []);
});

test('checkTailored: dropped jobs, wrong sources, new numbers and new skills block', () => {
  const bad = structuredClone(good);
  bad.experience[0].bullets[0] = { text: 'Built an AI agent used by 50 analysts.', source_ids: ['e1b1'] };
  bad.experience[0].bullets[1] = { text: 'Cut a report to 30 minutes.', source_ids: ['e2b1'] }; // another job's line
  bad.experience[1].bullets.push({ text: 'Led everything.', source_ids: [] });
  bad.skills = [{ category: 'AI', items: ['Kubernetes'] }, { category: 'Cloud', items: ['AWS'] }];
  const p = checkTailored(cv, lines, bad).problems.join('\n');
  assert.match(p, /Acme bullet 1: "50" is not in the source line/);
  assert.match(p, /source e2b1 is not a Acme line/);
  assert.match(p, /Beta Co bullet 2: names no cv\.md line/);
  assert.match(p, /"Kubernetes" is not in cv\.md's skills list/);
  assert.match(p, /"Cloud" is not a cv\.md skills category/);
  const missing = { ...good, experience: [good.experience[0]] };
  assert.match(checkTailored(cv, lines, missing).problems[0], /jobs must be e1, e2 in that order/);
});

test('render: career-ops payload keeps job headers, projects, education and interests word for word', () => {
  const p = cvPayload(cv, good, 'AI Deployment Strategist');
  assert.equal(p.candidate.title, 'AI Deployment Strategist');
  assert.deepEqual(p.candidate.linkedin, { url: 'https://linkedin.com/in/pat-example', display: 'linkedin.com/in/pat-example' });
  assert.equal(p.experience[0].role, 'Analyst, Strategy & Operations');
  assert.equal(p.experience[1].bullets.length, 1);
  assert.deepEqual(p.projects[0], { name: 'Side tool', badge: 'personal, 2026', description: 'Built a small tool for one user.' });
  assert.deepEqual(p.education[0], { title: 'B.A., Business', org: 'Example University', year: '2022', description: 'GPA 3.80' });
  assert.deepEqual(p.interests, ['Skiing and golf']);
  assert.match(cvMarkdown(cv, p), /## Interests\n\n- Skiing and golf\./);
  assert.throws(() => projectEntry('no format'), /project line should look like/);
  assert.throws(() => educationEntry('no year here'), /education line should look like/);
});

test('queue order: your ticks, then role family, then pay, then newest (D85)', () => {
  const row = (id, o) => ({ posting_id: id, reason: 'auto', title_family: 'bizops_so', pay_max: null, pay_interval: 'year', first_seen: '2026-11-01', ...o });
  const order = rankQueue([
    row(1, { title_family: 'deployment_ai_strategist', pay_max: 200000 }),
    row(2, { title_family: 'deployment_ai_strategist', pay_max: 250000 }),
    row(3, { reason: 'you' }),
    row(4, { title_family: 'deployment_ai_strategist', pay_max: null, first_seen: '2026-11-04' }),
    row(5, { title_family: 'deployment_ai_strategist', pay_max: 200000, first_seen: '2026-11-03' }),
  ]).map((r) => r.posting_id);
  assert.deepEqual(order, [3, 2, 5, 1, 4]);
});

test('pace: 1 a day, up to 3 when 2+ want one that day, never more than 5 in 7 days (D85)', () => {
  const cfg = { per_day: 1, max_per_day: 3, max_per_week: 5 };
  const now = new Date(2026, 10, 10, 13, 0);
  const q = (n) => Array.from({ length: n }, () => ({ status: 'queued' }));
  const built = (daysAgo) => ({ status: 'ready', built_at: new Date(now.getTime() - daysAgo * 86400000).toISOString() });
  assert.equal(allowance(q(1), cfg, now).build, 1);
  assert.equal(allowance(q(4), cfg, now).build, 3);
  assert.equal(allowance([built(0), ...q(1)], cfg, now).build, 1); // midday: one built this morning + one new → cap rises to 3
  assert.equal(allowance([built(0), ...q(1)], cfg, now).dayCap, 3);
  assert.equal(allowance([built(0)], cfg, now).build, 0);
  assert.equal(allowance([built(0), built(0), built(0), ...q(3)], cfg, now).build, 0);
  assert.equal(allowance([built(1), built(2), built(3), built(4), ...q(4)], cfg, now).build, 1); // weekly cap
  assert.equal(allowance([built(1), built(2), built(3), built(4), built(8), ...q(4)], cfg, now).build, 1);
  assert.equal(allowance([{ status: 'blocked', built_at: now.toISOString() }, ...q(1)], cfg, now).builtToday, 1); // a blocked pack used a slot
  assert.throws(() => checkPackConfig(undefined), /needs a "packs" block/);
  assert.throws(() => checkPackConfig({ per_day: 1, max_per_day: 3 }), /max_per_week must be a whole number/);
});

test('queue refresh: new S roles from the start date, your ticks, and closed roles dropped (D83)', () => {
  const store = openStore(':memory:');
  const since = store.getMeta('packs_auto_since');
  assert.ok(since);
  const add = (url, tier, at, extra = {}) => {
    const { id } = store.seePosting({ url, company: 'Acme', title: `Role ${url.slice(-1)}`, locations: ['New York, NY'], in_home_metro: true, ...extra });
    store.recordTier(id, { tier, flags: [], steps: [] }, { judgment: {} }, { at });
    return id;
  };
  const old = add('https://jobs.ashbyhq.com/acme/1', 'S', '2026-01-01T00:00:00Z');
  const fresh = add('https://jobs.ashbyhq.com/acme/2', 'S', new Date(Date.now() + 1000));
  const aRole = add('https://jobs.ashbyhq.com/acme/3', 'A', new Date(Date.now() + 1000));
  const notes = refreshQueue(store, [{ key: 'jobs.ashbyhq.com/acme/3' }, { key: 'jobs.ashbyhq.com/acme/9' }]);
  assert.equal(store.pack(old), null); // graded S before Phase 8: only if you tick it
  assert.equal(store.pack(fresh).reason, 'auto');
  assert.equal(store.pack(aRole).reason, 'you');
  assert.match(notes.join('\n'), /the database doesn't know \(jobs\.ashbyhq\.com\/acme\/9\)/);
  store.db.prepare('UPDATE postings SET closed_at = ? WHERE id = ?').run('2026-11-10', fresh);
  refreshQueue(store, []);
  assert.equal(store.pack(fresh).status, 'dropped');
  assert.throws(() => store.queuePack(old, 'whim'), /reason must be auto or you/);
  store.close();
});

const NOTES = `# The projects behind my CV lines

## AI agent
Line: Built an AI agent that maps files
Was on: Both old resumes
Project: File-mapping agent, 2026
What I did: Wrote it in Python
  and tested it on real files.
Who I worked with:
What I'd say in an interview: Saves the team repeated work.

## Migration kit
Line: Rolled out a migration kit
Was on: Operator resume only
Project:
What I did:
`;

test('project map: each bullet → cv.md line → your project notes; empty notes are flagged (D90)', () => {
  const notes = parseProjectNotes(NOTES);
  assert.equal(notes[0].fields['What I did'], 'Wrote it in Python and tested it on real files.');
  assert.equal(notes[0].filled, true);
  assert.equal(notes[1].filled, false);
  assert.equal(notesFor(lines.get('e1b1').text, notes).title, 'AI agent');
  const { markdown, missing } = mapMarkdown('Acme — Role', cv, lines, good, notes);
  assert.equal(missing, 2); // migration kit (empty) and Beta Co's line (none)
  assert.match(markdown, /\*\*Project:\*\* AI agent/);
  assert.match(markdown, /No project notes yet\.\*\* Add them to private\/cv-projects\.md\. \(Was on: Operator resume only\)/);
  assert.throws(() => parseProjectNotes('## No line here\nProject: x'), /has no "Line:"/);
});

test('project notes file: missing sections are added once, and empty ones listed', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'notes-')), 'cv-projects.md');
  writeFileSync(path, NOTES);
  const added = addMissingSections(path, lines, loadProjectNotes(path));
  assert.equal(added, 4); // e1b3, e1c, e2b1, project p1
  assert.equal(addMissingSections(path, lines, loadProjectNotes(path)), 0);
  assert.match(readFileSync(path, 'utf8'), /## Cut a daily report from ~3 hours to\nLine: Cut a daily report/);
  assert.equal(linesWithoutNotes(lines, loadProjectNotes(path)).length, 5);
});

test('draft checks: invented numbers, unknown leaders, long letters and unknown CV lines block (D86–D88)', () => {
  const docs = {
    cover_letter: 'Dear Hiring Team, I cut a report from ~3 hours to under 30 minutes. Sincerely, Pat',
    interview_prep: { role_in_one_line: 'x', company_brief: [], likely_questions: [{ question: 'q', posting_quote: null, answer_outline: 'Saved ~40 minutes each.', cv_source_ids: ['e1b2'] }], gaps: [{ gap: 'g', posting_quote: 'q', how_to_address: 'Learn it.' }], questions_to_ask: [] },
    outreach: { leader_name: 'Jane Doe', leader_title: 'CEO', leader_note: 'Congrats on the $15M raise.', hiring_manager_note: 'Hi, can we chat?' },
  };
  const ctx = { lines, cvText: CV, companyText: '- **Last raise:** Series A, $15M', jdText: '', leaders: [{ name: 'Jane Doe', title: 'CEO' }] };
  assert.deepEqual(checkDocs(docs, ctx), []);
  const bad = structuredClone(docs);
  bad.cover_letter = `${'word '.repeat(320)} I saved 12 hours.`;
  bad.outreach.leader_name = 'John Smith';
  bad.outreach.hiring_manager_note = 'Could we talk for 15 minutes?';
  bad.interview_prep.likely_questions[0].cv_source_ids = ['e9b9'];
  const p = checkDocs(bad, ctx).join('\n');
  assert.match(p, /cover letter is 324 words/);
  assert.match(p, /cover letter: "12" is not in the source/);
  assert.match(p, /"John Smith" is not a leader in Company Radar/);
  assert.match(p, /hiring manager note: "15 minutes"|hiring manager note: "15" is not in the source/);
  assert.match(p, /unknown CV line e9b9/);
  assert.equal(prepClaims(docs.interview_prep), '- Saved ~40 minutes each.\n- Learn it.\n');
});

test('company research as markdown: missing stays "unknown", never filled in', () => {
  assert.match(companyMarkdown('Nope', null), /No Company Radar research yet/);
  const md = companyMarkdown('Acme', { name: 'Acme', what_they_do: 'Widgets', leaders: [], investors: [], sources: [] });
  assert.match(md, /What they do:\*\* Widgets/);
  assert.match(md, /Leaders:\*\* unknown/);
  assert.equal(slug('Ode with Anthropic — AI Strategist (NY)'), 'ode-with-anthropic-ai-strategist-ny');
});

test('Notion text: markdown becomes blocks under the 2000-character limit; a blocked pack shows only why', () => {
  const b = markdownBlocks('# T\n## H\n- **Bold:** item\n1. one\n> quote\ntext\n```\ncode\n```');
  assert.deepEqual(b.map((x) => x.type), ['heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'quote', 'paragraph', 'code']);
  assert.deepEqual(b[2].bulleted_list_item.rich_text.map((r) => [r.text.content, Boolean(r.annotations?.bold)]), [['Bold:', true], [' item', false]]);
  assert.ok(rich('x'.repeat(5000)).every((r) => r.text.content.length <= 1900));
  const blocked = packBlocks({ folder: '/f', status: 'blocked', date: '2026-11-05', detail: 'CV line check: x' });
  assert.equal(blocked.length, 3);
  assert.match(blocked[2].callout.rich_text[0].text.content, /CV line check: x/);
});

// --- D98–D99: recruiter-file rules -------------------------------------------------------
const RULES = {
  locked: [{ name: 'AI agent', any_of: ['Built an AI agent'] }, { name: 'Beta report', any_of: ['Cut a daily report'] }],
  line_rules: [{ name: 'Side tool: no sales claims', line_starts: '**Side tool**', mention: ['Side tool'], forbidden: ['sales', 'customers'] }],
  tailoring_rules: 'tailoring-rules.md',
  name_notes: ['Acme Leo is a client; it is not the company Lio.'],
  ai_native_sentence: 'Built a small tool for one user.',
  keyword_bank: 'keyword-bank.md',
};

test('locked lines must appear (reworded is fine); a rule that matches no cv.md line is a settings error', () => {
  assert.deepEqual(cvRuleProblems(RULES, lines, good), []);
  const dropped = structuredClone(good);
  dropped.experience[0].bullets = dropped.experience[0].bullets.filter((b) => !b.source_ids.includes('e1b1'));
  assert.deepEqual(cvRuleProblems(RULES, lines, dropped), ['locked line left out: AI agent']);
  assert.throws(() => lockedIds({ ...RULES, locked: [{ name: 'x', any_of: ['Nothing like this'] }] }, lines), /matches no cv\.md line/);
});

test('a line rule blocks its words only where that line is described', () => {
  const t = structuredClone(good);
  t.experience[1].bullets[0].text = 'Cut a daily report to under 30 minutes for the sales team.';
  assert.deepEqual(cvRuleProblems(RULES, lines, t), []); // not the ruled line: "sales" is fine
  const draft = 'At the Side tool I won customers. Separately, I partnered with a sales team.';
  const p = draftRuleProblems(RULES, draft, 'cover letter');
  assert.equal(p.length, 1);
  assert.match(p[0], /cover letter: Side tool: no sales claims: "customers"/);
});

test('the headline is the posting title without location or work-model tags', () => {
  assert.equal(headlineFromTitle('AI Strategist (New York)'), 'AI Strategist');
  assert.equal(headlineFromTitle('Forward Deployed Strategist – NYC'), 'Forward Deployed Strategist');
  assert.equal(headlineFromTitle('Strategist, Agent Development - Public Sector'), 'Strategist, Agent Development - Public Sector');
  assert.equal(headlineFromTitle('Deployment Strategist (Remote, US)'), 'Deployment Strategist');
  assert.equal(headlineFromTitle('AI Deployment Manager - Builder'), 'AI Deployment Manager - Builder');
});

test('cv-rules.json is required and checked', () => {
  const d = mkdtempSync(join(tmpdir(), 'rules-'));
  assert.throws(() => loadCvRules(join(d, 'cv-rules.json')), /not found/);
  writeFileSync(join(d, 'cv-rules.json'), JSON.stringify({ ...RULES, ai_native_sentence: '' }));
  assert.throws(() => loadCvRules(join(d, 'cv-rules.json')), /needs "ai_native_sentence"/);
  writeFileSync(join(d, 'cv-rules.json'), JSON.stringify({ ...RULES, locked: [{ name: 'x' }] }));
  assert.throws(() => loadCvRules(join(d, 'cv-rules.json')), /needs "name" and "any_of"/);
  writeFileSync(join(d, 'cv-rules.json'), JSON.stringify(RULES));
  assert.equal(loadCvRules(join(d, 'cv-rules.json')).locked.length, 2);
});

test('fit report: measured scores are labeled measured, the AI\'s estimate is labeled an estimate', () => {
  const fr = { verdict: 'Medium', requirements: [{ requirement: 'SQL', posting_quote: 'Strong SQL', evidence: 'Strong', cv_source_ids: ['e1b1'] }],
    keywords: ['SQL'], rejection_risks: ['No healthcare'], questions_for_you: [], recruiter_impact: { score: 70, why: 'proof points are high on the page' } };
  const md = fitReportMarkdown('Acme — Role', fr, { archetype: 'pilot_led_deployment', lines,
    coverage: { coveragePct: 33, presentCount: 1, total: 3, present: ['SQL'], missing: ['go-live', 'onboarding'] },
    supportedCoverage: { coveragePct: 50, presentCount: 1, total: 2, present: ['SQL'], missing: ['go-live'] },
    ats: { score: 100, grade: 'A', issues: [] }, pages: 1 });
  assert.match(md, /\*\*Verdict:\*\* Medium · \*\*Role type:\*\* Pilot-led deployment/);
  assert.match(md, /ATS structure \| 100\/100 \(A\) \| measured/);
  assert.match(md, /Keyword coverage, all core terms \| 33% \(1 of 3\)/);
  assert.match(md, /Keyword coverage, your bank terms this posting uses \| 50% \(1 of 2\)/);
  assert.match(md, /Supported but not verbatim on the CV:\*\* go-live/);
  assert.match(md, /Terms your CV doesn't support:\*\* onboarding/);
  assert.match(md, /Recruiter impact \| 70\/100 \| AI estimate, not a measurement/);
  assert.match(md, /- None\./);
  const blocks = markdownBlocks(md);
  assert.ok(blocks.some((b) => b.type === 'bulleted_list_item' && /ATS structure · 100\/100/.test(b.bulleted_list_item.rich_text.map((r) => r.text.content).join(''))));
  assert.ok(!blocks.some((b) => /\|---/.test(JSON.stringify(b))));
});

test('names with numbers are not claims for the fact gate; a whole job may be cited in interview prep', () => {
  assert.equal(spellNumberNames('owned a Fortune 500 go-live, beat the S&P 500'), 'owned a Fortune-list go-live, beat the S&P-index');
  assert.deepEqual(numberProblems('a Fortune 500 operations team', 'an operations team'), []);
  // D118: a role's opening time frame isn't a claim (blocked the Trunk Tools pack on 2026-11-13).
  assert.deepEqual(numberProblems("I'd welcome a short conversation about the first 90 days.", 'an operations team'), []);
  assert.deepEqual(numberProblems('a 30-60-90 plan for the next 60-day stretch', 'an operations team'), []);
  assert.match(numberProblems('cut costs 90% in 90 days', 'cut costs').join(), /"90%" is not in the source line.*"90" is not in the source line/);
  const docs = { cover_letter: 'Dear Hiring Team. Sincerely, Pat', outreach: { leader_name: null, leader_title: null, leader_note: null, hiring_manager_note: 'Hi.' },
    interview_prep: { likely_questions: [{ question: 'q', posting_quote: null, answer_outline: 'At Acme…', cv_source_ids: ['e1'] }], gaps: [] } };
  assert.deepEqual(checkDocs(docs, { lines, cvText: CV, companyText: '', jdText: '', leaders: [], jobIds: new Set(['e1', 'e2']) }), []);
  assert.match(checkDocs(docs, { lines, cvText: CV, companyText: '', jdText: '', leaders: [] })[0], /unknown CV line e1/);
});

test('every pack README opens with the ATS check (D102)', () => {
  const p = { url: 'https://x' };
  const scores = { ats: { score: 99, grade: 'A', issues: [] }, coverage: { coveragePct: 50, presentCount: 10, total: 20 }, supportedCoverage: { coveragePct: 92, presentCount: 12, total: 13 }, pages: 2 };
  const md = readme('Acme — Role', p, { status: 'ready', detail: null, warnings: [], date: '2026-11-05', scores });
  assert.match(md, /## ATS check\n\n- \*\*ATS structure:\*\* \*\*99\/100\*\* \(A\)/);
  assert.match(md, /all core terms \(rough\):\*\* \*\*50%\*\* \(10 of 20\)/);
  assert.match(md, /your bank terms this posting uses:\*\* \*\*92%\*\* \(12 of 13\)/);
  assert.ok(md.indexOf('## ATS check') < md.indexOf('## Before you apply'));
  assert.match(readme('Acme — Role', p, { status: 'blocked', detail: 'x', warnings: [], date: '2026-11-05' }), /Not measured: the pack stopped before the CV was checked/);
});

test('keyword bank: terms are read (never the Never list), and the posting\'s own wording of them is found', () => {
  const md = '# Bank\n\n## Deployment\n- implementation, go-live — the migration.\n- playbook — the kit.\n\n## Never\n- C-suite\n';
  assert.deepEqual(bankTerms(md), ['implementation', 'go-live', 'playbook']);
  assert.deepEqual(postingBankTerms(['implementation', 'go-live', 'playbook'], 'Own Implementations and build Playbooks to go-live.'), ['Implementations', 'go-live', 'Playbooks']);
});

test('a bullet citing a whole job is read as citing its description line', () => {
  const t = structuredClone(good);
  t.experience[0].bullets[0] = { text: 'Analytics partner to 10+ leaders.', source_ids: ['e1'] };
  assert.deepEqual(checkTailored(cv, lines, t).problems, []);
  assert.deepEqual(t.experience[0].bullets[0].source_ids, ['e1c']);
});

test('what a number counts: "10K clients" is flagged when the CV says "10K+ customer estimates" (D104)', () => {
  const src = 'Analyzed a pilot across 250K+ returns and 10K+ customer estimates. Led 2 end to end as the sole consultant. Rolled out to the ~40-person team; nearly 300 fraudulent referral codes.';
  assert.match(countedNounWarnings('Reviewed 10K clients.', src, 'interview prep')[0], /check this number \(interview prep\): "10K clients", but your CV says "10K\+ customer estimates"/);
  assert.deepEqual(countedNounWarnings('across 10K+ customer estimates', src, 'CV'), []);
  assert.deepEqual(countedNounWarnings('led 2 projects end-to-end', src, 'CV'), []); // the source doesn't say what 2 counts
  assert.deepEqual(countedNounWarnings('a ~40 people team', src, 'CV'), []); // person / people
  assert.deepEqual(countedNounWarnings('nearly 300 codes', src, 'CV'), []);
});

test('a tailored description line keeps the source line\'s numbers (D104)', () => {
  const t = structuredClone(good);
  t.experience[0].context = 'Customer-facing analytics partner to 10+ senior leaders, owning priorities.';
  assert.deepEqual(checkTailored(cv, lines, t).problems, []);
  t.experience[0].context = 'Analytics partner to 25 leaders.';
  assert.match(checkTailored(cv, lines, t).problems.join(), /Acme description: "25" is not in the source line/);
  t.experience[0].context = null;
  t.experience[1].context = 'Consultant.';
  assert.match(checkTailored(cv, lines, t).problems.join(), /Beta Co: a description line was written, but cv\.md has none/);
  const p = cvPayload(cv, { ...good, experience: [{ ...good.experience[0], context: 'Customer-facing partner to 10+ leaders.' }, good.experience[1]] }, 'X');
  assert.equal(p.experience[0].context, 'Customer-facing partner to 10+ leaders.');
});

test('placement: a [where]-limited bank term blocks outside its jobs or lines (D105)', () => {
  const md = '## T\n- customer-facing — Beta client work. [where: Beta Co]\n- tradeoffs — the kit. [where: line "Rolled out a migration kit"]\n- customers — anywhere.\n## Never\n- C-suite\n';
  const entries = bankEntries(md);
  assert.deepEqual(entries.map((e) => [e.terms, e.where]), [[['customer-facing'], [{ kind: 'job', value: 'Beta Co' }]], [['tradeoffs'], [{ kind: 'line', value: 'Rolled out a migration kit' }]], [['customers'], null]]);
  const t = structuredClone(good);
  t.experience[0].bullets[0].text = 'Built a customer-facing AI agent for customers, weighing tradeoffs.';
  const p = placementProblems(entries, cv, lines, t).join('\n');
  assert.match(p, /"customer-facing" can't describe this Acme line \(bank: only Beta Co\)/);
  assert.match(p, /"tradeoffs" can't describe this Acme line/);
  assert.doesNotMatch(p, /^"customers"/m); // unrestricted term
  t.experience[0].bullets[0] = { text: 'Rolled out a migration kit, weighing tradeoffs.', source_ids: ['e1b2'] };
  t.experience[1].bullets[0].text = 'Customer-facing: cut a daily report from ~3 hours to under 30 minutes.';
  assert.deepEqual(placementProblems(entries, cv, lines, t), []);
});

test('meaning check: every line you would send is paired with its source; a skipped line is never assumed fine (D106)', () => {
  const docs = { cover_letter: 'Dear Hiring Team,\n\nI cut a daily report from ~3 hours to under 30 minutes at Beta Co, and rolled out a kit to a ~40-person team.\n\nSincerely, Pat', outreach: { leader_note: null, hiring_manager_note: 'Hi, I rolled out a kit to a ~40-person team and would welcome a chat.' } };
  const t = structuredClone(good);
  t.experience[0].context = 'Customer-facing analytics partner to 10+ leaders.';
  const pairs = meaningPairs({ cv, lines, tailored: t, docs });
  assert.deepEqual(pairs.map((p) => p.where), ['CV, Acme description', 'CV, Acme', 'CV, Acme', 'CV, Beta Co', 'CV summary', 'cover letter', 'outreach to the hiring manager']);
  assert.equal(pairs[0].source, 'Analytics partner to 10+ leaders.');
  assert.match(pairs[1].source, /^Built an AI agent that maps files/);
  const v = meaningVerdicts(pairs, { lines: [{ id: 'L1', verdict: 'same', what_changed: null }, { id: 'L2', verdict: 'new_claim', what_changed: '"used by 50 analysts": the source has no user count' }] });
  assert.equal(v[1].verdict, 'new_claim');
  assert.equal(v[2].verdict, 'stronger'); // no verdict returned → flagged, not passed
  const md = meaningMarkdown('Acme — Role', v);
  assert.match(md, /## 🚫 New claim: CV, Acme/);
  assert.match(md, /returned no verdict for this line/);
});

test('a number glued to a letter is a name, not a claim: B2B, S3 (D107)', () => {
  assert.deepEqual(numberProblems("I haven't worked in B2B SaaS, but I built an S3-fed job.", 'Built an automated, S3-fed Python job.'), []);
  assert.deepEqual(numbers('B2B and Q4').map((n) => n.key), []);
  assert.match(numberProblems('Grew revenue 2B.', 'none')[0] ?? '', /"2B" is not in the source/);
});

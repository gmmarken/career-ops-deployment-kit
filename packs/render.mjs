// Turn a checked, tailored CV into career-ops' CV payload, then HTML and PDF through
// career-ops' own scripts (build-cv-html.mjs, generate-pdf.mjs), run via scripts/co.sh
// so they read ../private. generate-pdf.mjs runs career-ops' fact gate again (D10).
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** "**Name** (personal, 2026) -- text" → { name, badge, description }. */
export function projectEntry(text) {
  const m = text.match(/^\*\*(.+?)\*\*\s*(?:\((.+?)\))?\s*--\s*(.+)$/);
  if (!m) throw new Error(`cv.md project line should look like "**Name** (note) -- description": "${text.slice(0, 60)}"`);
  return { name: m[1].trim(), badge: m[2]?.trim() ?? undefined, description: m[3].trim() };
}

/** "M.S., Field -- School (2023). GPA 3.76" → { title, org, year, description }. */
export function educationEntry(text) {
  const m = text.match(/^(.+?)\s+--\s+(.+?)\s*\((\d{4})\)\.?\s*(.*)$/);
  if (!m) throw new Error(`cv.md education line should look like "Degree -- School (YYYY). Detail": "${text.slice(0, 60)}"`);
  return { title: m[1].trim(), org: m[2].trim(), year: m[3], description: m[4].trim() || undefined };
}

/**
 * career-ops payload from the source CV and the tailored parts.
 * tailored: { summary, experience: [{ entry_id, bullets: [{ text }] }], skills: [{ category, items }] }; headline: the posting's title (D98)
 * Job headers, projects, education and the Additional section come from cv.md word for word.
 */
export function cvPayload(cv, tailored, headline) {
  const c = cv.candidate;
  const linkedin = c.linkedin ? { url: c.linkedin.startsWith('http') ? c.linkedin : `https://${c.linkedin}`, display: c.linkedin.replace(/^https?:\/\/(www\.)?/, '') } : undefined;
  return {
    lang: 'en',
    candidate: { name: c.name, title: headline || undefined, email: c.email, phone: c.phone ?? undefined, location: c.location ?? undefined, linkedin },
    summary: tailored.summary,
    competencies: [],
    experience: cv.experience.map((j) => {
      const t = tailored.experience.find((x) => x.entry_id === j.id);
      return { company: j.company, location: j.location ?? undefined, role: j.role, period: j.period, context: (t.context || j.context) ?? undefined, bullets: t.bullets.map((b) => b.text) };
    }),
    projects: cv.projects.map((p) => projectEntry(p.text)),
    education: cv.education.map((e) => educationEntry(e.text)),
    skills: tailored.skills.map((s) => ({ category: s.category, items: s.items.join(', ') })),
    // "Interests" in cv.md; an older "Additional" section is shown under the same heading.
    interests: [...cv.interests, ...cv.additional].map((a) => a.text.replace(/\.$/, '')),
  };
}

/** cv.md itself as the "tailored" parts, word for word: the base resume (no posting, no model). */
export function baseTailored(cv) {
  if (!cv.summary) throw new Error('cv.md: the Professional Summary is empty.');
  return {
    summary: cv.summary,
    experience: cv.experience.map((j) => ({ entry_id: j.id, bullets: j.bullets.map((b) => ({ text: b.text })) })),
    skills: cv.skills,
  };
}

/** The same CV as plain markdown, for the pack folder and the fact check. */
export function cvMarkdown(cv, payload) {
  const c = payload.candidate;
  const out = [`# ${c.name}`, c.title ? `**${c.title}**` : null, [c.location, c.email, c.phone, cv.candidate.linkedin].filter(Boolean).join(' · '), '', '## Professional Summary', '', payload.summary, '', '## Work Experience', ''];
  for (const j of payload.experience) {
    out.push(`### ${j.company}${j.location ? ` -- ${j.location}` : ''}`, '', `**${j.role}**`, j.period, '');
    if (j.context) out.push(j.context, '');
    for (const b of j.bullets) out.push(`- ${b}`);
    out.push('');
  }
  out.push('## Projects', '', ...cv.projects.map((p) => `- ${p.text}`), '', '## Education', '', ...cv.education.map((e) => `- ${e.text}`), '', '## Skills', '');
  for (const s of payload.skills) out.push(`- **${s.category}:** ${s.items}`);
  out.push('', '## Interests', '', ...[...cv.interests, ...cv.additional].map((a) => `- ${a.text}`), '');
  return out.filter((l) => l !== null).join('\n');
}

/** Run a career-ops script through co.sh. Resolves { code, out }. */
export function runCo(args, { co = join(KIT_DIR, 'scripts', 'co.sh'), timeout = 180_000 } = {}) {
  return new Promise((resolve) => {
    execFile(co, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

/** payload.json → cv.html → cv.pdf. Throws with career-ops' own message on any failure. */
export async function renderCv(payloadPath, htmlPath, pdfPath, { run = runCo, maxPages = 1 } = {}) {
  const h = await run(['build-cv-html.mjs', payloadPath, htmlPath]);
  if (h.code !== 0) throw new Error(`CV HTML build failed (career-ops build-cv-html.mjs):\n${h.out.trim().slice(0, 800)}`);
  // career-ops' template keeps an empty consent box hidden by CSS, which ATS checkers read as hidden text (D98).
  const html = readFileSync(htmlPath, 'utf8');
  writeFileSync(htmlPath, html.replace(/\s*<div class="cv-consent"><\/div>/, '').replace(/\s*\.cv-consent:empty \{ display: none; \}/, ''));
  // One page preferred, two allowed (D98): the page count goes in the fit report.
  const p = await run(['generate-pdf.mjs', htmlPath, pdfPath, '--format=letter', '--kind=cv', `--max-pages=${maxPages}`]);
  if (p.code !== 0) throw new Error(`CV PDF failed (career-ops generate-pdf.mjs):\n${p.out.trim().slice(0, 800)}`);
  return p.out;
}

// Read cv.md (the approved facts, D10) into numbered parts, so a tailored CV can say
// which source line each of its bullets came from (D84). Code reads the file; the model
// never sees anything but this structure plus the posting.
//
// Expected cv.md shape (the one Phase 1 wrote):
//   # CV -- Name
//   **Location:** … / **Email:** … / **Phone:** … / **LinkedIn:** …
//   ## Professional Summary  (paragraph)
//   ## Work Experience → ### Company -- Place · **Role** · period line · optional context paragraph · "- " bullets
//   ## Projects / ## Education / ## Interests (or ## Additional) → "- " lines
//   ## Skills → "- **Category:** a, b, c"
// Anything else is an error, so a changed cv.md can't be half-read.

const SECTION = {
  'professional summary': 'summary', 'work experience': 'experience', projects: 'projects',
  education: 'education', skills: 'skills', interests: 'interests', additional: 'additional',
};

const bulletText = (l) => l.replace(/^-\s+/, '').trim();

/** Parse cv.md text. Returns { candidate, summary, experience[], projects[], education[], skills[], additional[] }. */
export function parseCv(md) {
  const lines = String(md).split('\n');
  const head = lines.find((l) => l.startsWith('# '));
  if (!head) throw new Error('cv.md: no "# CV -- Name" heading.');
  const name = head.replace(/^#\s+(CV\s+--\s+)?/i, '').trim();
  const field = (label) => {
    const l = lines.find((x) => x.startsWith(`**${label}:**`));
    return l ? l.slice(`**${label}:**`.length).trim() : null;
  };
  const cv = {
    candidate: { name, location: field('Location'), email: field('Email'), phone: field('Phone'), linkedin: field('LinkedIn') },
    summary: null, experience: [], projects: [], education: [], skills: [], interests: [], additional: [],
  };
  if (!cv.candidate.email) throw new Error('cv.md: no **Email:** line.');
  let section = null;
  let job = null;
  const para = [];
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (l.startsWith('## ')) {
      const key = SECTION[l.slice(3).trim().toLowerCase()];
      if (!key) throw new Error(`cv.md: unknown section "${l.slice(3).trim()}". Known: ${Object.keys(SECTION).join(', ')}.`);
      section = key; job = null; continue;
    }
    if (!section || !l.trim()) continue;
    if (section === 'summary') { para.push(l.trim()); continue; }
    if (section === 'experience') {
      if (l.startsWith('### ')) {
        const [company, place] = l.slice(4).split(/\s+--\s+/);
        job = { id: `e${cv.experience.length + 1}`, company: company.trim(), location: place?.trim() ?? null, role: null, period: null, context: null, bullets: [] };
        cv.experience.push(job);
        continue;
      }
      if (!job) throw new Error(`cv.md: text under Work Experience before any "### Company" line: "${l.slice(0, 60)}"`);
      if (/^\*\*.+\*\*$/.test(l.trim()) && !job.role) { job.role = l.trim().slice(2, -2); continue; }
      if (job.role && !job.period && !l.startsWith('- ')) { job.period = l.trim(); continue; }
      if (l.startsWith('- ')) { job.bullets.push({ id: `${job.id}b${job.bullets.length + 1}`, text: bulletText(l) }); continue; }
      if (!job.context) { job.context = l.trim(); continue; }
      throw new Error(`cv.md: unexpected line under ${job.company}: "${l.slice(0, 60)}"`);
    }
    if (!l.startsWith('- ')) throw new Error(`cv.md: expected a "- " line under ${section}: "${l.slice(0, 60)}"`);
    const t = bulletText(l);
    if (section === 'skills') {
      const m = t.match(/^\*\*(.+?):\*\*\s*(.+)$/);
      if (!m) throw new Error(`cv.md: skills line should look like "- **Category:** a, b": "${t.slice(0, 60)}"`);
      cv.skills.push({ category: m[1].trim(), items: m[2].split(',').map((s) => s.trim()).filter(Boolean) });
    } else cv[section].push({ id: `${section[0]}${cv[section].length + 1}`, text: t });
  }
  cv.summary = para.join(' ') || null;
  for (const j of cv.experience) if (!j.role || !j.period) throw new Error(`cv.md: ${j.company} needs a **Role** line and a period line.`);
  if (!cv.experience.length) throw new Error('cv.md: no Work Experience entries.');
  return cv;
}

/** Every bullet line by id (experience bullets, projects, education, additional). */
export function sourceLines(cv) {
  const m = new Map();
  for (const j of cv.experience) {
    for (const b of j.bullets) m.set(b.id, { ...b, entry: j.id });
    if (j.context) m.set(`${j.id}c`, { id: `${j.id}c`, text: j.context, entry: j.id });
  }
  for (const k of ['projects', 'education', 'interests', 'additional']) for (const x of cv[k]) m.set(x.id, { ...x, entry: k });
  if (cv.summary) m.set('summary', { id: 'summary', text: cv.summary, entry: 'summary' });
  return m;
}

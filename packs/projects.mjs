// The project map (D90): every tailored CV bullet → the cv.md line it came from → the real
// project behind it, from the candidate's own notes in private/cv-projects.md. It's for his
// review before applying ("can I speak to this?"), so it stays in the pack folder on the Mac.
//
// private/cv-projects.md, one section per cv.md line:
//   ## Short name
//   Line: <the start of the cv.md line, enough to tell it apart>
//   Was on: <which old resume it came from> (optional, a reminder)
//   Project: …
//   What I did: …
//   Who I worked with: …
//   What I'd say in an interview: …
// A section with nothing filled in after "Line:" counts as missing notes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const NOTE_FIELDS = ['Project', 'What I did', 'Who I worked with', 'What I\'d say in an interview'];
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').replace(/[.…]+$/, '').trim();

/** Parse cv-projects.md. Returns [{ title, line, fields: { name: text }, filled }]. */
export function parseProjectNotes(md) {
  const out = [];
  let cur = null;
  for (const raw of String(md).split('\n')) {
    const l = raw.trimEnd();
    if (l.startsWith('## ')) { cur = { title: l.slice(3).trim(), line: null, fields: {}, filled: false }; out.push(cur); continue; }
    if (!cur) continue;
    const m = l.match(/^([A-Za-z' ]+):\s*(.*)$/);
    if (m && m[1] === 'Line') { cur.line = m[2].trim(); continue; }
    if (m && m[1] === 'Was on') { cur.was = m[2].trim(); continue; }
    if (m && NOTE_FIELDS.includes(m[1])) { cur.fields[m[1]] = m[2].trim(); if (m[2].trim()) cur.filled = true; continue; }
    if (l.trim() && Object.keys(cur.fields).length) {
      const last = Object.keys(cur.fields).at(-1);
      cur.fields[last] = `${cur.fields[last]} ${l.trim()}`.trim();
      cur.filled = true;
    }
  }
  for (const n of out) if (!n.line) throw new Error(`cv-projects.md: section "${n.title}" has no "Line:" telling which cv.md line it explains.`);
  return out;
}

/** The notes for one cv.md line (its text starts with the section's Line:), or null. */
export function notesFor(text, notes) {
  const t = norm(text);
  return notes.find((n) => t.startsWith(norm(n.line))) ?? null;
}

export function loadProjectNotes(path) {
  return existsSync(path) ? parseProjectNotes(readFileSync(path, 'utf8')) : [];
}

/** Lines of cv.md (experience bullets, context lines, projects) with no notes yet. */
export function linesWithoutNotes(lines, notes) {
  return [...lines.values()].filter((l) => !['summary', 'education', 'interests', 'additional'].includes(l.entry))
    .filter((l) => !notesFor(l.text, notes)?.filled);
}

/** Add an empty section for every cv.md line that has none. Returns how many were added. */
export function addMissingSections(path, lines, notes) {
  const missing = [...lines.values()].filter((l) => !['summary', 'education', 'interests', 'additional'].includes(l.entry))
    .filter((l) => !notesFor(l.text, notes));
  if (!missing.length) return 0;
  const head = existsSync(path) ? readFileSync(path, 'utf8').trimEnd() : [
    '# The projects behind my CV lines',
    '',
    'Private: never copied into the repo or Notion. One section per cv.md line, so every prep pack can show',
    'which project each bullet comes from (cv-map.md in the pack). Keep H&R Block details at the level cv.md',
    'already uses: no internal system names, client names or non-public numbers.',
  ].join('\n');
  const sections = missing.map((l) => [
    '', `## ${l.text.replace(/\*\*/g, '').split(/[.:;,(]/)[0].trim().split(/\s+/).slice(0, 8).join(' ')}`,
    `Line: ${l.text.slice(0, 70)}`, ...NOTE_FIELDS.map((f) => `${f}: `),
  ].join('\n'));
  writeFileSync(path, `${head}\n${sections.join('\n')}\n`);
  return missing.length;
}

/** cv-map.md for one pack. */
export function mapMarkdown(role, cv, lines, tailored, notes) {
  const out = [`# CV map: ${role}`, '', 'Each line of the tailored CV, the cv.md line it came from, and the project behind it (your notes in private/cv-projects.md). Read it before applying: if you can\'t speak to a line, take it out.', ''];
  let missing = 0;
  for (const e of tailored.experience) {
    const job = cv.experience.find((j) => j.id === e.entry_id);
    out.push(`## ${job.company}: ${job.role}`, '');
    if (e.context && job.context && e.context !== job.context) out.push(`- **Description line:** ${e.context}`, `  - **From cv.md:** ${job.context}`);
    for (const b of e.bullets) {
      out.push(`- **CV line:** ${b.text}`);
      for (const id of b.source_ids) {
        const src = lines.get(id);
        if (!src) continue;
        out.push(`  - **From cv.md:** ${src.text}`);
        const n = notesFor(src.text, notes);
        if (n?.filled) out.push(`  - **Project:** ${n.title}`, ...NOTE_FIELDS.filter((f) => n.fields[f]).map((f) => `    - ${f}: ${n.fields[f]}`));
        else { missing++; out.push(`  - ⚠️ **No project notes yet.** Add them to private/cv-projects.md.${n?.was ? ` (Was on: ${n.was})` : ''}`); }
      }
    }
    out.push('');
  }
  return { markdown: out.join('\n'), missing };
}

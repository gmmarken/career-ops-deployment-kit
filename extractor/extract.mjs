// Judgment extraction: JD text + candidate context in, schema-checked facts out.
// The model gets no tools. Its answer is checked against judgment.schema.json by
// our own code; anything off-form throws.
import { readFileSync } from 'node:fs';
import { runClaude } from './claude.mjs';
import { assertValid } from './validate.mjs';

const here = (f) => new URL(`./${f}`, import.meta.url);
export const JUDGMENT_SCHEMA = JSON.parse(readFileSync(here('judgment.schema.json')));
export const SYSTEM_PROMPT = readFileSync(here('prompt.md'), 'utf-8');

/** Pull one "## Heading" section (to the next "## ") out of a markdown file. */
export function markdownSection(md, heading) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) throw new Error(`Section "## ${heading}" not found in _profile.md`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start, end === -1 ? undefined : end).join('\n').trim();
}

/** The user message: candidate context first, untrusted posting last and fenced. */
export function buildInput({ jdText, targets, cv }) {
  if (!jdText?.trim()) throw new Error('Job description text is empty; nothing to extract.');
  return [
    '<candidate_targets>', targets.trim(), '</candidate_targets>',
    '', '<candidate_cv>', cv.trim(), '</candidate_cv>',
    '', '<job_posting>', jdText.trim(), '</job_posting>',
    '', 'Fill in the form for this job posting.',
  ].join('\n');
}

export async function extractJudgment({ jdText, targets, cv, model }) {
  const { data, usage } = await runClaude({
    systemPrompt: SYSTEM_PROMPT,
    input: buildInput({ jdText, targets, cv }),
    schema: JUDGMENT_SCHEMA,
    tools: [],
    model,
  });
  return { judgment: assertValid(data, JUDGMENT_SCHEMA, 'Extracted facts'), usage };
}

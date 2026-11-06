// Prep packs in Notion (D87): two Job Postings columns and the pack's text in the role's page.
//   Make pack  (checkbox, yours): tick it to queue a pack for any role; read every run.
//   Prep pack  (select, the kit's): Queued / Ready / Blocked / Failed / Dropped.
// The CV PDF stays on the Mac (iCloud-synced folder); the page says where.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { select, readProp } from '../notion/client.mjs';

export const PACK_STATUS = { queued: 'Queued', ready: 'Ready', blocked: 'Blocked', failed: 'Failed', dropped: 'Dropped (role closed)' };
export const JOBS_V7 = {
  'Make pack': { checkbox: {} },
  'Prep pack': { select: { options: [['Queued', 'yellow'], ['Ready', 'green'], ['Blocked', 'red'], ['Failed', 'red'], ['Dropped (role closed)', 'gray']].map(([name, color]) => ({ name, color })) } },
};

/** Add the two columns to an existing Job Postings database (idempotent). */
export async function ensureJobsColumns(client, cfg) {
  const ds = await client.api(`data_sources/${cfg.jobs_data_source_id}`);
  const patch = {};
  for (const [name, def] of Object.entries(JOBS_V7)) if (!ds.properties[name]) patch[name] = def;
  if (Object.keys(patch).length) await client.api(`data_sources/${cfg.jobs_data_source_id}`, 'PATCH', { properties: patch });
  return Object.keys(patch);
}

/** Job Postings rows with Make pack ticked: [{ key, pageId }]. */
export async function tickedRoles(client, cfg) {
  const pages = await client.queryAll(cfg.jobs_data_source_id, { filter: { property: 'Make pack', checkbox: { equals: true } } });
  return pages.map((pg) => ({ key: readProp(pg.properties.Key), pageId: pg.id })).filter((r) => r.key);
}

/** The Job Postings page id for a posting key, or null. */
export async function jobPageId(client, cfg, urlKey) {
  const r = await client.queryAll(cfg.jobs_data_source_id, { filter: { property: 'Key', rich_text: { equals: urlKey } } });
  return r[0]?.id ?? null;
}

export async function setPackStatus(client, pageId, status) {
  await client.api(`pages/${pageId}`, 'PATCH', { properties: { 'Prep pack': select(PACK_STATUS[status]) } });
}

// --- markdown → Notion blocks (headings, bullets, numbered items, quotes, code, paragraphs) ---

const MAX = 1900;
/** Rich text with **bold** spans, split under Notion's 2000-character limit. */
export function rich(s) {
  const out = [];
  for (const [i, part] of String(s).split('**').entries()) {
    for (let k = 0; k < part.length; k += MAX) {
      const chunk = part.slice(k, k + MAX);
      if (chunk) out.push({ type: 'text', text: { content: chunk }, ...(i % 2 ? { annotations: { bold: true } } : {}) });
    }
  }
  return out;
}
const block = (type, s, extra = {}) => ({ object: 'block', type, [type]: { rich_text: rich(s), ...extra } });

export function markdownBlocks(md) {
  const blocks = [];
  const lines = String(md).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      const text = code.join('\n');
      const parts = [];
      for (let k = 0; k < text.length; k += MAX) parts.push({ type: 'text', text: { content: text.slice(k, k + MAX) } });
      blocks.push({ object: 'block', type: 'code', code: { rich_text: parts.slice(0, 100), language: 'plain text' } });
      continue;
    }
    if (!l.trim()) continue;
    // Markdown tables become bullets ("cell · cell"); the separator row is dropped.
    if (l.startsWith('|')) {
      if (/^\|[\s|:-]+\|$/.test(l)) continue;
      blocks.push(block('bulleted_list_item', l.split('|').slice(1, -1).map((c) => c.trim().replace(/<br>/g, '; ')).join(' · ')));
      continue;
    }
    if (l.startsWith('### ')) blocks.push(block('heading_3', l.slice(4)));
    else if (l.startsWith('## ')) blocks.push(block('heading_3', l.slice(3)));
    else if (l.startsWith('# ')) blocks.push(block('heading_2', l.slice(2)));
    else if (l.startsWith('- ')) blocks.push(block('bulleted_list_item', l.slice(2)));
    else if (/^\d+\.\s/.test(l)) blocks.push(block('numbered_list_item', l.replace(/^\d+\.\s/, '')));
    else if (l.startsWith('> ')) blocks.push(block('quote', l.slice(2)));
    else blocks.push(block('paragraph', l));
  }
  return blocks;
}

/** The blocks added to a role's page for a finished pack. */
export function packBlocks({ folder, status, date, detail }) {
  const head = [
    { object: 'block', type: 'divider', divider: {} },
    block('heading_1', `📦 Prep pack (${date})${status === 'blocked' ? ': BLOCKED' : ''}`),
    block('callout', status === 'blocked'
      ? `A fact check failed, so this pack isn't ready: ${detail}`
      : `Drafts for you to review and send yourself. The tailored CV is a PDF on your Mac: ${folder}/cv.pdf (also in iCloud Drive → Files). Read it line by line before applying.`,
    { icon: { type: 'emoji', emoji: status === 'blocked' ? '🚫' : '📝' } }),
  ];
  if (status === 'blocked') return head;
  const doc = (title, name) => (existsSync(join(folder, name)) ? [block('heading_2', title), ...markdownBlocks(readFileSync(join(folder, name), 'utf8').replace(/^# .*\n/, ''))] : []);
  return [...head, ...doc('Fit report', 'fit-report.md'), ...doc('Cover letter', 'cover-letter.md'), ...doc('Outreach drafts', 'outreach.md'), ...doc('Interview prep', 'interview-prep.md'), ...doc('Research next', 'research-next.md'), ...doc('What the CV tailoring changed', 'cv-changes.md')];
}

/** Append blocks to a page, 100 at a time (Notion's limit per request). */
export async function appendBlocks(client, pageId, blocks) {
  for (let i = 0; i < blocks.length; i += 100) {
    await client.api(`blocks/${pageId}/children`, 'PATCH', { children: blocks.slice(i, i + 100) });
  }
}

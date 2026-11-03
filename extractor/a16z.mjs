// a16z's portfolio job board (jobs.a16z.com, D61). It is not on Getro. What it publishes
// openly: a sitemap with one page per portfolio company, and on each page the company's
// job titles (standard schema.org data) and links to the company's own job board.
// Used only to FIND boards; postings are then read from those boards as usual. No AI.
import { USER_AGENT, boardFromUrl } from './ats.mjs';

const TIMEOUT_MS = 30_000;
export const PAGE_DELAY_MS = 1_500;

async function getText(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': USER_AGENT } });
  } catch (err) {
    throw new Error(`Could not reach ${url}: ${err.message}`);
  }
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}.`);
  return res.text();
}

/** Every company jobs page the board lists: [{ slug, url }]. Throws if there are none. */
export async function listCompanyPages(baseUrl, get = getText) {
  const root = `${baseUrl.replace(/\/+$/, '')}/sitemap.xml`;
  const xml = await get(root);
  const pages = [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((m) => m[1].replace(/&amp;/g, '&'))
    .map((url) => { const m = url.match(/^https?:\/\/[^/]+\/jobs\/([^/?#]+)\/?$/); return m ? { slug: m[1], url } : null; })
    .filter(Boolean);
  if (!pages.length) throw new Error(`${root} lists no company job pages. The board's layout may have changed.`);
  return pages;
}

/**
 * A company jobs page → { company, titles, boards, unreadable }. Titles come from the
 * page's schema.org "ItemList"; boards from links to Ashby/Greenhouse/Lever/Rippling.
 * Throws when the page carries no job list at all (a changed layout must not read as "no jobs").
 */
export function parseCompanyPage(html, pageUrl = 'the company page') {
  const blocks = [...String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => {
    try { return JSON.parse(m[1]); } catch { throw new Error(`${pageUrl}: structured data is not valid JSON.`); }
  });
  const nodes = blocks.flatMap((b) => (Array.isArray(b['@graph']) ? b['@graph'] : [b]));
  const list = nodes.find((n) => n['@type'] === 'ItemList');
  if (!list) throw new Error(`${pageUrl} has no job list. The board's layout may have changed.`);
  const org = nodes.find((n) => n['@type'] === 'Organization' && n.name && !/andreessen/i.test(n.name));
  const titles = (list.itemListElement || []).map((i) => i?.name).filter(Boolean);
  const links = [...new Set([...String(html).matchAll(/href="(https:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')))];
  const boards = [...new Set(links.map(boardFromUrl).filter(Boolean))];
  const jobHosts = links.filter((l) => /\/(job|jobs|careers|apply|position)/i.test(l) && !/a16z\.com/i.test(l) && !boardFromUrl(l));
  return { company: org?.name ?? null, titles, boards, unreadable: boards.length ? [] : [...new Set(jobHosts.map((l) => new URL(l).hostname))] };
}

export async function fetchCompanyPage(url, get = getText) {
  return parseCompanyPage(await get(url), url);
}

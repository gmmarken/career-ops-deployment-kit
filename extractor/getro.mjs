// Investor job boards hosted on Getro (D50–D51), read from what they publish openly:
// the sitemap (every job link, with the title in the link) and a job's own public page
// (which says where the company really posts it). No search API, no sign-in, no AI.
//
// Getro is used only to FIND companies' own job boards. Postings are then read from
// those boards (Ashby, Greenhouse, Lever) by the existing readers, so every posting in
// the market database still comes from the employer's own board.

import { USER_AGENT } from './ats.mjs';

export { USER_AGENT };
const TIMEOUT_MS = 30_000;
export const PAGE_DELAY_MS = 1_500; // be gentle: one job page every 1.5 s

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

const locs = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));

/** Job-page link → { url, company_slug, title } (title rebuilt from the link), or null if it isn't a job link. */
export function jobFromUrl(url) {
  const m = String(url).match(/^https?:\/\/[^/]+\/companies\/([^/]+)\/jobs\/(\d+)-([^/?#]+)\/?$/);
  if (!m) return null;
  return { url, company_slug: m[1], title: decodeURIComponent(m[3]).replace(/-/g, ' ').trim() };
}

/**
 * Every job link a Getro board publishes. The sitemap is either an index of sitemaps
 * (job links sit in the ones named *jobs*) or a single list. Throws if none are found,
 * so a changed or broken board is reported rather than read as "no jobs".
 */
export async function listGetroJobs(baseUrl, get = getText) {
  const root = `${baseUrl.replace(/\/+$/, '')}/sitemap.xml`;
  const xml = await get(root);
  let urls;
  if (/<sitemapindex/i.test(xml)) {
    const children = locs(xml).filter((u) => /jobs/i.test(u.split('/').pop()));
    if (!children.length) throw new Error(`${root} lists no job sitemaps. The board's layout may have changed.`);
    urls = [];
    for (const c of children) urls.push(...locs(await get(c)));
  } else {
    urls = locs(xml);
  }
  const jobs = urls.map(jobFromUrl).filter(Boolean);
  if (!jobs.length) throw new Error(`${root} has no job links. The board's layout may have changed.`);
  return jobs;
}

/** A Getro job page → where the company posts the job, its title, locations and company name. */
export function parseJobPage(html, pageUrl = 'the job page') {
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`${pageUrl} has no page data. The board's layout may have changed.`);
  let data;
  try { data = JSON.parse(m[1]); } catch (e) { throw new Error(`${pageUrl}: page data is not valid JSON (${e.message}).`); }
  const job = data?.props?.pageProps?.initialState?.jobs?.currentJob;
  if (!job?.url) throw new Error(`${pageUrl} does not say where the job is posted (it may have closed).`);
  return {
    url: job.url,
    title: job.title ?? null,
    company: job.organization?.name ?? null,
    locations: (job.locations || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean),
  };
}

export async function fetchJobPage(url, get = getText) {
  return parseJobPage(await get(url), url);
}

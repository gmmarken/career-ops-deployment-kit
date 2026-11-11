// Search-engine discovery (D52, D66): Google results through Serper find job postings on
// company job boards we can read (Ashby, Greenhouse, Lever, Rippling) for the target titles
// in New York. Only the BOARD is taken from a result; postings are then read from the
// company's own board by the existing readers, like the investor boards (D57, D61).
//
// One search = one Serper credit. A failed search is reported, never replaced by another
// provider (D52).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardFromUrl } from './ats.mjs';

const API = 'https://google.serper.dev/search';
const ACCOUNT_API = 'https://google.serper.dev/account';
const TIMEOUT_MS = 30_000;

/** Credits left on the Serper account (D113). The check itself is free (balance unchanged after it, checked). */
export async function serperBalance(key, { fetchImpl = fetch } = {}) {
  let res;
  try { res = await fetchImpl(ACCOUNT_API, { headers: { 'X-API-KEY': key }, signal: AbortSignal.timeout(TIMEOUT_MS) }); } catch (err) { throw new Error(`Could not reach Serper for the credit balance: ${err.message}`); }
  if (!res.ok) throw new Error(`Serper's account check returned HTTP ${res.status}.${res.status === 401 || res.status === 403 ? ' Check SERPER_API_KEY.' : ''}`);
  const body = await res.json();
  if (!Number.isFinite(body?.balance)) throw new Error("Serper's account answer has no credit balance. Its format may have changed.");
  return body.balance;
}

// The job-board sites a result may come from. Greenhouse has two hosts; one search covers both.
export const SITES = {
  ashby: ['jobs.ashbyhq.com'],
  greenhouse: ['job-boards.greenhouse.io', 'boards.greenhouse.io'],
  lever: ['jobs.lever.co'],
  rippling: ['ats.rippling.com'],
};

/** Read SERPER_API_KEY from <data dir>/.env without printing it. */
export function readSerperKey(dataDir = process.env.CAREER_OPS_DATA_DIR) {
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set.');
  const envPath = join(dataDir, '.env');
  if (!existsSync(envPath)) throw new Error(`No ${envPath}. Add SERPER_API_KEY=<key> there.`);
  const line = readFileSync(envPath, 'utf-8').split('\n').find((l) => l.startsWith('SERPER_API_KEY='));
  const key = line?.slice('SERPER_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error(`SERPER_API_KEY is missing or empty in ${envPath}. Create a key at serper.dev and add SERPER_API_KEY=<key>.`);
  return key;
}

const quote = (s) => `"${String(s).replace(/"/g, '')}"`;

/**
 * Every search for one discovery run: each title on each job-board site, in any of the
 * places, e.g. site:jobs.ashbyhq.com "deployment strategist" ("New York" OR NYC OR Brooklyn).
 * Returns [{ q, ats, title }].
 */
export function buildQueries({ titles, places }) {
  if (!Array.isArray(titles) || !titles.length) throw new Error('serper.titles must be a non-empty list.');
  if (!Array.isArray(places) || !places.length) throw new Error('serper.places must be a non-empty list.');
  const where = places.length === 1 ? quote(places[0]) : `(${places.map((p) => (/\s/.test(p) ? quote(p) : p)).join(' OR ')})`;
  const out = [];
  for (const title of titles) {
    for (const [ats, hosts] of Object.entries(SITES)) {
      const site = hosts.length === 1 ? `site:${hosts[0]}` : `(${hosts.map((h) => `site:${h}`).join(' OR ')})`;
      out.push({ q: `${site} ${quote(title)} ${where}`, ats, title });
    }
  }
  return out;
}

/** Readable boards in a list of result links, each once, in order. */
export function boardsFromLinks(links) {
  const seen = new Set();
  for (const l of links) { const b = boardFromUrl(l); if (b) seen.add(b); }
  return [...seen];
}

/** One search page (10 results = 1 credit at Serper's pricing). Returns the result links. Throws on any failure. */
export async function search(key, q, page = 1, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(API, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
      body: JSON.stringify({ q, num: 10, page }),
    });
  } catch (err) {
    throw new Error(`Could not reach Serper: ${err.message}`);
  }
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? ' Check SERPER_API_KEY, and that the account still has credits.'
      : res.status === 400 ? ' Serper refused the search (out of credits, or the search text was rejected).'
      : res.status === 429 ? ' Too many searches too fast.' : '';
    const err = new Error(`Serper returned HTTP ${res.status} for ${q}.${hint}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  if (!Array.isArray(body.organic)) throw new Error(`Serper's answer for ${q} has no results list. Its format may have changed.`);
  return body.organic.map((r) => r.link).filter(Boolean);
}

// Search-engine discovery run (D66): once every `every_days`, search for the target titles on
// readable job-board sites in New York, and add each company board found to the scan.
// Spending is capped per run (`max_credits_per_run`); one search page = one credit.

import { buildQueries, boardsFromLinks } from '../extractor/serper.mjs';

export const SOURCE = 'serper';
const DAY_MS = 86_400_000;

/** Check and return the serper settings from sources.json. */
export function checkSerperConfig(cfg, where = 'sources.json') {
  const s = cfg?.serper;
  if (!s || typeof s !== 'object') throw new Error(`${where}: "serper" settings are missing. See market/sources.example.json.`);
  for (const k of ['every_days', 'max_credits_per_run', 'max_pages']) {
    if (!Number.isInteger(s[k]) || s[k] < 1) throw new Error(`${where}: serper.${k} must be a whole number of at least 1.`);
  }
  buildQueries(s); // checks titles and places
  return s;
}

/** Is a discovery run due? Returns { due, nextInDays }. Only a run that finished OK counts. */
export function discoveryDue(lastOkAt, everyDays, now = new Date()) {
  if (!lastOkAt) return { due: true, nextInDays: 0 };
  const left = everyDays - (new Date(now) - new Date(lastOkAt)) / DAY_MS;
  return left <= 0 ? { due: true, nextInDays: 0 } : { due: false, nextInDays: Math.ceil(left) };
}

/**
 * One discovery run. `search(q, page)` returns result links. A full first page (10 results)
 * that turned up a new board earns the next page, up to max_pages, while credits last.
 * An error that means every search would fail (bad key, no credits) stops the run.
 * Returns { searches, credits, found, added: [{board, q}], capped, stopped, errors: [] }.
 */
export async function runDiscovery(store, cfg, search, { pause = () => Promise.resolve() } = {}) {
  const out = { searches: 0, credits: 0, found: 0, added: [], capped: false, stopped: false, errors: [] };
  const seen = new Set();
  for (const { q } of buildQueries(cfg)) {
    for (let page = 1; page <= cfg.max_pages; page++) {
      if (out.credits >= cfg.max_credits_per_run) { out.capped = true; break; }
      let links;
      try {
        await pause();
        out.credits++;
        links = await search(q, page);
      } catch (err) {
        out.errors.push(err.message);
        if ([400, 401, 403].includes(err.status)) return { ...out, stopped: true };
        break;
      }
      if (page === 1) out.searches++;
      let newHere = 0;
      for (const board of boardsFromLinks(links)) {
        if (!seen.has(board)) { seen.add(board); out.found++; }
        const company = board.slice(board.indexOf(':') + 1);
        if (store.addBoard(board, company, SOURCE, q).added) { out.added.push({ board, q }); newHere++; }
      }
      if (links.length < 10 || newHere === 0) break;
    }
    if (out.capped) break;
  }
  return out;
}

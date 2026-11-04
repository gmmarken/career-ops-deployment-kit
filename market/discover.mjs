// Search-engine discovery run (D66, D69): once every `every_days`, search for the target titles
// on readable job-board sites in New York, and add each company board found to the scan.
// Spending is capped per run (`max_credits_per_run`); one search page = one credit.
// `core_titles` are searched first, every run. `rotating_titles` share what's left of the cap,
// each run continuing where the last one stopped, so every title gets its turn.

import { buildQueries, boardsFromLinks } from '../extractor/serper.mjs';

export const SOURCE = 'serper';
export const ROTATE_KEY = 'serper_rotation_next';
const DAY_MS = 86_400_000;

/** Check and return the serper settings from sources.json. */
export function checkSerperConfig(cfg, where = 'sources.json') {
  const s = cfg?.serper;
  if (!s || typeof s !== 'object') throw new Error(`${where}: "serper" settings are missing. See market/sources.example.json.`);
  for (const k of ['every_days', 'max_credits_per_run', 'max_pages']) {
    if (!Number.isInteger(s[k]) || s[k] < 1) throw new Error(`${where}: serper.${k} must be a whole number of at least 1.`);
  }
  if ('titles' in s) throw new Error(`${where}: serper.titles was split in two (D69): core_titles (searched every run) and rotating_titles (take turns). See market/sources.example.json.`);
  if (!Array.isArray(s.core_titles) || !s.core_titles.length) throw new Error(`${where}: serper.core_titles must be a non-empty list.`);
  if (!Array.isArray(s.rotating_titles)) throw new Error(`${where}: serper.rotating_titles must be a list (it may be empty).`);
  const all = [...s.core_titles, ...s.rotating_titles].map((t) => String(t).toLowerCase());
  if (new Set(all).size !== all.length) throw new Error(`${where}: a title is listed twice in serper.core_titles / rotating_titles.`);
  planQueries(s, 0); // checks titles and places
  return s;
}

/**
 * The searches for one run, in order: every core search, then the rotating searches starting
 * at position `next` and wrapping around. Returns [{ q, ats, title, rotating }].
 */
export function planQueries(cfg, next = 0) {
  const core = buildQueries({ titles: cfg.core_titles, places: cfg.places }).map((x) => ({ ...x, rotating: false }));
  const rot = cfg.rotating_titles.length ? buildQueries({ titles: cfg.rotating_titles, places: cfg.places }).map((x) => ({ ...x, rotating: true })) : [];
  const start = rot.length ? ((Number(next) || 0) % rot.length + rot.length) % rot.length : 0;
  return [...core, ...rot.slice(start), ...rot.slice(0, start)];
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
 * A board not yet known is added only if `readable(board)` succeeds (one free read of the
 * board), so a dead or unreadable board doesn't fail every daily scan. It is listed instead,
 * and tried again next run.
 * Returns { searches, credits, found, added: [{board, q}], unreadable: [{board, why}], capped, stopped, errors: [],
 *   rotation: { total, done, nextTitle } }.
 */
export async function runDiscovery(store, cfg, search, { pause = () => Promise.resolve(), readable = async () => {}, known = new Set() } = {}) {
  const out = { searches: 0, credits: 0, found: 0, added: [], unreadable: [], capped: false, stopped: false, errors: [] };
  const seen = new Set();
  const have = new Set([...known, ...store.boards().map((b) => b.board)]);
  const rotTotal = cfg.rotating_titles.length ? buildQueries({ titles: cfg.rotating_titles, places: cfg.places }).length : 0;
  const from = rotTotal ? (Number(store.getMeta(ROTATE_KEY)) || 0) % rotTotal : 0;
  let rotDone = 0;
  // Save where the rotation stopped, so the next run picks up from there.
  const finish = (extra = {}) => {
    const nextPos = rotTotal ? (from + rotDone) % rotTotal : 0;
    if (rotTotal) store.setMeta(ROTATE_KEY, nextPos);
    const next = rotTotal ? planQueries(cfg, nextPos).find((x) => x.rotating) : null;
    return { ...out, ...extra, rotation: { total: rotTotal, done: rotDone, nextTitle: next?.title ?? null } };
  };
  for (const { q, rotating } of planQueries(cfg, from)) {
    for (let page = 1; page <= cfg.max_pages; page++) {
      if (out.credits >= cfg.max_credits_per_run) { out.capped = true; break; }
      let links;
      try {
        await pause();
        out.credits++;
        links = await search(q, page);
      } catch (err) {
        out.errors.push(err.message);
        if ([400, 401, 403].includes(err.status)) return finish({ stopped: true });
        if (page === 1 && rotating) rotDone++; // tried; reported above, retried when its turn comes again
        break;
      }
      if (page === 1 && rotating) rotDone++;
      if (page === 1) out.searches++;
      let newHere = 0;
      for (const board of boardsFromLinks(links)) {
        if (seen.has(board)) continue;
        seen.add(board); out.found++;
        if (have.has(board)) continue;
        try { await readable(board); } catch (err) { out.unreadable.push({ board, why: err.message }); continue; }
        const company = board.slice(board.indexOf(':') + 1);
        if (store.addBoard(board, company, SOURCE, q).added) { out.added.push({ board, q }); have.add(board); newHere++; }
      }
      if (links.length < 10 || newHere === 0) break;
    }
    if (out.capped) break;
  }
  return finish();
}

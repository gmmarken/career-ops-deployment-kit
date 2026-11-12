// Company Radar sources and upkeep (Phase 6, D70–D76): newly funded NYC companies from SEC
// Form D filings and funding news, recorded in the market database before they post jobs.
// Network access comes in through the functions passed in, so everything here is testable.
//
// A funding round is matched to a company we already know (by name, ignoring Inc/LLC/AI…).
// A company we don't know gets a Radar record marked by how it was found ("Form D" or
// "News"), unverified, and is researched first in the queue. Nothing is guessed: a round
// with no date keeps no date, a headline the code can't read is listed as such.
import { companyKey, TARGET_FAMILIES } from './classify.mjs';
import { normalizeName } from '../extractor/research.mjs';
import { searchFormD, fetchFormD, screenHit, screenForm, displayName, leadersFromForm, secUserAgent, filingFolder, PAUSE_MS } from '../extractor/formd.mjs';
import { readHeadline, isNyc, relativeDate } from '../extractor/funding-news.mjs';
import { deploymentFit } from '../engine/fit.mjs';
import { NO_DATE } from './store.mjs';

export const FORM_D_SOURCE = 'form_d';
export const TECHCRUNCH_SOURCE = 'news:techcrunch';
export const NEWS_SEARCH_SOURCE = 'news:serper';
const DAY_MS = 86_400_000;
const day = (d) => new Date(d).toISOString().slice(0, 10);

/** Check the Phase 6 settings in sources.json; returns { form_d, funding_news }. */
export function checkRadarConfig(cfg, where = 'sources.json') {
  const f = cfg?.form_d;
  if (!f || typeof f !== 'object') throw new Error(`${where}: "form_d" settings are missing. See market/sources.example.json.`);
  secUserAgent(f.contact_email);
  if (!/^[A-Z]{2}$/.test(f.state ?? '')) throw new Error(`${where}: form_d.state must be a two-letter state code like "NY".`);
  for (const k of ['cities', 'industry_groups']) {
    if (!Array.isArray(f[k]) || !f[k].length || f[k].some((x) => typeof x !== 'string' || !x.trim())) throw new Error(`${where}: form_d.${k} must be a non-empty list of names.`);
  }
  if (typeof f.min_amount_usd !== 'number' || f.min_amount_usd < 0) throw new Error(`${where}: form_d.min_amount_usd must be a number of dollars (0 or more).`);
  if (!Number.isInteger(f.lookback_days) || f.lookback_days < 1 || f.lookback_days > 90) throw new Error(`${where}: form_d.lookback_days must be a whole number from 1 to 90.`);
  const n = cfg?.funding_news;
  if (!n || typeof n !== 'object') throw new Error(`${where}: "funding_news" settings are missing. See market/sources.example.json.`);
  if (!Number.isInteger(n.max_age_days) || n.max_age_days < 1 || n.max_age_days > 90) throw new Error(`${where}: funding_news.max_age_days must be a whole number from 1 to 90 (older news is not counted as newly funded).`);
  if (!Array.isArray(n.techcrunch_feeds) || n.techcrunch_feeds.some((u) => !/^https:\/\/techcrunch\.com\//.test(u))) throw new Error(`${where}: funding_news.techcrunch_feeds must be a list of https://techcrunch.com/… feed links (it may be empty).`);
  const s = n.serper;
  if (!s || !Number.isInteger(s.every_days) || s.every_days < 1 || !Array.isArray(s.queries) || !s.queries.length) {
    throw new Error(`${where}: funding_news.serper needs every_days (whole number, at least 1) and a non-empty queries list.`);
  }
  return { form_d: f, funding_news: n };
}

/** Every company we know, by match key (name and aliases): { name, entry|null }. */
export function companyIndex(store) {
  const recs = new Map(store.companyRecords().map((e) => [e.name, e]));
  const idx = new Map();
  for (const c of store.companies()) {
    const entry = recs.get(c.name) ?? null;
    for (const n of [c.name, ...(entry?.aliases ?? [])]) {
      const k = companyKey(n);
      if (k && !idx.has(k)) idx.set(k, { name: c.name, entry });
    }
  }
  return idx;
}

const newRecord = (name, foundVia) => ({
  name, aliases: [], status: 'unknown', verified: false, watch: false, ai_native: false, stage: 'unknown', investors: [],
  what_they_do: null, parent: null, owner_categories: [], is_mbb: false, sources: [], leaders: [], origin: 'research',
  found_via: foundVia, reason: `Found via ${foundVia ?? 'a job board'}; not researched yet`,
});

/**
 * Record one funding round. f: { name, legal_name?, round, stage, amount_usd, date, source_url,
 * supports, found_via ("Form D" | "News"), source ("form_d" | "news"), nyc, nyc_evidence, leaders }.
 * Returns { name, isNewCompany, newRound, nyc }.
 */
export function recordFunded(store, idx, f, at = new Date()) {
  const hit = idx.get(companyKey(f.name)) ?? (f.legal_name ? idx.get(companyKey(f.legal_name)) : null) ?? null;
  const name = hit?.name ?? f.name;
  // A company we only knew by name (from a job board) keeps "Job board" as how it was found.
  const e = hit?.entry ? structuredClone(hit.entry) : newRecord(name, hit ? null : f.found_via);
  if (f.legal_name && normalizeName(f.legal_name) !== normalizeName(name) && !(e.aliases ?? []).includes(f.legal_name)) e.aliases = [...(e.aliases ?? []), f.legal_name];
  const round = { round: f.round ?? null, amount_usd: f.amount_usd ?? null, date: f.date ?? null, source_url: f.source_url, found_via: f.source };
  const id = store.company(name, at);
  // Another article about a round already on file is a source for it, not a new round.
  const newRound = store.addFundingRound(id, round, at);
  const last = e.last_raise;
  if (newRound && (!last || (round.date && (!last.date || round.date >= last.date)))) e.last_raise = round;
  if ((!e.stage || e.stage === 'unknown') && f.stage) e.stage = f.stage;
  if (f.nyc && e.nyc_presence !== true) { e.nyc_presence = true; if (!e.nyc_evidence) e.nyc_evidence = f.nyc_evidence ?? null; }
  if (!(e.leaders ?? []).length && f.leaders?.length) e.leaders = f.leaders;
  e.sources = e.sources ?? [];
  if (!e.sources.some((s) => s.url === f.source_url)) e.sources.push({ url: f.source_url, supports: f.supports });
  store.saveCompany(e, { source: f.source, by: 'kit', at });
  idx.set(companyKey(name), { name, entry: e });
  return { name, isNewCompany: !hit, newRound, nyc: e.nyc_presence === true };
}

const usd = (n) => (n == null ? null : n >= 1e9 ? `$${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : `$${Math.round(n / 1e3)}K`);

/** Human page for a Form D (the SEC's own rendering of the filing). */
export const formDPage = (cik, accession) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filingFolder(accession)}/xslFormDX01/primary_doc.xml`;

/**
 * Form D: list the state's filings since the last good run (first run: lookback_days),
 * screen them, open the ones that may count, record those that do.
 * get: { search(args), filing(hit) } (defaults read the SEC). Returns
 * { listed, opened, counted: [{ name, amount_usd, newRound, isNewCompany, nyc, via }], skipped: {why: n}, errors: [] }.
 */
export async function runFormD(store, idx, cfg, { fetchImpl = fetch, pause = () => new Promise((r) => setTimeout(r, PAUSE_MS)), now = new Date() } = {}) {
  const ua = secUserAgent(cfg.contact_email);
  const today = day(now);
  const floor = day(new Date(now) - cfg.lookback_days * DAY_MS);
  const lastOk = store.lastOkScan(FORM_D_SOURCE);
  const fromLast = lastOk ? day(new Date(lastOk) - 3 * DAY_MS) : floor; // overlap 3 days: filings appear in search a little late
  const start = fromLast > floor ? fromLast : floor;
  const hits = await searchFormD({ state: cfg.state, start, end: today, ua, fetchImpl, pause });
  const seen = store.formDSeen();
  const out = { listed: hits.length, start, opened: 0, counted: [], skipped: {}, errors: [] };
  const skip = (why) => { const k = why.replace(/\s*\(.*$/, '').replace(/^industry: .*/, 'industry not on the list').replace(/^raised .*/, 'under the minimum amount'); out.skipped[k] = (out.skipped[k] ?? 0) + 1; };
  for (const h of hits) {
    if (seen.has(h.accession)) continue;
    seen.add(h.accession);
    const why = screenHit(h, cfg);
    if (why) { store.recordFormD({ ...h, city: h.cities[0] ?? null, qualifies: false, why }, now); skip(why); continue; }
    await pause();
    let form;
    try { ({ form } = await fetchFormD(h, ua, fetchImpl)); out.opened++; } catch (err) { out.errors.push(`Form D ${h.entity} (${h.accession}): ${err.message}`); continue; } // not recorded: tried again next run
    const why2 = screenForm(form, cfg);
    let companyId = null;
    if (!why2) {
      const page = formDPage(h.cik, h.accession);
      const name = displayName(form.name);
      const r = recordFunded(store, idx, {
        name, legal_name: form.name, round: null, stage: null, amount_usd: form.amount_sold, date: form.first_sale, source_url: page,
        supports: `SEC Form D filed ${h.filed}: ${usd(form.amount_sold)} sold${form.first_sale ? ` (first sale ${form.first_sale})` : ''}, ${form.industry}, business address in ${form.city}, NY; officers and directors`,
        found_via: 'Form D', source: 'form_d', nyc: true, nyc_evidence: `Form D business address: ${form.city}, ${form.state}`, leaders: leadersFromForm(form, page),
      }, now);
      companyId = store.company(r.name, now);
      out.counted.push({ ...r, amount_usd: form.amount_sold, via: 'Form D' });
    } else skip(why2);
    store.recordFormD({ ...h, city: form.city, industry: form.industry, amount_sold: form.amount_sold, offering: form.offering, first_sale: form.first_sale, qualifies: !why2, why: why2, company_id: companyId }, now);
  }
  return out;
}

/**
 * One news item → recorded, or why not. A headline is recorded when it names a company and
 * either places it in NYC or the company is one we already track (its new round is news to us).
 */
export function considerNews(store, idx, item, { source, label, maxAgeDays, now = new Date() }) {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1) throw new Error('considerNews: maxAgeDays (funding_news.max_age_days) must be a whole number of days.');
  const h = readHeadline(item.title);
  const nyc = isNyc(`${item.title} ${item.text ?? ''}`);
  const base = { url: item.link, source, title: item.title, published: item.published ?? null, nyc };
  if (!h) { store.recordNews({ ...base, outcome: 'not a company-raised-money headline' }, now); return null; }
  // Feeds also carry old stories; only recent news counts as "newly funded". No date, no count.
  if (!item.published) { store.recordNews({ ...base, company: h.company, outcome: NO_DATE }, now); return null; }
  if (item.published < day(new Date(now) - maxAgeDays * DAY_MS)) { store.recordNews({ ...base, company: h.company, outcome: `older than ${maxAgeDays} days; not counted` }, now); return null; }
  const known = idx.get(companyKey(h.company));
  if (!nyc && !known) { store.recordNews({ ...base, company: h.company, outcome: 'not NYC, company not tracked' }, now); return null; }
  const r = recordFunded(store, idx, {
    name: h.company, round: h.round, stage: h.stage, amount_usd: h.amount_usd, date: item.published ?? null, source_url: item.link,
    supports: `${label}: "${item.title}"`, found_via: 'News', source: 'news', nyc, nyc_evidence: nyc ? `In the news as NYC-based: "${item.title}"` : null,
  }, now);
  store.recordNews({ ...base, company: r.name, outcome: 'recorded', company_id: store.company(r.name, now) }, now);
  return { ...r, amount_usd: h.amount_usd, round: h.round, via: 'News' };
}

/** TechCrunch feeds, every run. feed(url) → RSS items. Returns { headlines, counted, errors }. */
export async function runTechCrunch(store, idx, feeds, { feed, maxAgeDays, now = new Date() }) {
  const out = { headlines: 0, counted: [], errors: [] };
  const seen = store.newsSeen();
  for (const url of feeds) {
    let items;
    try { items = await feed(url); } catch (err) { out.errors.push(`TechCrunch ${url}: ${err.message}`); continue; }
    for (const it of items) {
      if (seen.has(it.link)) continue;
      seen.add(it.link);
      out.headlines++;
      const r = considerNews(store, idx, it, { source: TECHCRUNCH_SOURCE, label: 'TechCrunch', maxAgeDays, now });
      if (r) out.counted.push(r);
    }
  }
  return out;
}

/**
 * How far back a news search looks (D113): the time since the last good search, so a daily
 * search reads the past day (fresh stories, few repeats) and a missed day still gets covered.
 */
export function newsWindow(lastOkAt, now = new Date()) {
  if (!lastOkAt) return { tbs: 'qdr:w', label: 'past week' };
  const days = (new Date(now) - new Date(lastOkAt)) / DAY_MS;
  if (days <= 1.1) return { tbs: 'qdr:d', label: 'past day' };
  if (days <= 7) return { tbs: 'qdr:w', label: 'past week' };
  return { tbs: 'qdr:m', label: 'past month' };
}

// --- Serper credits (D113): a warning a week before they run out.
export const SERPER_CREDITS_KEY = 'serper_credit_history';
export const CREDIT_WARN_DAYS = 7;

/**
 * Credits left and how long they last. history: [{at, balance}], oldest first (from meta).
 * The pace is the measured drop over up to 14 days (once 3+ days are recorded), never less than
 * the planned use (news searches + search discovery), so the warning comes early, not late.
 * A balance that went up (credits bought) starts the history over.
 */
export function creditOutlook(history, balance, plannedPerDay, now = new Date()) {
  const prev = history.at(-1);
  let h = prev && balance > prev.balance ? [] : [...history];
  h.push({ at: new Date(now).toISOString(), balance });
  h = h.filter((e) => new Date(now) - new Date(e.at) <= 14 * DAY_MS);
  const days = (new Date(now) - new Date(h[0].at)) / DAY_MS;
  const measured = days >= 3 ? (h[0].balance - balance) / days : 0;
  const perDay = Math.max(measured, plannedPerDay);
  const daysLeft = perDay > 0 ? Math.floor(balance / perDay) : Infinity;
  return { history: h, perDay, daysLeft, low: daysLeft <= CREDIT_WARN_DAYS };
}

/** The radar's credit line; the daily run reads "Serper credits LOW:" for the warning. */
export function creditLine(balance, o) {
  const pace = `about ${Math.round(o.perDay)} a day · about ${o.daysLeft} day${o.daysLeft === 1 ? '' : 's'} left`;
  return o.low
    ? `Serper credits LOW: ${balance.toLocaleString('en-US')} left · ${pace}. Buy more at serper.dev before they run out.`
    : `  ✓ Serper credits: ${balance.toLocaleString('en-US')} left · ${pace}`;
}

/** Is the news search due? Only a run that finished OK counts. */
export function newsSearchDue(lastOkAt, everyDays, now = new Date()) {
  if (!lastOkAt) return { due: true, nextInDays: 0 };
  const left = everyDays - (new Date(now) - new Date(lastOkAt)) / DAY_MS;
  return left <= 0 ? { due: true, nextInDays: 0 } : { due: false, nextInDays: Math.ceil(left) };
}

/**
 * Serper news search (daily, D113). search(q) → [{ title, link, snippet, date, source }].
 * A bad key or no credits stops the remaining searches. Returns { searches, headlines, counted, errors, stopped }.
 */
export async function runNewsSearch(store, idx, queries, { search, maxAgeDays, now = new Date(), pause = () => Promise.resolve() }) {
  const out = { searches: 0, headlines: 0, counted: [], errors: [], stopped: false };
  const seen = store.newsSeen();
  for (const q of queries) {
    let items;
    try { items = await search(q); out.searches++; } catch (err) {
      out.errors.push(`News search "${q}": ${err.message}`);
      if ([400, 401, 403].includes(err.status)) { out.stopped = true; break; }
      continue;
    }
    for (const n of items) {
      if (seen.has(n.link)) continue;
      seen.add(n.link);
      out.headlines++;
      const it = { title: n.title, link: n.link, text: n.snippet, published: relativeDate(n.date, now) };
      const r = considerNews(store, idx, it, { source: NEWS_SEARCH_SOURCE, label: `${n.source ?? 'News'} (via Google News)`, maxAgeDays, now });
      if (r) out.counted.push(r);
    }
    await pause();
  }
  return out;
}

/** The "newly funded NYC companies" line the morning text reads (each company once). */
export function fundedLine(counted) {
  const by = new Map();
  for (const c of counted) if (c.newRound && c.nyc && !by.has(c.name)) by.set(c.name, c);
  if (!by.size) return null;
  const items = [...by.values()].map((c) => `${c.name} (${[usd(c.amount_usd), c.round, c.via].filter(Boolean).join(', ')})`);
  return `Newly funded NYC companies (${by.size}): ${items.join(' · ')}`;
}

/**
 * Research order (D76): companies found through Form D or news first (newest first), then
 * companies with open NYC target-family roles, then everyone else. Returns names.
 */
export function researchOrder(records, postings) {
  const found = records.filter((e) => e.found_via && !e.fit_facts)
    .sort((a, b) => String(b.last_raise?.date ?? '').localeCompare(String(a.last_raise?.date ?? ''))).map((e) => e.name);
  const hiring = [...new Set(postings.filter((p) => !p.closed_at && p.in_home_metro === true && TARGET_FAMILIES.has(p.ai_family ?? p.title_family)).map((p) => p.company))];
  const rest = [...new Set([...records.map((e) => e.name), ...postings.map((p) => p.company)])];
  return [...found, ...hiring, ...rest];
}

/** Open deployment-family postings per company name (any location). */
export function openDeploymentByCompany(postings) {
  const by = new Map();
  for (const p of postings) {
    if (p.closed_at || (p.ai_family ?? p.title_family) !== 'deployment_ai_strategist') continue;
    by.set(p.company, (by.get(p.company) ?? 0) + 1);
  }
  return by;
}

/** Recompute the deployment fit of every researched company; returns the entries that changed. */
export function refit(records, postings) {
  const open = openDeploymentByCompany(postings);
  const changed = [];
  for (const e of records) {
    const r = deploymentFit(e, { openDeployment: open.get(e.name) ?? 0 });
    if (!r || (r.fit === e.fit && r.reason === e.fit_reason)) continue;
    e.fit = r.fit;
    e.fit_reason = r.reason;
    changed.push(e);
  }
  return changed;
}

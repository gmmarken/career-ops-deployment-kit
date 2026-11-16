// Sync between the market database / watchlist and Notion (D26).
//   push: postings → Job Postings, companies → Company Radar. Pipeline-owned properties
//         are rewritten each time; candidate-owned ones are set only on create.
//   pull: Company Radar's Status / Verified / Watch / AI-native → watchlist (companies.json),
//         so the candidate's company calls drive tiering.
// Any Notion error stops the run (fail loudly).
import { createClient, readToken, text, title, select, multi, num, date, check, url, relation, readProp } from './client.mjs';
import { loadNotionConfig } from './setup.mjs';
import { OWNED_BY_YOU, RADAR_V6 } from './schema.mjs';
import { openStore } from '../market/store.mjs';
import { companyKey } from '../market/classify.mjs';
import { loadWatchlist, saveWatchlist, findCompany } from '../extractor/research.mjs';

/** Short, stable tag for a flag string ("Old posting: posted …" → "Old posting"). */
export function flagLabel(flag) {
  const f = String(flag);
  const m = f.match(/^(Red flag: [a-z_0-9]+|Trap: [a-z_]+|Watch: quota path)/);
  if (m) return m[1];
  if (f.startsWith('Company bar:')) return 'Company unverified';
  return f.split(/ — |: /)[0].slice(0, 60);
}

/** "Why" text: the tier plus every step that wasn't a plain pass. */
export function whyText(decision) {
  const quiet = new Set(['none', 'met', 'clear', 'fits']);
  const lines = decision.steps.filter((s) => !quiet.has(s.result)).map((s) => `${s.step}: ${s.result}${s.detail ? ` — ${s.detail}` : ''}`);
  return [`Tier ${decision.tier}`, ...lines].join('\n').slice(0, 1900);
}

/** Job Postings properties for one posting (pipeline-owned + candidate defaults). */
export function postingProps(p, decision, companyPageId, { create }) {
  const j = decision?.facts?.judgment ?? {};
  const props = {
    Role: title(p.title),
    Company: relation(companyPageId ? [companyPageId] : []),
    Tier: select(decision?.tier ?? null),
    Why: text(decision ? whyText(decision) : 'Not tiered yet'),
    Flags: multi((decision?.flags ?? []).map(flagLabel)),
    Family: select(decision?.ai_family ?? p.title_family),
    Shape: select(j.role_shape?.value ?? null),
    Fit: select(j.fit?.value ?? null),
    'GM path': check(j.tags?.gm_path),
    'Product path': check(j.tags?.product_path),
    'Back office': check(j.back_office?.value),
    'Pay min': num(p.pay_interval === 'year' ? p.pay_min : null),
    'Pay max': num(p.pay_interval === 'year' ? p.pay_max : null),
    'Pay source': select(p.pay_source),
    Locations: text(p.locations.join('; ')),
    NYC: check(p.in_home_metro),
    'Work model': select(p.workplace),
    'Office days': num(j.work_model?.office_days ?? null),
    'Years asked': num(j.years_required?.min ?? null),
    Posted: date(p.posted_at),
    'Date added': date(p.first_seen),
    'Last seen': date(p.last_seen),
    Live: check(!p.closed_at),
    Board: select(p.board),
    URL: url(p.url),
    Key: text(p.url_key),
  };
  if (create) Object.assign(props, { Status: select('To review'), Favorite: check(false), Notes: text(''), 'Make pack': check(false) });
  return props;
}

/** How the kit first found a company: a Form D, the news, you (Notion / watchlist), or a job board it scanned. */
export const foundVia = (entry) => entry?.found_via ?? (entry?.origin === 'you' || entry?.origin === 'watchlist' ? 'You' : 'Job board');

/** Company Radar properties from a watchlist entry (or a bare name). */
export function companyProps(name, entry, firstSeen, { create, counts = null }) {
  const e = entry ?? {};
  const raise = e.last_raise ? [e.last_raise.round, e.last_raise.amount_usd ? `$${Math.round(e.last_raise.amount_usd / 1e6)}M` : null, e.last_raise.date].filter(Boolean).join(' · ') : '';
  const props = {
    Name: title(e.name ?? name),
    Stage: select(e.stage && e.stage !== 'unknown' ? e.stage : null),
    'Last raise': text(raise),
    Investors: text((e.investors ?? []).join(', ')),
    'What they do': text(e.what_they_do ?? ''),
    Parent: text(e.parent ?? ''),
    'Excluded as': multi(e.owner_categories ?? []),
    Reason: text(e.reason ?? ''),
    Sources: text((e.sources ?? []).map((s) => s.url).join('\n')),
    Origin: select(entry ? (e.origin === 'research' ? 'research' : 'watchlist') : null),
    'First seen': date(firstSeen),
    ...(counts ? { 'Open postings': num(counts.open), 'Open deployment postings': num(counts.deployment) } : {}),
    'Deployment fit': select(e.fit ?? null),
    'Fit reason': text(e.fit_reason ?? ''),
    'Funding amount': num(e.last_raise?.amount_usd ?? null),
    'Funding date': date(e.last_raise?.date ?? null),
    'Funding source': url(e.last_raise ? (e.last_raise.source_url ?? e.sources?.[0]?.url ?? null) : null),
    'Found via': select(foundVia(entry)),
    Leaders: text((e.leaders ?? []).map((l) => `${l.name} (${l.title})`).join('; ')),
    'NYC presence': select(e.nyc_presence === true ? 'Yes' : e.nyc_presence === false ? 'No' : 'Unknown'),
    'NYC evidence': text(e.nyc_evidence ?? ''),
    'Careers page': url(e.careers_url ?? null),
  };
  if (create) Object.assign(props, {
    Status: select(e.status ?? 'unknown'),
    Verified: check(entry ? e.verified !== false : false),
    Watch: check(Boolean(e.watch)),
    'AI-native': check(Boolean(e.ai_native)),
  });
  return props;
}

// --- Your company columns: three-way reconciliation (D36) ---------------------------
// The kit remembers the value it last wrote to each of your columns (entry.notion_pushed).
//   Notion ≠ last written  → you edited it: your value wins (pull).
//   Notion = last written  → untouched: newer kit info may update it (push).
// A page created before the company was on the watchlist was written with the defaults.
export const OWNED_FIELDS = { status: 'Status', verified: 'Verified', watch: 'Watch', ai_native: 'AI-native' };
export const OWNED_DEFAULTS = { status: 'unknown', verified: false, watch: false, ai_native: false };
export const ownedFromEntry = (e) => ({ status: e.status ?? 'unknown', verified: e.verified !== false, watch: Boolean(e.watch), ai_native: Boolean(e.ai_native) });
export const ownedFromPage = (pg) => Object.fromEntries(Object.entries(OWNED_FIELDS).map(([k, prop]) => {
  const v = readProp(pg.properties[prop]);
  return [k, k === 'status' ? (v || 'unknown') : Boolean(v)];
}));

/**
 * Decide, per field, whether Notion holds your edit or the kit should update it.
 * Returns the edits, the updates, and the fields already in agreement. Callers update
 * entry.notion_pushed only for what they actually do (pull applies edits; sync writes updates).
 */
export function reconcile(notion, pushed, current) {
  const yourEdits = {}, kitUpdates = {}, agreed = {};
  for (const k of Object.keys(OWNED_FIELDS)) {
    if (notion[k] === current[k]) agreed[k] = notion[k];
    else if (notion[k] !== pushed[k]) yourEdits[k] = notion[k];
    else kitUpdates[k] = current[k];
  }
  return { yourEdits, kitUpdates, agreed };
}

const ownedProps = (vals) => Object.fromEntries(Object.entries(vals).map(([k, v]) => [OWNED_FIELDS[k], k === 'status' ? select(v) : check(v)]));

const ownedRemoved = (props, owned) => Object.fromEntries(Object.entries(props).filter(([k]) => !owned.includes(k)));

/** Push postings and their companies: all of them, or only `postingIds`. Returns counts. */
export async function syncAll(dataDir, { log = console.log, postingIds = null, companyNames = null } = {}) {
  const cfg = loadNotionConfig(dataDir);
  const client = createClient(readToken(dataDir));
  const store = openStore();
  const wl = loadWatchlist();
  try {
    // Companies.
    await ensureRadarColumns(client, cfg);
    const radarPages = await client.queryAll(cfg.radar_data_source_id);
    const radarByKey = new Map(radarPages.map((pg) => [companyKey(readProp(pg.properties.Name)), pg]));
    const counts = companyCounts(store.postings());
    let cNew = 0, cUpd = 0, wlChanged = false;
    const onlyPostings = postingIds ? store.postings().filter((p) => postingIds.includes(p.id)) : null;
    // companyNames: only these companies, and no postings (the Radar step, Phase 6).
    const wantNames = companyNames ? new Set(companyNames.map(companyKey)) : null;
    const companies = onlyPostings ? store.companies().filter((c) => onlyPostings.some((p) => p.company_id === c.id))
      : wantNames ? store.companies().filter((c) => wantNames.has(companyKey(c.name))) : store.companies();
    for (const c of companies) {
      const entry = findCompany(wl, c.name);
      const key = companyKey(entry?.name ?? c.name);
      let existing = radarByKey.get(key);
      if (!existing && entry) {
        // Research just named this company: reuse the page made under its board name, renamed (D110).
        const oldKey = [c.name, ...(entry.aliases ?? [])].map(companyKey).find((k) => k !== key && radarByKey.has(k));
        if (oldKey) {
          existing = radarByKey.get(oldKey);
          radarByKey.delete(oldKey);
          radarByKey.set(key, existing);
          log(`Company Radar: renamed page "${readProp(existing.properties.Name)}" to "${entry.name}".`);
        }
      }
      const n = counts.get(c.id) ?? { open: 0, deployment: 0 };
      if (existing) {
        const props = ownedRemoved(companyProps(c.name, entry, c.first_seen, { create: false, counts: n }), OWNED_BY_YOU.radar);
        if (entry) {
          const { kitUpdates, agreed } = reconcile(ownedFromPage(existing), entry.notion_pushed ?? OWNED_DEFAULTS, ownedFromEntry(entry));
          Object.assign(props, ownedProps(kitUpdates));
          const nowPushed = { ...OWNED_DEFAULTS, ...entry.notion_pushed, ...agreed, ...kitUpdates };
          if (JSON.stringify(entry.notion_pushed) !== JSON.stringify(nowPushed)) { entry.notion_pushed = nowPushed; wlChanged = true; }
        }
        await client.api(`pages/${existing.id}`, 'PATCH', { properties: props });
        cUpd++;
      } else {
        const pg = await client.api('pages', 'POST', { parent: { type: 'data_source_id', data_source_id: cfg.radar_data_source_id }, properties: companyProps(c.name, entry, c.first_seen, { create: true, counts: n }) });
        if (entry) { entry.notion_pushed = ownedFromEntry(entry); wlChanged = true; }
        radarByKey.set(key, pg);
        cNew++;
      }
    }
    if (wlChanged) saveWatchlist(wl, { source: 'notion-sync', by: 'kit' });
    // Postings.
    // The Job Postings view holds tiered roles only (D42); every posting still counts on the Radar.
    const postings = wantNames ? [] : (onlyPostings ?? store.postings()).filter((p) => store.latestDecision(p.id));
    const jobPages = wantNames ? [] : onlyPostings
      ? (await Promise.all(postings.map((p) => client.queryAll(cfg.jobs_data_source_id, { filter: { property: 'Key', rich_text: { equals: p.url_key } } })))).flat()
      : await client.queryAll(cfg.jobs_data_source_id);
    const jobsByKey = new Map(jobPages.map((pg) => [readProp(pg.properties.Key), pg.id]));
    let pNew = 0, pUpd = 0;
    for (const p of postings) {
      const decision = store.latestDecision(p.id);
      const entry = findCompany(wl, p.company);
      const companyPage = radarByKey.get(companyKey(entry?.name ?? p.company))?.id ?? null;
      const existing = jobsByKey.get(p.url_key);
      if (existing) {
        await client.api(`pages/${existing}`, 'PATCH', { properties: ownedRemoved(postingProps(p, decision, companyPage, { create: false }), OWNED_BY_YOU.jobs) });
        pUpd++;
      } else {
        await client.api('pages', 'POST', { parent: { type: 'data_source_id', data_source_id: cfg.jobs_data_source_id }, properties: postingProps(p, decision, companyPage, { create: true }) });
        pNew++;
      }
    }
    log(`Notion sync: companies ${cNew} new / ${cUpd} updated; postings ${pNew} new / ${pUpd} updated (${client.calls} Notion calls).`);
    return { cNew, cUpd, pNew, pUpd };
  } finally {
    store.close();
  }
}

/** Read the candidate's company calls from Notion into the watchlist. */
/**
 * Radar pages that match the same company record (by name or alias), e.g. a page made under the
 * job board's name before research named the company (D109, D110). The page named like the
 * company is kept. An extra page still at the defaults holds none of your edits, so it can go
 * to the trash; one with an edit of yours, or a group with no page named like the company, is stuck.
 * Returns { trash: [{ page, keep, company }], stuck: [{ company, pages: [names] }] }.
 */
export function duplicatePlan(pages, wl) {
  const by = new Map();
  for (const pg of pages) {
    const name = readProp(pg.properties.Name);
    if (!name) continue;
    const entry = findCompany(wl, name);
    if (!entry) continue;
    if (!by.has(entry.name)) by.set(entry.name, []);
    by.get(entry.name).push(pg);
  }
  const trash = [];
  const stuck = [];
  const isDefault = (pg) => JSON.stringify(ownedFromPage(pg)) === JSON.stringify(OWNED_DEFAULTS);
  for (const [company, group] of by) {
    if (group.length < 2) continue;
    const keep = group.find((pg) => companyKey(readProp(pg.properties.Name)) === companyKey(company));
    const extras = group.filter((pg) => pg !== keep);
    if (!keep || extras.some((pg) => !isDefault(pg))) {
      stuck.push({ company, pages: group.map((pg) => readProp(pg.properties.Name)) });
      continue;
    }
    for (const page of extras) trash.push({ page, keep, company });
  }
  return { trash, stuck };
}

/** Move extra pages that hold no edits of yours to the Notion trash, relinking their roles first (D110). Returns the pages left. */
export async function cleanDuplicatePages(client, cfg, pages, wl, log) {
  const { trash, stuck } = duplicatePlan(pages, wl);
  if (stuck.length) {
    throw new Error(`Company Radar has more than one page for the same company, and the extra page holds an edit of yours (or none is named like the company), so the kit won't pick one (D109, D110). No company edits were read. In Notion, copy any edit you want onto the page named exactly like the company, move the other page to the trash, then run again:\n  ${stuck.map((d) => `${d.company}: pages ${d.pages.map((n) => `"${n}"`).join(', ')}`).join('\n  ')}`);
  }
  for (const { page, keep, company } of trash) {
    const roles = await client.queryAll(cfg.jobs_data_source_id, { filter: { property: 'Company', relation: { contains: page.id } } });
    for (const r of roles) await client.api(`pages/${r.id}`, 'PATCH', { properties: { Company: relation([keep.id]) } });
    await client.api(`pages/${page.id}`, 'PATCH', { in_trash: true });
    log(`Company Radar: moved duplicate page "${readProp(page.properties.Name)}" to the Notion trash (no edits of yours; ${roles.length} role(s) relinked to "${company}"). Restore it from Notion's trash if needed.`);
  }
  const gone = new Set(trash.map((t) => t.page.id));
  return pages.filter((pg) => !gone.has(pg.id));
}

export async function pullCompanyEdits(dataDir, { verbose = false, log = console.log } = {}) {
  const cfg = loadNotionConfig(dataDir);
  const client = createClient(readToken(dataDir));
  const wl = loadWatchlist();
  const pages = await cleanDuplicatePages(client, cfg, await client.queryAll(cfg.radar_data_source_id), wl, log);
  const changes = [];
  let changed = false;
  for (const pg of pages) {
    const name = readProp(pg.properties.Name);
    if (!name) continue;
    const notion = ownedFromPage(pg);
    let entry = findCompany(wl, name);
    if (!entry) {
      // Not on the watchlist: the page was written with the defaults, so any difference is your edit.
      const { yourEdits } = reconcile(notion, OWNED_DEFAULTS, OWNED_DEFAULTS);
      if (!Object.keys(yourEdits).length) continue;
      entry = { name, aliases: [], ...OWNED_DEFAULTS, stage: 'unknown', owner_categories: [], parent: null, is_mbb: false, origin: 'you', reason: 'Set in Notion', sources: [], notion_pushed: { ...OWNED_DEFAULTS } };
      wl.companies.push(entry);
      changes.push(`${name}: added from Notion`);
    }
    const { yourEdits, agreed } = reconcile(notion, entry.notion_pushed ?? OWNED_DEFAULTS, ownedFromEntry(entry));
    for (const [k, v] of Object.entries(yourEdits)) { changes.push(`${name}: ${k} ${JSON.stringify(ownedFromEntry(entry)[k])} → ${JSON.stringify(v)}`); entry[k] = v; }
    const nowPushed = { ...OWNED_DEFAULTS, ...entry.notion_pushed, ...agreed, ...yourEdits };
    if (JSON.stringify(entry.notion_pushed) !== JSON.stringify(nowPushed)) { entry.notion_pushed = nowPushed; changed = true; }
  }
  if (changes.length || changed) saveWatchlist(wl, { source: 'notion', by: 'you' });
  if (verbose || changes.length) log(changes.length ? `Company edits from Notion:\n  ${changes.join('\n  ')}` : 'No company edits in Notion.');
  return changes;
}

/** Open postings per company: all families, and the deployment family (best label: AI's, else title). */
export function companyCounts(postings) {
  const by = new Map();
  for (const p of postings) {
    if (p.closed_at) continue;
    const c = by.get(p.company_id) ?? { open: 0, deployment: 0 };
    c.open++;
    if ((p.ai_family ?? p.title_family) === 'deployment_ai_strategist') c.deployment++;
    by.set(p.company_id, c);
  }
  return by;
}

/** Bring an existing Company Radar up to the current layout (idempotent). */
export async function ensureRadarColumns(client, cfg) {
  const ds = await client.api(`data_sources/${cfg.radar_data_source_id}`);
  const patch = {};
  for (const name of ['Open postings', 'Open deployment postings']) if (!ds.properties[name]) patch[name] = { number: {} };
  for (const [name, def] of Object.entries(RADAR_V6)) if (!ds.properties[name]) patch[name] = def;
  for (const name of ['Live roles', 'All roles']) if (ds.properties[name]) patch[name] = null;
  if (Object.keys(patch).length) await client.api(`data_sources/${cfg.radar_data_source_id}`, 'PATCH', { properties: patch });
}

/** Where companies or graded roles wait when their Notion sync failed (D119). */
export const CARRY_KEYS = { companyNames: 'notion_unsynced_companies', postingIds: 'notion_unsynced_postings' };

/**
 * Sync these companies (kind 'companyNames') or graded roles ('postingIds'), plus any a failed sync
 * left for this run (D119). On failure all of them wait for the next run and the error is returned,
 * not thrown, so the step can report its other problems. Returns { error, count, carried }.
 */
export async function syncCarrying(dataDir, kind, ids, { log = console.log, sync = syncAll, open = openStore } = {}) {
  const key = CARRY_KEYS[kind];
  if (!key) throw new Error(`syncCarrying: unknown kind ${kind}`);
  const withStore = (fn) => { const st = open(); try { return fn(st); } finally { st.close(); } };
  const prev = withStore((st) => JSON.parse(st.getMeta(key) ?? '[]'));
  const all = [...new Set([...prev, ...ids])];
  const carried = all.length - new Set(ids).size;
  if (!all.length) return { error: null, count: 0, carried: 0 };
  if (carried) log(`Notion: ${carried} left from a run whose sync failed go too.`);
  try {
    await sync(dataDir, { log, [kind]: all });
    if (prev.length) withStore((st) => st.setMeta(key, '[]'));
    return { error: null, count: all.length, carried };
  } catch (err) {
    withStore((st) => st.setMeta(key, JSON.stringify(all)));
    return { error: err.message.split('\n')[0], count: all.length, carried };
  }
}

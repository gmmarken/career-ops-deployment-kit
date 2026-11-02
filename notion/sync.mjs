// Sync between the market database / watchlist and Notion (D26).
//   push: postings → Job Postings, companies → Company Radar. Pipeline-owned properties
//         are rewritten each time; candidate-owned ones are set only on create.
//   pull: Company Radar's Status / Verified / Watch / AI-native → watchlist (companies.json),
//         so the candidate's company calls drive tiering.
// Any Notion error stops the run (fail loudly).
import { writeFileSync } from 'node:fs';
import { createClient, readToken, text, title, select, multi, num, date, check, url, relation, readProp } from './client.mjs';
import { loadNotionConfig } from './setup.mjs';
import { OWNED_BY_YOU } from './schema.mjs';
import { openStore } from '../market/store.mjs';
import { companyKey } from '../market/classify.mjs';
import { loadWatchlist, watchlistPath, findCompany } from '../extractor/research.mjs';

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
  if (create) Object.assign(props, { Status: select('To review'), Favorite: check(false), Notes: text('') });
  return props;
}

/** Company Radar properties from a watchlist entry (or a bare name). */
export function companyProps(name, entry, firstSeen, { create }) {
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
  };
  if (create) Object.assign(props, {
    Status: select(e.status ?? 'unknown'),
    Verified: check(entry ? e.verified !== false : false),
    Watch: check(Boolean(e.watch)),
    'AI-native': check(Boolean(e.ai_native)),
  });
  return props;
}

const ownedRemoved = (props, owned) => Object.fromEntries(Object.entries(props).filter(([k]) => !owned.includes(k)));

/** Push postings and their companies: all of them, or only `postingIds`. Returns counts. */
export async function syncAll(dataDir, { log = console.log, postingIds = null } = {}) {
  const cfg = loadNotionConfig(dataDir);
  const client = createClient(readToken(dataDir));
  const store = openStore();
  const wl = loadWatchlist(watchlistPath(dataDir));
  try {
    // Companies.
    const radarPages = await client.queryAll(cfg.radar_data_source_id);
    const radarByKey = new Map(radarPages.map((pg) => [companyKey(readProp(pg.properties.Name)), pg.id]));
    let cNew = 0, cUpd = 0;
    const onlyPostings = postingIds ? store.postings().filter((p) => postingIds.includes(p.id)) : null;
    const companies = onlyPostings ? store.companies().filter((c) => onlyPostings.some((p) => p.company_id === c.id)) : store.companies();
    for (const c of companies) {
      const entry = findCompany(wl, c.name);
      const key = companyKey(entry?.name ?? c.name);
      const existing = radarByKey.get(key);
      if (existing) {
        await client.api(`pages/${existing}`, 'PATCH', { properties: ownedRemoved(companyProps(c.name, entry, c.first_seen, { create: false }), OWNED_BY_YOU.radar) });
        cUpd++;
      } else {
        const pg = await client.api('pages', 'POST', { parent: { type: 'data_source_id', data_source_id: cfg.radar_data_source_id }, properties: companyProps(c.name, entry, c.first_seen, { create: true }) });
        radarByKey.set(key, pg.id);
        cNew++;
      }
    }
    // Postings.
    const postings = onlyPostings ?? store.postings();
    const jobPages = onlyPostings
      ? (await Promise.all(postings.map((p) => client.queryAll(cfg.jobs_data_source_id, { filter: { property: 'Key', rich_text: { equals: p.url_key } } })))).flat()
      : await client.queryAll(cfg.jobs_data_source_id);
    const jobsByKey = new Map(jobPages.map((pg) => [readProp(pg.properties.Key), pg.id]));
    let pNew = 0, pUpd = 0;
    for (const p of postings) {
      const decision = store.latestDecision(p.id);
      const entry = findCompany(wl, p.company);
      const companyPage = radarByKey.get(companyKey(entry?.name ?? p.company)) ?? null;
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
export async function pullCompanyEdits(dataDir, { verbose = false, log = console.log } = {}) {
  const cfg = loadNotionConfig(dataDir);
  const client = createClient(readToken(dataDir));
  const path = watchlistPath(dataDir);
  const wl = loadWatchlist(path);
  const pages = await client.queryAll(cfg.radar_data_source_id);
  const changes = [];
  for (const pg of pages) {
    const name = readProp(pg.properties.Name);
    if (!name) continue;
    const edit = {
      status: readProp(pg.properties.Status) || 'unknown',
      verified: readProp(pg.properties.Verified),
      watch: readProp(pg.properties.Watch),
      ai_native: readProp(pg.properties['AI-native']),
    };
    let entry = findCompany(wl, name);
    if (!entry) {
      if (edit.status === 'unknown' && !edit.watch) continue; // nothing decided yet
      entry = { name, aliases: [], status: edit.status, stage: 'unknown', owner_categories: [], parent: null, is_mbb: false, origin: 'you', reason: 'Set in Notion', sources: [] };
      wl.companies.push(entry);
      changes.push(`${name}: added (${edit.status})`);
    }
    // Compare on the meaning the engine uses: missing "verified" = verified; missing booleans = false.
    const current = { status: entry.status ?? 'unknown', verified: entry.verified !== false, watch: Boolean(entry.watch), ai_native: Boolean(entry.ai_native) };
    for (const [k, v] of Object.entries(edit)) {
      if (current[k] !== v) { changes.push(`${name}: ${k} ${JSON.stringify(current[k])} → ${JSON.stringify(v)}`); entry[k] = v; }
    }
  }
  if (changes.length) writeFileSync(path, `${JSON.stringify(wl, null, 2)}\n`);
  if (verbose || changes.length) log(changes.length ? `Company edits from Notion:\n  ${changes.join('\n  ')}` : 'No company edits in Notion.');
  return changes;
}

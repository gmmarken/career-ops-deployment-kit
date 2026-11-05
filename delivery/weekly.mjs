// The Sunday email (Phase 7, D81): the week's newly funded NYC companies as an outreach list,
// then the week's new roles, then one line on the market. Built from market.db only, no AI.
// Missing facts say so ("not researched yet"), never a guess.
import { payText, usd } from './format.mjs';

const DAY_MS = 86_400_000;
const FIT_ORDER = ['Strong', 'Possible', 'Unclear', 'Unlikely'];
const TIER_ORDER = ['S', 'A', 'B', 'C', 'Walk-away', 'Excluded'];
const RULE = '─'.repeat(40);
const MAX_A = 15; // every S role is listed; A roles up to this many

const shortDay = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const pay = (p) => payText({ min: p.pay_min, max: p.pay_max, currency: p.pay_currency, interval: p.pay_interval });

/**
 * What the email says, as data. `now` ends the week; the week is the 7 days before it.
 * { since, companies: [...], roles: { top: [...], counts: {tier: n} }, market: {...} }
 */
export function weeklyData(store, { now = new Date(), days = 7 } = {}) {
  const since = new Date(new Date(now) - days * DAY_MS).toISOString();
  const postings = store.postings();
  const records = new Map(store.companyRecords().map((e) => [e.name, e]));
  const names = new Map(store.companies().map((c) => [c.id, c.name]));

  // 1. Companies with a round first recorded this week from Form D or the news, NYC only.
  const fresh = store.db.prepare(`SELECT * FROM funding_rounds WHERE recorded_at >= ? AND found_via IN ('form_d', 'news')
    ORDER BY COALESCE(amount_usd, 0) DESC`).all(since);
  const seen = new Set();
  const companies = [];
  for (const r of fresh) {
    const name = names.get(r.company_id);
    if (!name || seen.has(name)) continue;
    const e = records.get(name);
    if (!e || e.nyc_presence !== true) continue;
    seen.add(name);
    const open = postings.filter((p) => p.company === name && !p.closed_at);
    const ranked = open.filter((p) => p.tier).sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
    companies.push({
      name, round: { amount_usd: r.amount_usd, round: r.round, date: r.announced, via: r.found_via === 'form_d' ? 'SEC Form D' : 'News', source_url: r.source_url },
      what: e.what_they_do ?? null, leaders: e.leaders ?? [], nyc_evidence: e.nyc_evidence ?? null,
      fit: e.fit ?? null, fit_reason: e.fit_reason ?? null, careers_url: e.careers_url ?? null,
      researched: Boolean(e.researched_at), status: e.status,
      open: open.length, best: ranked[0] ? { tier: ranked[0].tier, title: ranked[0].title, url: ranked[0].url } : null,
    });
  }
  companies.sort((a, b) => (FIT_ORDER.indexOf(a.fit) + 1 || 9) - (FIT_ORDER.indexOf(b.fit) + 1 || 9) || (b.round.amount_usd ?? 0) - (a.round.amount_usd ?? 0));

  // 2. Roles graded for the first time this week (their latest grade).
  const graded = new Set(store.db.prepare(`SELECT posting_id FROM tier_decisions GROUP BY posting_id HAVING MIN(decided_at) >= ?`).all(since).map((r) => r.posting_id));
  const week = postings.filter((p) => graded.has(p.id) && p.tier);
  const counts = Object.fromEntries(TIER_ORDER.map((t) => [t, week.filter((p) => p.tier === t).length]).filter(([, n]) => n));
  const top = week.filter((p) => p.tier === 'S' || p.tier === 'A')
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.company.localeCompare(b.company))
    .map((p) => ({ tier: p.tier, company: p.company, title: p.title, pay: pay(p), url: p.url, closed: Boolean(p.closed_at) }));

  // 3. The market, in one line.
  const market = {
    opened: postings.filter((p) => p.first_seen >= since).length,
    closed: postings.filter((p) => p.closed_at && p.closed_at >= since.slice(0, 10)).length,
    open: postings.filter((p) => !p.closed_at).length,
    nycTarget: postings.filter((p) => p.first_seen >= since && p.in_home_metro === true && p.tier).length,
  };
  return { since, until: new Date(now).toISOString(), companies, roles: { top, counts }, market };
}

/** The email itself: { subject, text }. Plain text, so it reads the same in any mail app. */
export function weeklyEmail(d) {
  const nS = d.roles.counts.S ?? 0, nA = d.roles.counts.A ?? 0;
  const subject = `Job search weekly (${shortDay(d.until)}): ${d.companies.length} newly funded NYC compan${d.companies.length === 1 ? 'y' : 'ies'}, ${nS} S + ${nA} A role${nS + nA === 1 ? '' : 's'}`;
  const L = [`Your week, ${shortDay(d.since)} to ${shortDay(d.until)}.`, ''];

  L.push(`NEWLY FUNDED NYC COMPANIES (${d.companies.length})`, 'Best deployment fit first. Leaders are from public sources; you decide who to contact.', RULE);
  if (!d.companies.length) L.push('None this week.');
  for (const c of d.companies) {
    L.push('', `${c.name}: ${[usd(c.round.amount_usd), c.round.round, c.round.date && `on ${c.round.date}`].filter(Boolean).join(', ')} (${c.round.via})`);
    L.push(`  Fit: ${c.fit ? `${c.fit}. ${c.fit_reason ?? ''}`.trim() : 'not read yet'}`);
    L.push(`  What they do: ${c.what ?? (c.researched ? 'not found' : 'not researched yet')}`);
    if (c.leaders.length) L.push(`  Leaders: ${c.leaders.map((l) => `${l.name}${l.title ? ` (${l.title})` : ''}`).join('; ')}`);
    if (c.nyc_evidence) L.push(`  NYC: ${c.nyc_evidence}`);
    L.push(`  Open roles: ${c.open}${c.best ? `; best: ${c.best.tier}, ${c.best.title} ${c.best.url}` : ''}`);
    if (c.careers_url) L.push(`  Careers page: ${c.careers_url}`);
    if (c.round.source_url) L.push(`  Source: ${c.round.source_url}`);
  }

  const counts = TIER_ORDER.filter((t) => d.roles.counts[t]).map((t) => `${d.roles.counts[t]} ${t}`).join(' · ');
  L.push('', '', `NEW ROLES GRADED THIS WEEK${counts ? `: ${counts}` : ''}`, RULE);
  if (!d.roles.top.length) L.push('No new S or A roles this week.');
  const shown = [...d.roles.top.filter((r) => r.tier === 'S'), ...d.roles.top.filter((r) => r.tier === 'A').slice(0, MAX_A)];
  for (const r of shown) L.push(`${r.tier === 'S' ? '⭐ S' : '• A'}: ${r.company}, ${r.title} (${r.pay})${r.closed ? ' [closed since]' : ''}`, `  ${r.url}`);

  const moreA = d.roles.top.length - shown.length;
  if (moreA > 0) L.push(`…and ${moreA} more A role${moreA === 1 ? '' : 's'} in Notion (Job Postings).`);
  L.push('', '', 'MARKET', RULE,
    `${d.market.opened.toLocaleString('en-US')} postings opened and ${d.market.closed.toLocaleString('en-US')} closed this week; ${d.market.open.toLocaleString('en-US')} open now. ${d.market.nycTarget} new NYC target-family roles graded.`,
    '', 'Everything here is also in Notion (Company Radar, Job Postings). Nothing has been sent to anyone else.');
  return { subject, text: L.join('\n') };
}

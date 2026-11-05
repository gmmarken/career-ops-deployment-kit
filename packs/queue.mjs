// Which prep packs to build, and how many today (D85). Code decides; no model involved.
//   Order: roles you ticked (Make pack) first, then role family (same order as grading, D67),
//          then highest posted yearly pay (not posted last), then newest.
//   Pace:  1 a day; up to 3 on a day when 2 or more wanted one (built today + waiting);
//          never more than 5 in any 7 days. Morning and midday runs share the same allowance.
import { FAMILY_PRIORITY } from '../market/priority.mjs';
import { PACK_BUILT } from '../market/store.mjs';

const familyRank = (f) => { const i = FAMILY_PRIORITY.indexOf(f); return i === -1 ? FAMILY_PRIORITY.length : i; };
const yearlyPay = (p) => (p.pay_interval === 'year' && p.pay_max != null ? p.pay_max : null);

/** Sort waiting packs, best first. Each row needs reason, title_family, pay_max, pay_interval, first_seen, posting_id. */
export function rankQueue(rows) {
  return [...rows].sort((a, b) =>
    (a.reason === 'you' ? 0 : 1) - (b.reason === 'you' ? 0 : 1)
    || familyRank(a.title_family) - familyRank(b.title_family)
    || (yearlyPay(b) ?? -1) - (yearlyPay(a) ?? -1)
    || String(b.first_seen).localeCompare(String(a.first_seen))
    || b.posting_id - a.posting_id);
}

/** Local calendar day (YYYY-MM-DD) of an ISO time, on this Mac's clock. */
export function localDay(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * How many packs to build now.
 * @param rows   all pack rows (status, built_at)
 * @param cfg    { per_day, max_per_day, max_per_week }
 * @param now    Date
 * @returns { build, waiting, builtToday, builtWeek, dayCap }
 */
export function allowance(rows, cfg, now = new Date()) {
  const today = localDay(now);
  const weekAgo = now.getTime() - 7 * 24 * 3600 * 1000;
  const built = rows.filter((r) => PACK_BUILT.includes(r.status) && r.built_at);
  const builtToday = built.filter((r) => localDay(r.built_at) === today).length;
  const builtWeek = built.filter((r) => new Date(r.built_at).getTime() > weekAgo).length;
  const waiting = rows.filter((r) => r.status === 'queued').length;
  const dayCap = waiting + builtToday >= 2 ? cfg.max_per_day : cfg.per_day;
  const build = Math.max(0, Math.min(dayCap - builtToday, cfg.max_per_week - builtWeek, waiting));
  return { build, waiting, builtToday, builtWeek, dayCap };
}

/** Check the "packs" block of private/config/daily.json. Throws with what to fix. */
export function checkPackConfig(p) {
  if (!p || typeof p !== 'object') throw new Error('private/config/daily.json needs a "packs" block, e.g. "packs": { "per_day": 1, "max_per_day": 3, "max_per_week": 5 } (D85).');
  for (const k of ['per_day', 'max_per_day', 'max_per_week']) {
    if (!Number.isInteger(p[k]) || p[k] < 0) throw new Error(`daily.json packs.${k} must be a whole number of at least 0.`);
  }
  if (p.per_day > p.max_per_day) throw new Error('daily.json packs.per_day can\'t be more than packs.max_per_day.');
  return p;
}

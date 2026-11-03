// Monthly market metrics from posting intervals. Pure functions: no I/O.
//
// A posting is OPEN in month M if its start (earlier of posted_at and first_seen)
// is on or before the month's last day, and its end (closed_at, else last_seen) is
// on or after the month's first day. It is NEW in the month its start falls in.
// Each month carries how many scans ran in it, so an unscanned month shows as
// "no coverage" rather than as zero hiring.

const ym = (iso) => String(iso).slice(0, 7);
const monthStart = (m) => `${m}-01`;
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };

/** Inclusive list of YYYY-MM months between two months. */
export function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

export function postingStart(p) {
  const posted = p.posted_at ? String(p.posted_at).slice(0, 10) : null;
  return posted && posted < p.first_seen ? posted : p.first_seen;
}
export const postingEnd = (p) => (p.closed_at ?? p.last_seen);

export function openInMonth(p, m) {
  return postingStart(p) <= monthEnd(m) && postingEnd(p) >= monthStart(m);
}

/**
 * @param {object[]} postings  rows from store.postings()
 * @param {object[]} scans     rows from store.scans()
 * @param {{ from: string, to: string, filter?: (p) => boolean }} opts  months as YYYY-MM
 * @returns rows: { month, coverage_scans, company, family, open, new }
 */
export function monthlyByCompany(postings, scans, { from, to, filter = () => true }) {
  const rows = [];
  const scansByMonth = new Map();
  for (const s of scans) if (s.status === 'ok') scansByMonth.set(ym(s.started_at), (scansByMonth.get(ym(s.started_at)) ?? 0) + 1);
  const ps = postings.filter(filter);
  for (const m of monthRange(from, to)) {
    const groups = new Map();
    for (const p of ps) {
      const open = openInMonth(p, m);
      const isNew = ym(postingStart(p)) === m;
      if (!open && !isNew) continue;
      const k = `${p.company}\u0000${p.title_family}`;
      const g = groups.get(k) ?? { month: m, coverage_scans: scansByMonth.get(m) ?? 0, company: p.company, company_id: p.company_id, family: p.title_family, open: 0, new: 0 };
      if (open) g.open++;
      if (isNew) g.new++;
      groups.set(k, g);
    }
    rows.push(...[...groups.values()].sort((a, b) => b.open - a.open || a.company.localeCompare(b.company)));
  }
  return rows;
}

/** Company ranking over a window: total distinct postings open at any point, then new. */
export function ranking(postings, { from, to, filter = () => true }) {
  const lo = monthStart(from);
  const hi = monthEnd(to);
  const by = new Map();
  for (const p of postings.filter(filter)) {
    if (postingStart(p) > hi || postingEnd(p) < lo) continue;
    const r = by.get(p.company) ?? { company: p.company, postings: 0, new_in_window: 0 };
    r.postings++;
    if (postingStart(p) >= lo) r.new_in_window++;
    by.set(p.company, r);
  }
  return [...by.values()].sort((a, b) => b.postings - a.postings || a.company.localeCompare(b.company))
    .map((r, i) => ({ rank: i + 1, ...r }));
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

export const FREEZE_AFTER_DAYS = 7;

/** Months that should be frozen on `today`: ended at least FREEZE_AFTER_DAYS ago. */
export function freezable(months, today = new Date()) {
  return months.filter((m) => {
    const [y, mo] = m.split('-').map(Number);
    const end = Date.UTC(y, mo, 0);
    return today.getTime() - end >= FREEZE_AFTER_DAYS * 86_400_000;
  });
}

/** Month of the first completed scan (when real market tracking began), or null. */
export function trackingStartMonth(scans) {
  const ok = scans.filter((s) => s.status === 'ok').map((s) => String(s.started_at).slice(0, 7)).sort();
  return ok[0] ?? null;
}

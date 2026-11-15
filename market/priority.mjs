// Which untiered roles to grade first when there are more than a day's cap (D67).
// Deployment / AI strategist roles first, then forward-deployed PM, chief of staff, BizOps,
// and borderline titles that passed the text check; oldest first within a family. At most
// `perCompany` roles from one company per run, so one big board can't take the whole day.
import { companyKey } from './classify.mjs';

/**
 * A role the latest scan of its board didn't see (D114): it's probably just been taken down, so its
 * page would answer "not found" and fail grading. It waits: graded if it's back on the next scan,
 * closed if it's missed again (CLOSE_AFTER_MISSES).
 */
export const missedLastScan = (p) => Number(p.miss_count ?? 0) > 0;

export const FAMILY_PRIORITY = ['deployment_ai_strategist', 'forward_deployed_pm', 'chief_of_staff', 'bizops_so', 'borderline'];

/** Pick up to `limit` roles in priority order, at most `perCompany` per company. */
export function pickBatch(todo, { limit = Infinity, perCompany = Infinity } = {}) {
  const rank = (p) => { const i = FAMILY_PRIORITY.indexOf(p.title_family); return i === -1 ? FAMILY_PRIORITY.length : i; };
  const ordered = [...todo].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  const perCo = new Map();
  const batch = [];
  for (const p of ordered) {
    if (batch.length >= limit) break;
    const k = companyKey(p.company);
    const n = perCo.get(k) ?? 0;
    if (n >= perCompany) continue;
    perCo.set(k, n + 1);
    batch.push(p);
  }
  return batch;
}

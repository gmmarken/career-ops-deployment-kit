// Which job boards the scan reads (D41, D50–D51). Pure functions, no file or network access.
import { companyKey } from './classify.mjs';

const READABLE = /^(ashby|greenhouse|lever|rippling):/;
/**
 * Boards to scan: every ATS board a recorded posting came from, plus boards found on
 * investor boards or added by hand (D50–D51), each with the company name used there.
 */
export function knownBoards(postings, extraBoards = []) {
  const by = new Map();
  const unreadable = new Map();
  for (const p of postings) {
    if (READABLE.test(p.board ?? '')) { if (!by.has(p.board)) by.set(p.board, p.company); }
    else unreadable.set(p.company, p.board ?? 'unknown');
  }
  for (const b of extraBoards) if (!by.has(b.board)) by.set(b.board, b.company);
  const covered = new Set([...by.values()].map(companyKey));
  for (const [company] of unreadable) if (covered.has(companyKey(company))) unreadable.delete(company);
  return { boards: by, unreadable };
}

/** Companies ticked Watch with no readable job board yet (D51). */
export function watchedWithoutBoard(companies, boards) {
  const covered = new Set([...boards.values()].map(companyKey));
  return companies.filter((c) => c.watch && !covered.has(companyKey(c.name))).map((c) => c.name);
}

// D108: a board that can't be reached (no network, a timeout) is tried once more at the end of
// the scan. D115: a problem is counted in days in a row (a morning and a midday failure are one
// day). Day 1 is only logged; from WARN_AFTER_DAYS it's a ⚠️ line in the morning text; from
// ALERT_AFTER_DAYS it fails the run (🚨). More than UNREACHABLE_MAX boards still unreachable after
// the retry means the Mac lost its network, which fails the run at once.
export const RETRY_WAIT_MS = 30_000;
export const UNREACHABLE_MAX = 10;
export const WARN_AFTER_DAYS = 2;
export const ALERT_AFTER_DAYS = 5;

/** True for a connection problem (no answer at all), not for an answer like HTTP 404 or 500. */
export function isNetworkError(message) {
  return /fetch failed|aborted due to timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(String(message ?? ''));
}

/**
 * A problem the next run fixes by itself (D112): no answer at all (no network, a timeout), a server
 * error (HTTP 5xx), or an AI call cut off (code 143: stopped while the Mac slept). Anything else,
 * anything already counted for several days, and a lost network are real problems.
 */
export function isTemporary(error) {
  const e = String(error ?? '');
  if (/(runs|days) in a row|lost its network/.test(e)) return false;
  return isNetworkError(e) || /\bHTTP 5\d\d\b/.test(e) || /claude exited with code 143\b|claude was stopped \(SIGTERM\)/.test(e);
}

/** "2 days in a row" (D115). */
export const daysInARow = (n) => `${n} day${n === 1 ? '' : 's'} in a row`;

/**
 * Boards still unreachable after the retry → which fail the run and which go on the summary line.
 * `still` is [{ board, name, days, error }], days counting today.
 */
export function unreachableOutcome(still) {
  if (still.length > UNREACHABLE_MAX) {
    return { failures: still.map((u) => `${u.board}: ${u.error} (one of ${still.length} boards unreachable after a retry; more than ${UNREACHABLE_MAX} usually means the Mac lost its network)`), summary: [] };
  }
  const failures = [];
  const summary = [];
  for (const u of still) {
    if (u.days >= ALERT_AFTER_DAYS) failures.push(`${u.board}: unreachable ${daysInARow(u.days)} (${u.error})`);
    else summary.push(`${u.name} (${daysInARow(u.days)})`);
  }
  return { failures, summary };
}

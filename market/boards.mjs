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
// the scan. Still unreachable: a summary line, unless too many boards failed (the Mac lost its
// network) or the same board failed UNREACHABLE_FAIL_AFTER runs in a row. Either one fails the run.
export const RETRY_WAIT_MS = 30_000;
export const UNREACHABLE_MAX = 10;
export const UNREACHABLE_FAIL_AFTER = 3;

/** True for a connection problem (no answer at all), not for an answer like HTTP 404 or 500. */
export function isNetworkError(message) {
  return /fetch failed|aborted due to timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(String(message ?? ''));
}

/**
 * Boards still unreachable after the retry → which fail the run and which go on the summary line.
 * `still` is [{ board, name, streak, error }], streak counting this run.
 */
export function unreachableOutcome(still) {
  if (still.length > UNREACHABLE_MAX) {
    return { failures: still.map((u) => `${u.board}: ${u.error} (one of ${still.length} boards unreachable after a retry; more than ${UNREACHABLE_MAX} usually means the Mac lost its network)`), summary: [] };
  }
  const failures = [];
  const summary = [];
  for (const u of still) {
    if (u.streak >= UNREACHABLE_FAIL_AFTER) failures.push(`${u.board}: unreachable ${u.streak} runs in a row (${u.error})`);
    else summary.push(u.name);
  }
  return { failures, summary };
}

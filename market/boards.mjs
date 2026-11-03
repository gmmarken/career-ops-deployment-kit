// Which job boards the scan reads (D41, D50–D51). Pure functions, no file or network access.
import { companyKey } from './classify.mjs';

const READABLE = /^(ashby|greenhouse|lever):/;
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

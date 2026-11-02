// Cheap, versioned classifiers that run on EVERY posting (no AI): role family from
// the title, and home-metro eligibility from locations. Definitions must stay stable
// for month-over-month counts, so any change bumps the version and is a recorded
// decision (D9/D33). Old rows keep the version that labelled them.

export const TITLE_CLASSIFIER_VERSION = 'title-v1';

// Order matters: the first match wins. Forward Deployed Engineer is tracked as its
// own family (market context) and checked before the deployment families.
const FAMILY_PATTERNS = [
  ['forward_deployed_engineer', /forward[\s-]*deployed[\s-]*(software\s+)?engineer|\bfde\b/i],
  ['forward_deployed_pm', /forward[\s-]*deployed[\s-]*(product\s+manager|pm)\b|\bfdpm\b/i],
  ['deployment_ai_strategist', /deployment\s+strateg|\bai\s+strateg|applied\s+ai\s+strateg|ai\s+deployment|deployment\s+manager|ai\s+transformation|ai\s+solutions\s+strateg|ai\s+adoption|forward[\s-]*deployed\s+strateg/i],
  ['chief_of_staff', /chief\s+of\s+staff/i],
  ['bizops_so', /business\s+operations|\bbiz\s?ops\b|strategy\s*(&|and)\s*op(eration)?s|\bs&o\b|strategic\s+operations/i],
];

/** Family from a job title, or 'other'. */
export function titleFamily(title) {
  const t = String(title ?? '');
  for (const [family, re] of FAMILY_PATTERNS) if (re.test(t)) return family;
  return 'other';
}

/** The target families (vs market-context families like FDE). */
export const TARGET_FAMILIES = new Set(['deployment_ai_strategist', 'forward_deployed_pm', 'bizops_so', 'chief_of_staff']);

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Is any location in the home metro? Whole-word match on the metro name and its
 * aliases; in "City, State" only the city part counts (so "Albany, New York" is out).
 * Shared by the tier engine and the market classifier so they can't disagree.
 */
export function inHomeMetro(locations, { home_metro, home_metro_aliases = [] }) {
  const names = [home_metro, ...home_metro_aliases].filter(Boolean);
  if (!names.length) throw new Error('home_metro is not set in the tier settings.');
  const re = new RegExp(`\\b(${names.map(esc).join('|')})\\b`, 'i');
  return (locations || []).some((l) => re.test(String(l).split(',')[0]));
}

// Company-name matching for hand-collected lists: ignore case, punctuation, and common
// endings ("Distyl AI" = "Distyl", "Acme, Inc." = "Acme"). Exact normalized match only.
const COMPANY_SUFFIXES = /\b(inc|llc|ltd|corp|corporation|co|company|ai|labs?|hq|technologies|technology|tech|group)\b/g;
export function companyKey(name) {
  const k = String(name ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(COMPANY_SUFFIXES, ' ').replace(/\s+/g, '');
  return k || String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

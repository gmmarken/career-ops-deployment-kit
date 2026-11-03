// Cheap, versioned classifiers that run on EVERY posting (no AI): role family from
// the title, and home-metro eligibility from locations. Definitions must stay stable
// for month-over-month counts, so any change bumps the version and is a recorded
// decision (D9/D33). Old rows keep the version that labelled them.

export const TITLE_CLASSIFIER_VERSION = 'title-v2';

// Order matters: the first match wins. Forward Deployed Engineer is tracked as its
// own family (market context) and checked before the deployment families.
// v2 (D49) adds "Solutions Strategist", "Deployment Lead" and non-engineer forward-deployed titles.
const FAMILY_PATTERNS = [
  ['forward_deployed_engineer', /forward[\s-]*deployed[\s-]*(software\s+|ai\s+)?engineer|\bfde\b|engineer.*forward[\s-]*deployed/i],
  ['forward_deployed_pm', /forward[\s-]*deployed[\s-]*(product\s+manager|pm)\b|\bfdpm\b/i],
  ['deployment_ai_strategist', /deployment\s+strateg|\bai\s+strateg|applied\s+ai\s+strateg|ai\s+deployment|deployment\s+manager|ai\s+transformation|ai\s+solutions\s+strateg|ai\s+adoption|forward[\s-]*deployed\s+strateg|solutions\s+strategist|deployment\s+lead\b|forward[\s-]*deployed\s+(lead|manager|specialist|operator|partner|associate)\b/i],
  ['chief_of_staff', /chief\s+of\s+staff/i],
  ['bizops_so', /business\s+operations|\bbiz\s?ops\b|strategy\s*(&|and)\s*op(eration)?s|\bs&o\b|strategic\s+operations|strategy\s*(&|and)\s*planning/i],
];

// v2 (D49): titles that might be a target role but can't be told from the title alone.
// They are labelled 'borderline'; the posting text is then checked (no AI) and only hits
// are sent on to be tiered. Titles that are plainly something else are never borderline.
const BORDERLINE = /\bsolutions?\s+(consultant|consulting|lead|manager|partner)\b|product\s+operations|agent\s+product\s+manager|strategic\s+(growth|projects?|initiatives|programs?)\b|special\s+projects|\b(gtm|go[\s-]to[\s-]market|business|corporate|growth|ai)\s+strategy\b|\bstrategist\b|\bstrategy\s+(manager|lead|associate|principal|director)\b|implementation\s+(lead|manager|strategist|consultant)|engagement\s+manager|customer\s+(success|experience)\s+(strategy|operations)|\btransformation\b|founder'?s?\s+(associate|office)|founding\s+operator|\bai\s+operations|applied\s+ai\b/i;
const NOT_BORDERLINE = /engineer|developer|scientist|researcher|account\s+executive|sales\s+development|business\s+development\s+rep|\bsdr\b|\bbdr\b|recruit|talent|marketing|designer|counsel|attorney|accountant|intern(ship)?\b|new\s+grad|architect/i;

/** Family from a job title: a target or context family, 'borderline', or 'other'. */
export function titleFamily(title) {
  const t = String(title ?? '');
  for (const [family, re] of FAMILY_PATTERNS) if (re.test(t)) return family;
  if (BORDERLINE.test(t) && !NOT_BORDERLINE.test(t)) return 'borderline';
  return 'other';
}

// The no-AI text check for borderline titles (D49). A hit needs all three: AI work, putting
// it into use (deploying/implementing, or working with forward-deployed engineers), and
// customers. Returns which signal words were found so the reason is visible.
const SIGNALS = {
  ai: /\b(ai|llms?|genai|generative ai|ai agents?|agentic|machine learning|large language models?)\b/gi,
  deploy: /\b(deploy(s|ed|ing|ment|ments)?|implementation|implement(ing)?|roll[\s-]?outs?|go[\s-]live|forward[\s-]deployed)\b/gi,
  customer: /\b(customers?|clients?|enterprise accounts?)\b/gi,
};
export const TEXT_CHECK_VERSION = 'text-v1';
export function textCheck(text) {
  const t = String(text ?? '');
  if (!t.trim()) throw new Error('textCheck: the posting has no text to check.');
  const found = {};
  for (const [k, re] of Object.entries(SIGNALS)) found[k] = [...new Set((t.match(re) || []).map((w) => w.toLowerCase()))].slice(0, 5);
  const hit = Object.values(found).every((w) => w.length > 0);
  return { hit, found };
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

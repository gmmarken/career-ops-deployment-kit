// SEC Form D reader (Phase 6, D70–D71). A Form D is the notice a company files with the SEC
// after it sells shares privately (a funding round). EDGAR is public and allows automated
// reading at up to 10 requests a second, as long as every request names a contact email in
// its user agent (SEC fair access policy). The email lives in private/config/sources.json.
//
// Two reads per filing at most:
//   1. EDGAR full-text search lists Form D filings by business-address state and date
//      (company name, city, exemption codes). Funds (3(c) exemptions), amendments and
//      filings outside the chosen cities are dropped here, without opening them.
//   2. The filing's own form (primary_doc.xml): industry, amount sold, date of first sale,
//      and the officers and directors (names and roles only; their addresses are never read).
// Anything missing or in an unexpected shape is an error, never a guess.

const SEARCH = 'https://efts.sec.gov/LATEST/search-index';
const ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const TIMEOUT_MS = 30_000;
export const PAUSE_MS = 250; // ~4 requests a second, well under the SEC's 10
const PAGE = 100;

/** The user agent the SEC asks for: who we are and a contact email. */
export function secUserAgent(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? ''))) throw new Error('form_d.contact_email is missing or not an email address. The SEC requires a contact email on every request.');
  return `career-ops-deployment-kit (personal job search) ${email}`;
}

async function get(url, ua, fetchImpl, what) {
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': ua, 'Accept-Encoding': 'gzip, deflate' } });
  } catch (err) {
    throw new Error(`Could not reach the SEC for ${what}: ${err.message}`);
  }
  if (!res.ok) {
    const hint = res.status === 403 ? ' The SEC refused the request: check form_d.contact_email, or the request rate.' : res.status === 429 ? ' Too many requests too fast.' : '';
    throw new Error(`The SEC returned HTTP ${res.status} for ${what} (${url}).${hint}`);
  }
  return res;
}

/** Accession number → the filing's folder id ("0002036427-26-000001" → "000203642726000001"). */
export const filingFolder = (accession) => String(accession).replace(/-/g, '');
export const filingUrl = (cik, accession) => `${ARCHIVES}/${Number(cik)}/${filingFolder(accession)}/primary_doc.xml`;
export const filingIndexUrl = (cik, accession) => `${ARCHIVES}/${Number(cik)}/${filingFolder(accession)}/`;

/**
 * One search hit → the fields we use. Throws if the shape changed.
 * { accession, cik, entity, filed, form, cities: ["Brooklyn, NY"], items: ["06B"] }
 */
export function hitToFiling(hit) {
  const s = hit?._source;
  if (!s || !s.adsh || !Array.isArray(s.ciks) || !s.ciks.length || !Array.isArray(s.display_names) || !s.file_date || !s.form) {
    throw new Error('An EDGAR search result is missing its filing number, company, date or form. The search format may have changed.');
  }
  return {
    accession: s.adsh, cik: s.ciks[0], entity: s.display_names[0].replace(/\s*\(CIK \d+\)\s*$/, '').trim(), filed: s.file_date,
    form: s.form, cities: Array.isArray(s.biz_locations) ? s.biz_locations : [], items: Array.isArray(s.items) ? s.items : [],
  };
}

/** Every Form D-family filing (D and D/A) with a business address in `state`, filed between two dates. */
export async function searchFormD({ state, start, end, ua, fetchImpl = fetch, pause = () => Promise.resolve() }) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const url = `${SEARCH}?forms=D&locationCodes=${encodeURIComponent(state)}&startdt=${start}&enddt=${end}&from=${from}`;
    const res = await get(url, ua, fetchImpl, `the Form D search (${state}, ${start} to ${end})`);
    const body = await res.json();
    const hits = body?.hits?.hits;
    const total = body?.hits?.total?.value;
    if (!Array.isArray(hits) || !Number.isInteger(total)) throw new Error('The EDGAR search answer has no results list. Its format may have changed.');
    out.push(...hits.map(hitToFiling));
    if (from + PAGE >= total || !hits.length) break;
    if (from + PAGE >= 10_000) throw new Error(`The EDGAR search found ${total} filings; it returns at most 10,000. Shorten form_d.lookback_days.`);
    await pause();
  }
  return out;
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : null;
};
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => decode(m[1].trim()));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const money = (v) => (v == null || v === '' || !/^\d+(\.\d+)?$/.test(v) ? null : Number(v)); // "Indefinite" → null

/**
 * The fields we use from a Form D's primary_doc.xml. Officers and directors keep only their
 * name and role; addresses are not read. Throws if the core fields are missing.
 */
export function parseFormD(xml) {
  const doc = String(xml);
  if (!/<edgarSubmission>/.test(doc)) throw new Error('This is not a Form D document (no <edgarSubmission>).');
  const issuer = tag(doc, 'primaryIssuer');
  const offering = tag(doc, 'offeringData');
  if (!issuer || !offering) throw new Error('The Form D has no issuer or offering section. The format may have changed.');
  const name = tag(issuer, 'entityName');
  const address = tag(issuer, 'issuerAddress') ?? '';
  const industry = tag(tag(offering, 'industryGroup') ?? '', 'industryGroupType');
  const amounts = tag(offering, 'offeringSalesAmounts') ?? '';
  if (!name || !industry || !amounts) throw new Error('The Form D is missing the company name, industry or amounts.');
  const signers = tags(offering, 'signature').map((sg) => ({ name: tag(sg, 'nameOfSigner'), title: tag(sg, 'signatureTitle') }));
  const people = tags(tag(doc, 'relatedPersonsList') ?? '', 'relatedPersonInfo').map((p) => {
    const n = tag(p, 'relatedPersonName') ?? '';
    const full = [tag(n, 'firstName'), tag(n, 'middleName'), tag(n, 'lastName')].filter(Boolean).join(' ');
    const roles = tags(p, 'relationship');
    const signed = signers.find((s) => s.name && s.name.toLowerCase() === full.toLowerCase());
    return { name: full, roles, title: signed?.title ?? null };
  }).filter((p) => p.name);
  const firstSale = tag(tag(offering, 'dateOfFirstSale') ?? '', 'value');
  return {
    name, entity_type: tag(issuer, 'entityType'), city: tag(address, 'city'), state: tag(address, 'stateOrCountry'),
    year_of_inc: tag(tag(issuer, 'yearOfInc') ?? '', 'value'),
    industry, amendment: tag(offering, 'isAmendment') === 'true',
    first_sale: /^\d{4}-\d{2}-\d{2}$/.test(firstSale ?? '') ? firstSale : null,
    offering: money(tag(amounts, 'totalOfferingAmount')), amount_sold: money(tag(amounts, 'totalAmountSold')),
    people,
  };
}

/** Read one filing's form. */
export async function fetchFormD({ cik, accession }, ua, fetchImpl = fetch) {
  const url = filingUrl(cik, accession);
  const res = await get(url, ua, fetchImpl, `Form D ${accession}`);
  return { url, form: parseFormD(await res.text()) };
}

const cityOf = (loc) => String(loc).split(',')[0].trim().toLowerCase();

/**
 * First pass, from the search result alone. Returns null if the filing should be opened,
 * else why it doesn't count.
 */
export function screenHit(f, cfg) {
  if (f.form !== 'D') return 'amendment (D/A)';
  if (f.items.some((i) => /^3C/i.test(i))) return 'investment fund (3(c) exemption)';
  const cities = cfg.cities.map((c) => c.toLowerCase());
  if (!f.cities.some((l) => cities.includes(cityOf(l)))) return `outside the chosen cities (${f.cities.join('; ') || 'no city'})`;
  return null;
}

// Partnerships, trusts and numbered or holding vehicles raise money for investments, not to hire.
const VEHICLE_TYPES = ['Limited Partnership', 'General Partnership', 'Business Trust'];
const VEHICLE_NAME = /\b(L\.?P\.?|fund|SPV|feeder|co-?invest\w*|aggregator|topco|holdco|DST|REIT)\b|\s(I|II|III|IV|V|VI|VII|VIII|IX|X)(,?\s+(LLC|L\.L\.C\.|Inc\.?|LP))?\.?$/i;

/** Second pass, from the form itself. Returns null if it counts, else why not. */
export function screenForm(form, cfg) {
  if (form.amendment) return 'amendment';
  if (VEHICLE_TYPES.includes(form.entity_type)) return `investment vehicle (${form.entity_type})`;
  if (VEHICLE_NAME.test(form.name)) return 'investment vehicle (name)';
  if (!cfg.industry_groups.includes(form.industry)) return `industry: ${form.industry}`;
  if (form.amount_sold == null) return 'no amount sold given';
  if (form.amount_sold < cfg.min_amount_usd) return `raised $${Math.round(form.amount_sold).toLocaleString('en-US')} (under the minimum)`;
  if (!cfg.cities.map((c) => c.toLowerCase()).includes(String(form.city ?? '').toLowerCase())) return `address city: ${form.city ?? 'none'}`;
  return null;
}

const SUFFIX = /[,\s]+(inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|corp\.?|corporation|co\.?|company|pbc|p\.b\.c\.|limited|holdings)$/i;

/** "MINERVA BI, INC." → "Minerva BI"; keeps short all-caps words (AI, BI, HQ) as they are. */
export function displayName(entity) {
  let n = String(entity).trim();
  for (let i = 0; i < 3 && SUFFIX.test(n); i++) n = n.replace(SUFFIX, '').trim();
  if (n === n.toUpperCase() && /[A-Z]{4,}/.test(n)) {
    n = n.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Ai|Bi|Hq|Io|Nyc|Usa|Ml)\b/g, (w) => w.toUpperCase());
  }
  return n;
}

/** Officers and directors as Radar leaders (names and roles only), sourced to the filing. */
export function leadersFromForm(form, sourceUrl) {
  return form.people
    .filter((p) => p.roles.includes('Executive Officer') || p.roles.includes('Director'))
    .map((p) => ({ name: p.name, title: p.title ?? (p.roles.includes('Executive Officer') ? 'Executive officer' : 'Director'), source_url: sourceUrl }));
}

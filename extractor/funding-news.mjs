// Funding news readers (Phase 6, D72). Two sources, both allowed for this use:
//   - TechCrunch's funding RSS feeds. Their RSS terms allow news-reader use, showing the
//     feed's content with credit and a link to the article. We keep the headline, the link
//     and "TechCrunch"; article pages are never fetched.
//   - Serper's news search (Google News results through the paid API we already use, D52),
//     weekly. Only Google's headline, snippet and link are used; the news sites themselves
//     are never fetched.
// The company, amount and round are read from the headline by code (no AI). A headline the
// code can't read is listed as such, never guessed.

const TIMEOUT_MS = 30_000;
const UA = 'career-ops-deployment-kit (personal job search; reads RSS feeds)';
const NEWS_API = 'https://google.serper.dev/news';

const decode = (s) => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'")
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** RSS items → [{ title, link, published (YYYY-MM-DD), text }]. Throws if it isn't RSS. */
export function parseRss(xml) {
  const doc = String(xml);
  if (!/<rss[\s>]/.test(doc) || !/<channel>/.test(doc)) throw new Error('The feed is not RSS (no <rss>/<channel>). Its format may have changed.');
  return [...doc.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const get = (t) => { const m = it.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : null; };
    const pub = get('pubDate');
    const d = pub ? new Date(pub) : null;
    return { title: get('title'), link: get('link'), published: d && !Number.isNaN(+d) ? d.toISOString().slice(0, 10) : null, text: get('description') ?? '' };
  }).filter((i) => i.title && i.link);
}

export async function fetchFeed(url, fetchImpl = fetch) {
  let res;
  try { res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA } }); } catch (err) { throw new Error(`Could not reach ${url}: ${err.message}`); }
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}.`);
  return parseRss(await res.text());
}

/** One Serper news search (1 credit). Returns [{ title, link, snippet, date, source }]. Throws on any failure. */
export async function serperNews(key, q, { fetchImpl = fetch, window = 'qdr:w' } = {}) {
  let res;
  try {
    res = await fetchImpl(NEWS_API, {
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
      body: JSON.stringify({ q, num: 10, tbs: window }),
    });
  } catch (err) { throw new Error(`Could not reach Serper: ${err.message}`); }
  if (!res.ok) {
    const err = new Error(`Serper news returned HTTP ${res.status} for ${q}.${res.status === 401 || res.status === 403 ? ' Check SERPER_API_KEY, and that the account still has credits.' : res.status === 400 ? ' Out of credits, or the search was rejected.' : ''}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  if (!Array.isArray(body.news)) throw new Error(`Serper's news answer for ${q} has no news list. Its format may have changed.`);
  return body.news.map((n) => ({ title: n.title, link: n.link, snippet: n.snippet ?? '', date: n.date ?? null, source: n.source ?? null })).filter((n) => n.title && n.link);
}

/** "5 days ago" → the date, counted from `now`. Hours and days only; anything vaguer stays null. */
export function relativeDate(text, now = new Date()) {
  const m = String(text ?? '').match(/^(\d+)\s+(minute|hour|day)s?\s+ago$/i);
  if (!m) return null;
  const ms = { minute: 60e3, hour: 3600e3, day: 86400e3 }[m[2].toLowerCase()] * Number(m[1]);
  return new Date(new Date(now) - ms).toISOString().slice(0, 10);
}

/** Does the text place the company in NYC? */
export const NYC_MARKERS = /\b(New York|NYC|Brooklyn|Manhattan)\b|\bNY-based\b/;
export const isNyc = (text) => NYC_MARKERS.test(String(text));

const VERB = /\s+(raises|raised|has raised|lands|landed|secures|secured|nabs|bags|closes|closed|snags|gets|grabs|picks up|captures|locks down|pulls in|scores|collects|banks|emerges from stealth with)\s+/i;
const DESCRIPTOR = /^(?:.*\b(?:startup|start-up|company|platform|maker|firm|provider|developer|unicorn|upstart|fintech|insurtech|healthtech|proptech|legaltech)\s+)/i;
const ROUNDS = [['pre-seed', 'pre_seed'], ['seed', 'seed'], ['series a', 'series_a'], ['series b', 'series_b'], ['series c', 'series_c'], ['series d', 'series_d_plus'], ['series e', 'series_d_plus'], ['series f', 'series_d_plus']];

/** "$45M" / "$2.5 million" / "$1B" → dollars. */
export function amountOf(text) {
  const m = String(text).match(/\$\s?(\d+(?:\.\d+)?)\s?(million|billion|m|b|k)\b/i);
  if (!m) return null;
  const mult = { million: 1e6, m: 1e6, billion: 1e9, b: 1e9, k: 1e3 }[m[2].toLowerCase()];
  return Math.round(Number(m[1]) * mult);
}

export function roundOf(text) {
  const t = String(text).toLowerCase();
  for (const [word, stage] of ROUNDS) if (new RegExp(`\\b${word}\\b`).test(t)) return { round: word.replace(/\b\w/g, (c) => c.toUpperCase()), stage };
  return null;
}

/**
 * Read a funding headline: "Audit AI Startup Clark Raises $11M Seed Round" →
 * { company: "Clark", amount_usd: 11000000, round: "Seed", stage: "seed" }. Returns null if
 * it isn't a company-raised-money headline or the company name can't be told apart.
 */
export function readHeadline(title) {
  const t = decode(title).replace(/[’‘]/g, "'");
  const m = t.match(VERB);
  if (!m) return null;
  const after = t.slice(m.index + m[0].length);
  if (!/\$|\bfunding\b|\bround\b|\bseed\b|\bseries\b/i.test(after)) return null;
  if (/\bfund\b(?!ing)/i.test(after.split(/\s+to\s+/)[0]) && !/\bfunding\b|\bround\b/i.test(after)) return null; // a VC raising a fund
  let name = t.slice(0, m.index).replace(/^.*?:\s+/, '').trim();
  name = name.replace(DESCRIPTOR, '').replace(/^.*\bbacked\s+/i, '').replace(/^(?:the|a|an)\s+/i, '').replace(/^(?:ex-\S+\s+.*\s+launch\s+)/i, '').trim();
  name = name.replace(/,.*$/, '').replace(/'s$/, '').replace(/\s+(reportedly|officially|quietly|now|just|also|finally)$/i, '').trim();
  const words = name.split(/\s+/);
  if (!name || words.length > 4 || !/^[A-Z0-9]/.test(name) || /\b(startup|company|startups|investors|firms|who|how|why|what|this|these)\b/i.test(name)) return null;
  const r = roundOf(after);
  return { company: name, amount_usd: amountOf(after), round: r?.round ?? null, stage: r?.stage ?? null };
}

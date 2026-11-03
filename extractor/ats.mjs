// Read hard facts (title, company, locations, workplace, posted date, pay, JD text)
// from an ATS's public JSON API. Code, not the model, owns these facts.
// Unsupported URLs and failed fetches throw with a clear message; nothing is guessed.

const TIMEOUT_MS = 20_000;
const BOARD_TIMEOUT_MS = 90_000; // whole boards can be large (hundreds of postings with descriptions)

export function parseJobUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error(`Not a valid URL: ${raw}`); }
  const parts = u.pathname.split('/').filter(Boolean);
  const host = u.hostname.toLowerCase();
  if (host === 'jobs.ashbyhq.com' && parts.length >= 2) return { ats: 'ashby', board: parts[0], id: parts[1] };
  if ((host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') && parts[1] === 'jobs' && parts[2]) {
    return { ats: 'greenhouse', board: parts[0], id: parts[2] };
  }
  if (host === 'jobs.lever.co' && parts.length >= 2) return { ats: 'lever', board: parts[0], id: parts[1] };
  throw new Error(`Unsupported job board: ${host}. Supported: Ashby, Greenhouse, Lever. For other boards, save the JD text to a file and run with --jd-file.`);
}

export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, ' - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const INTERVALS = { '1 YEAR': 'year', '1 MONTH': 'month', '1 HOUR': 'hour', 'per-year-salary': 'year', 'per-month-salary': 'month', 'per-hour-wage': 'hour' };
const WORKPLACE = { OnSite: 'onsite', Hybrid: 'hybrid', Remote: 'remote', onsite: 'onsite', hybrid: 'hybrid', remote: 'remote' };

/** Ashby job-board API payload → hard facts. */
export function fromAshby(board, id, payload, url) {
  const job = (payload.jobs || []).find((j) => j.id === id || (j.jobUrl || '').includes(id));
  if (!job) throw new Error(`Ashby board "${board}" has no listed job ${id}. The posting may be closed or unlisted.`);
  return ashbyJob(board, job, url);
}

function ashbyJob(board, job, url = job.jobUrl) {
  const salary = (job.compensation?.compensationTiers || []).flatMap((t) => t.components || []).find((c) => c.compensationType === 'Salary');
  const equity = (job.compensation?.compensationTiers || []).flatMap((t) => t.components || []).some((c) => /equity/i.test(c.compensationType || ''));
  const locations = [job.location, ...(job.secondaryLocations || []).map((l) => l.location)].filter(Boolean);
  return {
    posting: {
      url, source: 'ashby', title: job.title, company: board,
      locations, workplace: WORKPLACE[job.workplaceType] ?? (job.isRemote ? 'remote' : 'unclear'),
      posted_at: job.publishedAt ?? null,
      pay: salary ? { min: salary.minValue ?? null, max: salary.maxValue ?? null, currency: salary.currencyCode ?? null, interval: INTERVALS[salary.interval] ?? 'unknown', kind: 'base', source: 'ats' } : null,
      equity_offered: equity,
      pay_conflict: null,
    },
    jdText: job.descriptionPlain || htmlToText(job.descriptionHtml),
  };
}

/** Greenhouse job API payload (with pay_transparency) → hard facts. */
export function fromGreenhouse(board, id, job, url) {
  const range = (job.pay_input_ranges || [])[0];
  const interval = range && /annual|year|salary/i.test(`${range.title ?? ''} ${range.blurb ?? ''}`) ? 'year' : 'unknown';
  return {
    posting: {
      url, source: 'greenhouse', title: job.title, company: job.company_name ?? board,
      locations: [job.location?.name].filter(Boolean), workplace: 'unclear',
      posted_at: job.first_published ?? job.updated_at ?? null,
      pay: range ? { min: range.min_cents != null ? range.min_cents / 100 : null, max: range.max_cents != null ? range.max_cents / 100 : null, currency: range.currency_type ?? null, interval, kind: 'unknown', source: 'ats' } : null,
      equity_offered: null,
      pay_conflict: null,
    },
    jdText: htmlToText(job.content?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')),
  };
}

/** Lever posting API payload → hard facts. */
export function fromLever(board, id, job, url) {
  const s = job.salaryRange;
  const text = [job.descriptionPlain, ...(job.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`), job.additionalPlain].filter(Boolean).join('\n\n');
  return {
    posting: {
      url, source: 'lever', title: job.text, company: board,
      locations: [job.categories?.location, ...(job.categories?.allLocations || [])].filter((v, i, a) => v && a.indexOf(v) === i),
      workplace: WORKPLACE[job.workplaceType] ?? 'unclear',
      posted_at: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      pay: s ? { min: s.min ?? null, max: s.max ?? null, currency: s.currency ?? null, interval: INTERVALS[s.interval] ?? 'unknown', kind: 'base', source: 'ats' } : null,
      equity_offered: null,
      pay_conflict: null,
    },
    jdText: text,
  };
}

async function getJson(apiUrl, timeoutMs = TIMEOUT_MS) {
  let res;
  try {
    res = await fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  } catch (err) {
    throw new Error(`Could not reach ${apiUrl}: ${err.message}`);
  }
  if (!res.ok) throw new Error(`${apiUrl} returned HTTP ${res.status}. The posting may be closed, or the board name is wrong.`);
  return res.json();
}

/** Fetch hard facts + JD text for a supported ATS URL. */
export async function fetchPosting(url) {
  const { ats, board, id } = parseJobUrl(url);
  if (ats === 'ashby') {
    return fromAshby(board, id, await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`), url);
  }
  if (ats === 'greenhouse') {
    return fromGreenhouse(board, id, await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}?pay_transparency=true`), url);
  }
  return fromLever(board, id, await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(board)}/${encodeURIComponent(id)}`), url);
}

// --- Whole-board listings (D41): every open posting, hard facts only, no AI -----------

const splitLocations = (s) => String(s ?? '').split(/\s*[|;]\s*/).map((x) => x.trim()).filter(Boolean);

/** All open postings on an Ashby board (listed jobs only). */
export function ashbyBoard(board, payload) {
  if (!Array.isArray(payload?.jobs)) throw new Error(`Ashby board "${board}" returned no job list.`);
  return payload.jobs.filter((j) => j.isListed !== false).map((j) => ashbyJob(board, j).posting);
}

/** All open postings on a Greenhouse board (pay needs a per-job call, so it's left to tiering). */
export function greenhouseBoard(board, payload) {
  if (!Array.isArray(payload?.jobs)) throw new Error(`Greenhouse board "${board}" returned no job list.`);
  return payload.jobs.map((j) => ({
    url: j.absolute_url, source: 'greenhouse', title: j.title, company: j.company_name ?? board,
    locations: splitLocations(j.location?.name), workplace: /remote/i.test(j.location?.name ?? '') ? 'remote' : 'unclear',
    posted_at: j.first_published ?? null, pay: null, equity_offered: null, pay_conflict: null,
  }));
}

/** All open postings on a Lever board. */
export function leverBoard(board, payload) {
  if (!Array.isArray(payload)) throw new Error(`Lever board "${board}" returned no job list.`);
  return payload.map((j) => fromLever(board, j.id, j, j.hostedUrl).posting);
}

/** "ashby:acme" → every open posting on that board. Throws on any failure (never a partial list). */
export async function listBoard(boardKey) {
  const [ats, board] = String(boardKey).split(':');
  if (!board) throw new Error(`Board key must look like ashby:acme, got ${boardKey}`);
  if (ats === 'ashby') return ashbyBoard(board, await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`, BOARD_TIMEOUT_MS));
  if (ats === 'greenhouse') return greenhouseBoard(board, await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`, BOARD_TIMEOUT_MS));
  if (ats === 'lever') return leverBoard(board, await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`, BOARD_TIMEOUT_MS));
  throw new Error(`No board reader for "${ats}" yet (${boardKey}). Supported: ashby, greenhouse, lever.`);
}

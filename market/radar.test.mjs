import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './store.mjs';
import { runNycChecks, companyIndex, recordFunded, runFormD, runTechCrunch, runNewsSearch, considerNews, fundedLine, researchOrder, refit, checkRadarConfig, newsSearchDue, newsWindow, creditOutlook, creditLine } from './radar.mjs';
import { serperBalance } from '../extractor/serper.mjs';
import { parseFormD, screenHit, screenForm, displayName, leadersFromForm, hitToFiling, secUserAgent } from '../extractor/formd.mjs';
import { parseRss, readHeadline, relativeDate, isNyc, amountOf } from '../extractor/funding-news.mjs';

const CFG = {
  contact_email: 'someone@example.com', state: 'NY', cities: ['New York', 'Brooklyn', 'Long Island City'],
  industry_groups: ['Other Technology', 'Computers', 'Other Health Care'], min_amount_usd: 1_000_000, lookback_days: 30,
};

const formXml = ({ name = 'EXAMPLE ROBOTICS, INC.', city = 'BROOKLYN', industry = 'Other Technology', sold = '15000000', amendment = 'false' } = {}) => `<?xml version="1.0"?>
<edgarSubmission><submissionType>D</submissionType>
<primaryIssuer><cik>0000000001</cik><entityName>${name}</entityName>
<issuerAddress><street1>1 Main St</street1><city>${city}</city><stateOrCountry>NY</stateOrCountry><zipCode>11201</zipCode></issuerAddress>
<issuerPhoneNumber>5555555555</issuerPhoneNumber><entityType>Corporation</entityType><yearOfInc><withinFiveYears>true</withinFiveYears><value>2024</value></yearOfInc></primaryIssuer>
<relatedPersonsList>
<relatedPersonInfo><relatedPersonName><firstName>Ada</firstName><lastName>Example</lastName></relatedPersonName>
<relatedPersonAddress><street1>9 Home Rd</street1><city>Brooklyn</city></relatedPersonAddress>
<relatedPersonRelationshipList><relationship>Executive Officer</relationship><relationship>Director</relationship></relatedPersonRelationshipList></relatedPersonInfo>
<relatedPersonInfo><relatedPersonName><firstName>Bo</firstName><lastName>Investor</lastName></relatedPersonName>
<relatedPersonRelationshipList><relationship>Director</relationship></relatedPersonRelationshipList></relatedPersonInfo>
<relatedPersonInfo><relatedPersonName><firstName>Cy</firstName><lastName>Promoter</lastName></relatedPersonName>
<relatedPersonRelationshipList><relationship>Promoter</relationship></relatedPersonRelationshipList></relatedPersonInfo>
</relatedPersonsList>
<offeringData><industryGroup><industryGroupType>${industry}</industryGroupType></industryGroup>
<typeOfFiling><newOrAmendment><isAmendment>${amendment}</isAmendment></newOrAmendment><dateOfFirstSale><value>2026-10-20</value></dateOfFirstSale></typeOfFiling>
<offeringSalesAmounts><totalOfferingAmount>20000000</totalOfferingAmount><totalAmountSold>${sold}</totalAmountSold></offeringSalesAmounts>
<signatureBlock><signature><nameOfSigner>Ada Example</nameOfSigner><signatureTitle>Chief Executive Officer</signatureTitle></signature></signatureBlock>
</offeringData></edgarSubmission>`;

const hit = (adsh, name, { form = 'D', loc = 'Brooklyn, NY', items = ['06B'] } = {}) => ({
  _source: { adsh, ciks: ['0000000001'], display_names: [`${name}  (CIK 0000000001)`], file_date: '2026-11-03', form, biz_locations: [loc], items },
});

// --- Form D reading
test('Form D: parse keeps names and roles of officers, never their addresses', () => {
  const f = parseFormD(formXml());
  assert.equal(f.name, 'EXAMPLE ROBOTICS, INC.');
  assert.equal(f.city, 'BROOKLYN');
  assert.equal(f.amount_sold, 15_000_000);
  assert.equal(f.first_sale, '2026-10-20');
  assert.deepEqual(f.people[0], { name: 'Ada Example', roles: ['Executive Officer', 'Director'], title: 'Chief Executive Officer' });
  assert.ok(!JSON.stringify(f).includes('Home Rd'));
  assert.deepEqual(leadersFromForm(f, 'u').map((l) => `${l.name}|${l.title}`), ['Ada Example|Chief Executive Officer', 'Bo Investor|Director']);
});

test('Form D: a changed format is an error, and "Indefinite" amounts stay unknown', () => {
  assert.throws(() => parseFormD('<html></html>'), /not a Form D/);
  assert.equal(parseFormD(formXml({ sold: 'Indefinite' })).amount_sold, null);
  assert.throws(() => hitToFiling({ _source: {} }), /search format may have changed/);
});

test('Form D: screening drops amendments, funds, other cities, industries and small raises', () => {
  const f = (o) => hitToFiling(hit('x', 'X', o));
  assert.match(screenHit(f({ form: 'D/A' }), CFG), /amendment/);
  assert.match(screenHit(f({ items: ['06B', '3C.7'] }), CFG), /investment fund/);
  assert.match(screenHit(f({ loc: 'Buffalo, NY' }), CFG), /outside the chosen cities/);
  assert.equal(screenHit(f({}), CFG), null);
  const city = (c) => screenForm(parseFormD(formXml({ city: c })), CFG);
  assert.equal(city('LONG ISLAND CITY'), null);
  assert.match(screenForm(parseFormD(formXml({ industry: 'Pooled Investment Fund' })), CFG), /industry/);
  assert.match(screenForm(parseFormD(formXml({ sold: '250000' })), CFG), /under the minimum/);
  assert.match(screenForm(parseFormD(formXml({ sold: 'Indefinite' })), CFG), /no amount sold/);
  for (const n of ['Project Evergreen TopCo LP', 'Chrysler Holdings, LP', 'Halo Labs I LLC', 'Acme Co-Invest Fund II']) assert.match(screenForm(parseFormD(formXml({ name: n })), CFG), /investment vehicle/, n);
  for (const n of ['Minerva BI, Inc.', 'Upright Education, Inc.', 'Mocean Holdings Corp']) assert.equal(screenForm(parseFormD(formXml({ name: n })), CFG), null, n);
});

test('Form D: display names drop legal suffixes; the SEC contact email is required', () => {
  assert.equal(displayName('MINERVA BI, INC.'), 'Minerva BI');
  assert.equal(displayName('Summer, PBC'), 'Summer');
  assert.equal(displayName('Acme AI Holdings, LLC'), 'Acme AI');
  assert.throws(() => secUserAgent(''), /contact email/);
  assert.match(secUserAgent('a@b.co'), /a@b\.co$/);
});

test('Form D run: screens, opens only what may count, records it once, and retries failures next run', async () => {
  const store = openStore(':memory:');
  const pages = {
    search: { hits: { total: { value: 4 }, hits: [hit('1', 'EXAMPLE ROBOTICS, INC.'), hit('2', 'Some Fund LP', { items: ['3C.1'] }), hit('3', 'Broken Co'), hit('4', 'Upstate Inc', { loc: 'Albany, NY' })] } },
  };
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    assert.match(opts.headers['User-Agent'], /someone@example\.com/);
    if (url.includes('efts.sec.gov')) return { ok: true, json: async () => pages.search };
    if (url.endsWith('/data/1/1/primary_doc.xml')) return { ok: true, text: async () => formXml() };
    return { ok: false, status: 500 };
  };
  const idx = companyIndex(store);
  const r = await runFormD(store, idx, CFG, { fetchImpl, pause: async () => {}, now: new Date('2026-11-04T12:00:00Z') });
  assert.equal(r.listed, 4);
  assert.equal(r.opened, 1);
  assert.equal(r.counted.length, 1);
  assert.equal(r.counted[0].name, 'Example Robotics');
  assert.equal(r.errors.length, 1); // Broken Co: HTTP 500, reported, not recorded
  const e = store.companyRecords().find((c) => c.name === 'Example Robotics');
  assert.deepEqual([e.found_via, e.status, e.verified, e.nyc_presence], ['Form D', 'unknown', false, true]);
  assert.equal(e.last_raise.amount_usd, 15_000_000);
  assert.equal(e.leaders.length, 2);
  assert.ok(e.aliases.includes('EXAMPLE ROBOTICS, INC.'));
  assert.equal(store.fundingByCompany().size, 1);
  // Second run: the recorded filings are not opened again; the failed one is.
  calls.length = 0;
  const r2 = await runFormD(store, companyIndex(store), CFG, { fetchImpl, pause: async () => {}, now: new Date('2026-11-04T13:00:00Z') });
  assert.equal(r2.counted.length, 0);
  assert.equal(calls.filter((u) => !u.includes('efts')).length, 1);
  store.close();
});

// --- news reading
test('headlines: company, amount and round read by code; non-company headlines skipped', () => {
  assert.deepEqual(readHeadline('Audit AI Startup Clark Raises $11M Seed Round'), { company: 'Clark', amount_usd: 11_000_000, round: 'Seed', stage: 'seed' });
  assert.equal(readHeadline('Sam Altman-backed Coco Robotics raises $80M').company, 'Coco Robotics');
  assert.equal(readHeadline('DeepSeek reportedly raises $15B days after US restrictions').company, 'DeepSeek');
  assert.equal(readHeadline('The New York Startup Daily Funding Report: 10/29/2026'), null);
  assert.equal(readHeadline('Employee training startup raises $40 million'), null);
  assert.equal(readHeadline('Convective Capital raises an $85 million fund to build disaster resilience'), null);
  assert.equal(amountOf('$2.5 million'), 2_500_000);
  assert.equal(relativeDate('5 days ago', new Date('2026-11-04T12:00:00Z')), '2026-10-30');
  assert.equal(relativeDate('someday'), null);
  assert.ok(isNyc('Clark, a New York-based AI startup'));
  assert.ok(!isNyc('a Baltimore firm'));
});

test('RSS: items parsed; a page that is not RSS is an error', () => {
  const xml = '<rss><channel><item><title>Acme raises $5M seed</title><link>https://techcrunch.com/a</link><pubDate>Wed, 04 Nov 2026 17:11:15 +0000</pubDate><description><![CDATA[New York-based Acme&#8217;s news]]></description></item></channel></rss>';
  assert.deepEqual(parseRss(xml), [{ title: 'Acme raises $5M seed', link: 'https://techcrunch.com/a', published: '2026-11-04', text: 'New York-based Acme’s news' }]);
  assert.throws(() => parseRss('<html/>'), /not RSS/);
});

test('news: NYC companies are recorded; a known company gets its new round wherever it is; others are only logged', async () => {
  const store = openStore(':memory:');
  store.saveCompany({ name: 'Serval', status: 'strong', sources: [{ url: 's', supports: 'x' }] }, { source: 'research', by: 'kit' });
  const items = [
    { title: 'Clark Raises $11M Seed Round', link: 'https://n/1', text: 'Clark, a New York-based startup', published: '2026-11-03' },
    { title: 'Serval raises $47M to bring AI agents to IT service management', link: 'https://n/2', text: '', published: '2026-10-28' },
    { title: 'Trajectory raises $45M to make AI model training accessible', link: 'https://n/3', text: 'San Francisco', published: '2026-11-03' },
    { title: 'Sequoia hits rewind', link: 'https://n/4', text: '', published: '2026-11-04' },
  ];
  const r = await runTechCrunch(store, companyIndex(store), ['https://techcrunch.com/feed/'], { feed: async () => items, maxAgeDays: 30, now: new Date('2026-11-04T12:00:00Z') });
  assert.deepEqual(r.counted.map((c) => `${c.name}:${c.isNewCompany}:${c.nyc}`), ['Clark:true:true', 'Serval:false:false']);
  assert.equal(store.companyRecords().find((c) => c.name === 'Serval').last_raise.amount_usd, 47_000_000);
  assert.equal(store.companyRecords().find((c) => c.name === 'Serval').status, 'strong'); // your call untouched
  assert.equal(fundedLine(r.counted), 'Newly funded NYC companies (1): Clark ($11M, Seed, News)');
  // Seen items are skipped next time.
  const again = await runTechCrunch(store, companyIndex(store), ['https://techcrunch.com/feed/'], { feed: async () => items, maxAgeDays: 30, now: new Date('2026-11-04T12:00:00Z') });
  assert.equal(again.headlines, 0);
  store.close();
});

test('news search: a bad key or no credits stops the remaining searches', async () => {
  const store = openStore(':memory:');
  let n = 0;
  const search = async () => { n++; const e = new Error('HTTP 403'); e.status = 403; throw e; };
  const r = await runNewsSearch(store, companyIndex(store), ['q1', 'q2', 'q3'], { search, maxAgeDays: 30 });
  assert.equal(n, 1);
  assert.ok(r.stopped);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(newsSearchDue(null, 7), { due: true, nextInDays: 0 });
  assert.equal(newsSearchDue('2026-11-01T00:00:00Z', 7, new Date('2026-11-04T00:00:00Z')).due, false);
  store.close();
});

test('the same round from Form D and the news lands on one company', () => {
  const store = openStore(':memory:');
  const idx = companyIndex(store);
  recordFunded(store, idx, { name: 'Clark', legal_name: 'Clark AI, Inc.', amount_usd: 11e6, date: '2026-10-20', source_url: 'sec', supports: 'Form D', found_via: 'Form D', source: 'form_d', nyc: true });
  const r = considerNews(store, idx, { title: 'Audit AI Startup Clark Raises $11M Seed Round', link: 'https://n/1', text: '', published: '2026-11-03' }, { source: 'news:x', label: 'X', maxAgeDays: 30, now: new Date('2026-11-04T12:00:00Z') });
  assert.equal(r.isNewCompany, false);
  assert.equal(r.newRound, false); // the Form D and the article are one round
  const e = store.companyRecords().find((c) => c.name === 'Clark');
  assert.equal(e.found_via, 'Form D');
  assert.equal(e.stage, 'seed');
  assert.equal(e.sources.length, 2);
  store.close();
});

// --- research order and fit
test('research order: newly funded first, then companies hiring for target roles in NYC, then the rest', () => {
  const records = [
    { name: 'Old Co' }, { name: 'Funded Late', found_via: 'News', last_raise: { date: '2026-11-03' } },
    { name: 'Funded Early', found_via: 'Form D', last_raise: { date: '2026-10-01' } }, { name: 'Done', found_via: 'News', fit_facts: {} },
  ];
  const postings = [{ company: 'Hiring Co', in_home_metro: true, title_family: 'deployment_ai_strategist' }, { company: 'Other', in_home_metro: true, title_family: 'other' }];
  assert.deepEqual(researchOrder(records, postings).slice(0, 3), ['Funded Late', 'Funded Early', 'Hiring Co']);
});

test('refit: fit follows the facts and today\'s open deployment roles; unchanged companies are left alone', () => {
  const facts = { sells_to_businesses: { value: true }, enterprise_customers: { value: false }, hands_on_rollout: { value: true } };
  const recs = [{ name: 'A', ai_native: true, fit_facts: facts }, { name: 'B' }];
  assert.deepEqual(refit(recs, []).map((e) => `${e.name}:${e.fit}`), ['A:Possible']);
  assert.equal(refit(recs, []).length, 0);
  assert.deepEqual(refit(recs, [{ company: 'A', title_family: 'deployment_ai_strategist' }]).map((e) => e.fit), ['Strong']);
});

test('config: Form D and funding news settings are checked with clear messages', () => {
  const ok = { form_d: CFG, funding_news: { max_age_days: 30, nyc_checks_per_run: 15, techcrunch_feeds: ['https://techcrunch.com/tag/funding/feed/'], serper: { every_days: 7, queries: ['q'], national_queries: [] } } };
  assert.ok(checkRadarConfig(ok));
  assert.throws(() => checkRadarConfig({ ...ok, funding_news: { ...ok.funding_news, nyc_checks_per_run: undefined } }), /nyc_checks_per_run/);
  assert.throws(() => checkRadarConfig({ ...ok, funding_news: { ...ok.funding_news, serper: { every_days: 7, queries: ['q'] } } }), /national_queries/);
  assert.throws(() => checkRadarConfig({ ...ok, form_d: undefined }), /"form_d" settings are missing/);
  assert.throws(() => checkRadarConfig({ ...ok, form_d: { ...CFG, contact_email: 'nope' } }), /contact email/);
  assert.throws(() => checkRadarConfig({ ...ok, funding_news: { ...ok.funding_news, techcrunch_feeds: ['https://alleywatch.com/feed/'] } }), /techcrunch/);
  assert.throws(() => checkRadarConfig({ ...ok, funding_news: { ...ok.funding_news, max_age_days: undefined } }), /max_age_days/);
});

test('a company known only from a job board keeps "Job board" as how it was found', () => {
  const store = openStore(':memory:');
  store.company('traversal');
  const r = recordFunded(store, companyIndex(store), { name: 'Traversal', amount_usd: 120e6, date: '2026-11-03', source_url: 'n', supports: 'x', found_via: 'News', source: 'news', nyc: true });
  assert.equal(r.isNewCompany, false);
  const e = store.companyRecords().find((c) => c.name === 'traversal');
  assert.equal(e.found_via ?? null, null);
  assert.match(e.reason, /a job board/);
  store.close();
});

test('news: old stories and undated ones are logged but not counted as newly funded (D77)', async () => {
  const store = openStore(':memory:');
  store.saveCompany({ name: 'Substack', status: 'unknown', sources: [{ url: 's', supports: 'x' }] }, { source: 'research', by: 'kit' });
  const items = [
    { title: 'Substack raises $100M from Chernin Group', link: 'https://n/old', text: 'New York', published: '2025-07-17' },
    { title: 'Clark Raises $11M Seed Round', link: 'https://n/nodate', text: 'New York-based', published: null },
  ];
  const r = await runTechCrunch(store, companyIndex(store), ['https://techcrunch.com/feed/'], { feed: async () => items, maxAgeDays: 30, now: new Date('2026-11-04T12:00:00Z') });
  assert.equal(r.headlines, 2);
  assert.deepEqual(r.counted, []);
  assert.equal(store.fundingByCompany().size, 0);
  assert.equal(store.companyRecords().find((c) => c.name === 'Substack').last_raise ?? null, null);
  assert.throws(() => considerNews(store, companyIndex(store), items[0], { source: 'x', label: 'X' }), /max_age_days/);
  store.close();
});

test('several articles about one raise stay one round; a different raise is a new one (D77)', () => {
  const store = openStore(':memory:');
  const idx = companyIndex(store);
  const now = new Date('2026-11-04T12:00:00Z');
  const opts = { source: 'news:x', label: 'X', maxAgeDays: 30, now };
  const a = considerNews(store, idx, { title: 'Serval Raises $150M Series C at $3B Valuation', link: 'https://n/a', text: 'New York', published: '2026-10-30' }, opts);
  const b = considerNews(store, idx, { title: 'Serval raises $150 million led by Sequoia', link: 'https://n/b', text: '', published: '2026-11-03' }, opts);
  const c = considerNews(store, idx, { title: 'Serval raises $47M to bring AI agents to IT', link: 'https://n/c', text: '', published: '2026-10-25' }, opts);
  assert.deepEqual([a.newRound, b.newRound, c.newRound], [true, false, true]);
  const id = store.company('Serval');
  const rounds = store.fundingByCompany().get(id);
  assert.equal(rounds.length, 2);
  assert.equal(rounds.find((x) => x.amount_usd === 150e6).round, 'Series C');
  const e = store.companyRecords().find((x) => x.name === 'Serval');
  assert.equal(e.last_raise.date, '2026-10-30'); // a repeat article does not move the raise date
  assert.equal(e.sources.length, 3); // every article is still kept as a source
  assert.equal(fundedLine([a, b, c]), 'Newly funded NYC companies (1): Serval ($150M, Series C, News)');
  store.close();
});

// --- D113: a daily news search, and a warning a week before the Serper credits run out
test('news window: the time since the last good search (D113)', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  assert.deepEqual(newsWindow(null, now), { tbs: 'qdr:w', label: 'past week' });
  assert.equal(newsWindow('2026-11-11T12:13:00Z', now).tbs, 'qdr:d'); // a day ago, a little late
  assert.equal(newsWindow('2026-11-09T12:00:00Z', now).tbs, 'qdr:w'); // missed two days
  assert.equal(newsWindow('2026-10-20T12:00:00Z', now).tbs, 'qdr:m');
});

test('credits: the pace is never below planned use; a week left is LOW; a top-up starts over (D113)', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const first = creditOutlook([], 2438, 17, now);
  assert.equal(first.daysLeft, 143);
  assert.equal(first.low, false);
  assert.match(creditLine(2438, first), /^ {2}✓ Serper credits: 2,438 left · about 17 a day · about 143 days left$/);
  // measured faster than planned: 400 used in 4 days = 100 a day
  const hist = [{ at: '2026-11-16T12:00:00Z', balance: 1000 }, { at: '2026-11-18T12:00:00Z', balance: 800 }];
  const fast = creditOutlook(hist, 600, 17, now);
  assert.equal(fast.perDay, 100);
  assert.equal(fast.daysLeft, 6);
  assert.equal(fast.low, true);
  assert.equal(creditLine(600, fast), 'Serper credits LOW: 600 left · about 100 a day · about 6 days left. Buy more at serper.dev before they run out.');
  // credits bought: the history starts over, so the old pace doesn't count
  const topped = creditOutlook(hist, 50600, 17, now);
  assert.deepEqual(topped.history, [{ at: now.toISOString(), balance: 50600 }]);
  assert.equal(topped.low, false);
  // under 3 days recorded: planned use only
  assert.equal(creditOutlook([{ at: '2026-11-19T12:00:00Z', balance: 200 }], 100, 17, now).perDay, 17);
});

test('credit balance: read from Serper; a missing number or a bad answer fails loudly (D113)', async () => {
  const answer = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
  assert.equal(await serperBalance('k', { fetchImpl: answer(200, { balance: 2438, rateLimit: 5 }) }), 2438);
  await assert.rejects(serperBalance('k', { fetchImpl: answer(200, {}) }), /no credit balance/);
  await assert.rejects(serperBalance('k', { fetchImpl: answer(403, {}) }), /HTTP 403\. Check SERPER_API_KEY/);
  await assert.rejects(serperBalance('k', { fetchImpl: async () => { throw new Error('fetch failed'); } }), /Could not reach Serper for the credit balance: fetch failed/);
});

// --- D116: every Google News date form, and stories dropped for a missing date are read again
test('news dates: hours, days, weeks, months, yesterday and written dates (D116)', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  assert.equal(relativeDate('3 hours ago', now), '2026-11-12');
  assert.equal(relativeDate('5 days ago', now), '2026-11-07');
  assert.equal(relativeDate('1 week ago', now), '2026-11-05');
  assert.equal(relativeDate('2 weeks ago', now), '2026-10-29');
  assert.equal(relativeDate('1 month ago', now), '2026-10-12'); // 31 days: older than the 30-day limit
  assert.equal(relativeDate('Yesterday', now), '2026-11-11');
  assert.equal(relativeDate('Nov 4, 2026', now), '2026-11-04');
  assert.equal(relativeDate('4 Nov 2026', now), '2026-11-04');
  assert.equal(relativeDate('2026-11-04T10:00:00Z', now), '2026-11-04');
  assert.equal(relativeDate('Foo 4, 2026', now), null);
  assert.equal(relativeDate('', now), null);
});

test('a story dropped for having no date is read again and can be recorded; others stay seen (D116)', () => {
  const s = openStore(':memory:');
  const base = { source: 'news:serper', title: 'NYC AI startup Qualitate raises $25M', nyc: true };
  s.recordNews({ ...base, url: 'https://a', company: 'Qualitate', outcome: 'no publish date; not counted' });
  s.recordNews({ ...base, url: 'https://b', outcome: 'not a company-raised-money headline' });
  assert.deepEqual([...s.newsSeen()], ['https://b']);
  s.recordNews({ ...base, url: 'https://a', published: '2026-11-05', company: 'Qualitate', outcome: 'recorded' });
  s.recordNews({ ...base, url: 'https://b', outcome: 'recorded' }); // a decided story isn't overwritten
  const rows = s.db.prepare('SELECT url, outcome, published FROM funding_news ORDER BY url').all();
  assert.deepEqual(rows.map((r) => [r.url, r.outcome, r.published]), [['https://a', 'recorded', '2026-11-05'], ['https://b', 'not a company-raised-money headline', null]]);
  s.close();
});

// --- D117: nationwide news, an NYC check for companies a story doesn't place
test('NYC check: one call per company, newest first, capped; only a sourced "yes" is recorded (D117)', async () => {
  const store = openStore(':memory:');
  const idx = companyIndex(store);
  const now = new Date('2026-11-12T12:00:00Z');
  const news = (url, title, published) => store.recordNews({ url, source: 'news:serper', title, published, company: readHeadline(title).company, nyc: false, outcome: 'NYC check pending' }, now);
  news('https://a1', 'Imprint raises $130M to help brands build loyalty', '2026-11-12');
  news('https://a2', 'Imprint raises $130M at $1.9B valuation', '2026-11-11');
  news('https://b', 'Zippy raises $20M for manufactured-home lending', '2026-11-10');
  news('https://c', 'Gloop raises $5M seed', '2026-11-09');
  news('https://d', 'Oldco raises $9M', '2026-10-01'); // past the 30-day limit
  const facts = {
    Imprint: { is_operating_company: true, hq_city: 'New York', nyc_office: 'yes', evidence: 'HQ: New York (company site)', source_url: 'https://imprint.co' },
    Zippy: { is_operating_company: true, hq_city: 'Dallas', nyc_office: 'no', evidence: 'Dallas fintech', source_url: 'https://z' },
    Gloop: { is_operating_company: true, hq_city: null, nyc_office: 'yes', evidence: null, source_url: null }, // no evidence: not counted
  };
  const asked = [];
  const r = await runNycChecks(store, idx, { check: async ({ company }) => { asked.push(company); return { facts: facts[company] }; }, limit: 2, maxAgeDays: 30, now });
  assert.deepEqual(asked, ['Imprint', 'Zippy']); // one call for Imprint's two stories; the cap leaves Gloop waiting
  assert.deepEqual(r.nyc, ['Imprint']);
  assert.equal(r.elsewhere, 1);
  assert.equal(r.waiting, 1);
  assert.equal(r.counted.length, 2); // both stories, one round (D77)
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM funding_rounds").get().n, 1);
  const outcome = (u) => store.db.prepare('SELECT outcome FROM funding_news WHERE url = ?').get(u).outcome;
  assert.equal(outcome('https://a1'), 'recorded');
  assert.equal(outcome('https://b'), 'not NYC (checked: Dallas)');
  assert.equal(outcome('https://c'), 'NYC check pending');
  assert.equal(outcome('https://d'), 'older than 30 days; not counted');
  const r2 = await runNycChecks(store, idx, { check: async ({ company }) => ({ facts: facts[company] }), limit: 5, maxAgeDays: 30, now });
  assert.equal(r2.unknown, 1);
  assert.equal(outcome('https://c'), 'NYC office not found (checked); not counted');
  // A failed check is reported and the company waits; the usage limit pauses the rest.
  news('https://e', 'Fragment raises $12M Series A', '2026-11-12');
  news('https://f', 'Mural raises $15M Series A', '2026-11-12');
  const r3 = await runNycChecks(store, idx, { check: async ({ company }) => { throw new Error(company === 'Fragment' ? 'claude exited with code 143.' : 'Claude usage limit reached'); }, limit: 5, maxAgeDays: 30, now });
  assert.match(r3.errors[0], /^NYC check, (Fragment|Mural): claude exited with code 143/);
  assert.equal(outcome('https://e'), 'NYC check pending');
  store.close();
});

test('a story that doesn\'t place an untracked company in NYC waits for the NYC check instead of being dropped (D117)', () => {
  const store = openStore(':memory:');
  const now = new Date('2026-11-12T12:00:00Z');
  const r = considerNews(store, companyIndex(store), { title: 'Garage Raises $41M to help cities buy used fire trucks', link: 'https://g', published: '2026-11-10' }, { source: 'news:serper', label: 'x', maxAgeDays: 30, now });
  assert.equal(r, null);
  assert.equal(store.newsPending()[0].company, 'Garage');
  // A company we already track is recorded wherever the story is set (D72).
  store.company('garage');
  const r2 = considerNews(store, companyIndex(store), { title: 'Garage Raises $41M to help cities buy used fire trucks', link: 'https://g2', published: '2026-11-10' }, { source: 'news:serper', label: 'x', maxAgeDays: 30, now });
  assert.equal(r2.name, 'garage');
  store.close();
});

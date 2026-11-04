import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './store.mjs';
import { companyIndex, recordFunded, runFormD, runTechCrunch, runNewsSearch, considerNews, fundedLine, researchOrder, refit, checkRadarConfig, newsSearchDue } from './radar.mjs';
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
  assert.equal(relativeDate('2 weeks ago'), null);
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
  const r = await runTechCrunch(store, companyIndex(store), ['https://techcrunch.com/feed/'], { feed: async () => items });
  assert.deepEqual(r.counted.map((c) => `${c.name}:${c.isNewCompany}:${c.nyc}`), ['Clark:true:true', 'Serval:false:false']);
  assert.equal(store.companyRecords().find((c) => c.name === 'Serval').last_raise.amount_usd, 47_000_000);
  assert.equal(store.companyRecords().find((c) => c.name === 'Serval').status, 'strong'); // your call untouched
  assert.equal(fundedLine(r.counted), 'Newly funded NYC companies (1): Clark ($11M, Seed, News)');
  // Seen items are skipped next time.
  const again = await runTechCrunch(store, companyIndex(store), ['https://techcrunch.com/feed/'], { feed: async () => items });
  assert.equal(again.headlines, 0);
  store.close();
});

test('news search: a bad key or no credits stops the remaining searches', async () => {
  const store = openStore(':memory:');
  let n = 0;
  const search = async () => { n++; const e = new Error('HTTP 403'); e.status = 403; throw e; };
  const r = await runNewsSearch(store, companyIndex(store), ['q1', 'q2', 'q3'], { search });
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
  const r = considerNews(store, idx, { title: 'Audit AI Startup Clark Raises $11M Seed Round', link: 'https://n/1', text: '', published: '2026-11-03' }, { source: 'news:x', label: 'X' });
  assert.equal(r.isNewCompany, false);
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
  const ok = { form_d: CFG, funding_news: { techcrunch_feeds: ['https://techcrunch.com/tag/funding/feed/'], serper: { every_days: 7, queries: ['q'] } } };
  assert.ok(checkRadarConfig(ok));
  assert.throws(() => checkRadarConfig({ ...ok, form_d: undefined }), /"form_d" settings are missing/);
  assert.throws(() => checkRadarConfig({ ...ok, form_d: { ...CFG, contact_email: 'nope' } }), /contact email/);
  assert.throws(() => checkRadarConfig({ ...ok, funding_news: { ...ok.funding_news, techcrunch_feeds: ['https://alleywatch.com/feed/'] } }), /techcrunch/);
});

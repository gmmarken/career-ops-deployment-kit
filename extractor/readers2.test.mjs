// Rippling (D60) and a16z (D61) readers: parsing only, with made-up pages (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJobUrl, boardFromUrl, fromRippling, ripplingBoardPage, ripplingPay } from './ats.mjs';
import { listCompanyPages, parseCompanyPage } from './a16z.mjs';

const nextPage = (pageProps) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script></html>`;

test('Rippling links: job URL and board key', () => {
  assert.deepEqual(parseJobUrl('https://ats.rippling.com/pace/jobs/abc-123'), { ats: 'rippling', board: 'pace', id: 'abc-123' });
  assert.equal(boardFromUrl('https://ats.rippling.com/pace/jobs/abc-123'), 'rippling:pace');
  assert.equal(boardFromUrl('https://ats.rippling.com/es-419/drivepoint/jobs/abc-123'), 'rippling:drivepoint'); // language code skipped
  assert.equal(parseJobUrl('https://ats.rippling.com/pt-BR/acme/jobs/x1').board, 'acme');
  assert.deepEqual(parseJobUrl('https://jobs.ashbyhq.com/hippocratic%20ai/abc-1'), { ats: 'ashby', board: 'hippocratic ai', id: 'abc-1' });
});

test('Rippling board page: jobs with locations and work model; total pages', () => {
  const html = nextPage({ dehydratedState: { queries: [
    { queryKey: ['board', 'pace', 'locations'], state: { data: { items: [] } } },
    { queryKey: ['board', 'pace', 'job-posts', false, { page: 0 }], state: { data: { items: [
      { url: 'https://ats.rippling.com/pace/jobs/1', name: 'Deployment Strategist', locations: [{ name: 'New York, NY', workplaceType: 'ON_SITE' }] },
    ], totalPages: 2 } } },
  ] } });
  const r = ripplingBoardPage('pace', html);
  assert.equal(r.totalPages, 2);
  assert.deepEqual(r.items.map((i) => [i.title, i.locations, i.workplace]), [['Deployment Strategist', ['New York, NY'], 'onsite']]);
});
test('Rippling board page without a job list fails loudly', () => {
  assert.throws(() => ripplingBoardPage('pace', nextPage({ dehydratedState: { queries: [] } })), /no job list/);
  assert.throws(() => ripplingBoardPage('pace', '<html></html>'), /no page data/);
});

test('Rippling job page: hard facts and description text', () => {
  const html = nextPage({ apiData: { jobPost: {
    name: 'Deployment Strategist', companyName: 'Pace', workLocations: ['New York, NY'], createdOn: '2026-01-26T18:05:56-08:00',
    payRangeDetails: [], description: { company: '<p>Pace builds AI agents.</p>', role: '<ul><li>Deploy with customers</li></ul>' },
  } } });
  const { posting, jdText } = fromRippling(html, 'https://ats.rippling.com/pace/jobs/1');
  assert.equal(posting.title, 'Deployment Strategist');
  assert.equal(posting.company, 'Pace');
  assert.equal(posting.pay, null);
  assert.match(jdText, /Pace builds AI agents\.[\s\S]*Deploy with customers/);
});
test('Rippling pay in an unknown format is reported, never guessed', () => {
  assert.equal(ripplingPay([], 'x'), null);
  assert.throws(() => ripplingPay([{ min: 1 }], 'x'), /format the kit doesn't read yet/);
});
test('Rippling job page with no job fails loudly', () => {
  assert.throws(() => fromRippling(nextPage({ apiData: {} }), 'u'), /no job on it/);
});

const sitemap = (urls) => `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`;
test('a16z sitemap: only company job pages', async () => {
  const pages = await listCompanyPages('https://jobs.vc/', async () => sitemap(['https://jobs.vc/', 'https://jobs.vc/company/patch', 'https://jobs.vc/jobs/patch', 'https://jobs.vc/jobs/eka-robotics']));
  assert.deepEqual(pages.map((p) => p.slug), ['patch', 'eka-robotics']);
  await assert.rejects(listCompanyPages('https://jobs.vc', async () => sitemap(['https://jobs.vc/'])), /no company job pages/);
});

const ld = (graph) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`;
test('a16z company page: name, titles and readable boards', () => {
  const html = ld([{ '@type': 'Organization', name: 'Andreessen Horowitz' }]) + ld([
    { '@type': 'Organization', name: 'Patch' },
    { '@type': 'ItemList', itemListElement: [{ name: 'Embedded Climate Strategist' }, { name: 'Account Executive' }] },
  ]) + '<a href="https://jobs.ashbyhq.com/patch.io/a9/application">Apply</a><a href="https://jobs.ashbyhq.com/patch.io/b1">x</a>';
  assert.deepEqual(parseCompanyPage(html), { company: 'Patch', titles: ['Embedded Climate Strategist', 'Account Executive'], boards: ['ashby:patch.io'], unreadable: [] });
});
test('a16z company page: jobs on a site we cannot read are named; no job list fails loudly', () => {
  const html = ld([{ '@type': 'Organization', name: 'Big' }, { '@type': 'ItemList', itemListElement: [{ name: 'Chief of Staff' }] }]) + '<a href="https://big.com/careers/job?gh_jid=1">x</a>';
  assert.deepEqual(parseCompanyPage(html).unreadable, ['big.com']);
  assert.throws(() => parseCompanyPage(ld([{ '@type': 'Organization', name: 'Big' }]), 'p'), /no job list/);
});

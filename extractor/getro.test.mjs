import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobFromUrl, listGetroJobs, parseJobPage } from './getro.mjs';
import { boardFromUrl } from './ats.mjs';

test('jobFromUrl rebuilds the title from the link; non-job links are ignored', () => {
  assert.deepEqual(jobFromUrl('https://jobs.example.vc/companies/acme-2/jobs/123-ai-deployment-strategist'),
    { url: 'https://jobs.example.vc/companies/acme-2/jobs/123-ai-deployment-strategist', company_slug: 'acme-2', title: 'ai deployment strategist' });
  assert.equal(jobFromUrl('https://jobs.example.vc/companies/acme-2'), null);
});

const xml = (tag, urls) => `<?xml version="1.0"?><${tag}>${urls.map((u) => `<${tag === 'sitemapindex' ? 'sitemap' : 'url'}><loc>${u}</loc></${tag === 'sitemapindex' ? 'sitemap' : 'url'}>`).join('')}</${tag}>`;

test('listGetroJobs follows a sitemap index into the job sitemaps only', async () => {
  const pages = {
    'https://b.vc/sitemap.xml': xml('sitemapindex', ['https://b.vc/sitemap_main.xml', 'https://b.vc/sitemap_jobs1.xml']),
    'https://b.vc/sitemap_jobs1.xml': xml('urlset', ['https://b.vc/companies/x/jobs/1-chief-of-staff', 'https://b.vc/companies/x']),
  };
  const jobs = await listGetroJobs('https://b.vc/', async (u) => { if (!(u in pages)) throw new Error(`unexpected ${u}`); return pages[u]; });
  assert.deepEqual(jobs.map((j) => j.title), ['chief of staff']);
});

test('listGetroJobs reads a single-list sitemap, and fails loudly when there are no job links', async () => {
  const one = xml('urlset', ['https://b.vc/jobs', 'https://b.vc/companies/y/jobs/9-bizops-lead']);
  assert.equal((await listGetroJobs('https://b.vc', async () => one)).length, 1);
  await assert.rejects(listGetroJobs('https://b.vc', async () => xml('urlset', ['https://b.vc/jobs'])), /no job links/);
  await assert.rejects(listGetroJobs('https://b.vc', async () => xml('sitemapindex', ['https://b.vc/sitemap_main.xml'])), /no job sitemaps/);
});

const page = (job) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialState: { jobs: { currentJob: job } } } } })}</script></html>`;

test('parseJobPage returns where the job is really posted', () => {
  const r = parseJobPage(page({ url: 'https://jobs.ashbyhq.com/acme/abc', title: 'AI Strategist', organization: { name: 'Acme' }, locations: [{ name: 'New York, NY, USA' }] }));
  assert.deepEqual(r, { url: 'https://jobs.ashbyhq.com/acme/abc', title: 'AI Strategist', company: 'Acme', locations: ['New York, NY, USA'] });
});
test('parseJobPage fails loudly on a changed or closed page', () => {
  assert.throws(() => parseJobPage('<html></html>', 'p'), /no page data/);
  assert.throws(() => parseJobPage(page(null), 'p'), /does not say where/);
});

test('boardFromUrl: readable boards from job or board links; others are null', () => {
  assert.equal(boardFromUrl('https://jobs.ashbyhq.com/Acme/abc'), 'ashby:acme');
  assert.equal(boardFromUrl('https://jobs.ashbyhq.com/acme'), 'ashby:acme');
  assert.equal(boardFromUrl('https://job-boards.greenhouse.io/stripe/jobs/1'), 'greenhouse:stripe');
  assert.equal(boardFromUrl('https://boards.greenhouse.io/embed/job_app?for=notion&token=1'), 'greenhouse:notion');
  assert.equal(boardFromUrl('https://jobs.lever.co/palantir/x'), 'lever:palantir');
  assert.equal(boardFromUrl('https://example.com/careers'), null);
  assert.equal(boardFromUrl('not a url'), null);
});

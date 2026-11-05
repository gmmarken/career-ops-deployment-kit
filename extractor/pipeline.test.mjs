// Offline tests for the claude runner's safety flags, output parsing, input building,
// and watchlist lookups. No model calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs, parseClaudeOutput } from './claude.mjs';
import { buildInput, markdownSection } from './extract.mjs';
import { findCompany, normalizeName, toCompanyFacts, fillFromResearch, needsEnrichment, applyResearch, screenLeaders } from './research.mjs';

const argAfter = (args, flag) => args[args.indexOf(flag) + 1];

test('extraction runs with no tools and no MCP servers, never skipping permissions', () => {
  const args = claudeArgs({ systemPrompt: 'p', schema: { type: 'object' }, tools: [] });
  assert.equal(argAfter(args, '--tools'), '');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(argAfter(args, '--permission-mode'), 'dontAsk');
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(!args.includes('--allowedTools'));
  assert.ok(!args.some((a) => /dangerously/.test(a)));
});
test('the $schema version key is not sent to claude', () => {
  const args = claudeArgs({ systemPrompt: 'p', schema: { $schema: 'x', type: 'object' } });
  assert.deepEqual(JSON.parse(argAfter(args, '--json-schema')), { type: 'object' });
});
test('research may only search and read the web', () => {
  const args = claudeArgs({ systemPrompt: 'p', schema: {}, tools: ['WebSearch', 'WebFetch'] });
  assert.equal(argAfter(args, '--tools'), 'WebSearch,WebFetch');
  assert.equal(argAfter(args, '--allowedTools'), 'WebSearch,WebFetch');
});

test('parses structured_output and usage', () => {
  const out = JSON.stringify({ subtype: 'success', is_error: false, structured_output: { a: 1 }, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01, num_turns: 1 });
  const r = parseClaudeOutput(out);
  assert.deepEqual(r.data, { a: 1 });
  assert.equal(r.usage.input_tokens, 10);
});
test('falls back to JSON in result text (with or without code fence)', () => {
  assert.deepEqual(parseClaudeOutput(JSON.stringify({ subtype: 'success', result: '```json\n{"b":2}\n```' })).data, { b: 2 });
});
test('error envelopes and prose answers fail loudly', () => {
  assert.throws(() => parseClaudeOutput(JSON.stringify({ subtype: 'error_max_turns', is_error: true, result: 'x' })), /reported an error/);
  assert.throws(() => parseClaudeOutput(JSON.stringify({ subtype: 'success', result: 'Sure! Here you go' })), /not the requested JSON/);
  assert.throws(() => parseClaudeOutput('not json'), /non-JSON/);
});

test('posting goes last, fenced as untrusted, after candidate context', () => {
  const s = buildInput({ jdText: 'JOB', targets: 'T', cv: 'CV' });
  assert.ok(s.indexOf('<candidate_targets>') < s.indexOf('<candidate_cv>'));
  assert.ok(s.indexOf('<candidate_cv>') < s.indexOf('<job_posting>'));
  assert.match(s, /<job_posting>\nJOB\n<\/job_posting>/);
  assert.throws(() => buildInput({ jdText: '  ', targets: 'T', cv: 'CV' }), /empty/);
});
test('markdownSection extracts one section and fails loudly if missing', () => {
  const md = '# Title\n## Target Role Definition\nline 1\nline 2\n## Next\nother';
  assert.equal(markdownSection(md, 'Target Role Definition'), '## Target Role Definition\nline 1\nline 2');
  assert.throws(() => markdownSection(md, 'Nope'), /not found/);
});

const wl = { companies: [{ name: 'Acme AI', aliases: ['acmeai-careers'], status: 'strong', stage: 'series_b', owner_categories: [], origin: 'watchlist' }] };
test('watchlist lookup ignores case and punctuation, and checks aliases', () => {
  assert.equal(normalizeName('Acme, AI!'), 'acmeai');
  assert.equal(findCompany(wl, 'ACME ai')?.name, 'Acme AI');
  assert.equal(findCompany(wl, 'nope', 'acmeai-careers')?.name, 'Acme AI');
  assert.equal(findCompany(wl, 'Other'), null);
});
test('unknown company becomes status unknown (engine caps it), never "strong"', () => {
  const f = toCompanyFacts(null, 'Mystery Co');
  assert.equal(f.status, 'unknown');
  assert.equal(f.verified, false);
});
test('research entries stay unverified until confirmed', () => {
  assert.equal(toCompanyFacts({ name: 'X', status: 'strong', origin: 'research', verified: false }).verified, false);
  assert.equal(toCompanyFacts({ name: 'X', status: 'strong' }).verified, true);
});

// --- enrichment
test('enrich fills only empty fields and never your calls', () => {
  const entry = { name: 'SpaceX', status: 'strong', verified: true, ai_native: true, stage: 'unknown', investors: [], sources: [], reason: 'Your call' };
  const research = { status: 'not_strong', verified: false, ai_native: false, stage: 'private_equity_backed', investors: ['A'], sources: [{ url: 'u', supports: 'x' }], what_they_do: 'rockets', reason: 'r' };
  const filled = fillFromResearch(entry, research, '2026-11-02');
  assert.deepEqual(filled.sort(), ['investors', 'sources', 'stage', 'what_they_do']);
  assert.deepEqual([entry.status, entry.verified, entry.ai_native, entry.reason], ['strong', true, true, 'Your call']);
  assert.equal(entry.researched_at, '2026-11-02');
});
test('needs enrichment: missing from watchlist, or never asked the Phase 6 questions (no fit facts); each company once', () => {
  const wl2 = { companies: [{ name: 'Acme AI', sources: [{ url: 'u' }], fit_facts: {} }, { name: 'SpaceX', sources: [{ url: 'u' }] }] };
  assert.deepEqual(needsEnrichment(wl2, ['Acme AI', 'SpaceX', 'spacex', 'Newco']).map((x) => x.name), ['SpaceX', 'Newco']);
});
test('enrich merges sources and leaders; a generic Form D title takes the research title', () => {
  const entry = { name: 'Minerva BI', sources: [{ url: 'sec', supports: 'Form D' }], leaders: [{ name: 'Jackson Engles', title: 'Executive officer', source_url: 'sec' }] };
  const research = { sources: [{ url: 'sec', supports: 'dup' }, { url: 'site', supports: 'team page' }],
    leaders: [{ name: 'jackson engles', title: 'CEO & Co-founder', source_url: 'site' }, { name: 'Daniel Saedi', title: 'CTO', source_url: 'site' }] };
  const filled = fillFromResearch(entry, research, '2026-11-04');
  assert.ok(filled.includes('sources') && filled.includes('leaders'));
  assert.deepEqual(entry.sources.map((x) => x.url), ['sec', 'site']);
  assert.deepEqual(entry.leaders.map((l) => `${l.name}|${l.title}`), ['Jackson Engles|CEO & Co-founder', 'Daniel Saedi|CTO']);
});
test('first research of a Form D / news record sets the company call; later research never does', () => {
  const found = { name: 'Clark', status: 'unknown', ai_native: false, found_via: 'News', reason: 'Found via News; not researched yet' };
  applyResearch(found, { status: 'strong', ai_native: true, reason: 'AI audit agents', sources: [] }, '2026-11-04');
  assert.deepEqual([found.status, found.ai_native, found.reason], ['strong', true, 'AI audit agents']);
  const yours = { name: 'Clark', status: 'not_strong', ai_native: false, found_via: 'News', reason: 'Your call' };
  applyResearch(yours, { status: 'strong', ai_native: true, reason: 'x', sources: [] }, '2026-11-04');
  assert.deepEqual([yours.status, yours.ai_native, yours.reason], ['not_strong', false, 'Your call']);
});
test('leaders from LinkedIn or with contact details are dropped and reported', () => {
  const { kept, dropped } = screenLeaders([
    { name: 'A B', title: 'CEO', source_url: 'https://acme.com/team' },
    { name: 'C D', title: 'COO', source_url: 'https://www.linkedin.com/in/cd' },
    { name: 'E F', title: 'CTO (e@acme.com)', source_url: 'https://acme.com' },
    { name: 'G H', title: 'CFO', source_url: 'press release' },
  ]);
  assert.deepEqual(kept.map((l) => l.name), ['A B']);
  assert.deepEqual(dropped.map((d) => d.why), ['sourced to LinkedIn', 'contains contact details', 'no source link']);
});

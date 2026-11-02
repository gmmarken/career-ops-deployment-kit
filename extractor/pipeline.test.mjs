// Offline tests for the claude runner's safety flags, output parsing, input building,
// and watchlist lookups. No model calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs, parseClaudeOutput } from './claude.mjs';
import { buildInput, markdownSection } from './extract.mjs';
import { findCompany, normalizeName, toCompanyFacts } from './research.mjs';

const argAfter = (args, flag) => args[args.indexOf(flag) + 1];

test('extraction runs with no tools and no MCP servers, never skipping permissions', () => {
  const args = claudeArgs({ systemPrompt: 'p', schema: { type: 'object' }, tools: [] });
  assert.equal(argAfter(args, '--tools'), '');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(!args.includes('--allowedTools'));
  assert.ok(!args.some((a) => /dangerously/.test(a)));
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

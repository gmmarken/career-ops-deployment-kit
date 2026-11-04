import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUsageLimit } from './claude.mjs';

test('isUsageLimit: Claude plan limits, in the wordings Claude uses (D68)', () => {
  for (const m of [
    'claude reported an error (success): Claude AI usage limit reached|1762282800',
    "claude exited with code 1.\nYou've hit your limit · resets 10:55am (America/Los_Angeles)",
    "You've hit your session limit · resets 3pm",
    '5-hour limit reached ∙ resets 10:55am',
    'Weekly limit reached · resets Mon 9am',
  ]) assert.equal(isUsageLimit(m), true, m);
});

test('isUsageLimit: other errors are not a pause', () => {
  for (const m of [
    'claude exited with code 1. Run `claude` and /login first.',
    'claude was stopped (SIGTERM) after 300s',
    "claude's answer was not the requested JSON: …",
    'https://api.ashbyhq.com/… returned HTTP 429. Too many requests',
    'Daily limit of 30 roles: the posting mentions a limit on travel',
  ]) assert.equal(isUsageLimit(m), false, m);
});

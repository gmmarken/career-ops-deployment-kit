// The launchd templates must hold placeholders only (no personal values), and every
// placeholder must be one install-daily.sh fills in (D53, D65).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), 'utf8');
const install = read('install-daily.sh');
const placeholders = (t) => [...new Set(t.match(/__[A-Z_]+__/g) || [])].sort();

for (const [file, want] of [
  ['launchd/com.career-ops.daily.plist.template', ['__APP_BIN__', '__HOUR__', '__LOG_DIR__', '__MINUTE__']],
  ['launchd/CareerOpsDaily.applescript.template', ['__APP_LOG__', '__DAILY_SH__', '__IMESSAGE_TO__', '__PATH__']],
]) {
  test(`${file}: placeholders are the ones install-daily.sh fills in`, () => {
    const t = read(file);
    assert.deepEqual(placeholders(t), want);
    for (const p of want) assert.ok(install.includes(`s|${p}|`), `install-daily.sh does not fill in ${p}`);
    assert.doesNotMatch(t, /\+?\d[\d\s().-]{8,}\d/, 'looks like a phone number');
    assert.doesNotMatch(t, /\/Users\//, 'has a real home-folder path');
  });
}

test('helper app sends its own failure text only when daily.mjs could not (exit not 0 or 1)', () => {
  const t = read('launchd/CareerOpsDaily.applescript.template');
  assert.match(t, /if code is not 0 and code is not 1 then/);
  assert.match(t, /🚨🚨 JOB SEARCH RUN FAILED 🚨🚨/);
});

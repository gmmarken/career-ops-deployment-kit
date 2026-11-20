// True when this module is the file node was asked to run, not one being imported.
// Compares real paths: under a symlinked folder (macOS /tmp is one) process.argv[1] and
// import.meta.url name the same file differently, and a plain comparison would skip the
// script's work and exit 0 without a word.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function runAsScript(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(argv1));
}

#!/usr/bin/env node
// scripts/notion.sh setup <parent page URL> | sync | pull
import { setup } from './setup.mjs';

const dataDir = process.env.CAREER_OPS_DATA_DIR;
try {
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set. Run through scripts/notion.sh.');
  const [cmd, a1] = process.argv.slice(2);
  if (cmd === 'setup') await setup(dataDir, a1);
  else if (cmd === 'sync') { const { syncAll } = await import('./sync.mjs'); await syncAll(dataDir); }
  else if (cmd === 'pull') { const { pullCompanyEdits } = await import('./sync.mjs'); await pullCompanyEdits(dataDir, { verbose: true }); }
  else throw new Error('Usage: notion.sh setup <parent page URL> | sync | pull');
} catch (err) {
  console.error(`notion: ${err.message}`);
  process.exit(1);
}

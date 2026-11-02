#!/usr/bin/env node
// One-time setup: create Company Radar and Job Postings under a parent page and save
// their ids to <data dir>/config/notion.json. Safe to re-run: if the saved databases
// are reachable it changes nothing; if they're saved but unreachable it stops.
// Usage: scripts/notion.sh setup <parent page URL>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, readToken, notionId } from './client.mjs';
import { radarProperties, jobsProperties, RADAR_TITLE, JOBS_TITLE } from './schema.mjs';

export const configPath = (dataDir) => join(dataDir, 'config', 'notion.json');

export function loadNotionConfig(dataDir) {
  const p = configPath(dataDir);
  if (!existsSync(p)) throw new Error(`Notion isn't set up yet (${p} missing). Run scripts/notion.sh setup <parent page URL>.`);
  const c = JSON.parse(readFileSync(p, 'utf-8'));
  for (const k of ['parent_page_id', 'jobs_database_id', 'jobs_data_source_id', 'radar_database_id', 'radar_data_source_id']) {
    if (!c[k]) throw new Error(`${p} is missing ${k}.`);
  }
  return c;
}

async function createDatabase(client, parentId, name, description, properties) {
  const db = await client.api('databases', 'POST', {
    parent: { type: 'page_id', page_id: parentId },
    title: [{ type: 'text', text: { content: name } }],
    description: [{ type: 'text', text: { content: description } }],
    initial_data_source: { properties },
  });
  const ds = db.data_sources?.[0]?.id;
  if (!ds) throw new Error(`Notion created "${name}" but returned no data source id.`);
  return { databaseId: db.id, dataSourceId: ds, url: db.url };
}

export async function setup(dataDir, parentUrl) {
  const client = createClient(readToken(dataDir));
  const p = configPath(dataDir);
  if (existsSync(p)) {
    const c = loadNotionConfig(dataDir);
    await client.api(`data_sources/${c.jobs_data_source_id}`);
    await client.api(`data_sources/${c.radar_data_source_id}`);
    console.log('Notion is already set up; both databases are reachable. Nothing changed.');
    return c;
  }
  if (!parentUrl) throw new Error('Give the parent page URL: scripts/notion.sh setup <URL>');
  const parentId = notionId(parentUrl);
  await client.api(`pages/${parentId}`);

  const radar = await createDatabase(client, parentId, RADAR_TITLE,
    'Companies the kit has seen. Edit Status, Verified, Watch and AI-native here; the kit reads them back before tiering.', radarProperties());
  const jobs = await createDatabase(client, parentId, JOBS_TITLE,
    'Every scored role. Tier and facts are written by the kit; Status, Favorite and Notes are yours and never overwritten.', jobsProperties(radar.dataSourceId));

  // Name the synced relation on the Radar side, then add role counts.
  const rds = await client.api(`data_sources/${radar.dataSourceId}`);
  const synced = Object.entries(rds.properties).find(([, v]) => v.type === 'relation' && v.relation?.data_source_id === jobs.dataSourceId);
  if (!synced) throw new Error('Notion did not create the synced relation on Company Radar.');
  await client.api(`data_sources/${radar.dataSourceId}`, 'PATCH', { properties: { [synced[0]]: { name: 'Job Postings' } } });
  await client.api(`data_sources/${radar.dataSourceId}`, 'PATCH', { properties: {
    'Live roles': { rollup: { relation_property_name: 'Job Postings', rollup_property_name: 'Live', function: 'checked' } },
    'All roles': { rollup: { relation_property_name: 'Job Postings', rollup_property_name: 'Role', function: 'count' } },
  } });

  const config = {
    parent_page_id: parentId,
    jobs_database_id: jobs.databaseId, jobs_data_source_id: jobs.dataSourceId, jobs_url: jobs.url,
    radar_database_id: radar.databaseId, radar_data_source_id: radar.dataSourceId, radar_url: radar.url,
    created_at: new Date().toISOString(),
  };
  writeFileSync(p, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Created:\n  ${JOBS_TITLE}: ${jobs.url}\n  ${RADAR_TITLE}: ${radar.url}\nSaved ids to ${p} (${client.calls} Notion calls).`);
  return config;
}

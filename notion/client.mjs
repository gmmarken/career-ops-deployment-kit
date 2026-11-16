// Minimal Notion API client (API version 2025-09-03, data sources). Paced under
// Notion's ~3 requests/second limit. A call that gets no answer at all (no network, a timeout) is
// tried once more after 30 seconds (D119); any answer that is an error stops with Notion's own message.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isNetworkError } from '../market/boards.mjs';

export const NOTION_VERSION = '2025-09-03';
const MIN_GAP_MS = 350;
export const RETRY_WAIT_MS = 30_000;

/** Read NOTION_ACCESS_TOKEN from <data dir>/.env without printing it. */
export function readToken(dataDir = process.env.CAREER_OPS_DATA_DIR) {
  if (!dataDir) throw new Error('CAREER_OPS_DATA_DIR is not set.');
  const envPath = join(dataDir, '.env');
  if (!existsSync(envPath)) throw new Error(`No ${envPath}. Add NOTION_ACCESS_TOKEN=<secret> there.`);
  const line = readFileSync(envPath, 'utf-8').split('\n').find((l) => l.startsWith('NOTION_ACCESS_TOKEN='));
  const token = line?.slice('NOTION_ACCESS_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
  if (!token) throw new Error(`NOTION_ACCESS_TOKEN is missing or empty in ${envPath}.`);
  return token;
}

/** Notion page/database id from a URL or a bare 32-hex id → dashed UUID. */
export function notionId(urlOrId) {
  const m = String(urlOrId).match(/([0-9a-f]{32})(?:\?|$|#)/i) || String(urlOrId).match(/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i);
  if (!m) throw new Error(`No Notion id found in ${urlOrId}`);
  const h = m[1].replace(/-/g, '').toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createClient(token, { fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = 0;
  let calls = 0;
  async function api(path, method = 'GET', body) {
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    calls++;
    const send = () => fetchFn(`https://api.notion.com/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let res;
    try { res = await send(); } catch (err) {
      if (!isNetworkError(err.message)) throw err;
      await sleep(RETRY_WAIT_MS);
      calls++;
      try { res = await send(); } catch (again) {
        throw new Error(`Notion ${method} ${path}: ${again.message} (no answer, even on a retry ${RETRY_WAIT_MS / 1000} seconds later)`);
      }
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint = res.status === 401 ? ' Check NOTION_ACCESS_TOKEN.' : res.status === 404 ? ' Is the page shared with the integration (••• → Connections)?' : res.status === 429 ? ' Rate limited; run again in a minute.' : '';
      throw new Error(`Notion ${method} ${path} failed (${res.status} ${json.code ?? ''}): ${json.message ?? 'no message'}.${hint}`);
    }
    return json;
  }
  return {
    api,
    get calls() { return calls; },
    async queryAll(dataSourceId, body = {}) {
      const out = [];
      let cursor;
      do {
        const r = await api(`data_sources/${dataSourceId}/query`, 'POST', { page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) });
        out.push(...r.results);
        cursor = r.has_more ? r.next_cursor : undefined;
      } while (cursor);
      return out;
    },
  };
}

// --- property value helpers (Notion's rich_text limit is 2000 chars per item)
export const text = (s) => ({ rich_text: s == null || s === '' ? [] : [{ type: 'text', text: { content: String(s).slice(0, 1990) } }] });
export const title = (s) => ({ title: [{ type: 'text', text: { content: String(s ?? '').slice(0, 1990) } }] });
export const select = (s) => ({ select: s == null || s === '' ? null : { name: String(s).slice(0, 100).replace(/,/g, ' ') } });
export const multi = (arr) => ({ multi_select: [...new Set((arr || []).filter(Boolean).map((s) => String(s).slice(0, 100).replace(/,/g, ' ')))].map((name) => ({ name })) });
export const num = (n) => ({ number: n == null || Number.isNaN(Number(n)) ? null : Number(n) });
export const date = (d) => ({ date: d ? { start: String(d).slice(0, 10) } : null });
export const check = (b) => ({ checkbox: Boolean(b) });
export const url = (u) => ({ url: u || null });
export const relation = (ids) => ({ relation: (ids || []).map((id) => ({ id })) });

/** Read a property's plain value back (for company edits). */
export function readProp(prop) {
  if (!prop) return undefined;
  switch (prop.type) {
    case 'title': case 'rich_text': return prop[prop.type].map((t) => t.plain_text).join('');
    case 'select': return prop.select?.name ?? null;
    case 'multi_select': return prop.multi_select.map((o) => o.name);
    case 'checkbox': return prop.checkbox;
    case 'number': return prop.number;
    case 'date': return prop.date?.start ?? null;
    case 'url': return prop.url;
    default: return undefined;
  }
}

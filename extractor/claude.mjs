// Run `claude -p` for one structured-output call and return the parsed object.
// Isolation: an empty temporary working dir (no project files), no MCP servers,
// no saved session, and an explicit tool list ("" = no tools at all).
// Never passes --dangerously-skip-permissions. Any failure throws with details.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_MODEL = process.env.KIT_EXTRACT_MODEL || 'sonnet';
const TIMEOUT_MS = 5 * 60_000;

/** Build the argument list. Exported for tests. */
export function claudeArgs({ systemPrompt, schema, tools = [], model = DEFAULT_MODEL }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', model,
    '--system-prompt', systemPrompt,
    '--json-schema', JSON.stringify(schema),
    '--tools', tools.join(','),
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  if (tools.length) args.push('--allowedTools', tools.join(','));
  return args;
}

/** Pull the structured answer out of `claude -p --output-format json` output. */
export function parseClaudeOutput(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`claude returned non-JSON output: ${stdout.slice(0, 300)}`);
  }
  if (envelope.is_error || envelope.subtype && envelope.subtype !== 'success') {
    throw new Error(`claude reported an error (${envelope.subtype ?? 'unknown'}): ${String(envelope.result ?? '').slice(0, 300)}`);
  }
  let data = envelope.structured_output;
  if (data == null && typeof envelope.result === 'string') {
    const text = envelope.result.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { data = JSON.parse(text); } catch {
      throw new Error(`claude's answer was not the requested JSON: ${envelope.result.slice(0, 300)}`);
    }
  }
  if (data == null) throw new Error('claude returned no structured answer');
  return {
    data,
    usage: {
      model: envelope.modelUsage ? Object.keys(envelope.modelUsage).join(',') : null,
      input_tokens: envelope.usage?.input_tokens ?? null,
      output_tokens: envelope.usage?.output_tokens ?? null,
      cache_read_tokens: envelope.usage?.cache_read_input_tokens ?? null,
      cost_usd_equivalent: envelope.total_cost_usd ?? null,
      duration_ms: envelope.duration_ms ?? null,
      turns: envelope.num_turns ?? null,
    },
  };
}

/** Run one call. `input` goes to stdin; returns { data, usage }. */
export function runClaude({ systemPrompt, input, schema, tools = [], model = DEFAULT_MODEL, bin = 'claude' }) {
  const cwd = mkdtempSync(join(tmpdir(), 'kit-claude-'));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, claudeArgs({ systemPrompt, schema, tools, model }), { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer); rmSync(cwd, { recursive: true, force: true });
      reject(new Error(e.code === 'ENOENT'
        ? 'The `claude` command was not found. Install it with `npm install -g @anthropic-ai/claude-code`, then run `claude` and /login.'
        : `Could not start claude: ${e.message}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer); rmSync(cwd, { recursive: true, force: true });
      if (signal) return reject(new Error(`claude was stopped (${signal}) after ${TIMEOUT_MS / 1000}s`));
      if (code !== 0) {
        const hint = /log ?in|auth|credential/i.test(out + err) ? ' Run `claude` and /login first.' : '';
        return reject(new Error(`claude exited with code ${code}.${hint}\n${(err || out).slice(0, 500)}`));
      }
      try { resolve(parseClaudeOutput(out)); } catch (e) { reject(e); }
    });
    child.stdin.end(input);
  });
}

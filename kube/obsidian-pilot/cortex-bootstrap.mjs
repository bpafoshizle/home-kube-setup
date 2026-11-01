// Explicit first initialization only. The vault stays read-only throughout.
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
let stage = 'verify-storage';
let server;
function demand(condition) { if (!condition) throw new Error('BOOTSTRAP_REFUSED'); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  demand(process.getuid() === 1000 && process.env.MCP_AUTH_TOKEN?.length >= 32 && process.env.READONLY_MODE === 'true');
  const identity = JSON.parse(await fs.readFile('/data/.pilot-storage.json', 'utf8'));
  demand(identity.vault === 'obsidian-pilot' && identity.lun_uuid === '9a583351-01a2-45f5-abed-b38a476594dd' &&
    identity.filesystem_uuid === '256f8624-4e9c-45eb-95de-9103c3c955fe');
  demand((await fs.readdir('/data')).every(name => ['lost+found', '.pilot-storage.json'].includes(name)));
  const vaultIdentity = JSON.parse(await fs.readFile('/vault/.pilot-vault.json', 'utf8'));
  demand(vaultIdentity.vault === 'obsidian-pilot' && vaultIdentity.purpose === 'working-vault');
  const mounts = (await fs.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n');
  const sources = JSON.parse(await fs.readFile('/checks/sources.json', 'utf8'));
  const evidence = [];
  for (const [path, types] of [['/data', ['ext4']], ['/vault', ['nfs', 'nfs4']]]) {
    const matches = mounts.filter(line => line.split(' ')[4] === path);
    demand(matches.length === 1);
    const [type, source] = matches[0].split(' - ')[1].split(' ');
    demand(types.includes(type));
    if (path === '/vault') demand(source === sources[path] && matches[0].split(' ')[5].split(',').includes('ro'));
    evidence.push({path, type, source});
  }
  stage = 'start-read-only-server';
  const started = Date.now();
  server = spawn(process.execPath, ['--enable-source-maps', 'dist/src/vault-mcp/server.js'], {stdio: 'ignore'});
  let exited = false;
  server.once('exit', () => { exited = true; });
  server.once('error', () => { exited = true; });
  const origin = 'http://127.0.0.1:8000';
  let ready = false;
  while (Date.now() - started < 240000) {
    demand(!exited);
    try { ready = (await fetch(origin + '/healthz', {signal: AbortSignal.timeout(1000)})).status === 200; } catch { /* not ready */ }
    if (ready) break;
    await pause(500);
  }
  demand(ready);
  const startupMilliseconds = Date.now() - started;
  async function mcp(body, token, session, protocol, method = 'POST') {
    return fetch(origin + '/mcp', {method, signal: AbortSignal.timeout(10000),
      headers: {Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
        ...(token ? {Authorization: 'Bearer ' + token} : {}),
        ...(session ? {'Mcp-Session-Id': session} : {}),
        ...(protocol ? {'MCP-Protocol-Version': protocol} : {})},
      body: body ? JSON.stringify(body) : undefined});
  }
  async function message(response) {
    const text = await response.text();
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const values = text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
      demand(values.length === 1); return values[0];
    }
    return JSON.parse(text);
  }
  const initialize = {jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'pilot-bootstrap', version: '1'}}};
  stage = 'verify-bearer-auth';
  demand([401, 403].includes((await mcp(initialize)).status));
  demand([401, 403].includes((await mcp(initialize, 'deliberately-invalid-token')).status));
  const token = process.env.MCP_AUTH_TOKEN;
  const initialized = await mcp(initialize, token);
  demand(initialized.status === 200);
  const session = initialized.headers.get('mcp-session-id');
  const protocol = (await message(initialized)).result?.protocolVersion;
  demand(session && /^\d{4}-\d{2}-\d{2}$/.test(protocol));
  demand([200, 202, 204].includes((await mcp({jsonrpc: '2.0', method: 'notifications/initialized'}, token, session, protocol)).status));
  stage = 'verify-read-only-tools';
  const toolsResponse = await mcp({jsonrpc: '2.0', id: 2, method: 'tools/list'}, token, session, protocol);
  demand(toolsResponse.status === 200);
  const tools = (await message(toolsResponse)).result?.tools;
  demand(Array.isArray(tools) && tools.some(tool => tool.name === 'vault_read_note'));
  const mutations = ['vault_write_note', 'vault_patch_note', 'vault_update_properties', 'vault_delete_note',
    'vault_move_note', 'vault_create_task', 'vault_update_task'];
  demand(!tools.some(tool => mutations.includes(tool.name)));
  demand((await mcp(undefined, token, session, protocol, 'GET')).status === 405);
  demand([200, 202, 204].includes((await mcp(undefined, token, session, protocol, 'DELETE')).status));
  stage = 'graceful-shutdown';
  const shutdown = new Promise(resolve => server.once('exit', code => resolve(code)));
  server.kill('SIGTERM');
  const code = await Promise.race([shutdown, pause(15000).then(() => { throw new Error('SHUTDOWN_TIMEOUT'); })]);
  demand(code === 0);
  stage = 'verify-complete-initial-state';
  demand((await fs.stat('/data/index.db')).size > 0 && (await fs.stat('/data/oauth.db')).size > 0);
  const marker = await fs.open('/data/.pilot-cortex-state.json', 'wx', 0o600);
  try {
    await marker.writeFile(JSON.stringify({vault: 'obsidian-pilot', initialized: true,
      image: 'sha256:2ad32d433956fa96764ca6afffee9470ec4f1cd51dcb734615f52b121be8b0e5'}) + '\n');
    await marker.sync();
  } finally { await marker.close(); }
  const directory = await fs.open('/data', 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  console.log(JSON.stringify({readOnlyBootstrapCompleted: true, mounts: evidence, startupMilliseconds,
    missingWrongTokenDenied: true, authenticatedMcpSession: true, mutationToolsAbsent: true,
    authenticatedGet405: true, gracefulExit: true, indexAndAuthStatePresent: true}));
}
main().catch(() => {
  if (server) server.kill('SIGKILL');
  console.error('PILOT_CORTEX_BOOTSTRAP_REFUSED stage=' + stage); process.exit(1);
});

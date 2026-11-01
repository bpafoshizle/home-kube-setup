// Creates the approved 100-note synthetic dataset through Cortex ONLY.
// No vault mount, raw note output, model features, binary upload or shared DB.
import * as fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {connectMcp} from './mcp-client.mjs';
let stage = 'read-scoped-projections';
function demand(condition) { if (!condition) throw new Error('QUALIFICATION_REFUSED'); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const token = await fs.readFile('/cortex/token', 'utf8');
  const credentials = JSON.parse(await fs.readFile('/database/credentials.json', 'utf8'));
  demand(credentials.database === 'obsidian-pilot' && credentials.username === 'obsidian-pilot');
  const client = await connectMcp('http://obsidian-pilot.obsidian-pilot.svc.cluster.local:8000/mcp', token);
  const names = new Set((await client.tools()).map(tool => tool.name));
  demand(['vault_write_note', 'vault_read_note', 'vault_list_notes', 'vault_search'].every(name => names.has(name)));
  stage = 'refuse-existing-vault';
  demand((await client.call('vault_list_notes', {})).length === 0);
  const marker = 'pilotcanary' + randomBytes(12).toString('hex');
  const fixtures = Array.from({length: 100}, (_, index) => {
    const number = String(index).padStart(3, '0');
    const next = String((index + 1) % 100).padStart(3, '0');
    return {path: `Pilot/Note${number}.md`,
      body: `# Status\n\n${marker} entry${number} state-original\n\n[[Note${next}]]\n\n# Tasks\n\n`,
      properties: {tags: ['pilot'], pilot_fixture: true, pilot_seq: index, status: 'initial'}};
  });
  stage = 'create-through-cortex-api';
  for (const fixture of fixtures) await client.call('vault_write_note', fixture);
  const filesArrived = Date.now();
  stage = 'verify-exact-reads-and-properties';
  for (const [index, fixture] of fixtures.entries()) {
    const raw = await client.call('vault_read_note', {path: fixture.path});
    demand(typeof raw === 'string' && raw.endsWith(fixture.body));
    const properties = await client.call('vault_read_note', {path: fixture.path, properties_only: true});
    demand(properties.pilot_fixture === true && properties.pilot_seq === index &&
      properties.status === 'initial' && properties.tags.includes('pilot'));
  }
  stage = 'verify-index-freshness';
  let indexed = false;
  while (Date.now() - filesArrived <= 30000) {
    const search = await client.call('vault_search', {query: marker, limit: 100, snippet_tokens: 1});
    indexed = search.results?.length === 100 && search.total === 100 && search.search_mode === 'fts' && search.reranked === false;
    if (indexed) break;
    await pause(500);
  }
  demand(indexed);
  const indexFreshnessMilliseconds = Date.now() - filesArrived;
  stage = 'verify-outgoing-livesync-encryption-and-convergence';
  let converged = false;
  let types = {};
  let encrypted = false;
  while (Date.now() - filesArrived <= 60000) {
    const response = await fetch('http://couchdb-couchdb.couchdb.svc.cluster.local:5984/obsidian-pilot/_all_docs?include_docs=true', {
      headers: {Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')},
      signal: AbortSignal.timeout(10000)});
    demand(response.status === 200);
    const remote = await response.json();
    demand(Array.isArray(remote.rows));
    types = {};
    for (const row of remote.rows) {
      const type = ['plain', 'newnote', 'leaf', 'versioninfo'].includes(row.doc?.type) ? row.doc.type : 'other';
      types[type] = (types[type] ?? 0) + 1;
    }
    const serialized = JSON.stringify(remote);
    encrypted = !serialized.includes(marker) && (serialized.includes('%=') || serialized.includes('"%'));
    converged = (types.plain ?? 0) + (types.newnote ?? 0) === 100 && encrypted;
    if (converged) break;
    await pause(500);
  }
  if (!converged) console.error(JSON.stringify({remoteDocumentTypeCounts: types, encryptionEvidence: encrypted}));
  demand(converged);
  const syncConvergenceMilliseconds = Date.now() - filesArrived;
  demand((await client.call('vault_list_notes', {})).length === 100);
  await client.close();
  console.log(JSON.stringify({syntheticNotesCreatedThroughApi: 100, exactContentAndPropertyChecks: 100,
    indexFreshnessMilliseconds, syncConvergenceMilliseconds, remoteMainNoteDocuments: 100,
    encryptedRemoteEvidence: true, directNasWrites: false, binaryUploads: false,
    incomingPeerAndRealDeviceBehaviorTested: false, noteContentsPrinted: false}));
}
main().catch(() => { console.error('PILOT_DATASET_CHECK_REFUSED stage=' + stage); process.exit(1); });

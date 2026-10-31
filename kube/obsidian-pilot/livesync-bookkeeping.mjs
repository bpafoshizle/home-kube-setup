// Explicit completion of NEW disposable state only, never a restart/restore hook.
import * as fs from 'node:fs/promises';
function demand(condition) { if (!condition) throw new Error('INITIAL_STATE_REFUSED'); }
export const requiredState = ['.livesync/settings.json', '.livesync/runtime/keyvalue-db.json',
  '.livesync/runtime/local-storage.json', 'headless-vault-livesync-v2/CURRENT',
  '.guard-observed-files.json', '.pilot-sync-initialized.json'];

export async function finalizeInitialState() {
  const expected = JSON.parse(await fs.readFile('/checks/sources.json', 'utf8'));
  const mounts = (await fs.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n');
  for (const [path, marker, purpose] of [['/vault', '.pilot-vault.json', 'working-vault'],
    ['/data', '.pilot-sync-state.json', 'livesync-state']]) {
    const matches = mounts.filter(line => line.split(' ')[4] === path);
    demand(matches.length === 1);
    const [type, source] = matches[0].split(' - ')[1].split(' ');
    demand(['nfs', 'nfs4'].includes(type) && source === expected[path]);
    const info = await fs.lstat(`${path}/${marker}`);
    demand(info.isFile() && !info.isSymbolicLink());
    const identity = JSON.parse(await fs.readFile(`${path}/${marker}`, 'utf8'));
    demand(identity.vault === 'obsidian-pilot' && identity.purpose === purpose);
  }
  const credentials = JSON.parse(await fs.readFile('/pilot/credentials.json', 'utf8'));
  const settings = JSON.parse(await fs.readFile('/data/.livesync/settings.json', 'utf8'));
  demand(credentials.database === 'obsidian-pilot' && credentials.username === 'obsidian-pilot' &&
    settings.couchDB_DBNAME === credentials.database && settings.couchDB_USER === credentials.username &&
    settings.couchDB_PASSWORD === credentials.password && settings.passphrase === credentials.e2eePassphrase &&
    settings.encrypt === true && settings.isConfigured === true && settings.liveSync === true &&
    settings.useIndexedDBAdapter === false && settings.resolveConflictsByNewerFile === false);
  demand(((await fs.stat('/data/.livesync/settings.json')).mode & 0o777) === 0o600);
  for (const path of requiredState.slice(0, 4)) {
    const info = await fs.lstat('/data/' + path);
    demand(info.isFile() && !info.isSymbolicLink() && info.size > 0);
  }
  demand((await fs.readdir('/vault')).every(name => name.startsWith('.')));
  let snapshotPresent = false;
  try {
    const info = await fs.lstat('/vault/.livesync-snapshot.json');
    demand(info.isFile() && !info.isSymbolicLink());
    const queue = JSON.parse(await fs.readFile('/vault/.livesync-snapshot.json', 'utf8'));
    demand(Array.isArray(queue) && queue.length === 0); // Never discard pending operations.
    snapshotPresent = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const remote = await fetch('http://couchdb-couchdb.couchdb.svc.cluster.local:5984/obsidian-pilot', {
    headers: {Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')},
    signal: AbortSignal.timeout(10000),
  });
  demand(remote.status === 200);
  const metadata = await remote.json(); demand(metadata.db_name === 'obsidian-pilot');
  const observation = {version: 1, vault: 'obsidian-pilot', observed: {'/vault/.livesync-snapshot.json': snapshotPresent}};
  const initialized = {vault: 'obsidian-pilot', initialized: true, e2ee: true,
    snapshotPresentInitially: snapshotPresent, requiredState};
  for (const [path, value] of [['/data/.guard-observed-files.json', observation],
    ['/data/.pilot-sync-initialized.json', initialized]]) {
    const file = await fs.open(path, 'wx', 0o600); // Refuse duplicate/implicit reinitialization.
    try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); } finally { await file.close(); }
  }
  const directory = await fs.open('/data', 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  return {initialized: true, e2ee: true, settingsMode: 384, requiredState,
    queueSnapshotPresentInitially: snapshotPresent, visibleVaultFiles: 0,
    pilotDatabaseReachable: true, remoteDocumentCount: metadata.doc_count};
}

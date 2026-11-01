// Explicit single-owner bootstrap only. Never used by steady-state startup.
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { finalizeInitialState } from './livesync-bookkeeping.mjs';
let stage = 'verify-mounts';
function demand(condition) { if (!condition) throw new Error('BOOTSTRAP_REFUSED'); }
async function directorySync(path) {
  const file = await fs.open(path, 'r');
  try { await file.sync(); } finally { await file.close(); }
}
async function command(args) {
  await new Promise((resolve, reject) => {
    const child = spawn('livesync-cli', args, {stdio: 'ignore', env: {...process.env, LIVESYNC_DB_PATH: '/data'}});
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('CLI_TIMEOUT')); }, 120000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('CLI_FAILED')); });
  });
}
async function main() {
  demand(process.getuid() === 1000);
  const mounts = (await fs.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n');
  const sources = JSON.parse(await fs.readFile('/checks/sources.json', 'utf8'));
  for (const [path, marker, purpose] of [
    ['/vault', '.pilot-vault.json', 'working-vault'],
    ['/data', '.pilot-sync-state.json', 'livesync-state'],
  ]) {
    const matches = mounts.filter(line => line.split(' ')[4] === path);
    demand(matches.length === 1);
    const [type, source] = matches[0].split(' - ')[1].split(' ');
    demand(['nfs', 'nfs4'].includes(type) && source === sources[path]);
    const status = await fs.lstat(`${path}/${marker}`);
    demand(status.isFile() && !status.isSymbolicLink());
    const identity = JSON.parse(await fs.readFile(`${path}/${marker}`, 'utf8'));
    demand(identity.vault === 'obsidian-pilot' && identity.purpose === purpose);
    demand((await fs.readdir(path)).every(name => name === marker));
  }
  stage = 'verify-disposable-configuration';
  const credentials = JSON.parse(await fs.readFile('/pilot/credentials.json', 'utf8'));
  demand(credentials.database === 'obsidian-pilot' && credentials.username === 'obsidian-pilot' &&
    credentials.password.length >= 32 && credentials.e2eePassphrase.length >= 32);
  // No admin credential is mounted into this Job.
  stage = 'create-actual-image-defaults';
  await fs.mkdir('/data/.livesync', {mode: 0o700});
  const settingsPath = '/data/.livesync/settings.json';
  await command(['init-settings', settingsPath]);
  const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  demand(settings.isConfigured === false && settings.useIndexedDBAdapter === false && settings.E2EEAlgorithm);
  Object.assign(settings, {
    couchDB_URI: 'http://couchdb-couchdb.couchdb.svc.cluster.local:5984',
    couchDB_DBNAME: credentials.database, couchDB_USER: credentials.username,
    couchDB_PASSWORD: credentials.password, encrypt: true, passphrase: credentials.e2eePassphrase,
    isConfigured: true, liveSync: true, useIndexedDBAdapter: false,
    deviceAndVaultName: 'obsidian-pilot-headless', resolveConflictsByNewerFile: false,
    lessInformationInLog: true, showVerboseLog: false, writeLogToTheFile: false,
  });
  stage = 'persist-private-settings';
  const temporary = settingsPath + '.initial';
  const file = await fs.open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(settings)); await file.sync(); } finally { await file.close(); }
  await fs.rename(temporary, settingsPath);
  await directorySync('/data/.livesync');
  stage = 'initial-replication';
  await command(['sync']);
  stage = 'materialize-empty-disposable-vault';
  await command(['--vault', '/vault', 'mirror']);
  stage = 'verify-bootstrap-bookkeeping';
  const bookkeeping = await finalizeInitialState();
  demand((await fs.stat(settingsPath)).size > 0);
  await directorySync('/vault');
  await directorySync('/data');
  console.log(JSON.stringify({bootstrapCompleted: true, database: credentials.database,
    e2eeEnabled: true, algorithm: settings.E2EEAlgorithm, continuousReplicationConfigured: true,
    newestWins: false, settingsMode: (await fs.stat(settingsPath)).mode & 0o777,
    bookkeeping, vaultNotesCreated: false,
    stateEntries: await fs.readdir('/data')}));
}
main().catch(() => { console.error('PILOT_LIVESYNC_BOOTSTRAP_REFUSED stage=' + stage); process.exit(1); });

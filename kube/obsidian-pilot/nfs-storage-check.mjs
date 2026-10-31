// Disposable state-only filesystem qualification. Never creates vault notes.
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(`${process.cwd()}/package.json`);
const leveldown = require('leveldown');
const roots = ['/vault-root', '/sync-root'];
const identityNames = ['.pilot-vault.json', '.pilot-sync-state.json'];

function demand(condition) {
  if (!condition) throw new Error('NFS_QUALIFICATION_FAILED');
}
async function syncDirectory(path) {
  const handle = await fs.open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function main() {
  demand(process.arch === 'arm64' && process.getuid() === 1000);
  const lines = (await fs.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n');
  const expectedSources = JSON.parse(await fs.readFile('/checks/sources.json', 'utf8'));
  const evidence = [];
  for (const root of roots) {
    const mounts = lines.filter(line => line.split(' ')[4] === root);
    demand(mounts.length === 1);
    const [type, source] = mounts[0].split(' - ')[1].split(' ');
    demand(['nfs', 'nfs4'].includes(type) && source === expectedSources[root]);
    demand((await fs.readdir(root)).length === 0); // One-shot only, no state replacement.
    evidence.push({mount: root, type, source});
  }
  // Each app owns a dedicated subdirectory, avoiding recursive root-squash chown.
  const vault = '/vault-root/vault';
  const state = '/sync-root/state';
  for (const [index, path] of [vault, state].entries()) {
    await fs.mkdir(path, {mode: 0o700});
    const file = await fs.open(`${path}/${identityNames[index]}`, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify({vault: 'obsidian-pilot', purpose: index ? 'livesync-state' : 'working-vault'}) + '\n');
      await file.sync();
    } finally { await file.close(); }
    await syncDirectory(path);
    await syncDirectory(roots[index]);
  }
  const diagnostic = `${state}/.storage-check`;
  await fs.mkdir(diagnostic, {mode: 0o700});
  const dbPath = `${diagnostic}/leveldb`;
  const db = leveldown(dbPath);
  await promisify(db.open.bind(db))({createIfMissing: true});
  await promisify(db.put.bind(db))('fixture', '42', {sync: true});
  const childCode = `
    const db = require('leveldown')(process.argv[1]);
    db.open({createIfMissing:false}, error => {
      if (error) process.exit(/lock|temporarily unavailable/i.test(error.message) ? 0 : 2);
      db.close(() => process.exit(1));
    });`;
  const child = spawnSync(process.execPath, ['-e', childCode, dbPath], {timeout: 10000, stdio: 'ignore'});
  demand(child.status === 0);
  await promisify(db.close.bind(db))();
  const reopened = leveldown(dbPath);
  await promisify(reopened.open.bind(reopened))({createIfMissing: false});
  demand((await promisify(reopened.get.bind(reopened))('fixture')).toString() === '42');
  await promisify(reopened.close.bind(reopened))();
  await promisify(leveldown.destroy)(dbPath);
  const temporary = `${diagnostic}/temporary`;
  const final = `${diagnostic}/renamed`;
  const file = await fs.open(temporary, 'wx', 0o600);
  try { await file.writeFile('synthetic-state-fixture'); await file.sync(); } finally { await file.close(); }
  await fs.rename(temporary, final);
  await syncDirectory(diagnostic);
  demand(await fs.readFile(final, 'utf8') === 'synthetic-state-fixture');
  await fs.unlink(final);
  await fs.rmdir(diagnostic);
  await syncDirectory(state);
  console.log(JSON.stringify({uid: process.getuid(), mounts: evidence,
    nativeLeveldown: require('leveldown/package.json').version, separateProcessLock: true,
    synchronousPutReopen: true, fileSyncRenameDirectorySync: true,
    diagnosticFilesRemoved: true, vaultNotesCreated: false}));
}
main().catch(() => { console.error('PILOT_NFS_STORAGE_CHECK_FAILED'); process.exit(1); });

// Read-only pilot state metadata, with private configuration values never printed.
import * as fs from 'node:fs/promises';
const summary = {contentPrinted: false};
try {
  const file = '/data/.livesync/settings.json';
  const info = await fs.stat(file);
  const settings = JSON.parse(await fs.readFile(file, 'utf8'));
  summary.settings = {present: true, mode: info.mode & 0o777,
    configured: settings.isConfigured === true, e2ee: settings.encrypt === true,
    passphrasePresent: typeof settings.passphrase === 'string' && settings.passphrase.length >= 32,
    pilotDatabase: settings.couchDB_DBNAME === 'obsidian-pilot', liveSync: settings.liveSync === true,
    newestWins: settings.resolveConflictsByNewerFile === true};
  const privateValues = [settings.couchDB_PASSWORD, settings.passphrase].filter(Boolean);
  const entries = [];
  async function inspect(path, relative, depth) {
    for (const name of await fs.readdir(path)) {
      const next = relative ? relative + '/' + name : name;
      const safe = /^[a-zA-Z0-9._/-]+$/.test(next) && !privateValues.some(value => next.includes(value));
      const stat = await fs.lstat(path + '/' + name);
      entries.push({path: safe ? next : '<redacted>', directory: stat.isDirectory(),
        symlink: stat.isSymbolicLink(), size: stat.size});
      if (safe && stat.isDirectory() && !stat.isSymbolicLink() && depth > 0) await inspect(path + '/' + name, next, depth - 1);
    }
  }
  await inspect('/data', '', 2);
  summary.stateEntries = entries;
} catch (error) {
  summary.settingsErrorCode = ['ENOENT', 'EACCES'].includes(error.code) ? error.code : 'UNEXPECTED';
}
try {
  const snapshot = await fs.stat('/vault/.livesync-snapshot.json');
  summary.snapshot = {present: true, size: snapshot.size};
} catch (error) { summary.snapshot = {present: false, missing: error.code === 'ENOENT'}; }
summary.visibleVaultEntryCount = (await fs.readdir('/vault')).filter(name => !name.startsWith('.')).length;
console.log(JSON.stringify(summary));

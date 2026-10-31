// Read-only metadata diagnostic; never prints filenames, settings or note content.
import * as fs from 'node:fs/promises';
const lines = (await fs.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n');
const expected = JSON.parse(await fs.readFile('/checks/sources.json', 'utf8'));
const evidence = [];
for (const [path, marker, purpose] of [['/vault', '.pilot-vault.json', 'working-vault'],
  ['/data', '.pilot-sync-state.json', 'livesync-state']]) {
  const item = {path, expectedSource: expected[path]};
  try {
    item.mounts = lines.filter(line => line.split(' ')[4] === path).map(line => ({
      root: line.split(' ')[3], type: line.split(' - ')[1].split(' ')[0], source: line.split(' - ')[1].split(' ')[1]}));
    const info = await fs.lstat(`${path}/${marker}`);
    item.marker = {regular: info.isFile(), symlink: info.isSymbolicLink(), uid: info.uid, mode: info.mode & 0o777};
    const identity = JSON.parse(await fs.readFile(`${path}/${marker}`, 'utf8'));
    item.expectedIdentity = identity.vault === 'obsidian-pilot' && identity.purpose === purpose;
    const entries = await fs.readdir(path);
    item.entryCount = entries.length;
    item.onlyIdentityMarker = entries.every(name => name === marker);
  } catch (error) {
    item.errorCode = ['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code) ? error.code : 'UNEXPECTED';
  }
  evidence.push(item);
}
console.log(JSON.stringify({uid: process.getuid(), roots: evidence, contentPrinted: false}));

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes, createCipheriv} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createBackup, verifyArchive} from './backup-archive.mjs';

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pilot-backup-test-')));
  t.after(() => fs.rm(base, {recursive: true, force: true})); // Exact synthetic fixture only.
  const roots = {};
  for (const name of ['vault', 'livesync', 'cortex', 'configuration']) {
    roots[name] = path.join(base, name);
    await fs.mkdir(roots[name], {mode: 0o700});
  }
  const destination = path.join(base, 'backups');
  await fs.mkdir(destination, {mode: 0o700});
  const body = '# Synthetic only\nconfidential-fixture-' + randomBytes(12).toString('hex');
  await fs.writeFile(path.join(roots.vault, 'Note.md'), body, {mode: 0o600});
  await fs.mkdir(path.join(roots.vault, '.hidden'), {mode: 0o700});
  await fs.writeFile(path.join(roots.vault, '.hidden', 'queue.json'), '[]', {mode: 0o600});
  await fs.writeFile(path.join(roots.vault, '絵文字-🧪.md'), 'unicode note', {mode: 0o600});
  for (const name of ['index.db', 'index.db-wal', 'index.db-shm', 'oauth.db']) {
    await fs.writeFile(path.join(roots.cortex, name), randomBytes(100), {mode: 0o600});
  }
  await fs.writeFile(path.join(roots.configuration, 'credentials.json'), '{"synthetic":true}', {mode: 0o600});
  const options = {destination, roots, key: randomBytes(32), vault: 'synthetic', transactionID: 'transaction-1'};
  return {base, body, options};
}
async function generations(destination) {
  return (await fs.readdir(destination)).filter(name => name.startsWith('backup-')).sort();
}

test('encrypted full-root capture authenticates, verifies and restores exact data/modes', async t => {
  const {base, body, options} = await fixture(t);
  const receipt = await createBackup(options);
  assert.equal(receipt.files, 8);
  const archive = path.join(options.destination, receipt.generation, 'bundle.enc');
  assert.equal((await fs.stat(archive)).mode & 0o777, 0o600);
  assert.equal((await fs.readFile(archive)).includes(Buffer.from(body)), false);
  const output = path.join(base, 'restored');
  const checked = await verifyArchive(archive, options.key, options, output);
  assert.equal(checked.inventorySHA256, receipt.inventorySHA256);
  assert.equal(await fs.readFile(path.join(output, 'vault/Note.md'), 'utf8'), body);
  assert.equal(await fs.readFile(path.join(output, 'vault/.hidden/queue.json'), 'utf8'), '[]');
  assert.equal(await fs.readFile(path.join(output, 'vault/絵文字-🧪.md'), 'utf8'), 'unicode note');
  assert.equal((await fs.stat(path.join(output, 'configuration/credentials.json'))).mode & 0o777, 0o600);
  for (const name of ['index.db', 'index.db-wal', 'index.db-shm', 'oauth.db']) {
    assert.deepEqual(await fs.readFile(path.join(output, 'cortex', name)), await fs.readFile(path.join(options.roots.cortex, name)));
  }
  await assert.rejects(verifyArchive(archive, options.key, options, output));
});

for (const damage of ['wrong-key', 'ciphertext', 'truncated', 'header', 'tag']) {
  test(`${damage} refuses BEFORE creating a restore directory`, async t => {
    const {base, options} = await fixture(t);
    const receipt = await createBackup(options);
    const archive = path.join(options.destination, receipt.generation, 'bundle.enc');
    const bytes = await fs.readFile(archive);
    let key = options.key;
    if (damage === 'wrong-key') key = randomBytes(32);
    else if (damage === 'truncated') await fs.writeFile(archive, bytes.subarray(0, bytes.length - 20));
    else {
      bytes[damage === 'header' ? 0 : damage === 'tag' ? bytes.length - 1 : 40] ^= 1;
      await fs.writeFile(archive, bytes);
    }
    const output = path.join(base, 'refused-restore');
    await assert.rejects(verifyArchive(archive, key, options, output));
    await assert.rejects(fs.stat(output), {code: 'ENOENT'});
  });
}

test('latest two successful backups retained; failed capture preserves both', async t => {
  const {options} = await fixture(t);
  const first = await createBackup(options);
  const second = await createBackup({...options, transactionID: 'transaction-2'});
  const third = await createBackup({...options, transactionID: 'transaction-3'});
  assert.deepEqual(await generations(options.destination), [second.generation, third.generation].sort());
  assert.equal((await generations(options.destination)).includes(first.generation), false);
  await fs.symlink('/outside', path.join(options.roots.vault, 'unsafe-link'));
  await assert.rejects(createBackup({...options, transactionID: 'failed'}));
  assert.deepEqual(await generations(options.destination), [second.generation, third.generation].sort());
});

test('corrupted older successful backup blocks pruning; does not displace good copies', async t => {
  const {options} = await fixture(t);
  const first = await createBackup(options);
  const second = await createBackup(options);
  const broken = path.join(options.destination, first.generation, 'bundle.enc');
  const bytes = await fs.readFile(broken); bytes[40] ^= 1; await fs.writeFile(broken, bytes);
  await assert.rejects(createBackup(options));
  const names = await generations(options.destination);
  assert.equal(names.length, 3);
  assert(names.includes(first.generation) && names.includes(second.generation));
});

test('destination overlap, insecure permissions, weak key and retention below two refuse', async t => {
  const {options} = await fixture(t);
  await assert.rejects(createBackup({...options, destination: options.roots.vault}));
  await assert.rejects(createBackup({...options, key: randomBytes(16)}));
  await assert.rejects(createBackup({...options, keep: 1}));
  await fs.chmod(options.destination, 0o755);
  await assert.rejects(createBackup(options));
});

test('an existing backup lock cannot be stolen', async t => {
  const {options} = await fixture(t);
  await fs.mkdir(path.join(options.destination, '.backup-lock'), {mode: 0o700});
  await assert.rejects(createBackup(options), {code: 'EEXIST'});
  assert.deepEqual(await generations(options.destination), []);
});

test('hard links are refused rather than creating an unsafe restore alias', async t => {
  const {options} = await fixture(t);
  await fs.link(path.join(options.roots.vault, 'Note.md'), path.join(options.roots.vault, 'alias.md'));
  await assert.rejects(createBackup(options));
  assert.deepEqual(await generations(options.destination), []);
});

test('wrong vault or transaction cannot verify a valid archive', async t => {
  const {options} = await fixture(t);
  const receipt = await createBackup(options);
  const archive = path.join(options.destination, receipt.generation, 'bundle.enc');
  await assert.rejects(verifyArchive(archive, options.key, {...options, vault: 'other'}));
  await assert.rejects(verifyArchive(archive, options.key, {...options, transactionID: 'other'}));
});

test('authenticated traversal record is rejected without escaping restore root', async t => {
  const {base, options} = await fixture(t);
  const prefix = Buffer.concat([Buffer.from('PILOTBACKUP001\n'), randomBytes(12)]);
  const cipher = createCipheriv('aes-256-gcm', options.key, prefix.subarray(14));
  cipher.setAAD(prefix);
  const payload = gzipSync([
    JSON.stringify({kind: 'begin', version: 1, vault: options.vault, transactionID: options.transactionID}),
    JSON.stringify({kind: 'directory', path: 'vault/../../escaped', mode: 448, size: 0}),
  ].join('\n') + '\n');
  const archive = path.join(base, 'malicious.enc');
  await fs.writeFile(archive, Buffer.concat([prefix, cipher.update(payload), cipher.final(), cipher.getAuthTag()]));
  await assert.rejects(verifyArchive(archive, options.key, options, path.join(base, 'restore')));
  await assert.rejects(fs.stat(path.join(base, 'escaped')), {code: 'ENOENT'});
});

test('multi-chunk binary and empty files roundtrip without plaintext archive staging', async t => {
  const {base, options} = await fixture(t);
  const binary = randomBytes(1024 * 1024 + 3);
  await fs.writeFile(path.join(options.roots.vault, 'attachment.bin'), binary, {mode: 0o640});
  await fs.writeFile(path.join(options.roots.livesync, 'empty-state'), '', {mode: 0o600});
  const receipt = await createBackup(options);
  const generation = path.join(options.destination, receipt.generation);
  assert.deepEqual((await fs.readdir(generation)).sort(), ['bundle.enc', 'receipt.json']);
  const output = path.join(base, 'binary-restore');
  await verifyArchive(path.join(generation, 'bundle.enc'), options.key, options, output);
  assert.deepEqual(await fs.readFile(path.join(output, 'vault/attachment.bin')), binary);
  assert.equal((await fs.stat(path.join(output, 'vault/attachment.bin'))).mode & 0o777, 0o640);
  assert.equal((await fs.stat(path.join(output, 'livesync/empty-state'))).size, 0);
});

test('retention count is configurable above the two-successful minimum', async t => {
  const {options} = await fixture(t);
  for (let i = 0; i < 4; i++) await createBackup({...options, keep: 3});
  assert.equal((await generations(options.destination)).length, 3);
});

test('symlinked roots refuse; incomplete directories never count as good backups', async t => {
  const {base, options} = await fixture(t);
  const alias = path.join(base, 'alias-root');
  await fs.symlink(options.roots.vault, alias);
  await assert.rejects(createBackup({...options, roots: {...options.roots, vault: alias}}));
  const incomplete = path.join(options.destination, '.incomplete-unfinished');
  await fs.mkdir(incomplete, {mode: 0o700});
  await createBackup(options);
  await createBackup(options);
  await createBackup(options);
  assert.equal((await generations(options.destination)).length, 2);
  assert.equal((await fs.stat(incomplete)).isDirectory(), true);
});

test('clock rollback refuses without pruning or stealing the lock', async t => {
  const {options} = await fixture(t);
  const future = 'backup-9999999999999-00000000-0000-0000-0000-000000000000';
  await fs.mkdir(path.join(options.destination, future), {mode: 0o700});
  await assert.rejects(createBackup(options));
  assert.deepEqual(await generations(options.destination), [future]);
  await assert.rejects(fs.stat(path.join(options.destination, '.backup-lock')), {code: 'ENOENT'});
});

test('exported errors do not expose source paths or raw payloads', async t => {
  const {options} = await fixture(t);
  const privateName = 'private-fixture-name.md';
  await fs.symlink('/does-not-exist', path.join(options.roots.vault, privateName));
  await assert.rejects(createBackup(options), error => {
    assert.equal(error.message, 'BACKUP_ARCHIVE_REFUSED');
    assert.equal(error.stack.includes(privateName), false);
    assert.equal(error.stack.includes(options.roots.vault), false);
    return true;
  });
});

test('restore rejects a shared parent directory before writing plaintext files', async t => {
  const {base, options} = await fixture(t);
  const receipt = await createBackup(options);
  const parent = path.join(base, 'shared-parent');
  await fs.mkdir(parent, {mode: 0o755});
  const output = path.join(parent, 'restore');
  await assert.rejects(verifyArchive(path.join(options.destination, receipt.generation, 'bundle.enc'), options.key, options, output));
  await assert.rejects(fs.stat(output), {code: 'ENOENT'});
});

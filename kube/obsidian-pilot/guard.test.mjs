import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { boundedCheck, checkCapacity, parseMounts, verify } from './chart/files/guard.mjs';

const healthy = { blocks: 1000n, bavail: 500n, bsize: 1048576n, files: 1000n, ffree: 500n };
function fixture(overrides = {}) {
  const files = {
    '/release/release.json': JSON.stringify({ vault: 'pilot', node: 'worker', podUID: 'pod-one' }),
    '/proc/self/mountinfo': '12 1 8:0 / /data rw - ext4 /dev/sda rw\n',
    '/data/.pilot-storage.json': JSON.stringify({ vault: 'pilot', lun_uuid: 'expected-lun' }),
    ...overrides,
  };
  const config = { vault: 'pilot', node: 'worker', podUID: 'pod-one', releaseFile: '/release/release.json',
    mounts: [{ path: '/data', types: ['ext4'], source: '/dev/sda', marker: '.pilot-storage.json',
      identity: { vault: 'pilot', lun_uuid: 'expected-lun' }, required: [{ path: 'index.db' }] }] };
  const dependencies = {
    async readFile(path) { if (!(path in files)) throw new Error('missing'); return files[path]; },
    async lstat() { return { isFile: () => true, isSymbolicLink: () => false, size: 100 }; },
    async statfs() { return healthy; },
  };
  return { config, dependencies };
}

test('mountinfo decodes escaped paths', () => {
  assert.equal(parseMounts('12 1 8:0 / /some\\040path rw - ext4 /dev/sda rw')[0].path, '/some path');
});
test('expected mount, identity, state, release and capacity pass', async () => {
  const { config, dependencies } = fixture();
  assert.deepEqual(await verify(config, dependencies), { warning: false });
});
test('a new Pod cannot reuse a former Pod release', async () => {
  const { config, dependencies } = fixture();
  config.podUID = 'replacement';
  await assert.rejects(verify(config, dependencies), /OWNER_NOT_RELEASED/);
});
test('plain directory or wrong filesystem never falls back', async () => {
  for (const value of ['', '12 1 0:9 / /data rw - overlay overlay rw\n']) {
    const { config, dependencies } = fixture({ '/proc/self/mountinfo': value });
    await assert.rejects(verify(config, dependencies), /EXPECTED_MOUNT_ABSENT/);
  }
});
test('wrong storage source refuses even with a valid copied marker', async () => {
  const { config, dependencies } = fixture({ '/proc/self/mountinfo': '12 1 8:0 / /data rw - ext4 /dev/sdb rw\n' });
  await assert.rejects(verify(config, dependencies), /EXPECTED_MOUNT_ABSENT/);
});
test('NFS subPath identity requires its observed full source, not the PVC root', async () => {
  const {config, dependencies} = fixture({'/proc/self/mountinfo':
    '12 1 0:9 / /data rw - nfs4 lynott:/pilot/state rw\n'});
  config.mounts[0].types = ['nfs', 'nfs4'];
  config.mounts[0].source = 'lynott:/pilot/state';
  assert.deepEqual(await verify(config, dependencies), {warning: false});
  config.mounts[0].source = 'lynott:/pilot';
  await assert.rejects(verify(config, dependencies), /EXPECTED_MOUNT_ABSENT/);
});
test('wrong sentinel refuses', async () => {
  const { config, dependencies } = fixture({ '/data/.pilot-storage.json': '{"vault":"different"}' });
  await assert.rejects(verify(config, dependencies), /STORAGE_IDENTITY_MISMATCH/);
});
test('missing application state refuses instead of recreating it', async () => {
  const { config, dependencies } = fixture();
  dependencies.lstat = async path => { if (path.endsWith('index.db')) throw new Error('absent');
    return { isFile: () => true, isSymbolicLink: () => false }; };
  await assert.rejects(verify(config, dependencies), /absent/);
});
test('symlink sentinel refuses', async () => {
  const { config, dependencies } = fixture();
  dependencies.lstat = async () => ({ isFile: () => true, isSymbolicLink: () => true });
  await assert.rejects(verify(config, dependencies), /IDENTITY_MARKER_INVALID/);
});
test('capacity warning and critical stop are distinct', () => {
  assert.equal(checkCapacity({ ...healthy, bavail: 190n }, {}), true);
  assert.throws(() => checkCapacity({ ...healthy, bavail: 100n }, {}), /CAPACITY_CRITICAL/);
  assert.throws(() => checkCapacity({ ...healthy, ffree: 90n }, {}), /INODES_CRITICAL/);
});
test('hung storage operation fails within bounded time', async () => {
  await assert.rejects(boundedCheck(() => new Promise(() => {}), 10), /STORAGE_CHECK_TIMEOUT/);
});
test('projected ConfigMap symlink cannot silently skip the startup guard', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pilot-guard-entrypoint-'));
  const link = path.join(directory, 'guard.mjs');
  try {
    await fs.symlink(fileURLToPath(new URL('./chart/files/guard.mjs', import.meta.url)), link);
    const result = spawnSync(process.execPath, [link], {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PILOT_GUARD_START_REFUSED/);
  } finally {
    await fs.unlink(link);
    await fs.rmdir(directory);
  }
});

function snapshotFixture(seen, exists) {
  const original = fixture();
  original.config.observedFiles = {stateFile: '/data/.guard-observed-files.json', paths: ['/data/snapshot.json']};
  const read = original.dependencies.readFile;
  original.dependencies.readFile = async path => path === '/data/.guard-observed-files.json' ?
    JSON.stringify({version: 1, vault: 'pilot', observed: {'/data/snapshot.json': seen}}) :
    path === '/data/snapshot.json' && exists ? '[]' : read(path);
  const stat = original.dependencies.lstat;
  original.dependencies.lstat = async path => {
    if (path === '/data/snapshot.json' && !exists) throw Object.assign(new Error('missing snapshot'), {code: 'ENOENT'});
    return stat(path);
  };
  return original;
}
test('never-created optional queue snapshot may be absent only with initialized checkpoint', async () => {
  const {config, dependencies} = snapshotFixture(false, false);
  assert.deepEqual(await verify(config, dependencies), {warning: false});
});
test('previously observed queue snapshot cannot disappear', async () => {
  const {config, dependencies} = snapshotFixture(true, false);
  await assert.rejects(verify(config, dependencies), /missing snapshot/);
});
test('new queue snapshot is durably marked required before continuing', async () => {
  const {config, dependencies} = snapshotFixture(false, true);
  let saved;
  dependencies.persistObservedState = async (path, state) => { saved = state; };
  await verify(config, dependencies);
  assert.equal(saved.observed['/data/snapshot.json'], true);
});
test('missing observation checkpoint is never recreated automatically', async () => {
  const {config, dependencies} = snapshotFixture(false, false);
  const read = dependencies.readFile;
  dependencies.readFile = async path => {
    if (path === '/data/.guard-observed-files.json') throw new Error('checkpoint missing');
    return read(path);
  };
  await assert.rejects(verify(config, dependencies), /checkpoint missing/);
});
test('malformed required JSON state is refused, not initialized to defaults', async () => {
  const {config, dependencies} = fixture();
  config.mounts[0].required = [{path: 'settings.json', format: 'json'}];
  const read = dependencies.readFile;
  dependencies.readFile = async path => path === '/data/settings.json' ? '{broken' : read(path);
  await assert.rejects(verify(config, dependencies), SyntaxError);
});
test('well-formed settings for the wrong database are refused', async () => {
  const {config, dependencies} = fixture();
  config.mounts[0].required = [{path: 'settings.json', format: 'json', identity: {database: 'pilot'}}];
  const read = dependencies.readFile;
  dependencies.readFile = async path => path === '/data/settings.json' ? '{"database":"other"}' : read(path);
  await assert.rejects(verify(config, dependencies), /REQUIRED_STATE_IDENTITY_MISMATCH/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { accessibleWithoutRoles, pilotSecurity } from './couchdb-bootstrap.mjs';

test('missing or empty members grants ordinary-user access regardless of admins', () => {
  assert.equal(accessibleWithoutRoles({}, 'pilot'), true);
  assert.equal(accessibleWithoutRoles({admins: {names: ['administrator']}, members: {names: [], roles: []}}, 'pilot'), true);
});
test('new database has explicit server-admin role, not an empty admin boundary', () => {
  assert.deepEqual(pilotSecurity('pilot'), {
    admins: {names: [], roles: ['_admin']}, members: {names: ['pilot'], roles: []},
  });
});
test('unrelated named or role membership denies a new role-free pilot user', () => {
  assert.equal(accessibleWithoutRoles({members: {names: ['existing-user'], roles: []}}, 'pilot'), false);
  assert.equal(accessibleWithoutRoles({members: {names: [], roles: ['existing-role']}}, 'pilot'), false);
});
test('existing explicit membership cannot be mistaken for isolation', () => {
  assert.equal(accessibleWithoutRoles({members: {names: ['pilot'], roles: []}}, 'pilot'), true);
});
test('malformed metadata refuses rather than assuming denial', () => {
  assert.throws(() => accessibleWithoutRoles({members: {names: 'user'}}, 'pilot'), /BOOTSTRAP_REFUSED/);
});

test('ConfigMap-style symlink entrypoint executes instead of silently succeeding', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pilot-entrypoint-'));
  const link = path.join(directory, 'bootstrap.mjs');
  try {
    await fs.symlink(fileURLToPath(new URL('./couchdb-bootstrap.mjs', import.meta.url)), link);
    const result = spawnSync(process.execPath, [link], {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PILOT_COUCHDB_BOOTSTRAP_REFUSED stage=read-admin-projection/);
  } finally {
    await fs.unlink(link);
    await fs.rmdir(directory);
  }
});

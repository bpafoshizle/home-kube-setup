// Read-only verification of the new pilot's effective authentication/ACL boundary.
import * as fs from 'node:fs/promises';
let stage = 'read-projections';
function demand(condition) { if (!condition) throw new Error('VERIFY_REFUSED'); }
async function main() {
  const admin = {username: await fs.readFile('/admin/username', 'utf8'), password: await fs.readFile('/admin/password', 'utf8')};
  const pilot = JSON.parse(await fs.readFile('/pilot/credentials.json', 'utf8'));
  demand(pilot.database === 'obsidian-pilot' && pilot.username === 'obsidian-pilot');
  async function request(path, credentials = pilot, method = 'GET') {
    return fetch('http://couchdb-couchdb.couchdb.svc.cluster.local:5984' + path, {
      method, signal: AbortSignal.timeout(10000),
      headers: {Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')},
    });
  }
  stage = 'verify-user-session';
  const session = await request('/_session'); demand(session.status === 200);
  const context = (await session.json()).userCtx;
  demand(context?.name === pilot.username && Array.isArray(context.roles) && context.roles.length === 0);
  stage = 'verify-explicit-database-security';
  const response = await request('/obsidian-pilot/_security', admin); demand(response.status === 200);
  const security = await response.json();
  demand(security.admins?.names?.length === 0 && security.admins.roles?.length === 1 &&
    security.admins.roles[0] === '_admin' && security.members?.names?.length === 1 &&
    security.members.names[0] === pilot.username && security.members.roles?.length === 0);
  stage = 'verify-database-and-bad-password';
  demand((await request('/obsidian-pilot')).status === 200);
  demand([401, 403].includes((await request('/obsidian-pilot', {...pilot, password: 'deliberately-invalid-pilot-password'})).status));
  stage = 'verify-server-admin-denial';
  const configStatus = (await request('/_node/_local/_config', pilot, 'HEAD')).status;
  console.log(JSON.stringify({serverAdminHeadStatus: configStatus, pilotRolesEmpty: true}));
  demand([401, 403].includes(configStatus));
  stage = 'verify-other-database-denial';
  const responseList = await request('/_all_dbs', admin); demand(responseList.status === 200);
  let denied = 0;
  for (const name of (await responseList.json()).filter(name => !name.startsWith('_') && name !== pilot.database)) {
    const status = (await request('/' + encodeURIComponent(name), pilot, 'HEAD')).status;
    console.log(JSON.stringify({otherDatabaseHeadStatus: status}));
    demand([401, 403].includes(status));
    denied++;
  }
  console.log(JSON.stringify({database: pilot.database, databaseRead: true, wrongPasswordDenied: true,
    roleFreeUser: true, serverAdminDenied: true, otherApplicationDatabasesDenied: denied,
    securityMetadataVerified: true, vaultDocumentsRead: false, mutationsPerformed: false}));
}
main().catch(() => { console.error('PILOT_COUCHDB_VERIFY_REFUSED stage=' + stage); process.exit(1); });

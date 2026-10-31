// Controlled completion of this session's partially created disposable database.
// Refuses any identity/ACL other than the exact initial bootstrap configurations.
import * as fs from 'node:fs/promises';
let stage = 'read-projections';
function demand(condition) { if (!condition) throw new Error('FINALIZE_REFUSED'); }
async function main() {
  const admin = {username: await fs.readFile('/admin/username', 'utf8'), password: await fs.readFile('/admin/password', 'utf8')};
  const pilot = JSON.parse(await fs.readFile('/pilot/credentials.json', 'utf8'));
  demand(pilot.database === 'obsidian-pilot' && pilot.username === 'obsidian-pilot');
  const origin = 'http://couchdb-couchdb.couchdb.svc.cluster.local:5984';
  async function request(path, credentials = admin, method = 'GET', body) {
    return fetch(origin + path, {method, signal: AbortSignal.timeout(10000),
      headers: {Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64'),
        ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
  }
  stage = 'verify-exact-created-user';
  const userResponse = await request('/_users/org.couchdb.user:obsidian-pilot');
  demand(userResponse.status === 200);
  const user = await userResponse.json();
  demand(user.name === pilot.username && user.type === 'user' && Array.isArray(user.roles) && user.roles.length === 0);
  stage = 'verify-exact-partial-database-security';
  const response = await request('/obsidian-pilot/_security');
  demand(response.status === 200);
  const current = await response.json();
  demand(current.members?.names?.length === 1 && current.members.names[0] === pilot.username &&
    current.members.roles?.length === 0 && current.admins?.names?.length === 0 &&
    Array.isArray(current.admins.roles) && (current.admins.roles.length === 0 ||
      current.admins.roles.length === 1 && current.admins.roles[0] === '_admin'));
  stage = 'complete-disposable-admin-boundary';
  const security = {admins: {names: [], roles: ['_admin']}, members: {names: [pilot.username], roles: []}};
  demand((await request('/obsidian-pilot/_security', admin, 'PUT', security)).status === 200);
  stage = 'verify-pilot-read';
  const readStatus = (await request('/obsidian-pilot', pilot)).status;
  console.log(JSON.stringify({pilotDatabaseReadStatus: readStatus}));
  demand(readStatus === 200);
  stage = 'verify-pilot-admin-denial';
  const adminStatus = (await request('/obsidian-pilot/_security', pilot, 'PUT', security)).status;
  console.log(JSON.stringify({pilotSecurityWriteStatus: adminStatus}));
  demand([401, 403].includes(adminStatus));
  stage = 'verify-other-database-denial';
  const list = await request('/_all_dbs'); demand(list.status === 200);
  let denied = 0;
  for (const name of (await list.json()).filter(name => !name.startsWith('_') && name !== pilot.database)) {
    demand([401, 403].includes((await request('/' + encodeURIComponent(name), pilot, 'HEAD')).status));
    denied++;
  }
  console.log(JSON.stringify({database: pilot.database, roleFreeUser: true, restrictedUserAccess: true,
    otherApplicationDatabasesDenied: denied, existingDatabasesOrCredentialsChanged: false,
    vaultDocumentsRead: false}));
}
main().catch(() => { console.error('PILOT_COUCHDB_FINALIZE_REFUSED stage=' + stage); process.exit(1); });

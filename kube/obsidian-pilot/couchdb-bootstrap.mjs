// Only security metadata and explicitly new disposable resources; never reads notes.
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const origin = 'http://couchdb-couchdb.couchdb.svc.cluster.local:5984';
const database = 'obsidian-pilot';
const username = 'obsidian-pilot';
let stage = 'read-admin-projection';
function demand(condition) { if (!condition) throw new Error('BOOTSTRAP_REFUSED'); }
export function accessibleWithoutRoles(security, user) {
  const names = security.members?.names ?? [];
  const roles = security.members?.roles ?? [];
  demand(Array.isArray(names) && Array.isArray(roles));
  return (!names.length && !roles.length) || names.includes(user);
}
export function pilotSecurity(user) {
  return {admins: {names: [], roles: ['_admin']}, members: {names: [user], roles: []}};
}
async function main() {
  const admin = {
    username: await fs.readFile('/admin/username', 'utf8'),
    password: await fs.readFile('/admin/password', 'utf8'),
  };
  demand(admin.username && admin.password);
  async function request(path, credentials = admin, method = 'GET', body) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64'),
        ...(body ? {'Content-Type': 'application/json'} : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    return response;
  }
  stage = 'refuse-existing-pilot';
  demand((await request('/' + database)).status === 404);
  demand((await request('/_users/' + encodeURIComponent('org.couchdb.user:' + username))).status === 404);
  stage = 'audit-database-membership';
  const inventory = await request('/_all_dbs');
  demand(inventory.status === 200);
  const databases = await inventory.json();
  demand(Array.isArray(databases));
  let checked = 0;
  let unrestricted = 0;
  for (const name of databases.filter(name => !name.startsWith('_'))) {
    const response = await request('/' + encodeURIComponent(name) + '/_security');
    demand(response.status === 200);
    const security = await response.json();
    if (accessibleWithoutRoles(security, username)) unrestricted++;
    checked++;
  }
  console.log(JSON.stringify({existingApplicationDatabasesChecked: checked,
    databasesPotentiallyAccessibleToPilotUser: unrestricted, vaultDocumentsRead: false}));
  demand(unrestricted === 0);
  if (process.env.BOOTSTRAP_MODE === 'audit') return;
  demand(process.env.BOOTSTRAP_MODE === 'provision');
  stage = 'read-dedicated-pilot-projection';
  const pilot = JSON.parse(await fs.readFile('/pilot/credentials.json', 'utf8'));
  demand(pilot.database === database && pilot.username === username &&
    typeof pilot.password === 'string' && pilot.password.length >= 32);
  stage = 'create-dedicated-user';
  demand((await request('/_users/' + encodeURIComponent('org.couchdb.user:' + username), admin, 'PUT',
    {_id: 'org.couchdb.user:' + username, name: username, type: 'user', roles: [], password: pilot.password})).status === 201);
  stage = 'create-disposable-database';
  demand((await request('/' + database, admin, 'PUT')).status === 201);
  const security = pilotSecurity(username);
  stage = 'restrict-new-database';
  demand((await request('/' + database + '/_security', admin, 'PUT', security)).status === 200);
  const readback = await request('/' + database + '/_security');
  demand(readback.status === 200);
  const actual = await readback.json();
  demand(actual.members?.names?.length === 1 && actual.members.names[0] === username &&
    actual.members.roles?.length === 0 && actual.admins?.names?.length === 0 &&
    actual.admins.roles?.length === 1 && actual.admins.roles[0] === '_admin');
  stage = 'verify-pilot-access-boundary';
  demand((await request('/' + database, pilot)).status === 200);
  const session = await request('/_session', pilot);
  demand(session.status === 200);
  const context = (await session.json()).userCtx;
  demand(context?.name === username && context.roles?.length === 0);
  // Read-only effective admin-denial check. The synthetic _security PUT probe
  // returned unexpected HTTP 500 on this server and is not used as denial proof.
  demand([401, 403].includes((await request('/_node/_local/_config', pilot, 'HEAD')).status));
  let denied = 0;
  for (const name of databases.filter(name => !name.startsWith('_'))) {
    const response = await request('/' + encodeURIComponent(name), pilot, 'HEAD');
    demand([401, 403].includes(response.status));
    denied++;
  }
  console.log(JSON.stringify({databaseCreated: database, userCreated: username,
    restrictedUserAccess: true, otherApplicationDatabasesDenied: denied,
    existingDatabasesOrCredentialsChanged: false, vaultDocumentsRead: false}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(() => { console.error('PILOT_COUCHDB_BOOTSTRAP_REFUSED stage=' + stage); process.exit(1); });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeMaintenanceRelease} from './maintenance-release.mjs';

const now = Date.parse('2026-10-31T12:00:00Z');
const at = delta => new Date(now + delta).toISOString();
function fixture(phase = 'capture') {
  const transaction = {id: 'maintenance-1', vault: 'pilot', node: 'worker-a', phase,
    previousUID: 'old-owner', candidateUID: 'new-owner', startedAt: at(-60000),
    eligibleWorkers: ['worker-a', 'worker-b'], claims: ['vault', 'sync', 'cortex']};
  const evidence = {transactionID: transaction.id, observedAt: at(-1000),
    lease: {holder: transaction.id, resourceVersion: '10', expiresAt: at(20000)},
    node: {name: 'worker-a', ready: true, deleting: false},
    stopProof: {podUID: 'old-owner', node: 'worker-a', observedAt: at(-2000),
      actualContainerExitsObserved: phase === 'capture' ? {cortex: 0, livesync: 0} : {capture: 0},
      secondsAfterDeletionNotice: 1.2},
    sessions: ['worker-a', 'worker-b'].map(node => ({node, checked: true, targetSessions: 0})),
    ownerInventoryComplete: true, activeConsumers: [],
    candidate: {uid: 'new-owner', vault: 'pilot', selectedNode: 'worker-a', assignedNode: null,
      deleting: false, started: false, schedulingGates: ['home-kube/manual-owner-release'],
      claims: [...transaction.claims], resourceVersion: '20'},
    storageBindingsVerified: true, mountGuardConfigured: true,
    backup: {transactionID: transaction.id, authenticatedReadback: true,
      inventoryVerified: true, durablyPublished: true}};
  return {transaction, evidence};
}

for (const phase of ['capture', 'restart']) {
  test(`${phase} produces an exact same-worker UID/resourceVersion plan`, () => {
    const {transaction, evidence} = fixture(phase);
    assert.deepEqual(authorizeMaintenanceRelease(transaction, evidence, now), {
      transactionID: 'maintenance-1', vault: 'pilot', phase, node: 'worker-a',
      podUID: 'new-owner', podResourceVersion: '20', leaseResourceVersion: '10'});
  });
}

const refusals = [
  ['cross-node candidate', x => { x.evidence.candidate.selectedNode = 'worker-b'; }],
  ['unhealthy worker', x => { x.evidence.node.ready = false; }],
  ['deleting worker', x => { x.evidence.node.deleting = true; }],
  ['stale inventory', x => { x.evidence.observedAt = at(-16000); }],
  ['future inventory', x => { x.evidence.observedAt = at(1); }],
  ['previous transaction proof', x => { x.evidence.stopProof.observedAt = at(-61000); }],
  ['wrong stopped owner', x => { x.evidence.stopProof.podUID = 'another-owner'; }],
  ['missing actual exits', x => { delete x.evidence.stopProof.actualContainerExitsObserved; }],
  ['partial clean exit', x => { delete x.evidence.stopProof.actualContainerExitsObserved.cortex; }],
  ['failed exit', x => { x.evidence.stopProof.actualContainerExitsObserved.cortex = 1; }],
  ['forced stop deadline', x => { x.evidence.stopProof.secondsAfterDeletionNotice = 14; }],
  ['missing worker check', x => { x.evidence.sessions.pop(); }],
  ['duplicate worker checks', x => { x.evidence.sessions[1].node = 'worker-a'; }],
  ['unexecuted session check', x => { x.evidence.sessions[0].checked = false; }],
  ['remaining session', x => { x.evidence.sessions[1].targetSessions = 1; }],
  ['another consumer', x => { x.evidence.activeConsumers.push('unexpected-pod'); }],
  ['partial owner inventory', x => { x.evidence.ownerInventoryComplete = false; }],
  ['already assigned candidate', x => { x.evidence.candidate.assignedNode = 'worker-a'; }],
  ['missing scheduling gate', x => { x.evidence.candidate.schedulingGates = []; }],
  ['changed candidate UID', x => { x.evidence.candidate.uid = 'replacement'; }],
  ['changed claim', x => { x.evidence.candidate.claims[0] = 'other-vault'; }],
  ['missing mount guard', x => { x.evidence.mountGuardConfigured = false; }],
  ['wrong storage bindings', x => { x.evidence.storageBindingsVerified = false; }],
  ['foreign lease holder', x => { x.evidence.lease.holder = 'another-transaction'; }],
  ['expiring lease', x => { x.evidence.lease.expiresAt = at(4000); }],
  ['reused owner UID', x => { x.transaction.candidateUID = x.transaction.previousUID; }],
  ['unknown phase', x => { x.transaction.phase = 'restore'; }],
];
for (const [name, mutate] of refusals) {
  test(`refuses ${name}`, () => {
    const value = fixture();
    mutate(value);
    assert.throws(() => authorizeMaintenanceRelease(value.transaction, value.evidence, now));
  });
}
for (const field of ['authenticatedReadback', 'inventoryVerified', 'durablyPublished']) {
  test(`restart refuses backup without ${field}`, () => {
    const {transaction, evidence} = fixture('restart');
    evidence.backup[field] = false;
    assert.throws(() => authorizeMaintenanceRelease(transaction, evidence, now), /VERIFIED_BACKUP_REQUIRED/);
  });
}
test('restart cannot reuse another transaction backup', () => {
  const {transaction, evidence} = fixture('restart');
  evidence.backup.transactionID = 'old-backup';
  assert.throws(() => authorizeMaintenanceRelease(transaction, evidence, now), /VERIFIED_BACKUP_REQUIRED/);
});

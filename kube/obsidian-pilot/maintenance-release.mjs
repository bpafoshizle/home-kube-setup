// Pure fail-closed policy for the approved same-worker maintenance workflow.
// This does not collect evidence, patch Kubernetes or grant release permission.
// A future controller must collect fresh evidence under its exclusive lease and
// use UID/resourceVersion-tested patches; evaluating cached JSON is not fencing.
function requireCondition(value, code) {
  if (!value) throw new Error('MAINTENANCE_' + code);
}
function exactMembers(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    new Set(actual).size === actual.length && expected.every(item => actual.includes(item));
}
function timestamp(value) {
  requireCondition(typeof value === 'string', 'TIMESTAMP_INVALID');
  const parsed = Date.parse(value);
  requireCondition(Number.isFinite(parsed), 'TIMESTAMP_INVALID');
  return parsed;
}
function identity(value) {
  return typeof value === 'string' && value.length > 0;
}

export function authorizeMaintenanceRelease(transaction, evidence, now = Date.now()) {
  requireCondition(transaction && evidence && Number.isFinite(now), 'INPUT_INVALID');
  const {id, vault, node, phase, previousUID, candidateUID, eligibleWorkers, claims} = transaction;
  requireCondition([id, vault, node, previousUID, candidateUID].every(identity) &&
    previousUID !== candidateUID, 'IDENTITY_INVALID');
  requireCondition(['capture', 'restart'].includes(phase), 'PHASE_INVALID');
  requireCondition(Array.isArray(eligibleWorkers) && eligibleWorkers.length > 0 &&
    exactMembers(eligibleWorkers, [...new Set(eligibleWorkers)]) &&
    eligibleWorkers.every(identity) && eligibleWorkers.includes(node), 'WORKERS_INVALID');
  requireCondition(Array.isArray(claims) && claims.length === 3 &&
    exactMembers(claims, [...new Set(claims)]) && claims.every(identity), 'CLAIMS_INVALID');
  const began = timestamp(transaction.startedAt);
  requireCondition(began <= now, 'TRANSACTION_IN_FUTURE');
  const observed = timestamp(evidence.observedAt);
  requireCondition(observed >= began && observed <= now && now - observed <= 15000,
    'EVIDENCE_STALE');
  requireCondition(evidence.transactionID === id, 'TRANSACTION_MISMATCH');

  const lease = evidence.lease;
  requireCondition(lease?.holder === id && identity(lease.resourceVersion) &&
    timestamp(lease.expiresAt) > now + 5000, 'EXCLUSIVE_LEASE_REQUIRED');
  requireCondition(evidence.node?.name === node && evidence.node.ready === true &&
    evidence.node.deleting === false, 'HEALTHY_SAME_WORKER_REQUIRED');

  const proof = evidence.stopProof;
  requireCondition(proof?.podUID === previousUID && proof.node === node,
    'STOP_OWNER_MISMATCH');
  const stopped = timestamp(proof.observedAt);
  requireCondition(stopped >= began && stopped <= observed, 'STOP_PROOF_STALE');
  const exits = proof.actualContainerExitsObserved;
  const expectedContainers = phase === 'capture' ? ['cortex', 'livesync'] : ['capture'];
  requireCondition(exits && exactMembers(Object.keys(exits), expectedContainers) &&
    expectedContainers.every(name => exits[name] === 0), 'CLEAN_EXITS_REQUIRED');
  if (phase === 'capture') {
    requireCondition(Number.isFinite(proof.secondsAfterDeletionNotice) &&
      proof.secondsAfterDeletionNotice >= 0 && proof.secondsAfterDeletionNotice < 14,
    'BOUNDED_STOP_REQUIRED');
  }

  // Each eligible worker must have actually been checked, not just the owner.
  requireCondition(Array.isArray(evidence.sessions) &&
    exactMembers(evidence.sessions.map(item => item.node), eligibleWorkers) &&
    evidence.sessions.every(item => item.checked === true && item.targetSessions === 0),
  'ALL_WORKER_SESSION_RELEASE_REQUIRED');
  requireCondition(evidence.ownerInventoryComplete === true &&
    Array.isArray(evidence.activeConsumers) && evidence.activeConsumers.length === 0,
  'NO_OTHER_CONSUMERS_REQUIRED');

  const candidate = evidence.candidate;
  requireCondition(candidate?.uid === candidateUID && candidate.vault === vault &&
    candidate.selectedNode === node && candidate.assignedNode === null &&
    candidate.deleting === false && candidate.started === false &&
    exactMembers(candidate.schedulingGates, ['home-kube/manual-owner-release']) &&
    exactMembers(candidate.claims, claims) && identity(candidate.resourceVersion),
  'GATED_SAME_WORKER_CANDIDATE_REQUIRED');
  // Pre-mount checks can establish PV/PVC identity, not inspect unmounted files.
  // The released Pod must independently guard actual mounts/complete state before
  // capture or application startup. Never confuse API binding with mount proof.
  requireCondition(evidence.storageBindingsVerified === true &&
    evidence.mountGuardConfigured === true, 'GUARDED_STORAGE_REQUIRED');
  if (phase === 'restart') {
    requireCondition(evidence.backup?.transactionID === id &&
      evidence.backup.authenticatedReadback === true &&
      evidence.backup.inventoryVerified === true &&
      evidence.backup.durablyPublished === true, 'VERIFIED_BACKUP_REQUIRED');
  }

  // One-shot plan only. Never return a reusable boolean permission or wildcard.
  return {transactionID: id, vault, phase, node, podUID: candidateUID,
    podResourceVersion: candidate.resourceVersion, leaseResourceVersion: lease.resourceVersion};
}

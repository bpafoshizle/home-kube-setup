# Disposable Obsidian pilot

Implementation in progress; **not an accepted pilot or live-vault cutover**.
The [implementation ticket](https://github.com/bpafoshizle/home-kube-setup/issues/72)
and its linked approved contracts control. No existing human database, settings,
credentials or vault may be reused or changed.

Ext4 initialization, static Retain binding and the first Kubernetes storage
diagnostic completed. The human subsequently
[accepted standard kubelet CHAP handling](https://github.com/bpafoshizle/home-kube-setup/issues/84#issuecomment-6502567555),
including its internal iscsiadm argv behavior. That finding is no longer a
blocker. Our own commands still must not contain secret values. Existing storage
may be used through explicit single-owner release; never repeat initialization.

## Current checkpoint (2026-10-29)

- Deployed Helm revision **3**, namespace/release `obsidian-pilot`, Pod
  `obsidian-pilot-6d8cbb8fc4-kvz8l`, UID
  `47322d58-1906-41d6-a7a1-1e23afa39909`, selected worker `bletchley002`.
  Last observed 2/2 Ready, zero restarts; this is not ongoing health proof.
- Private MCP: `https://obsidian-pilot.tail55ae3f.ts.net/mcp`. HTTPS health 200,
  missing/wrong bearer 401. Actual Tailscale serve configs have HTTPS enabled
  and Funnel disabled; Service is ClusterIP with no external IPs. Shared
  route/grant inventory remains separate from these effective endpoint checks.
- Actual OpenCode v2.1.4 on this Mac uses project `opencode.json` and ignored
  0600 `sensitive/obsidian-pilot/mcp-token`. It reconnected after service
  replacement without manual client restart; discovery refreshed to 28 tools.
- Both applications completed explicit bootstrap. Cortex started read-only;
  revision 3 enabled the approved synthetic-write phase after read/auth checks.
  Both previous owner containers actually exited 0 in 1.064 seconds; session
  release was checked before explicit release of the replacement on the same
  healthy worker. This proves neither fencing nor cross-node transfer safety.
- API-only dataset Job passed: 100 exact content/property checks, FTS freshness
  **3704 ms**, encrypted outgoing convergence **15809 ms**, 100 remote main-note
  documents. No direct NAS-note writes or binary uploads.
- Actual OpenCode passed frontmatter/body preservation, exact edit, section
  append, collision refusal without mutation, rename/content/link rewrite,
  backlinks/outgoing links, task create/update/complete/index, invalid-date
  refusal without mutation, and traversal/absolute/hidden-path refusal.
  Delete/recreate preserved exact original content/properties; visible count 100.
  `Note001.md` is now `Renamed001.md`; Notes 000/099 contain operation fixtures.
- Snapshot observation is now recorded monotonically; settings and queue snapshot
  are 0600. Latest instantaneous usage: Cortex 6m/107 MiB, LiveSync 11m/103 MiB;
  **not measured peak sizing**. Local checks: 28 Node and 9 Python tests, Helm lint.
- No coordinated backup/restore, backup key/archive/PVC, weekly retention job or
  maintenance controller has been implemented. Recovery, meaningful continuous
  sync/index health, runtime safety/watcher tests, unlisted-initiator denial and
  human-device/attachment/incoming/conflict/Mac-closed gates remain open.
  No live-vault cutover or disruptive/fencing test has been performed.

## Management boundary

- Ansible handles worker initiator configuration and the guarded, one-time
  initialization of the verified new iSCSI LUN. It does not manage application
  containers, host application services or persistent worker-local data.
- Kubernetes owns the static PV/PVC, kubelet CHAP Secret, application containers,
  configuration, private Service/Ingress, diagnostic Jobs and normal lifecycle.
- All eligible workers retain the host iSCSI prerequisites and distinct IQNs;
  none should mount this LUN through `/etc/fstab` or automatic boot login.
  Current `iscsid.conf` readback on all four workers is `node.startup = manual`.
  `ansible/10-iscsi-pilot-readback.yml` verified active kubelet-generated records
  are root-owned 0600 with manual startup, without printing CHAP fields.
  One-time probe/format scripts are not boot hooks or recurring
  deployment steps; retain only guarded provisioning tools that remain useful.
- `native-cortex-check.yaml` is an isolated Kubernetes Job with **no PVC,
  credentials, application entrypoint or endpoint**. It only loads native modules
  and runs an in-memory SQLite query as UID 1000 on ARM64. Its selected node is a
  temporary diagnostic location, not permanent storage-driven app placement.
- `native-livesync-check.yaml` likewise loads LevelDOWN without opening a
  database, starting the CLI or using CouchDB/E2EE credentials.

## Storage sequence

Use explicit context `kubernetes-admin@kubernetes`. Never skip identity verification
or run the probe/initialization against an existing owner. Do not use `--limit`:
all four worker session checks are required. These scripts are deliberately
one-shot: an existing session, signature or nonzero disk causes a stop rather
than reformatting, restoring or force-releasing anything.

```bash
ansible-playbook -i ansible/inventory/hosts ansible/07-iscsi-pilot-probe.yml -e pilot_first_owner=bletchley002
ansible-playbook -i ansible/inventory/hosts ansible/08-iscsi-pilot-initialize.yml --check -e pilot_initialize_blank_lun=true
ansible-playbook -i ansible/inventory/hosts ansible/08-iscsi-pilot-initialize.yml -e pilot_initialize_blank_lun=true
```

The full-device blank check reads 5 GiB and can take several minutes. Use a
sufficient execution timeout; a timed-out check is **not** evidence of success.
Never start a second initialization while an earlier operation might still run.
Formatting uses the verified target/portal/LUN path and independently matches the
SCSI serial to the NAS LUN UUID. No `mkfs -F`, partition overwrite or worker-local
fallback is provided. The initializer creates only a Cortex storage-identity
sentinel, not notes or application databases. It syncs, unmounts and performs a
read-only filesystem check. Partial initialization requires investigation, not a
rerun with a force flag.

After successful initialization, explicitly log out the temporary host session,
verify it is gone on all workers, and remove its dedicated IPv4 discovery record
to remove the temporary host-side credential copy. Do not delete a record or log
out if a Kubernetes consumer or mounted filesystem has since appeared.

The completed handoff used `ansible/09-iscsi-pilot-release.yml` with
`-e pilot_release_initialization=true`. Its final session-only check can be run
separately with `--tags verify-session-release`, without logging out a consumer.
That check requires **no sessions**; do not run it while the application owns the
LUN. The commands below describe the completed one-time handoff, not routine ops.

```bash
# On bletchley002, as root, after verifying no mounts/consumers:
iscsiadm -m node -T iqn.2000-01.com.synology:lynott.obsidian-pilot-cortex -p 192.168.0.43:3260 --logout
iscsiadm -m node -T iqn.2000-01.com.synology:lynott.obsidian-pilot-cortex -p 192.168.0.43:3260 --op delete
```

Only then create the kubelet Secret and apply the static volume objects:

```bash
# Namespace must already exist. The helper refuses replacement of an existing Secret.
python3 -B kube/obsidian-pilot/create-iscsi-secret.py
kubectl --context=kubernetes-admin@kubernetes apply -f kube/obsidian-pilot/storage.yaml
kubectl --context=kubernetes-admin@kubernetes -n obsidian-pilot get pvc cortex-state
```

`storage.yaml` explicitly prebinds a classless 5 GiB **Retain** iSCSI PV/PVC.
Never substitute the default NFS class for Cortex. The CHAP helper reads only the
ignored 0600 local pilot file, sends credentials via stdin, uses `create` rather
than credential-bearing last-applied annotations, and compares private readback.
Do not use `kubectl get secret -o yaml`, shell tracing, verbose Ansible output or
secret-valued command arguments. No application container receives CHAP data.

Binding a PVC is not filesystem-mount, application-compatibility or ownership
acceptance. **No workload release is supplied by these storage files.** Future
application packaging must remain gated against automatic cross-node mounting
and writing; RWO, one replica and Recreate are not fencing. No automatic transfer,
force-delete, force-reschedule or physical-fencing test is authorized here.

## Local checks

```bash
python3 -B kube/obsidian-pilot/test_storage.py
node --test kube/obsidian-pilot/guard.test.mjs
node --test kube/obsidian-pilot/maintenance-release.test.mjs
kubectl --context=kubernetes-admin@kubernetes apply --dry-run=server -f kube/obsidian-pilot/storage.yaml
kubectl --context=kubernetes-admin@kubernetes apply --dry-run=server -f kube/obsidian-pilot/native-cortex-check.yaml
```

The synthetic unit tests do not contact the cluster/NAS or read real credentials.
They do not establish hardware flush durability, effective worker-only access,
runtime filesystem semantics or backup/restore acceptance.

## Integrated application guard (runtime failure qualification incomplete)

`chart/files/guard.mjs` is a reusable Node process wrapper for both pinned images. Local
tests cover mount/source identity, sentinels, required state, exact Pod-UID owner
release, capacity checks and bounded storage-operation timeout. It refuses startup
on missing state rather than creating it. During execution it rechecks every two
seconds, with a five-second check timeout, and requests child shutdown on failure.
It suppresses unreviewed upstream logs to avoid publishing secrets/note content;
application-specific sanitized synchronization/index-health evidence is still
required, not replaced by guard liveness.

Initial configurable capacity policy: warn at <=20% available blocks/inodes;
stop at <=10% or <=128 MiB available. No NAS alert delivery or measured runtime
failure response is claimed by these local tests. Mount-loss/in-flight-write
behavior must still be qualified before acceptance.

Every new application Pod must additionally be gated **before scheduling/mounts**
until explicit operator release; a process wrapper alone runs too late to prevent
an unsafe cross-node ext4 mount. Owner release must identify the exact Pod UID,
vault and selected worker, not a reusable boolean. Neither a mounted ConfigMap nor
this polling wrapper is fencing. The deployed chart integrates the gate and
wrapper; component tests alone never authorize a release. `watch-owner-stop.py`
records actual container exits; Pod disappearance is not clean-exit evidence.

## Remaining application gates

Coordinated stopped-app backup/restore, secure credential recovery and configurable
weekly retention of the latest two successful backups; meaningful sync/index
health and peak resources; remaining runtime guard/watcher/recovery/boundary tests;
actual unlisted-initiator denial; human-device, attachments, incoming/conflict and
Mac-closed behavior. Fenced transfer/disruptive tests still need separate approval.
See the implementation ticket for evidence; smoke success is not pilot acceptance.

The human approved bounded same-healthy-worker backup maintenance releases on
2026-10-31; no cross-node failover or forced release. See
[backup/recovery implementation boundary](BACKUP_RECOVERY.md). A tested pure
release-policy component exists, but no maintenance controller/permissions,
archive, key, destination PVC or restore has been deployed. The existing release
workflow remains operator-controlled until the adapter is implemented/qualified.

## Subsequent NFS and database bootstrap work

- `nfs-storage.yaml` creates a separate Retain class on the existing provisioner
  and separate `vault`/`livesync-state` claims. Their 1 GiB requests are not NAS
  quotas/reservations. Both are Bound; source identity was read from the resulting
  PVs (`lynott:/volume1/kubedata1/...`), not inferred from the iSCSI portal.
- `nfs-storage-check.mjs` and its owner-gated Job completed as UID 1000, verifying
  NFSv4, separate-process LevelDOWN exclusion, synchronous put/reopen, file
  fsync/rename/directory fsync. Only storage sentinels and disposable state
  diagnostics were written; no vault notes. LiveSync NFS compatibility remains
  conditional on application/watcher/recovery tests.
- `couchdb-permission-audit.yaml` ran in the existing CouchDB namespace with only
  the two required admin Secret projections. It inspected security metadata,
  not vault documents: one existing application database, zero accessible to a
  new role-free pilot user. It changed no permissions or existing credentials.
- `create-app-secrets.py` generated fresh pilot-only CouchDB password, E2EE
  passphrase and Cortex token in ignored 0600 `application.json` under the 0700
  pilot directory. It delivered separate scoped Secrets over stdin with private
  readback and no last-applied credential annotations. Re-execution compares
  exact existing values; it never silently rotates or overwrites a mismatch.
- Database creation is separate from LiveSync bootstrap. The initial provision
  Job unexpectedly no-oped because a ConfigMap symlink prevented its main guard
  from running. This was caught by checking actual output, corrected with
  realpath-aware invocation, and covered by a regression test. The v2 Job created
  only the new pilot DB/user, then failed its final permission assertion. A
  bounded finalizer verified the exact partial pilot state and explicitly
  restricted its database-admin role to `_admin`; its negative security-write
  probe returned unexpected HTTP 500, so that response is not denial proof.
  A separate read-only verification **passed**: effective pilot roles empty,
  own-database metadata read 200, wrong-password denied, server-admin HEAD 401,
  existing application database HEAD 403, explicit admin/member ACL matched.
  No shared permissions/credentials or existing vault documents were changed.
  Never rerun initial provisioning against existing resources or modify shared
  database permissions to bypass a failed isolation check.
- `livesync-bootstrap.mjs`/YAML completed initial sync/mirror. This explicit,
  owner-gated one-shot requires only the matching sentinels and otherwise empty
  new roots, derives defaults using the actual pinned CLI, writes 0600 E2EE
  settings privately, then performs initial sync/mirror with suppressed upstream
  output and required bookkeeping readback.
  It is not a normal restart path.
  The first attempt correctly refused because NFS subPath sources include
  `/vault` or `/state`, not just the PVC root. Read-only metadata inspection
  confirmed both markers/0700 owned directories and no extra files. Expected
  full sources were corrected without weakening matching or replacing state;
  explicitly released `livesync-bootstrap-v2` completed sync/mirror. The queue
  snapshot is a pending-event queue, not an inventory, and legitimately did not
  exist initially. `livesync-complete-bootstrap` verified complete runtime/LevelDB
  state and created explicit private checkpoints with the vault read-only; it did
  not fabricate the snapshot or rerun bootstrap on populated roots. Runtime guard
  records first observation monotonically and refuses later disappearance.
- `cortex-bootstrap.mjs`/YAML completed explicit first boot
  with read-only vault and expected storage identity, disabled models/memory,
  loopback missing/wrong-token checks, authenticated MCP/tool gating and graceful
  shutdown before recording complete index/auth state. Neither first-bootstrap
  script may be reused as automatic missing-state recovery.

## Reusable service chart (defaults disabled; pilot deployed)

`chart/` packages the shared two-container per-vault service with separate existing
claims, immutable approved images, approved CPU/memory budgets, read-only Cortex
by default, a ClusterIP Service and optional Tailscale-only Ingress. No policy
controller, public LoadBalancer or Funnel is installed. Default `enabled: false`
renders no workload; enabled rendering requires explicit identities, mount
sources, required LiveSync state paths, private bare HTTPS origin and temporary
selected owner. Default lint and enabled server dry-run with synthetic identities
passed; actual deployment separately uses `pilot-values.yaml`. Never apply its
identities to another vault or treat bootstrap scripts as restart recovery.

Every new Pod carries a pre-scheduling owner gate. An external operator-created
release ConfigMap must also match its exact Pod UID, selected worker and vault;
the wrapper checks it before starting either child and during execution. Recreate
and a temporary selected owner prevent ordinary rollout overlap, but neither is
physical fencing. The chart does not automatically create/reuse owner permission,
bootstrap missing state, format devices or transfer a failed worker's ownership.

Before enabling a new instance, record successful LiveSync and Cortex bootstrap,
actual complete state-file paths/source identity, and stopped prior owners. HTTP
health/readiness is only process health: sanitized sync backlog/conflict/index
freshness and runtime guard tests remain acceptance gates. Upstream child logs
are suppressed until safely instrumented, not claimed as health evidence.

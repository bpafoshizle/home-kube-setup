# Disposable Cortex pilot storage

Provisioned on **2026-10-29** under the human-approved disposable pilot contract
and the subsequent live approval for a 5 GB thick LUN on Volume 1. This is not
production storage or live-vault cutover approval.

## Provisioned resources and readback

| Item | Observed value |
| --- | --- |
| NAS | `lynott`, inventory address `192.168.0.43` |
| Management session | Human-established HTTPS session at `https://lynott.local:5001/` |
| LUN name | `obsidian-pilot-cortex` |
| LUN UUID | `9a583351-01a2-45f5-abed-b38a476594dd` |
| Backing | Synology Volume 1, Btrfs |
| Allocation | Thick, UI capacity 5 GB; backing UI store reports **5368709120 bytes (5 GiB)** |
| LUN status | Healthy |
| Target name | `obsidian-pilot-cortex` |
| Target IQN | `iqn.2000-01.com.synology:lynott.obsidian-pilot-cortex` |
| Target status | Ready, authentication **CHAP** |
| Multiple sessions | Disabled |
| LUN permissions | **Custom**, `obsidian-pilot-workers` Read/Write; unlisted initiators denied by the UI policy |
| FUA / Sync Cache commands | Explicitly enabled, saved, and verified by reopening the Cache tab |
| I/O policy | Buffered I/O retained; Direct I/O not selected |
| Client filesystem | ext4, UUID `256f8624-4e9c-45eb-95de-9103c3c955fe`; initialized, synced, unmounted and read-only checked |
| Kubernetes PV/PVC | `obsidian-pilot-cortex` / `obsidian-pilot/cortex-state`, 5 GiB, Bound, **Retain** |

The LUN numeric ID shown in the inventory is **not** evidence of its SCSI LUN
mapping. Record/verify the actual target portal, mapped SCSI LUN number and
device identity before formatting or creating a usable PV. Do not guess the
mapping from creation order, a UI row ID or the LUN UUID.

This is configuration readback, not a test of effective access denial, CHAP
login, flush propagation, crash durability or stale-writer fencing. Multiple
sessions disabled, RWO and CHAP do not replace physical fencing during transfer.

## Worker initiator identities

The NAS host alias `obsidian-pilot-workers` contains exactly these four IQNs:

| Worker | Initiator IQN |
| --- | --- |
| bletchley002 | `iqn.2026-10.local.home-kube:bletchley002` |
| bletchley003 | `iqn.2026-10.local.home-kube:bletchley003` |
| bletchley004 | `iqn.2026-10.local.home-kube:bletchley004` |
| bletchley005 | `iqn.2026-10.local.home-kube:bletchley005` |

Host configuration is managed by
[`ansible/06-iscsi-pilot-initiators.yml`](../../ansible/06-iscsi-pilot-initiators.yml).
Before changing the identity, it requires no active iSCSI sessions, an inactive
daemon and either the observed `GenerateName=yes` file or the exact intended
identity. Unexpected existing configuration causes a stop, not replacement.

Executed:

```bash
ansible-playbook -i ansible/inventory/hosts ansible/06-iscsi-pilot-initiators.yml --check --diff
ansible-playbook -i ansible/inventory/hosts ansible/06-iscsi-pilot-initiators.yml
```

Both passed on all four workers. The apply changed only their
`/etc/iscsi/initiatorname.iscsi` files, with successful identity readback.
No packages/services/modules were installed, restarted or loaded. No discovery,
session login, format or mount was attempted. Control-plane configuration was
not changed. IQN access control identifies the supplied initiator name; CHAP
credentials still must be kept private.

## Credential handling

A fresh dedicated CHAP credential was generated locally and entered only in the
HTTPS NAS session. The local recovery copy is in the Git-ignored
`sensitive/obsidian-pilot/chap.json` with file mode 0600 and directory mode 0700.
Do not print it, put it in command-line arguments, Git or tracker comments, or
mount it into application containers. Kubernetes iSCSI authentication uses the
separately referenced `obsidian-pilot/cortex-iscsi-chap` Secret, not application
environment variables. Kubelet internally places CHAP values in iscsiadm argv;
after risk disclosure the human explicitly accepted this standard kubelet path
in [the credential-delivery resolution](https://github.com/bpafoshizle/home-kube-setup/issues/84#issuecomment-6502567555).
Our own commands still must not contain secret values. The helper's stdin
delivery does not change downstream kubelet behavior. Secure configuration
recovery/backup remains to implement.

## Remaining storage gates

1. Kubelet CHAP handling is now accepted. Mapping/device identity, allowed-worker
   CHAP and missing-CHAP rejection are established; effective unlisted-initiator
   denial is not yet tested.
2. Initialization and static Retain PV/PVC binding are complete. The first
   Kubernetes single-owner storage diagnostic passed and released its session;
   this does not authorize overlapping mounts or automatic owner transfer.
3. Define/test low-space alerts and fail-closed behavior; the thick allocation
   reserves space but is not a complete capacity or health-monitoring policy.
4. Separate NFS vault/LiveSync state, mount/identity/state guards and explicit
   pre-mount single-owner release are deployed. Runtime failure qualification
   remains incomplete; never substitute a local directory on missing storage.
5. Validate locking, sync/flush, shutdown/restart and coordinated stopped-app
   backup/restore. No snapshot support exists for this thick LUN. Preserve good
   backups on failure; current replicas and RAID/cache are not backups.
6. Keep fenced cross-node transfer and disruptive tests behind their separate
    required approvals. Never infer fencing from a missing session alone.

## Continuation: actual mapping and first-owner probe

On 2026-10-29 the existing trusted DSM session was still available. Target
readback showed the approved LUN mapped to the target, CHAP and multiple-session
settings unchanged, and LAN 1 connected at `192.168.0.43`. Discovery from the sole
temporary initialization owner **bletchley002** returned
`192.168.0.43:3260,1` for the exact approved IQN. The portal-group tag `1` is not
used as evidence of a SCSI LUN number.

An unauthenticated login was rejected with iSCSI authorization failure (24).
After all four workers again showed no sessions and the exact stable initiator
identities, `ansible/07-iscsi-pilot-probe.yml` delivered CHAP over Ansible stdin
under `no_log`, storing only a root-owned 0600 manual-login node record. Login
succeeded **only on bletchley002**. No credentials were passed to iscsiadm argv.

Independent authenticated session/device readback:

- SCSI **LUN 1**, attached `/dev/sda` on this worker at this observation.
- Stable path:
  `/dev/disk/by-path/ip-192.168.0.43:3260-iscsi-iqn.2000-01.com.synology:lynott.obsidian-pilot-cortex-lun-1`.
- SCSI serial exactly matches NAS LUN UUID
  `9a583351-01a2-45f5-abed-b38a476594dd`.
- Reported WWN `0x60014059a583351d01a2d45f5dabeddb`; Synology Storage,
  **5368709120 bytes**.
- No filesystem, mount or partition children; `wipefs --no-act` found no
  signatures and `blkid -p` returned 2 (no recognized signature).

This establishes actual mapping/identity, not just the NAS inventory row ID.
It proves allowed-worker CHAP connectivity and missing-CHAP rejection, **not**
effective denial of every unlisted initiator or crash durability.

The guarded one-shot initializer in `ansible/08-iscsi-pilot-initialize.yml`
also requires an all-zero full-device read before formatting. An initial
120-second check timed out before completion; inspection found no remaining
initializer or filesystem and no format occurred. A longer check was then
started and **passed with changed=0 on all workers**. The explicitly authorized
initialization apply was then started; it rechecks the exact identity and full
blank device before formatting. The successful outcome and clean handoff are
recorded below. No other worker was logged in or mounted meanwhile.

Kubernetes packaging is under `kube/obsidian-pilot/`. The new namespace exists;
no-volume/no-credential native Cortex and LiveSync diagnostic Jobs completed.
Cortex loaded SQLite `3.53.4` and ONNX `1.30.0` on ARM64/Node `v24.21.0`;
LiveSync loaded LevelDOWN `6.1.1` on ARM64/Node `v22.23.3`. Both ran as UID 1000,
with no application entrypoint, vault, durable database or endpoint. This does
not qualify their application or persistent-storage behavior.
The static Retain PV/PVC and kubelet Secret were subsequently created and the
filesystem UUID independently read back, as recorded below. Application
management belongs in Kubernetes, not host container services.

## Completed initialization/handoff; historical credential-delivery blocker

The initialization apply succeeded: exact blank-LUN check, ext4 creation,
single-worker mount, identity-sentinel write/fsync, filesystem sync, unmount,
temporary mountpoint removal and successful `e2fsck -f -n`. Independent `lsblk`
readback matched ext4/UUID/capacity/serial with no mounts.
`ansible/09-iscsi-pilot-release.yml` then logged out the idle initialization
session, removed only this target's host node records/CHAP copy and verified no
sessions on all four workers.

Created the kubelet Secret with private exact readback, then applied the PV/PVC.
Both are Bound; **Retain is now effective**. `cortex-storage-check` was first
observed SchedulingGated and unassigned. After clean release checks, an exact-UID
JSON patch released only Pod `111b61e8-1b5a-499a-8888-0a8df77d7bcf`, selected
worker bletchley002. No application owner was released.

The Kubernetes Job verified the mounted ext4/sentinel and absence of application
state, then changed only the dedicated new state-root mode/owner to 0700,
1000:1000. As UID 1000 it passed SQLite WAL, concurrent-connection writer
exclusion, commit/checkpoint/reopen, directory fsync and synthetic-file cleanup.
Available space was 4911140864 bytes. This is not actual Cortex PRAGMA policy or
crash/flush durability. After completion, the session and kubelet node record
were absent. An all-worker session-only readback passed with changed=0.
All four iscsid.conf files showed manual startup; the short-lived kubelet record
was already gone, so its startup field was not read back while mounted.

**Subsequent source inspection found a blocking discrepancy:** Kubernetes v1.33.6
[`updateISCSINode`](https://github.com/kubernetes/kubernetes/blob/v1.33.6/pkg/volume/iscsi/iscsi_util.go)
passes Secret fields to `iscsiadm ... -v <value>`. It explicitly avoids command
logging, but still uses secret-valued argv. This was missed before the diagnostic
mount; the strict delivery gate has **not passed**. No observed disclosure or
compromise is established. Further mounts/application rollout are paused for
[Resolve pilot CHAP delivery versus kubelet secret-valued process arguments](https://github.com/bpafoshizle/home-kube-setup/issues/84),
a native blocker of the implementation ticket. The bound PV/PVC and Secret
remain idle at that checkpoint. The human subsequently accepted standard kubelet
CHAP handling after the risk explanation, explicitly saying “ok proceed”; that
decision is closed and no longer blocks explicitly released consumers.

## NFS roots qualified at smoke-test level

Created a separate `obsidian-pilot-nfs-retain` StorageClass using the **existing**
`k8s-sigs.io/nfs-subdir-external-provisioner`; no controller installation or shared
StorageClass modification. Separate 1 GiB-request RWO claims `vault` and
`livesync-state` are Bound with Retain. NFS requests are not enforced quotas or
reserved allocation. Actual provisioned sources (not guessed from iSCSI portal):

- Vault: `lynott:/volume1/kubedata1/obsidian-pilot-vault-pvc-32394d18-6b21-4a56-a542-d5578b4b96bb`.
- Sync state: `lynott:/volume1/kubedata1/obsidian-pilot-livesync-state-pvc-6cfaf67b-9fa1-487e-a6e2-dd9200a32f98`.

An exact-UID pre-mount release of NFS diagnostic Pod
`214e4b76-dc9e-4de5-b033-37df402c1c07` selected bletchley002 after checking both
claims and absence of other consumers. It observed NFSv4, ran as UID 1000,
created separate owned 0700 `vault/` and `state/` subdirectories with private
identity sentinels, and passed LevelDOWN 6.1.1 **separate-process** lock rejection,
synchronous put/reopen, file fsync/rename/directory fsync and synthetic-state-file
cleanup. No vault notes were created or directly written. Watchers, application
reconciliation, transport loss/recovery and backup/restore remain unqualified.

Deleting notes does not release the NAS reservation. Deliberately deleting this
disposable LUN eventually releases it; Kubernetes Retain is intended to prevent
automatic storage deletion, not forbid approved manual cleanup. No deletion is
currently requested or scheduled. Production storage is a separate later
live-vault approval decision.

## Application storage checkpoint (2026-10-29)

Both bootstraps completed and Helm revision 3 is deployed on bletchley002, exact
owner UID `47322d58-1906-41d6-a7a1-1e23afa39909`. The prior owner reported actual
exit 0 from both containers in 1.064 seconds; all-worker session release was
verified **before** explicitly releasing this replacement. The old proof does
not authorize any later replacement or transfer. Do not run no-session checks
against the active owner. Active kubelet records were read back root-owned 0600,
manual startup; no fstab/boot login or worker-local durable fallback.

Actual application subPath sources append `/vault` and `/state` to the respective
NFS sources above. Guard inventory matches those complete observed sources;
`/dev/sda` was the Cortex mount source at observation, not a permanent identity.
LUN/sentinel/filesystem identity must still match independently.

100 synthetic notes were created exclusively through Cortex, with exact reads,
FTS freshness 3704 ms and encrypted outgoing convergence 15809 ms. Actual client
operation checks passed; visible count remains 100 after rename/delete/recreate.
This provides application/NFS smoke evidence, not full watcher/crash/restore
qualification. The LiveSync event-queue snapshot is now observed; guard preserves
that fact monotonically. Snapshot/settings modes were 0600.

No backup archive, recovery key, backup PVC, retention job, restore or maintenance
controller exists yet. Weekly configurable two-successful-backup retention and
secure stopped-application recovery remain blocking acceptance gates. Retain,
replication and RAID do not satisfy them; no extra LUN allocation is authorized.

## Authority and execution record

- [Approved pilot](https://github.com/bpafoshizle/home-kube-setup/issues/71#issuecomment-6498323062)
- [Approved storage/recovery contract](https://github.com/bpafoshizle/home-kube-setup/issues/70#issuecomment-6254996127)
- [Superseding private-access policy](https://github.com/bpafoshizle/home-kube-setup/issues/80#issuecomment-6498974370)
- [Implementation and deployment](https://github.com/bpafoshizle/home-kube-setup/issues/72)

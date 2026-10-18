# Obsidian NAS Storage Evidence

Read-only evidence for [Verify NAS-backed persistence and application storage requirements](https://github.com/bpafoshizle/home-kube-setup/issues/75), within [Headless Obsidian vault service — execution Wayfinder](https://github.com/bpafoshizle/home-kube-setup/issues/67). Collected 2026-10-11. **Cluster, NAS and node prerequisite evidence collected; exact driver compatibility and remaining operational requirements still need evaluation. No backend selected or provisioned.**

Application-specific findings and primary citations: [Pinned application requirements](OBSIDIAN_NAS_APPLICATION_REQUIREMENTS.md).

Block release evidence: [NAS-backed block requirements](OBSIDIAN_NAS_BLOCK_REQUIREMENTS.md). Detailed flush/authentication/attachment findings: [Driver caveat review](OBSIDIAN_NAS_DRIVER_CAVEATS.md).

## Repository evidence, not live inventory

Repository configuration reviewed at `27cb9f8184abcd1f15b8251ef97c036f10c4ec12`:

- [`class.yaml`](../../kube/nfs-subdir-external-provisioner/deploy/class.yaml): `managed-nfs-storage`, provisioner `k8s-sigs.io/nfs-subdir-external-provisioner`, `archiveOnDelete: "true"`. No default-class annotation or explicit `mountOptions` is present. This does not establish the live default, effective mount options, or a backup policy.
- [`deployment.yaml`](../../kube/nfs-subdir-external-provisioner/deploy/deployment.yaml): one provisioner replica, `Recreate`, image `k8s.gcr.io/sig-storage/nfs-subdir-external-provisioner:v4.0.2`, NAS `lynott`, export `/volume1/kubedata1`. Its own volume is an NFS source, not node-local storage.
- [`postgresql-pvc.yaml`](../../kube/postgresql/postgresql-pvc.yaml): named PVC `postgresql-data`, namespace `postgresql`, 10Gi request, `ReadWriteOnce`, explicit `managed-nfs-storage`.
- [`postgresql-statefulset.yaml`](../../kube/postgresql/postgresql-statefulset.yaml): one replica using that PVC; `PGDATA=/var/lib/postgresql/data/pgdata`; no node selector, node affinity, or hostPath. Secret references were noted but no Secret values were read.
- [`03-add-packages.yml`](../../ansible/03-add-packages.yml): installs `nfs-common`. No iSCSI package/driver manifest was found in the reviewed repository. That is not evidence of absence on running nodes.

PostgreSQL demonstrates the repository's NAS-backed persistence architecture, **not** a validated LevelDB/SQLite filesystem contract. RWO does not by itself guarantee process exclusion or fencing.

## Live evidence and access boundary

The existing kubeconfig exposes one context, `kubernetes-admin@kubernetes`, with API endpoint `https://192.168.0.84:6443`. Context/server metadata only was inspected; credentials were not printed and the context was not changed.

Attempted:

```bash
kubectl --context=kubernetes-admin@kubernetes --request-timeout=8s get storageclasses -o json
```

Initial result: exit 1, `connect: no route to host`; a subsequent retry also failed. After the human restored access and requested another retry, this command and filtered metadata queries succeeded. The earlier empty response accompanying a connection error was not treated as inventory evidence.

### Observed cluster inventory after access restoration

- Exactly one StorageClass: `managed-nfs-storage`, provisioner `k8s-sigs.io/nfs-subdir-external-provisioner`, `archiveOnDelete: "true"`, reclaim policy `Delete`, binding mode `Immediate`, no default-class annotation, no explicit class mount options.
- Ten PVs, all Bound and using that class; all are NFS sources with server `lynott`. No inspected PV has node affinity or explicit mount options. Eight advertise RWO and two RWX. These observations do not establish negotiated NFS versions, node mount defaults, NAS export options, or lock/sync durability. No CSI/iSCSI/local/hostPath PV source was observed.
- `CSIDriver` inventory is empty. No registered CSI driver was observed; this does not establish whether initiator packages exist on nodes or whether NAS block storage could be provisioned later.
- Five nodes, `bletchley001` through `bletchley005`: all Ready, Linux ARM64, Ubuntu 24.04.3 LTS, kubelet `v1.33.6`; Raspberry Pi kernels `6.8.0-1056-raspi` or `6.8.0-1057-raspi`.
- PostgreSQL PVC `postgresql-data` is Bound, RWO, 10Gi, class `managed-nfs-storage`, PV `pvc-dda5d76c-1484-4b14-8f26-c76350e2b5ec`, an NFS source on `lynott`.
- PostgreSQL StatefulSet has desired/current/updated/ready replicas all 1. Its live pod template has no node selector or affinity and no hostPath volume; it references the named PVC. Readiness confirms workload status, not a database integrity or filesystem-durability test.

Commands used explicit `--context=kubernetes-admin@kubernetes --request-timeout=10s` and read-only `get` for StorageClasses, PVs, CSIDrivers, nodes, the named PostgreSQL PVC, and its StatefulSet. PV/node/workload results were filtered to relevant metadata; no logs, workload file contents, Secrets, CSI credentials, or vault data were inspected.

## Existing NFS evaluated first

### Read-only node prerequisite and mount inspection

SSH using the repository's Ansible inventory addresses and `ubuntu` user succeeded on all five nodes with existing authentication. Connections used `BatchMode=yes`, `StrictHostKeyChecking=yes`, and a bounded timeout; no host-key bypass, sudo, package installation, service mutation, iSCSI discovery/login, or workload file reads were performed.

On **all five nodes**:

- `open-iscsi` is installed, version `2.1.9-3ubuntu5.4`; `iscsiadm` exists at `/usr/sbin/iscsiadm`.
- `nfs-common` is installed, version `1:2.6.4-3ubuntu5.1`.
- `multipath-tools` is installed, version `0.9.4-5ubuntu8`. Installation does not establish active/configured multipath or a driver requirement for it.
- `iscsid.service` reports **inactive** and **disabled**. Follow-up read-only checks on 2026-10-12 establish `iscsid.socket` is **active** and **enabled** on all five. Socket activation means the inactive service alone does not establish a missing activation prerequisite. No service was started or enabled; actual target-login behavior was not tested.
- `modinfo -F filename iscsi_tcp` resolves a module in the matching `6.8.0-1056-raspi` or `6.8.0-1057-raspi` kernel tree. Follow-up `/sys/module/iscsi_tcp` checks show it is not currently loaded on any node. No module was loaded; attach behavior remains untested.
- Unprivileged checks did not establish initiator IQNs. No sudo access or credentials/session configuration was read to pursue that check; unique initiator identity remains a later gate.

`findmnt` was restricted to NFS filesystem type/options, omitting workload source/target paths. Workers `bletchley002`–`bletchley005` show existing `nfs4` mounts with `vers=4.1`, `hard`, `proto=tcp`, `sec=sys`, `local_lock=none`, `rsize=131072`, `wsize=131072`, `timeo=600`, `retrans=2`, and NAS server address `192.168.0.43`. No NFS mount was shown in the control node's inspected mount namespace. These observations establish current negotiated worker mount options, not NAS export policy, failover-safe locks, client cache correctness, directory-sync guarantees, or power-loss durability.

The prerequisite packages are therefore present; any required service activation/configuration remains a later authorized implementation step. No worker disks were investigated as durable storage candidates.

| Durable data | Source-level assessment | Remaining evidence |
|:--|:--|:--|
| Vault files and LiveSync snapshot | Existing NAS NFS architecture is a candidate; watcher/reconciliation and snapshot durability remain untested. | Polling/event visibility, atomic rename, missing-mount guards, disposable-vault round trips, backup/restore. |
| LiveSync LevelDB/JSON/settings | No explicit blanket NFS ban found in the scoped pinned documentation. Requires functioning `fcntl` record locks, file/directory sync, rename semantics, exclusive ownership, and recovery behavior. | Exact export/mount/client semantics, lock recovery and NAS durability; pilot crash/reconnect tests. |
| Cortex index/OAuth SQLite | Both initializers request ordinary WAL. SQLite explicitly excludes ordinary WAL over network filesystems; pinned Cortex exposes no WAL-off/exclusive-mode/backend setting. | Do not accept unchanged Cortex state on the NFS PVC simply because a basic smoke test passes. Evaluate NAS-backed block presentation or a separately validated application/access-layer change. |

Neither application exposes a supported external PostgreSQL replacement for its embedded state at the reviewed pin. Existing PostgreSQL cannot simply substitute for those databases.

## Conditional NAS-backed block investigation

### Human-supplied DSM evidence

The human reports **DSM 7.3.2-86009 Update 4** and supplied screenshots of SAN Manager and Storage Manager:

- SAN Manager is available and reports Healthy, with **zero LUNs**. The overview shows **zero connected iSCSI sessions**; follow-up human inspection confirms **no configured iSCSI targets**.
- A further Storage Manager screenshot establishes **Btrfs** on both volumes: Volume 1 total 1.9TB; Volume 2 total 986.9GB. NAS Btrfs does not establish the filesystem that a future node would mount inside a LUN, or validate SQLite WAL over NFS.
- Storage Pool 1 is Healthy, SHR with one-drive fault tolerance, 14.5TB total, 3TB allocated and 11.5TB free at the pool level.
- Volume 1 (`kubedata1`) is Healthy: 773.7GB used, approximately 1.2TB free. Volume 2 (`Family Backup`) is Healthy: 35.9GB used, 951GB free. Pool-unallocated capacity is distinct from currently available volume capacity; no expansion or allocation is approved by these observations.
- Five 3.6TB HDDs and two 372.6GB SSD cache devices are shown Healthy. Cache read/write mode, power-loss protection, UPS status, and flush behavior are not established by the screenshots.
- On 2026-10-12, the human reports a UPS is present and believes SSD Cache 1 is read-write. Treat cache mode as **tentative** pending its details view; DSM UPS integration/safe shutdown, UPS health/runtime, SSD power-loss protection and end-to-end flush behavior remain unverified. UPS presence does not replace correct FUA/flush settings or fencing.

#### Follow-up human screenshots and power clarification (2026-10-18)

- HDD/SSD view identifies five Healthy Seagate `ST4000VN008-2DR166` HDDs and two Healthy Synology `SNV3400-400G` SSDs assigned to SSD Cache 1. Both SSDs show 372.6GB, firmware `ECEM12.4`, and Normal estimated endurance. Serial numbers are intentionally not transcribed. This view does **not** establish cache mode or SSD power-loss protection; the earlier read-write report remains tentative.
- UPS panel shows **Enable UPS support unchecked** and **No UPS is connected**. The human reports the NAS is powered through a CyberPower **1350PFCLCD**, but DSM has no automatic outage awareness; shutdown would depend on human intervention. This supersedes the earlier unknown DSM-integration status. Battery runtime/health, network-equipment power coverage and automatic safe shutdown are not established. Battery-backed power is not proof of acknowledged-write survival through battery exhaustion or abrupt power loss.
- SAN Manager General settings show **Low-Capacity Write unchecked**. No capacity-exhaustion behavior was tested.
- iSCSI Service settings show I/O queue depth **64 (Default)** and **Global iSCSI CHAP unchecked**. The UI states global CHAP applies to connection and discovery sessions and overrides individual target CHAP settings. This is an observed global setting, not proof of any existing target's authentication policy.
- The unsaved LUN creation wizard offers **Thick Provisioning** and **Thin Provisioning**, with Volume 1 available capacity **1188GB**. The thick-provisioning view explicitly states that thick-provisioned LUNs do not support snapshots or space reclamation. These are offered UI capabilities, not an allocated LUN or a selected provisioning policy; no thin-provisioning snapshot behavior was established by these screenshots.
- The unsaved target wizard offers **CHAP** and **Mutual CHAP**. This establishes UI availability, not configured authentication or support in the reviewed CSI driver. Initiator restrictions, session controls and FUA/Sync Cache attributes are not visible in the supplied screens and remain unknown.

No creation confirmation or applied settings are shown. Cancel/close the creation wizards without completing them; no target/LUN creation or settings changes are authorized by this investigation.

#### Human UPS integration update (2026-10-18)

The human subsequently connected the UPS to the NAS by USB and reports enabling UPS support. The new screenshot shows **Enable UPS support checked**, type **USB UPS**, and **Until low battery** selected as the condition for DSM Standby Mode. Device Information reports **Connected** and **100%** battery charge; its displayed Manufacturer field is `CP1350PFCLCD` and Model field is `CRCA102-3I1`. The UPS shutdown option and network UPS server option are unchecked.

This supersedes the earlier disconnected/disabled observation: USB communication and human-reported enablement are now evidence. The screenshot alone does not establish whether Apply was committed; the human reports enabling it. No outage, low-battery transition, DSM standby/recovery or UPS shutdown test was performed. Charge percentage does not establish battery health or available runtime. Automatic outage awareness is now present through the connected USB device, while actual protective behavior, storage flush durability and network-equipment power coverage remain unverified. This was a human-performed configuration change, not an agent action or storage-provisioning approval.

#### Confirmed SSD cache configuration (2026-10-18)

The subsequent Storage Manager Volume 1 screenshot explicitly establishes SSD Cache 1 is **Healthy**, **Read-write cache**, **RAID 1 (With data protection)**, with **Pin all Btrfs metadata: Enabled** and approximately **372GB total** cache capacity. This supersedes all earlier tentative/unknown cache-mode statements. DSM also reports **Not the latest version** for the cache; the screenshot does not explain the version difference or establish a required remediation. No cache upgrade, removal or reconfiguration is authorized here.

RAID 1 establishes the displayed cache redundancy configuration, not SSD power-loss protection or acknowledged-write survival. SSD hardware protection, end-to-end FUA/flush behavior and actual UPS standby/recovery behavior remain separate evidence gates.

These observations establish SAN Manager availability, available capacity, Btrfs volume filesystems and absence of configured LUNs/targets, not a provisioned block backend, supported LUN type, filesystem compatibility, or recovery/backup guarantees. Node initiator packages/module availability are established above; service activation, applicable LUN capabilities and driver compatibility still require evaluation. No LUN or target should be created during this evidence task.

Cortex's actual WAL restriction, rather than a blanket database rule, justifies investigating NAS-backed block storage. All physical durable backing must still be Synology; a node-mounted filesystem over a NAS LUN is not permission for worker-local PVs, hostPath, or permanent node pinning.

Earlier [storage research](https://github.com/bpafoshizle/home-kube-setup/blob/2a051284889d6bd8d27575955aa7b54b299f3c87/docs/kube/research/OBSIDIAN_STATE_STORAGE.md) records conditional Synology iSCSI/CSI options and ARM64 artifact evidence, not an observed installed solution. Its worker-local recommendation is superseded by the map's NAS-only boundary. The human-supplied evidence above now establishes DSM version, SAN Manager availability, capacity and absence of LUNs/targets; node inspection establishes prerequisite package/module availability. Specific LUN capabilities and exact driver compatibility remain unverified. No agent NAS session, LUN creation, login to a target, package installation, or driver installation was attempted.

Evidence checklist (items 1–4 now have the observations above, with effective worker NFS mount options; NAS export policy and untested behavior remain unknown):

1. StorageClass provisioners/default annotations, volume binding modes, reclaim policies, and mount options.
2. Relevant PV source **types**, source drivers, access modes, node affinity and mount options; relevant PVC binding/storage class. Filter out CSI secret references/opaque volume attributes and avoid dumps containing credentials or unrelated workload data.
3. CSI driver names and attachment capabilities; node OS/architecture and Ready state. Do not investigate worker disks as storage candidates.
4. Existing authorized node/package metadata for NFS/iSCSI initiator prerequisites; no installing packages or mounting test storage during this read-only ticket.
5. Human-only DSM/SAN inspection if needed: model/DSM version, SAN Manager availability, supported target/LUN types, non-secret capacity, existing applicable target configuration, snapshot/backup and flush/power-protection capabilities. Do not expose CHAP credentials or provision anything.
6. Verify the exact proposed driver's release, Linux ARM64 artifacts and Kubernetes/node compatibility against primary documentation before a decision. Earlier registry evidence does not validate a different release or runtime.

## Pilot acceptance gates, not work performed here

- Separate per-vault durable roots for vault, sync state, and Cortex state; account for JSON/settings/snapshot, both SQLite databases and WAL state.
- Validate exact image/native dependencies and actual SQLite PRAGMAs using synthetic state only.
- Establish single-owner lifecycle/fencing; no forced reschedule while an old writer may exist. RWO and a single replica are not fencing.
- Test filesystem locks/sync/rename, partition/reconnect, orderly restart and crash, mount-loss guards, and manual fenced node recovery on the selected NAS-backed presentation.
- Validate watcher behavior, API-only writes, sync round trips, offline deletions/conflicts, and Cortex operations on a disposable vault.
- Demonstrate independent, consistent backup/restore including OAuth revocation/refresh state; document acknowledged-write loss boundaries. A synchronized copy is not a backup.

This ticket remains open until the accessible inventory and conditional NAS-block evidence are recorded, or the human explicitly changes its completion scope. No pilot runtime gate has passed, and no deployment or live-vault cutover is authorized by these notes.

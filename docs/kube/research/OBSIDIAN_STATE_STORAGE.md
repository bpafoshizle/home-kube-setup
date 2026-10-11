# Durable non-NFS state for the headless Obsidian service

Research date: **2026-10-11**. Research only: no installation, provisioning, deployment, cluster mutation, secret read, context change, or runtime acceptance test.

Context: [Which durable non-NFS state storage is viable on the home cluster?](https://github.com/bpafoshizle/home-kube-setup/issues/68), child of [Headless Obsidian vault service — execution Wayfinder](https://github.com/bpafoshizle/home-kube-setup/issues/67). The map fixes vault files on Synology NFS, one exclusive service owner per vault, initially manual node-failure recovery, and one disposable pilot before explicitly approved onboarding of one real vault. This report informs, **but does not make**, the storage-backend decision.

## Answer and recommendation for the later decision

Two credible non-NFS families fit the requirement:

1. **Node-local filesystem state through static local PVs/PVCs**, preferably on a verified dedicated SSD, with node affinity and independently stored, tested backups. Lowest new infrastructure burden for one pilot/one real vault. Pod replacement on the same healthy node preserves state; node failure means downtime until repair, disk relocation, or backup restore. Kubernetes does not replicate this data. [Kubernetes local volumes][volumes]
2. **Synology iSCSI LUNs, formatted and mounted as Linux filesystems**, exposed through static iSCSI PVs or the official Synology CSI driver. State can outlive a Pi and be manually reattached to a different verified initiator after fencing the old owner. This is block storage over a network, not SQLite/LevelDB files on a network filesystem. It adds NAS/initiator/driver configuration and retains NAS/network dependencies. [Kubernetes iSCSI volumes][volumes], [Synology CSI][synology]

**Conditional initial recommendation:** prefer static local PVs on a verified reliable worker-node disk if accepting restore-based recovery and a backup-sized recovery point. If only worn boot SD cards are available, do not turn that recommendation into production approval: evaluate acquiring reliable local media or using NAS iSCSI instead. Prefer iSCSI if retaining the latest surviving state across Pi loss matters enough to justify its setup/maintenance burden. Neither has been demonstrated ready on this cluster; there is no observed available non-NFS StorageClass.

Do not select an omitted/default StorageClass and hope it is local. Do not use `emptyDir`, the container writable layer, NFS/SMB database directories, or multi-node ext4 mounts as substitutes. No automatic failover/HA is required or claimed.

## What is established, and what is not

Repository facts below are pinned to base commit `27cb9f8184abcd1f15b8251ef97c036f10c4ec12`, not assertions about current live configuration.

| Subject | Evidence and limit |
|:--|:--|
| Compute | [README][repo-readme] describes Raspberry Pi 4s, 8 GB models, Ubuntu 22.04, kubeadm and Flannel. [Inventory][inventory] lists five Pi-tagged Kubernetes machines. README and inventory disagree on bletchley002's role; neither establishes current labels, taints, schedulability, architecture, memory, or Kubernetes version. ARM64 is the task's target, not a newly observed node fact. |
| NAS | [Inventory][inventory] records `lynott` as Synology “1520+” running DSM. This is model evidence, not verification of installed DSM version, SAN Manager, LUNs, free capacity, filesystem, RAID health, snapshots, UPS, or iSCSI service. |
| Existing provisioner | [Maintenance][maintenance] documents Synology NFS and nfs-subdir-external-provisioner. [class.yaml][nfs-class] defines `managed-nfs-storage`, provisioner `k8s-sigs.io/nfs-subdir-external-provisioner`, `archiveOnDelete: "true"`; that file has no default-class annotation and no explicit reclaim policy. The local headless proposal describes NFS as the current default, but this review cannot confirm the live default. Archiving on claim deletion is not versioned backup. |
| Local media | [Maintenance][maintenance] includes `/dev/mmcblk0p2` disk checks and an SD-card failure/recovery section, including SQLite WAL-related failure symptoms. This establishes an operational concern/history, not that every node currently uses SD-only storage. No dedicated SSD, spare partition, mount UUID, capacity, or disk health was verified. |
| Live inventory | Existing `kubectl get storageclasses -o json --request-timeout=10s` failed immediately with **“no route to host”** to the configured API endpoint. No auth/context change or connectivity repair was attempted. Installed classes, defaults, PVs, CSI drivers, node disk topology, iSCSI initiators and current scheduling constraints are **unknown**, not absent. |
| Application packaging | Existing local source reviews establish ARM64 packaging intent, not a passing storage/runtime trial. Cortex source checkout was verified at `7e59246738a69e43bb92dad1f7331a8da3c607e4`; storage details below were directly inspected. |

Source context read, without changing the original working tree: `docs/kube/OBSIDIAN_HEADLESS.md` and `docs/kube/OBSIDIAN_HEADLESS_RESEARCH.md` in `/Users/bpafoshizle/github/local/home-kube-setup`. These are unpublished local context assets, so this report cites public pinned upstream evidence instead of presenting broken repository links to them.

## What needs persistence

| State | Source-derived requirement and recovery consequence |
|:--|:--|
| LiveSync positional database root | Node PouchDB uses LevelDB; the root includes replicated documents/chunks/checkpoints plus `.livesync/runtime/local-storage.json`, `.livesync/runtime/keyvalue-db.json`, and normally `.livesync/settings.json`. Preserve the **whole root**, not just settings or selected `.ldb` files. [PouchDB wiring][pouchdb], [paths][hub], [CLI settings][main] |
| LiveSync scan bookkeeping | The JSON key-value store is synchronously rewritten, with load failures falling back to an empty map. Scan history influences offline deletion interpretation. State loss is not an automatically safe “cache reset.” The vault-side `.livesync-snapshot.json` still resides on the vault filesystem even when DB state is separate. [JSON store][kv], [scanner][scanner], [vault snapshot][watcher] |
| Cortex data directory | Server defaults to `/data/search.db` and `/data/oauth.db`; `INDEX_DB_PATH` moves search DB and determines OAuth DB's parent directory. Both databases explicitly use WAL. Search uses `synchronous = NORMAL`, so a committed change can be lost after power failure even on a persistent volume. [server][cortex-server], [search][cortex-search], [OAuth][cortex-oauth], [SQLite WAL][wal] |
| Cortex search vs authentication | Much search content is derived from vault files, but the search DB also has memory/trash-related tables: do not assume the entire database is disposable without checking enabled features. OAuth persists clients, refresh tokens, revocations, consumed refresh tokens and revoked clients. Losing it can require reauthorization and losing/rolling back revocation history is security-relevant. [search schema][cortex-search], [OAuth schema][cortex-oauth] |
| Configuration/security | LiveSync settings contain CouchDB/encryption configuration; Cortex OAuth state is tied to its authentication configuration. Store/restore required credentials separately using an approved secret mechanism; this research did not inspect them. Never expose sync state to the API container or state/backup contents to agent clients. [CLI settings/setup][main], [Cortex server][cortex-server] |

LevelDB permits **one process** per database, enforced by an OS lock. SQLite WAL requires shared memory on one host and explicitly does not work on a network filesystem. A single-owner local ext4 filesystem on an exclusively attached iSCSI device meets the filesystem topology requirement; merely changing NFS to SMB does not. This is a topology justification, not proof of crash durability on a particular NAS/LUN/cache configuration. [LevelDB concurrency][leveldb], [SQLite WAL][wal]

Use separate per-vault state roots and container-specific mounts. Two state PVCs are a clear default proposal (sync/API), but a single non-NFS filesystem with isolated subdirectories and correctly scoped mounts is also possible. With two node-local PVs the pod must be schedulable on the **intersection** of both PV node affinities; create them on the same chosen node. A raw `volumeMode: Block` device is not what these file-based applications consume: request **Filesystem** over local or iSCSI block backing. [Kubernetes volume modes/access][pv]

For the static-local proposal, define an explicit non-default class using `kubernetes.io/no-provisioner` and `WaitForFirstConsumer`, with statically prepared `local.path` PVs, required hostname node affinity, `Retain`, and explicit `storageClassName` in both claims. Kubernetes recommends delayed binding so storage and other scheduling constraints can be evaluated together. Requested PV capacity is not evidence of an enforced per-directory quota: monitor the real filesystem and reserve space for WAL/compaction/backup staging. These are proposed implementation settings, not manifests applied here. [Local volumes][volumes], [local StorageClass][localclass]

## Candidate comparison

| Candidate | Replacement pod | Node loss | Setup / principal risk | Assessment |
|:--|:--|:--|:--|:--|
| Static local PV on dedicated mounted disk/directory | Same PVC and healthy backing disk retain data; scheduler follows PV node affinity. | No automatic relocation. Repair node, physically move intact media with deliberate PV rebinding, or restore to new media. | Low infrastructure burden; manual disk/mount preparation, capacity/permissions monitoring and backups. Missing disk mount must not silently become an empty directory on boot media. | Best minimal starting candidate **if reliable media is verified**. |
| Static local PV on boot SD/root filesystem | Same persistence semantics while card survives. | Card failure can lose state and affects node OS as well. | Lowest immediate hardware effort, but shares disk pressure/wear/failure domain with OS; repo documents SD failures. | Disposable pilot possible with explicit loss tolerance; not preferred for real-vault state. |
| Rancher Local Path Provisioner | Dynamically creates node-local PVC backing; data survives pod recreation. | Still node-local; adding a provisioner does not add replication. | New controller/helper lifecycle; defaults can remove backing data when PVC is deleted, requested capacity currently is not enforced. Must configure target disk/path, affinity, reclaim and mount guards. | Viable convenience later, not necessary for two small manually managed vault deployments. [Upstream README][localpath] |
| Direct pinned `hostPath` directory | Survives same-node pod replacement if disk remains. | A rescheduled pod can see unrelated/empty path; explicit required node affinity needed. | Host filesystem exposure; weaker PV ownership/lifecycle visibility. `DirectoryOrCreate` can hide a missing mount. | Technically possible, but prefer a local PV; Kubernetes itself recommends local PV over hostPath. [Volumes][volumes] |
| Static pre-created Synology iSCSI LUN/PV | Reuses LUN/filesystem; pod replacement does not erase it. | Manually fence old node/session, then attach same LUN to eligible replacement node; NAS data can survive Pi loss. | Manual LUN/target/initiator provisioning and identifiers; filesystem recovery and exclusivity; no dynamic provisioner required. NAS/network outage still stops service. | Credible fallback if CSI maintenance is unwanted; not already established as configured. [Volumes][volumes] |
| Official Synology CSI, iSCSI + ext4 | PVC-backed filesystem persists, subject to retain/delete lifecycle. | Driver can manage attach/mount, but safe takeover still requires old writer fenced. | Privileged node component, NAS management credentials/API, host iSCSI dependencies, sidecars, version/ARM64 testing, thin-pool monitoring, optional snapshot controller. | Credible non-NFS NAS-backed option; conditional readiness, not a drop-in proven backend. [CSI README][synology] |

Distributed replication stacks are not required to answer the initial manual-recovery need and would add another storage system and multi-node disk/capacity/maintenance requirements. This report does not establish their hardware prerequisites or recommend them for this pilot. Existing NFS-hosted CouchDB persistence is not evidence that Cortex WAL or LiveSync state should use the same class, and changing existing CouchDB is out of scope.

## Synology/block feasibility: concrete evidence and gates

The official driver documents DSM **7.0+**, an initialized storage pool/volume and worker-to-NAS connectivity; iSCSI is the default protocol, with ext4/xfs filesystem options, clone/expand/snapshot support. Installing the upstream script can create a **default** `synology-iscsi-storage` class with `Retain`—a later rollout must avoid inadvertently changing the cluster's existing default. Snapshot support needs the snapshot CRDs/controller; neither was observed installed. The NAS model inventory plus this software path supports **conditional feasibility**, not proof that this NAS currently has SAN capacity or the required configuration. [CSI README][synology], [v1.2.0 README][synology-120]

First-party registry metadata was read without pulling/running images:

```text
docker buildx imagetools inspect synology/synology-csi:v1.2.0
index: sha256:f2fca28076a61b836e0b0527bc121ee8143968db08e15a515769e95ccbcee05a
linux/arm64: sha256:c867d4e9e49daec669db1e10609f5d12471ec954f0f20352eb0bc889371aa498
also advertises linux/amd64 and linux/arm/v7
```

This establishes an available ARM64 driver artifact, **not** an endorsed version or working complete CSI deployment. The current source README advertises `v1.4.0`, but inspection of `synology/synology-csi:v1.4.0` returned **not found**. Current source at `02af05d973c19cf7b91802452afe7271bd6a7400` also uses a UBI9 Dockerfile explicitly warning that its runtime-tool build needs RHEL entitlement; its CI builds a binary, not an ARM64 NAS attachment test. Do not equate current `main` source, old published images and advertised tags. Select and audit a real immutable release, all required sidecars and host tooling before deployment. [Registry][registry], [Dockerfile][synology-docker], [CI][synology-ci]

Important safety details from inspected current source (must be rechecked for the selected release):

- The driver advertises `SINGLE_NODE_WRITER` and `MULTI_NODE_MULTI_WRITER`, **not a verified `SINGLE_NODE_SINGLE_WRITER`/RWOP guarantee**. Controller code enables multi-session for multi-node multi-writer requests. Never request RWX and mount ordinary ext4/xfs read/write from different nodes for these applications. The README's “Read/Write Multiple Pods” is not database or clustered-filesystem safety. [driver capabilities][synology-driver], [controller][synology-controller]
- `enableFuaSyncCache` controls LUN flags `emulate_fua_write` and `emulate_sync_cache`; README default is **false**. Validate the chosen release, LUN flush/FUA behavior, write cache, power protection and filesystem settings before claiming power-loss durability. Do not infer that an acknowledged write has reached durable media because storage is on a NAS. This is an identified review gate, not an instruction to mutate existing LUN flags. [controller][synology-controller], [CSI parameters][synology]
- The driver calls `iscsiadm` to discover/login/logout and documents privileged root node operations, host chroot and mounting. Node initiator tools/services, unique initiator identities, network reachability, SAN ACLs and stale-session cleanup must be confirmed on **each eligible ARM64 worker**. [initiator][synology-initiator], [CSI installation notice][synology]
- Thin provisioning needs free-pool monitoring; snapshots/Retain are not an independent backup, and state plus vault on one Synology share a NAS failure domain. NAS-local snapshots may improve recovery from mistakes but do not survive NAS loss. [CSI thin LUN/snapshot documentation][synology]

Static iSCSI is a separate viable route: create an isolated LUN/target outside this research, record portal/IQN/LUN and filesystem identity, use a static filesystem PV and explicit retention/claim binding. All eligible nodes need usable initiators. Do not format an existing LUN as part of takeover, mount it simultaneously on two hosts, or treat SAN access control as a complete application writer fence. [Kubernetes iSCSI][volumes]

## Exclusive ownership is independent of persistence

Proposed common contract for either backend:

1. One per-vault service pod/replica, one LiveSync process per sync root and one Cortex process per API root. Mount each state root only into its owner; maintenance CLI/backup operations must not open LevelDB concurrently with its daemon. [LevelDB][leveldb]
2. Prevent routine rolling overlap (for example, `Recreate` plus graceful shutdown) but do not call this failure fencing. `replicas: 1` and a desired pod count are not proof an old partitioned node has stopped.
3. RWO means **one node**, not one pod or process. RWOP can provide single-pod access only for supporting CSI drivers/sidecars; it does not mean arbitrary processes within that pod are safe or an isolated physical writer has been powered off. Native local/static iSCSI PVs cannot claim CSI-only RWOP support. [Kubernetes access modes][pv]
4. Before node-loss takeover, establish physical or equally reliable fencing: old node powered off/disconnected from relevant storage, or confirmed process termination and storage access/session revocation. `NotReady`, deleting a Pod object, or force-detaching alone is insufficient evidence. Stop the old **vault writer** too, not just its state mount, because both services can write to the NFS vault.
5. Retain state PV/LUN assets and deliberate PVC reuse across upgrades/uninstalls; inspect actual reclaim policy before deletion. `Retain` reduces accidental automatic deletion, but is not a backup or a restore procedure. [PV reclaim lifecycle][pv]

Items 1–5 are operational requirements proposed for this service, not claims that Kubernetes or these applications already implement end-to-end fencing.

## Manual recovery contract candidates

These are contracts to approve and test, **not executable runbooks** for an unselected backend.

| Contract | Meaning / data-loss boundary |
|:--|:--|
| A: local disk, wait/repair | After node outage keep the vault service stopped, fence as needed, repair the same node/disk and restart with unchanged state/PVC. No predetermined RTO; accept repair duration. Disk failure still needs contract B. |
| B: local disk, move/restore | Fence old node; preserve any readable media; choose a verified new node/disk. Move intact disk or restore the last consistent backup into isolated state roots, then deliberately recreate/rebind local PV identity/affinity. Backup restore loses changes since the checkpoint; moving an intact disk may retain newer state. Never “fix” affinity to point at a different node with an empty same-named directory. |
| C: NAS iSCSI, manual reattach | Fence old node and its vault/state access; verify no conflicting iSCSI session/mount. Reattach **the existing** LUN to a tested replacement worker, inspect/recover its filesystem while applications remain stopped, reuse state and verify startup. Pi loss need not lose LUN data; NAS/LUN failure or corruption still requires independent backup restore. Flush/cache and application settings define crash-loss exposure. |
| D: state lost, explicit rebuild | Last resort, not transparent failover. Preserve/backup NAS vault and CouchDB before reconciliation. Bootstrap a fresh isolated LiveSync root and validate against synthetic/restore data first; loss of scan history changes interpretation. Reindex Cortex only after identifying non-derived features; reset OAuth/auth as a deliberate security/client-reauthorization operation. Never automatically run normal reconciliation on an empty/missing vault mount. [scanner][scanner], [Cortex schemas][cortex-search] |

All contracts require a recorded vault ID, namespace/workload, owning node or LUN identity, state PVC/PV identities, selected image/config versions, restore checkpoint and operator/fencing evidence. Restore into scratch first when uncertain; do not use the real vault as a recovery experiment. Mount identity/expected-vault sentinel must gate startup, including the local state disk where a missing mount might otherwise expose an empty root directory.

**RPO/RTO are not yet selected.** For local restore, RPO is the last verified consistent checkpoint, not “CouchDB will have everything.” RTO includes fencing, replacement media/node preparation, restore/rebind and validation. For surviving iSCSI state, node replacement may avoid backup rollback but does not promise zero loss after sudden power failure. Agree a maximum tolerated backup age, outage duration, backup retention and named recovery owner before real-vault approval.

## Backup and restore requirements

- Prefer a simple initial **quiesced checkpoint**: deny API writes, stop both owning processes gracefully, verify they exited, and capture the entire sync root, Cortex data directory, vault contents including vault-side sync bookkeeping, plus a reference to securely recoverable configuration and image versions. Remote human peers may still change CouchDB: record that boundary and coordinate writers for a point-in-time cutover/restore. Cross-system transaction consistency is not supplied by these volumes.
- Do not copy a live LevelDB directory or just `search.db`/`oauth.db` while WAL writers run and call it a consistent backup. SQLite's Online Backup API or `VACUUM INTO` can produce valid individual online DB backups, but that alone does not make a coordinated vault/LiveSync/OAuth checkpoint. Preserve WAL files if recovering a crashed database; SQLite explicitly treats WAL as part of persistent state. [SQLite backup][backup], [WAL file lifecycle][wal]
- Backups may be stored as archives on the NAS even though **active** DBs must not run on NFS. For NAS iSCSI, add an independent/off-NAS protected versioned copy; otherwise vault, state and “backup” can all disappear together. Do not confuse synced CouchDB/vault copies, PVC retention, or NAS snapshots with independent backup.
- Encrypt/access-restrict backups: vault plaintext, sync settings and OAuth data are sensitive. Retain multiple versions, checksum inventory, record backup freshness and disk/pool usage; do not log or commit contents. Restore OAuth carefully: old backups can resurrect previously revoked authorization state. Prefer an explicit auth reset/key rotation with client reauthorization if revocation continuity cannot be established; do not assume preserving the old signing configuration makes rollback safe. [OAuth persisted revocations][cortex-oauth]
- Demonstrate restore to an isolated disposable environment using synthetic notes, verify note hashes/attachments, successful sync and OAuth behavior, and show the procedure works without the original node. Only then schedule the human-approved real-vault cutover. No such tests were run here.

## Remaining evidence to gather before selection/implementation

Read-only when existing cluster/network access is available, without reading secrets:

1. Enumerate StorageClasses including default annotation, provisioner, binding mode/reclaim policy; PV source types/affinity and installed CSI driver names; live node versions/architecture/Ready/taints/labels. Reconcile inventory role drift.
2. Through separately authorized read-only host inventory, verify actual `lsblk`/mount filesystem/device UUIDs, spare reliable media, free space/health, power protection, and which worker can host both local state roots. Kubernetes API alone cannot establish physical disk reliability.
3. Confirm NAS model and DSM version/SAN package, available pool/volume capacity, iSCSI target/LUN capabilities and settings, networking/ACLs, snapshots/versioned backup/off-NAS destination. Do not access credentials or arbitrary vault content to answer these facts.
4. For iSCSI, choose an audited published ARM64 release/digest and compatible sidecars; inspect its actual capabilities/flush settings; confirm initiator tooling/identity on eligible workers. The available `v1.2.0` metadata is evidence, not a version selection.
5. Human decision: reliable local disk + repair/restore contract versus NAS block + reattachment contract; acceptable RPO/RTO, backup cadence/retention, auth rollback policy and recovery owner.

Disposable-pilot acceptance gates for either selected backend: graceful pod replacement retains both state roots; missing vault/state mount fails closed; claim deletion safeguards are known; old-owner fencing is demonstrated; controlled node-loss recovery/restore preserves synthetic notes without unintended deletions; index/auth restore is tested; capacity and backup freshness are observable. Tests must not force replacement while an old writer could remain active. These are future gates, not authorization to provision or deploy.

## Primary evidence

Official documentation was read via browser-harness; GitHub source via authenticated `gh` read calls or existing pinned checkouts; registry via read-only `docker buildx imagetools inspect`. No secondary articles are used to establish feasibility. Kubernetes live docs currently describe newer releases as well; only the cited long-established volume/access semantics are used, not an assumption that this cluster is on that release. Synology product/help URLs redirected to generic pages, so they are deliberately **not** evidence of model-specific SAN support here.

[repo-readme]: https://github.com/bpafoshizle/home-kube-setup/blob/27cb9f8184abcd1f15b8251ef97c036f10c4ec12/README.md
[inventory]: https://github.com/bpafoshizle/home-kube-setup/blob/27cb9f8184abcd1f15b8251ef97c036f10c4ec12/docs/inventory/inventory.yaml
[maintenance]: https://github.com/bpafoshizle/home-kube-setup/blob/27cb9f8184abcd1f15b8251ef97c036f10c4ec12/docs/kube/MAINTENANCE.md
[nfs-class]: https://github.com/bpafoshizle/home-kube-setup/blob/27cb9f8184abcd1f15b8251ef97c036f10c4ec12/kube/nfs-subdir-external-provisioner/deploy/class.yaml
[volumes]: https://kubernetes.io/docs/concepts/storage/volumes/
[pv]: https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes
[localclass]: https://kubernetes.io/docs/concepts/storage/storage-classes/#local
[localpath]: https://github.com/rancher/local-path-provisioner/blob/v0.0.37/README.md
[wal]: https://www.sqlite.org/wal.html
[backup]: https://www.sqlite.org/backup.html
[leveldb]: https://github.com/Level/leveldown/blob/0e332ee8ab92aecdc2fd9985ff8ba7bc46746ae0/deps/leveldb/leveldb-1.20/doc/index.md#concurrency
[pouchdb]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/lib/pouchdb-node.ts
[hub]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/services/NodeServiceHub.ts
[main]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/main.ts
[kv]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/services/NodeKeyValueDBService.ts
[watcher]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/managers/CLIStorageEventManagerAdapter.ts
[scanner]: https://github.com/vrtmrz/livesync-commonlib/blob/f0eb9bc2cf99ec7a3e17973ed65c9711318cf465/src/serviceFeatures/offlineScanner.ts#L1064-L1074
[cortex-server]: https://github.com/aliasunder/vault-cortex/blob/7e59246738a69e43bb92dad1f7331a8da3c607e4/src/vault-mcp/server.ts
[cortex-search]: https://github.com/aliasunder/vault-cortex/blob/7e59246738a69e43bb92dad1f7331a8da3c607e4/src/vault-mcp/search/search-index.ts
[cortex-oauth]: https://github.com/aliasunder/vault-cortex/blob/7e59246738a69e43bb92dad1f7331a8da3c607e4/src/vault-mcp/oauth/oauth-provider.ts
[synology]: https://github.com/SynologyOpenSource/synology-csi/blob/02af05d973c19cf7b91802452afe7271bd6a7400/README.md
[synology-120]: https://github.com/SynologyOpenSource/synology-csi/blob/v1.2.0/README.md
[synology-docker]: https://github.com/SynologyOpenSource/synology-csi/blob/02af05d973c19cf7b91802452afe7271bd6a7400/Dockerfile
[synology-ci]: https://github.com/SynologyOpenSource/synology-csi/blob/02af05d973c19cf7b91802452afe7271bd6a7400/.github/workflows/ci.yaml
[synology-driver]: https://github.com/SynologyOpenSource/synology-csi/blob/02af05d973c19cf7b91802452afe7271bd6a7400/pkg/driver/driver.go
[synology-controller]: https://github.com/SynologyOpenSource/synology-csi/blob/02af05d973c19cf7b91802452afe7271bd6a7400/pkg/driver/controllerserver.go
[synology-initiator]: https://github.com/SynologyOpenSource/synology-csi/blob/02af05d973c19cf7b91802452afe7271bd6a7400/pkg/driver/initiator.go
[registry]: https://hub.docker.com/r/synology/synology-csi

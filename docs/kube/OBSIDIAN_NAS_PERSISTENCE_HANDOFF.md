# NAS persistence evidence — decision handoff

Prepared 2026-10-18 for [Verify NAS-backed persistence and application storage requirements](https://github.com/bpafoshizle/home-kube-setup/issues/75). The next human decision is [Choose persistent state storage and the manual recovery contract](https://github.com/bpafoshizle/home-kube-setup/issues/70). **This is evidence and acceptance criteria, not backend selection or provisioning authorization.**

The companion notes preserve the chronology and boundaries of earlier investigations. Their historical statements about uncommitted/unpublished assets or no tracker writes describe those investigations, not this later publication/handoff. The complete-bundle compatibility audit is still pending at this handoff's initial publication; do not interpret the candidate comparison below as a completed compatibility certification.

## Settled boundary

All durable workload data belongs on Synology: vault contents, LiveSync databases/settings/JSON/snapshot, and Cortex index/auth databases including their WALs. No worker-local persistence, hostPath workload storage, or storage-driven permanent worker pinning. Manual node-failure recovery is acceptable; overlapping writers are not.

## Application-specific result

| Data | Existing NAS NFS | NAS block filesystem |
|:--|:--|:--|
| Vault files and LiveSync snapshot | Candidate; watcher/reconciliation, rename, mount-loss and backup behavior need a disposable pilot. | Not required solely because these files exist. |
| LiveSync embedded LevelDB and JSON/settings | No blanket ban found in scoped pinned source/docs. NFS remains unvalidated for record locking, directory/file sync, metadata ordering and failure recovery. | Candidate if single-owner filesystem and durability gates pass; block presentation does not fix asynchronous application writes or nontransactional JSON. |
| Unmodified pinned Cortex SQLite index/OAuth | Ordinary WAL requested by both initializers conflicts with SQLite's network-filesystem contract. A passing smoke test would not establish support. | Candidate with an ordinary filesystem mounted by exactly one worker and used by the application on that worker. Protocol, filesystem and recovery still need validation. |

Neither pinned application offers a supported PostgreSQL replacement for its embedded state. Existing PostgreSQL-on-NFS is architecture evidence, not proof of LevelDB/SQLite compatibility. Source pins, exact operations, SQLite journal settings and citations are in [application requirements](OBSIDIAN_NAS_APPLICATION_REQUIREMENTS.md).

The Cortex initializer claims were independently rechecked through the GitHub contents API at the same immutable pin on 2026-10-18: search lines 362/376–386 instantiate better-sqlite3 and request WAL, NORMAL synchronization and a 5000ms busy timeout; OAuth lines 93–94 instantiate better-sqlite3 and request WAL. No application runtime or actual database was opened for this check.

## Observed prerequisites and their limits

- Prior explicit-context cluster inventory found five Ready ARM64 Ubuntu 24.04.3 nodes on Kubernetes 1.33.6, one NFS StorageClass, only NFS PVs and no registered CSI driver. This is dated evidence, not fresh inventory or proof of working iSCSI.
- Existing Open-iSCSI tooling, matching-kernel transport module availability and enabled/active iscsid sockets were recorded on all five nodes. Unique initiator identities, actual service activation, login and reconnect behavior are not proven.
- Human inspection established DSM 7.3.2 Update 4, SAN Manager availability, Btrfs volumes, substantial Volume 1 headroom and no configured LUNs/targets at the time inspected. Creation wizards offer thick/thin LUNs and CHAP/mutual CHAP; offered options are not provisioned resources.
- Volume 1 has Healthy read-write RAID 1 SSD cache, using two SNV3400-400G devices. RAID 1 is not evidence of power-loss protection or correct flush propagation.
- The human connected the UPS by USB and reports enabling DSM UPS support. DSM shows Connected, 100% charge and standby Until low battery. Battery health/runtime and protective transitions remain untested.

Detailed provenance, chronology and non-secret observations: [storage evidence](OBSIDIAN_NAS_STORAGE_EVIDENCE.md). No outage test or NAS/cluster mutation was performed by this investigation; the UPS setup was human-performed.

## Two NAS-backed block candidates, neither selected

| Concern | Synology CSI | Administrator-managed static iSCSI |
|:--|:--|:--|
| Provisioning/lifecycle | Adds driver/sidecars, DSM API access and automated LUN lifecycle. Reviewed source has important auth/flush/attachment caveats. | Requires a human-approved, separately created target/LUN and explicit static PV lifecycle ownership. No Synology CSI installation or DSM management credential in driver pods. |
| Authentication | Reviewed v1.3.1 target-create path uses auth_type=0; initiator path does not configure CHAP. DSM TLS is management-channel protection, not data-path authentication. | Kubernetes 1.33.6 iSCSI implementation supports discovery/session CHAP. Secret handling and NAS access control still need approval. |
| Single owner | RWO and attachment status are not backend fencing; reviewed attacher can report attached without a backend publish operation. | Static PV binding and RWO also do not revoke an old writer or stop its reconnect. |
| Operations | More automation, with release-matched ARM64 bundle compatibility and credential exposure to assess. | Fewer components, but manual allocation, monitoring, expansion, backup and recovery responsibilities. |
| Durability | Explicit enableFuaSyncCache=true is implemented for new-LUN creation; effective NAS settings and end-to-end behavior still require validation. | Explicit NAS-side flush/cache choices must be established when provisioning is separately authorized. No attributes have been read back from a real LUN. |

Version-specific source citations and caveats: [block requirements](OBSIDIAN_NAS_BLOCK_REQUIREMENTS.md), [driver caveats](OBSIDIAN_NAS_DRIVER_CAVEATS.md). No global Kubernetes context, active GitHub account, networking, node services or NAS resources need changing to finish this research.

## Decisions for the human storage contract

1. Pick the candidate backend and per-vault root/PVC separation. Do not infer that all data must move to block simply because unchanged Cortex needs block-like filesystem semantics.
2. Define normal stop/update behavior with no overlapping application owners and no writes to bare mountpoints after mount loss.
3. Define positive stale-owner exclusion before mounting a LUN writable elsewhere: an unreachable/NotReady node, pod force deletion or a detached API object is insufficient. A manual process must prevent the former owner from writing **and reconnecting** until ownership is deliberately restored. Exact enforceable mechanism needs approval and validation.
4. Approve target authentication/isolation, initiator identities, client filesystem, flush settings, allocation/headroom alerts and reclaim policy before any target/LUN/PV exists.
5. Define acceptable data-loss/recovery semantics. LiveSync ordinary batches and Cortex NORMAL WAL do not guarantee every acknowledged update survives OS/power failure; OAuth revocations/refresh state need explicit recovery handling.
6. Approve independent consistent backup/restore covering both applications' complete state, not only main database files or synced vault copies.

## Later pilot gates — not tests performed here

- Verify exact container/native versions and effective SQLite PRAGMAs using synthetic data.
- Validate locking, mapping, file/directory sync, rename and missing-mount guards on the chosen presentation.
- Exercise orderly restart, process crash, transport loss/reconnect and approved NAS/worker failure cases without overlapping owners. No destructive power test is implied by this document.
- Demonstrate fenced manual move to another eligible worker and safe return of the former owner.
- Demonstrate disposable-vault synchronization, watcher/reconciliation behavior and required Cortex API operations.
- Restore an independent consistent backup and verify authentication-state recovery and any acknowledged-write loss boundary.

No live-vault access, cutover, driver/package installation or target/LUN creation is authorized by this handoff. If no NAS-backed path passes, consider an application/backend change rather than worker-local storage.

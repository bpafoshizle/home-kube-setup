# Obsidian NAS-backed block requirements

Primary-source research for [Verify NAS-backed persistence and application storage requirements](https://github.com/bpafoshizle/home-kube-setup/issues/75), collected 2026-10-11; node-evidence corrections added 2026-10-12. **Conditional feasibility, not backend selection or installation approval.** This source investigation accessed no nodes, NAS, credentials, or vaults; the separate read-only node checks are recorded in the companion evidence. No storage was provisioned. This note supplements [observed inventory](OBSIDIAN_NAS_STORAGE_EVIDENCE.md) and [pinned application requirements](OBSIDIAN_NAS_APPLICATION_REQUIREMENTS.md).

## Outcome and evidence boundary

**2026-10-18 follow-up:** [Complete basic-YAML source/artifact audit](OBSIDIAN_NAS_COMPATIBILITY_AUDIT.md) now records all core sidecar ARM64 digests, stable manifest/API/RBAC/flag review and a specifically incompatible optional capacity-publishing beta API (disabled in the supplied YAML). It does not establish complete-bundle runtime compatibility. Earlier missing-artifact/audit statements below describe the initial investigation; use the follow-up for current evidence. [Decision handoff](OBSIDIAN_NAS_PERSISTENCE_HANDOFF.md) consolidates choices and remaining gates, including the latest confirmed cache/USB UPS evidence.

An official **Synology CSI v1.3.1 Linux ARM64 image exists**, with an exact artifact identity below. Its own README claims Kubernetes **1.20+** and DSM **7.0+**. That places Kubernetes 1.33.6 and DSM 7.3.2 within the published version ranges, **not within a demonstrated test matrix for this cluster/NAS**. The newer v1.4.0 GitHub release exists, but its Docker Hub image tag returns 404. Do not deploy current-main manifests against a different image or treat an advertised version as a published artifact. [Release][release-131], [README][readme-131], [registry v1.3.1][registry-131], [registry v1.4.0][registry-140].

Static in-tree iSCSI remains present and documented in Kubernetes **1.33**; it is not marked deprecated in that version's storage documentation. It is a manually managed alternative requiring an existing NAS LUN/target, not an installed provisioner or an automatic escape from fencing/backup requirements. [Kubernetes 1.33 docs][k8s-volumes], [v1.33.6 implementation][k8s-iscsi].

| Item | Evidence status | Consequence |
|:--|:--|:--|
| NAS model | **Repository identification:** `lynott` inventory says “Synology 1520+”, consistent with DS1520+. **Live model unverified.** [Inventory](../inventory/inventory.yaml#L70-L80). | Synology's official SAN Manager applicable-model list includes **DS1520+**. This verifies model-family package eligibility, not the identity of the running NAS or CSI qualification of this exact tuple. [SAN Manager][san-package]. |
| DSM/SAN | **Human-reported:** DSM 7.3.2-86009 Update 4; SAN Manager Healthy, no LUNs and no targets. [Observed evidence](OBSIDIAN_NAS_STORAGE_EVIDENCE.md#human-supplied-dsm-evidence). | DSM meets CSI's stated minimum; no block backend currently exists. Exact SAN Manager package version and supported options on this device remain missing. |
| NAS volume | **Human-observed:** Btrfs Volume 1, 1.9TB total and approximately 1.2TB free. | An initialized volume meets a documented CSI prerequisite; free space is not an approved allocation or thin-provisioning safety policy. Pool-unallocated capacity is not current volume-free space. |
| Cluster | **Read-only inventory:** five Ready ARM64 Ubuntu 24.04.3 nodes (one control-plane, four workers), Raspberry Pi kernel 6.8, kubelet 1.33.6. | Driver ARM64 artifact exists; companion checks establish installed initiator tooling and module availability on all five. Socket activation is enabled; actual login/attach and full sidecar deployment remain unverified. |
| Storage today | **Prior inventory:** only NFS provisioner/class; no registered CSI driver. | No CSI installation, iSCSI attach, filesystem durability, or recovery test has passed. Existing NFS is not transformed into block storage by installing a driver. |

The inventory observations above are inherited from the companion evidence file, not fresh access by this research task.

## Exact release and artifact evidence

Public Docker Hub tag APIs were read through a new browser tab. Their returned platform metadata establishes publication; images were **not pulled, executed, signature-verified, or tested** here.

| Official tag | GitHub/source evidence | Docker Hub result |
|:--|:--|:--|
| `v1.4.0` | Published GitHub release 2026-09-15; tag commit `02af05d973c19cf7b91802452afe7271bd6a7400`. [Release][release-140], [tags API][tags]. | **404:** `tag 'v1.4.0' not found`. No verified published ARM64 artifact at this tag. [API][registry-140]. |
| `v1.3.1` | Published release 2026-08-05; tag commit `d6e51755fb09dc8e6979aa4f7e14649158c1b6a3`. Release enables DSM HTTPS certificate verification by default. [Release][release-131], [tags API][tags]. | **200**, active Linux `arm64`, alongside amd64/arm-v7; last pushed 2026-08-05. Exact digests below. [API][registry-131]. |
| `v1.3.0` | Earlier official release. [Release][release-130]. | **200**, Linux `arm64` listed. [API][registry-130]. |
| `v1.2.1` / `v1.2.0` | Earlier official releases; v1.2.1 adds FUA/Sync Cache and space-reclamation settings. [Release][release-121]. | Both **200**, Linux `arm64` listed. This independently reconfirms the earlier v1.2.0 publication finding; it does not endorse staying on that release. [v1.2.1 API][registry-121], [v1.2.0 API][registry-120]. |

Verified v1.3.1 identities:

- Image: `synology/synology-csi:v1.3.1`.
- Multi-platform manifest-list digest: `sha256:8aa84848187648a65c899f54e96061d3f22cdba0ad8926d770b431d4b274406f`.
- Linux ARM64 child digest: `sha256:efabd3fcd4f6e1f7eacb102db167118610c7bf313ed73207ad260364b924db91`.
- Matching source: [`d6e51755fb09dc8e6979aa4f7e14649158c1b6a3`](https://github.com/SynologyOpenSource/synology-csi/tree/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3).

**Viable artifact candidate is not a validated complete deployment.** The v1.3.1 Kubernetes v1.20 manifests also require `csi-node-driver-registrar:v2.3.0`, `csi-provisioner:v3.0.0`, `csi-attacher:v3.3.0`, and `csi-resizer:v1.3.0`; full snapshot deployment adds further components. Their exact ARM64 digests, security/update status, and Kubernetes 1.33 compatibility were not verified here. They must be audited as a set before rollout. [Node manifest][node], [controller manifest][controller]. Go 1.21 is a recommendation for source builds, not a reason to install Go on all workers. [README][readme-131].

The v1.4.0 client-filesystem change (ext4/xfs only; no new client Btrfs formatting) belongs to **v1.4.0**, not to this v1.3.1 artifact. v1.3.1's image build includes ext4, XFS and Btrfs tools. DSM-side Btrfs is a separate layer from the filesystem a worker mounts inside a LUN. [v1.4.0 README][readme-140], [v1.3.1 Dockerfile][dockerfile]. No client filesystem is selected by this report.

### Additional sidecar documentation review (2026-10-12)

The version-tagged upstream READMEs document the following ranges for three supplied sidecars:

| Supplied sidecar | Minimum Kubernetes | Recommended Kubernetes in that version's table |
|:--|:--|:--|
| `csi-provisioner:v3.0.0` | 1.20 | 1.22 |
| `csi-resizer:v1.3.0` | 1.16 | 1.22 |
| `csi-node-driver-registrar:v2.3.0` | 1.13 | Not specified |

Sources: [provisioner v3.0.0 README](https://github.com/kubernetes-csi/external-provisioner/tree/v3.0.0#compatibility), [resizer v1.3.0 README](https://github.com/kubernetes-csi/external-resizer/tree/v1.3.0#compatibility), [registrar v2.3.0 README](https://github.com/kubernetes-csi/node-driver-registrar/tree/v2.3.0#compatibility). A recommended version is **not a maximum supported version**. These tables neither prove failure on Kubernetes 1.33 nor establish a tested/supported complete deployment on it. Do not substitute arbitrary newer sidecars without checking their CSI/RBAC/flag requirements and the resulting bundle. Artifact/security and runtime validation remain separate gates.

## NAS LUN types: documented behavior versus device verification

Synology's SAN documentation describes thin-provisioned LUNs on ext4, thin-provisioned LUNs on Btrfs, and thick-provisioned LUNs. Thin Btrfs LUNs support instant snapshots/restoration; thick LUNs do **not** support snapshots or space reclamation. Thin provisioning can cause a LUN filesystem crash when its hosting volume runs out of space. Model-specific limits apply. [SAN specifications][san-spec], [LUN help][lun-help].

**Documentation-version limit:** the public `version=7` LUN help rendered as DSM 7.4 during this research, and the cited software-specification page is DSM 7.2. These are first-party descriptions, not an archived validation of every DSM 7.3.2 Update 4 option. The exact device/package UI capabilities remain a human-only inspection gate.

The **v1.3.1 source** supplies a more precise implementation map:

| Hosting DSM filesystem | Default thin LUN type | Additional source path |
|:--|:--|:--|
| Btrfs | `BLUN` (source comment: type 263) | `BLUN_THICK` (type 259) if `thin_provisioning` is false. |
| ext4 | `ADV` | `FILE` if `thin_provisioning` is false. |

`CreateVolume` defaults `isThin=true`; `getLunTypeByInputParams` implements that mapping. The README says all CSI-created iSCSI volumes are thin; the source additionally accepts `thin_provisioning` and `type`, neither advertised in its parameter table. **Treat thin as the documented path; do not promote undocumented thick/type overrides to a supported deployment contract without upstream confirmation.** A LUN type appearing in a list API is not proof that every operation supports it. [Controller source][controller-code], [DSM service][dsm-service], [model constants][models], [README][readme-131].

For the observed Btrfs Volume 1, the documented/default CSI path would therefore use a **thin Btrfs-backed `BLUN`**, with the pod seeing files on a worker-mounted block filesystem—not the NAS Btrfs directory exposed over NFS. This is a source-derived conditional path, not a created LUN or a verified DSM capability. Space allocation, snapshot retention/headroom, capacity alerts and low-capacity handling must be decided before any later provisioning.

## Initiator and node prerequisites

Before either CSI or static iSCSI can be considered ready, each eligible worker must have:

1. **Host iSCSI initiator tooling**, not merely `nfs-common`: an Ubuntu-appropriate Open-iSCSI installation providing `iscsiadm`, a functioning `iscsid`/session-management service, valid unique initiator IQN, and usable kernel iSCSI transport/SCSI device support. Companion checks establish `open-iscsi` and `iscsiadm` on all five, matching-kernel `iscsi_tcp` module availability, and active/enabled `iscsid.socket`; `iscsid.service` is inactive/disabled and the module is not loaded. Socket activation means inactive service alone is not proof of a missing service prerequisite. Initiator IQNs were not established without privileged access; no discovery/login was attempted. The driver calls host `iscsiadm` for discovery, login, rescan and logout. [Initiator source][initiator].
2. **Correct host execution/device paths:** the supplied node pod uses `--chroot-dir=/host`; `hostexec` wraps commands with `chroot` and a host PATH. Container-installed filesystem utilities do not supply missing host `iscsiadm`. Device paths under `/dev/disk/by-path` must appear after login. Multipath tools/configuration are conditional on an approved multipath design, not required merely because the NAS has multiple interfaces. [Host executor][hostexec], [node source][node-code], [manifest][node], [Dockerfile][dockerfile].
3. **Network reachability and explicit isolation:** worker-to-NAS TCP 3260 for iSCSI, and CSI components to the configured DSM management endpoint (default HTTPS 5001). Confirm routing/firewall and target/initiator access policy; do not expose either service publicly. A static PV needs the existing portal, IQN, LUN mapping and filesystem type; CSI additionally needs DSM API credentials and controller/driver objects. [Initiator][initiator], [README][readme-131], [static docs][k8s-volumes].
4. **Privileged driver acceptance:** v1.3.1's node DaemonSet is privileged, uses host networking, mounts `/`, `/dev` and kubelet paths, and requires bidirectional mount propagation. These are CSI infrastructure accesses, **not permission to store application state on worker-local `hostPath`**. The current NAS-only workload boundary still applies. [Node manifest][node].

No package installation, service query, module load, discovery/login, mount or privileged pod was performed. Public Ubuntu package-site access timed out, so this report does not claim to have independently verified a specific Noble ARM64 package version.

## Static iSCSI at Kubernetes 1.33

The release-1.33 documentation has an `iscsi` section with no deprecation marker: an **existing** iSCSI volume can be mounted and persists beyond pod removal; the target must already exist. It explicitly prohibits simultaneous writers. Kubernetes v1.33.6 still implements `kubernetes.io/iscsi`, supports PV and raw-block sources, and advertises RWO and ReadOnlyMany. This is distinct from deprecated FlexVolume and from cloud-specific in-tree plugins that were removed. **Do not assert generic in-tree-iSCSI removal/deprecation at 1.33.** These sources establish presence at the requested version, not perpetual future support or successful operation on these nodes. [Versioned docs][k8s-volumes], [versioned source][k8s-iscsi].

A manually created static iSCSI PV/PVC would not require the Synology CSI image or its DSM API credential. It still requires separately authorized NAS target/LUN creation, initiator tooling, portal/IQN/LUN metadata, access control/CHAP if used, explicit reclaim/ownership policy, and a single-writer recovery procedure. It does not provide automatic Synology CSI provisioning, cloning, snapshot integration or expansion. None of that configuration exists or is approved by this task. No static manifest is proposed here.

## Security, write durability and recovery constraints

Follow-up [driver caveat review](OBSIDIAN_NAS_DRIVER_CAVEATS.md) resolves two ambiguities below: the supplied attacher emulates success when publish capability is absent (no automatic attachment failure, but no fencing), and omitted `enableFuaSyncCache` leaves attributes unset rather than explicitly forcing false. Explicit `"true"` is documented and implemented. Effective DSM defaults and runtime behavior remain unverified.

- **TLS and credential scope:** v1.3.1 verifies DSM HTTPS certificates by default and supports a CA certificate/server-name override. Require verified HTTPS rather than the README's HTTP example or `insecureSkipVerify`. A later deployment must establish the minimum DSM account permissions, secret rotation/access and safe logging; exact least-privilege DSM permissions are unverified. The supplied node manifest exposes the DSM connection secret to every driver node pod. [Release][release-131], [README][readme-131], [node manifest][node].
- **Target authentication is not implied by DSM TLS:** the v1.3.1 target-create API sets `auth_type=0`; its initiator login path does not configure CHAP despite having CHAP fields. Do not assume automatic CHAP enforcement. Synology documents IQN access control and CHAP/mutual CHAP, but how to safely enforce the desired policy with CSI-generated targets remains a blocker. Management HTTPS does not encrypt iSCSI data traffic. [Target creation][iscsi-api], [initiator][initiator], [SAN specifications][san-spec].
- **Flush semantics need an explicit gate:** v1.3.1 documents `enableFuaSyncCache` default **false**; controller source maps it to both `emulate_fua_write` and `emulate_sync_cache`. Synology defines FUA as writing data to drives before completion and Sync Cache as flushing cache. Neither a Healthy NAS nor Btrfs establishes that application sync calls are honored across the full stack. Decide and validate this setting with NAS cache/drive/UPS behavior and application PRAGMAs before claiming durability; do not silently inherit the default. [README][readme-131], [controller source][controller-code], [LUN help][lun-help].
- **Fencing is a concrete missing requirement:** v1.3.1 advertises SINGLE_NODE_WRITER and MULTI_NODE_MULTI_WRITER, but `ControllerPublishVolume`/`ControllerUnpublishVolume` return `Unimplemented`; its CSIDriver manifest nevertheless has `attachRequired: true` with a TODO. That combination and the supplied sidecar behavior require explicit compatibility/lifecycle validation. No backend attachment exclusion or automatic fencing is established. RWO is not a distributed lock or power/network fencing mechanism; never force-move a writable ext4/XFS/Btrfs filesystem LUN while its old worker may still write. [Driver capabilities][driver], [controller methods][controller-code], [CSIDriver manifest][csi-object].
- **Application semantics still apply:** unchanged Cortex ordinary SQLite WAL cannot live on NFS; a filesystem on an iSCSI LUN is a candidate presentation, not proof of lock, mmap, fsync, rename, mount-loss or recovery correctness. Only one active database owner is acceptable. LiveSync LevelDB/JSON/snapshots and both Cortex databases/OAuth state must all retain Synology backing. Keep local mountpoints from becoming writable fallback storage after a missing mount. [Application evidence](OBSIDIAN_NAS_APPLICATION_REQUIREMENTS.md).
- **Snapshots are not application-consistent backup by default:** v1.3.1's LUN snapshot request sets `is_app_consistent=false`. Snapshot CRDs/controller are additional prerequisites; quiescing or application-native backup, independent backup copies and demonstrated restore remain required. SAN thin snapshots consume hosting-volume headroom; thick LUN snapshots are unsupported. A `Retain` reclaim policy avoids one deletion path, but is not backup or retention automation. [Snapshot API][iscsi-api], [README][readme-131], [SAN specifications][san-spec].

## Precise blockers before a later decision or pilot

1. Human confirmation of the running **DS1520+** model, SAN Manager version and non-secret thin-Btrfs-LUN/snapshot/flush/access-control capabilities on DSM 7.3.2 Update 4. No targets/LUNs exist today.
2. Initiator packages/socket/module availability on **all five nodes** are established by companion checks. Unique IQN policy, eligible scheduling nodes, actual login and network reachability remain unverified. No worker-local durable fallback or permanent pinning.
3. Complete release-matched ARM64 sidecar/manifests audit and Kubernetes 1.33.6/Ubuntu Pi validation; resolve the v1.3.1 attach manifest versus unimplemented controller RPC behavior. `v1.4.0` cannot be treated as a published image while its tag is missing.
4. Approved DSM credential/TLS policy, target isolation/authentication policy and explicit handling of CSI's unauthenticated target-create path. No credentials should be included in research/tracker output.
5. Explicit flush/FUA/cache/power-loss requirements, capacity/snapshot limits and low-space protection; approximately 1.2TB free does not settle those policies.
6. Tested single-owner/fencing and stale-session recovery; synthetic filesystem/database crash, partition, reconnect and node-move tests; independent consistent backup/restore. No readiness or integrity gate has passed.

**No backend selected, no installation/provisioning instructions executed, and no tracker edits, commits or pushes performed.**

[readme-131]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/README.md
[readme-140]: https://github.com/SynologyOpenSource/synology-csi/blob/02af05d973c19cf7b91802452afe7271bd6a7400/README.md
[release-131]: https://github.com/SynologyOpenSource/synology-csi/releases/tag/v1.3.1
[release-130]: https://github.com/SynologyOpenSource/synology-csi/releases/tag/v1.3.0
[release-140]: https://github.com/SynologyOpenSource/synology-csi/releases/tag/v1.4.0
[release-121]: https://github.com/SynologyOpenSource/synology-csi/releases/tag/v1.2.1
[tags]: https://api.github.com/repos/SynologyOpenSource/synology-csi/tags
[registry-131]: https://hub.docker.com/v2/repositories/synology/synology-csi/tags/v1.3.1
[registry-130]: https://hub.docker.com/v2/repositories/synology/synology-csi/tags/v1.3.0
[registry-140]: https://hub.docker.com/v2/repositories/synology/synology-csi/tags/v1.4.0
[registry-121]: https://hub.docker.com/v2/repositories/synology/synology-csi/tags/v1.2.1
[registry-120]: https://hub.docker.com/v2/repositories/synology/synology-csi/tags/v1.2.0
[dockerfile]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/Dockerfile
[node]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/node.yml
[controller]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/controller.yml
[csi-object]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/csi-driver.yml
[controller-code]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/controllerserver.go
[driver]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/driver.go
[initiator]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/initiator.go
[node-code]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/nodeserver.go
[hostexec]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/utils/hostexec/hostexec.go
[dsm-service]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/dsm/service/dsm.go
[models]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/models/dsm.go
[iscsi-api]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/dsm/webapi/iscsi.go
[san-package]: https://www.synology.com/en-us/dsm/packages/ScsiTarget
[san-spec]: https://www.synology.com/en-us/dsm/7.2/software_spec/san_manager
[lun-help]: https://kb.synology.com/en-us/DSM/help/ScsiTarget/lun?version=7
[k8s-volumes]: https://github.com/kubernetes/website/blob/release-1.33/content/en/docs/concepts/storage/volumes.md#iscsi
[k8s-iscsi]: https://github.com/kubernetes/kubernetes/blob/v1.33.6/pkg/volume/iscsi/iscsi.go

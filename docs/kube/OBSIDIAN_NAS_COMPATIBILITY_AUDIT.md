# Obsidian NAS compatibility audit

Primary-source audit for [Verify NAS-backed persistence and application storage requirements](https://github.com/bpafoshizle/home-kube-setup/issues/75), accessed **2026-10-18**. Supplements [block requirements](OBSIDIAN_NAS_BLOCK_REQUIREMENTS.md), [driver caveats](OBSIDIAN_NAS_DRIVER_CAVEATS.md) and [storage evidence](OBSIDIAN_NAS_STORAGE_EVIDENCE.md).

**Outcome: the complete basic YAML bundle has published Linux ARM64 artifacts; Kubernetes 1.33.6 runtime compatibility is not established. Neither CSI nor static iSCSI is approved or ready for workload use.** Source review identifies a specific incompatible *optional capacity-publishing API path*, not evidence that the unchanged basic bundle necessarily fails. Static in-tree iSCSI is retained at 1.33.6 and avoids the legacy CSI bundle and DSM management-secret distribution, but does not solve fencing or durability.

## Scope and immutable baseline

- Synology CSI **v1.3.1**, commit **`d6e51755fb09dc8e6979aa4f7e14649158c1b6a3`**; specifically `deploy/kubernetes/v1.20/` **basic YAML**. The pinned version selector chooses v1.20 for Kubernetes 1.33; this fallback is not a test/support statement. [Selector][selector], [installer][installer].
- Do not silently substitute current-main, v1.4.0, or Helm. **Even at this same commit Helm specifies a different set:** attacher v4.2.0, registrar v2.6.3, provisioner v3.4.0 and resizer v1.7.0. It is a separate, unaudited bundle here. [Helm values][helm].
- Cluster/NAS facts below are inherited evidence, not fresh cluster/NAS queries. Five ARM64 Ubuntu 24.04.3 / Raspberry Pi 6.8 nodes run kubelet 1.33.6. DSM is human-reported 7.3.2-86009 Update 4; SAN Manager exists, with no targets/LUNs. Actual NAS model/SAN Manager version, unique initiator IQNs, connectivity and sessions remain unverified. All five already have Open-iSCSI, an active/enabled `iscsid.socket`, and available but unloaded `iscsi_tcp`; inactive `iscsid.service` alone is not evidence of failure. [Storage evidence](OBSIDIAN_NAS_STORAGE_EVIDENCE.md).
- All durable workload data stays on **Synology**, including vaults, LevelDB/JSON/snapshots and both Cortex SQLite/OAuth stores. No worker-local PV, workload `hostPath`, writable local fallback, or storage-driven permanent worker pinning. Driver infrastructure host mounts do not relax that constraint.

## 1. Exact published images

Read-only `docker manifest inspect` against each **exact manifest image tag** returned a manifest-list descriptor with `platform.os=linux` and `platform.architecture=arm64`. These are **ARM64 child-manifest digests**, not image config digests or top-level index digests. Registry metadata was queried only: no image layers were pulled, no containers ran, no packages were installed, and no signature, SBOM, vulnerability or runtime/conformance assessment was performed. A registry descriptor establishes publication, not safe execution or a reproducible source-to-binary build.

| Role | Exact image in pinned YAML | Linux ARM64 child digest, observed 2026-10-18 |
|:--|:--|:--|
| Driver (controller and node) | `synology/synology-csi:v1.3.1` | `sha256:efabd3fcd4f6e1f7eacb102db167118610c7bf313ed73207ad260364b924db91` |
| Node registrar | `registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.3.0` | `sha256:11b414474d388fd6e650d08f104f1a4ff43201bada765b8af25d9b489b240edf` |
| Provisioner | `registry.k8s.io/sig-storage/csi-provisioner:v3.0.0` | `sha256:0aea724ede5c22c0acb2eb9eceb0e71d37b274bbc4204c5c60c3595f635a568d` |
| Attacher | `registry.k8s.io/sig-storage/csi-attacher:v3.3.0` | `sha256:30ec767fe7dace4173c299f60796bc37027c65852bb289d3027578854f3613c9` |
| Resizer | `registry.k8s.io/sig-storage/csi-resizer:v1.3.0` | `sha256:12afa3560f1e0f409e5e354227531af97c997ddff440198174085f9420f94dae` |
| Optional snapshot sidecar, **not basic** | `registry.k8s.io/sig-storage/csi-snapshotter:v4.2.1` | `sha256:f9a1b71fefa7f903aaf4cf5d0b1362781a7a83f537199920c425f56789ded409` |

Image selection sources: [controller YAML][controller], [node YAML][node], [snapshotter YAML][snapshotter]. Publication sources are the first-party registry manifest endpoints: [driver][reg-driver], [registrar][reg-registrar], [provisioner][reg-provisioner], [attacher][reg-attacher], [resizer][reg-resizer], [snapshotter][reg-snapshotter]. Auth/content negotiation may be required to read these endpoints; the installed Docker registry client handled that. Repeatable metadata-only query: `docker manifest inspect <exact-image-from-table>`; inspect `manifests[].platform` and `manifests[].digest`.

The earlier report records driver index digest `sha256:8aa84848187648a65c899f54e96061d3f22cdba0ad8926d770b431d4b274406f`. This audit independently reconfirmed the ARM64 child; it does **not** present an independently remeasured top-level index digest for any image. Supplied manifests use tags rather than immutable digest references; a later approved deployment must decide digest pinning explicitly.

### v1.4.0 is a separate artifact finding

Browser Harness opened the Docker Hub tag API in a new tab on 2026-10-18. It again returned `{"message":"httperror 404: tag 'v1.4.0' not found",...}`. [Tag API][reg-140]. This reconfirms absence at **that repository/tag**, not absence of every possible build or registry location. The earlier report records the GitHub release/tag commit `02af05d973c19cf7b91802452afe7271bd6a7400`; a source release is not an image publication. **The baseline remains v1.3.1.**

## 2. Pinned manifests: API, RBAC, flags and deployment assumptions

### API surface

| Pinned object/API | Finding for 1.33.6 |
|:--|:--|
| Namespace, ServiceAccount and Secret (`v1`); StatefulSet/DaemonSet (`apps/v1`); ClusterRole/Binding (`rbac.authorization.k8s.io/v1`) | Stable API versions, not the removed beta workload/RBAC APIs. Admission and actual acceptance were not tested. [Controller][controller], [node][node], [installer][installer]. |
| `CSIDriver` / `StorageClass`, `storage.k8s.io/v1` | Retained API registration at Kubernetes v1.33.6; no removed-version mismatch identified in these objects. [CSIDriver][csidriver], [class][class], [API server source][storage-api]. |
| `CSIDriver.attachRequired: true`, `podInfoOnMount: true`, persistent lifecycle | Source-derived attachment bookkeeping, **not fencing**; see below. No `fsGroupPolicy` is explicitly selected. [CSIDriver][csidriver]. |
| Example StorageClass | `Retain`, expansion enabled; default-class annotation is commented out, parameters omitted, no binding mode set. README's statement that installation creates a default class does **not** match this YAML. Unspecified location lets the driver choose available NAS space; this is not an approved allocation policy. [Class][class], [README][readme]. |
| Optional `VolumeSnapshotClass`, `snapshot.storage.k8s.io/v1` | A CRD API, not installed merely because Kubernetes serves storage/v1. Snapshot CRDs/common controller must be separately installed; supplied YAML alone is incomplete. Class deletion policy is `Delete`, not backup retention. [Snapshot class][snapshotclass], [README][readme]. |

### RBAC comparison against release-matched upstream examples

The pinned controller ClusterRole supplies the ordinary basic provisioner/attacher/resizer permissions in their corresponding versioned examples: PV/PVC watch and mutations, PVC status patch, events, node/CSINode reads, VolumeAttachment/status patch, StorageClass reads, snapshot source reads and secret get. **No missing core permission was identified in that comparison; this is not a live authorization test.** Node role additionally grants cluster-wide secret get/list, node update, PV update and VolumeAttachment update. Registrar itself does not need Kubernetes API access. Secret access is broad and the DSM connection secret is mounted in every node plugin; neither least-privilege DSM permissions nor acceptable cluster credential exposure is settled. [Controller][controller], [node][node], [upstream provisioner RBAC][prov-rbac], [attacher RBAC][attach-rbac], [resizer RBAC][resize-rbac], [registrar README][registrar-readme].

Two boundaries matter:

1. Controller role still contains obsolete `csi.storage.k8s.io/csinodeinfos` read permissions. An unused RBAC rule naming an absent resource does not itself make an RBAC object invalid or prove the client requests that API; the reviewed sidecar paths use `storage.k8s.io/v1` CSINodes. [Controller][controller], [provisioner main][prov-main], [attacher main][attach-main].
2. No lease/endpoints leader-election rights or CSIStorageCapacity create/update rights are supplied. Leader election and capacity publication are **not enabled by the pinned arguments**. Do not turn them on or scale controllers as a purported harmless repair: upstream examples require additional RBAC, and capacity publication also has the removed-API problem below. [Upstream RBAC][prov-rbac], [controller][controller], [provisioner main][prov-main].

### Exact supplied arguments and host assumptions

| Container | Supplied arguments / source check |
|:--|:--|
| Provisioner | `--timeout=60s`, `--csi-address=$(ADDRESS)`, `--v=5`, `--extra-create-metadata`; address `/var/lib/csi/sockets/pluginproxy/csi.sock`. Versioned main defines these application flags; logging uses klog. No capacity, leader-election or node-deployment opt-in. [Manifest][controller], [main][prov-main]. |
| Attacher / resizer | Both use `--v=5`, `--csi-address=$(ADDRESS)` with the same socket; the versioned mains define the CSI address flag and default leader election to false. [Manifest][controller], [attacher main][attach-main], [resizer main][resize-main]. |
| Registrar | `--v=5`, `--csi-address=/csi/csi.sock`, host registration path `/var/lib/kubelet/plugins/csi.san.synology.com/csi.sock`; registration mount `/registration`. These are documented registrar arguments and distinct container/host socket roles. [Node][node], [registrar README][registrar-readme]. |
| Synology controller | `--nodeid=NotUsed`, endpoint `unix:///var/lib/csi/sockets/pluginproxy/csi.sock`, `--client-info /etc/synology/client-info.yml`, `--log-level=info`. [Controller][controller]. |
| Synology node | Node ID from `spec.nodeName`, endpoint literal `unix://csi/csi.sock`, same client-info/log level, `--chroot-dir=/host`. All flag names are defined in the pinned driver; unknown flags are allowed by its parser, so successful startup alone would not validate arbitrary extra flags. The literal endpoint and registration must be checked in a future authorized runtime evaluation, not called broken merely from its spelling. [Node][node], [driver main][driver-main]. |

The YAML controller has one replica and no leader election; do not scale it without redesign. Controller sidecars/plugin and the node plugin are privileged; host networking, host `/`, `/dev`, kubelet paths and bidirectional mount propagation require an explicitly approved privileged admission/security posture. Restricted Pod Security enforcement would reject such a deployment. The supplied namespace does not by itself establish an admission exception. No readiness/liveness probes are supplied in the reviewed basic controller/node YAML, so Running alone cannot establish functioning storage. Host chroot execution still needs usable host initiator tools and actual device/session access; ARM64 publication does not establish that. [Controller][controller], [node][node], [host executor][hostexec].

## 3. What the version documentation does and does not establish

| Component/source identity | Documented CSI / Kubernetes guidance at that release |
|:--|:--|
| Synology v1.3.1 / `d6e51755fb09dc8e6979aa4f7e14649158c1b6a3` | Driver table says K8s **1.20+**; prerequisite prose says 1.19+, DSM 7.0+. No exact 1.33.6/Ubuntu ARM64/DSM 7.3.2 test matrix is supplied. [README][readme]. |
| Provisioner v3.0.0 / `3ebac48aa7a53efbaa599e546f86605f2f81da7f` | CSI 1.5.0; minimum K8s 1.20, recommended 1.22. [README][prov-readme]. |
| Attacher v3.3.0 / `ac8c4deb1954a72d4500aa6398459735c85782e6` | CSI 1.5.0; minimum K8s 1.17, recommended 1.22. [README][attach-readme]. |
| Resizer v1.3.0 / `4a6c116146204bb9bcce0f3697c5f651817575b7` | CSI 1.5.0; minimum K8s 1.16, recommended 1.22. [README][resize-readme]. |
| Registrar v2.3.0 / `de03348b9dca645b11ab537eb1ef57a703b68d48` | CSI 1.3.0; minimum K8s 1.13; no recommended K8s column. [README][registrar-readme]. |

All four pinned sidecar `go.mod` files reference `k8s.io/client-go v0.22.0`; the three controller sidecars reference CSI spec v1.5.0. Source dependency age is a concrete review concern, **not proof that all ordinary API calls fail across eleven Kubernetes minor versions**. Client-go documents shared-API interoperability and warns that removed APIs are not shared; its old compatibility table is not a certificate for this deployment on 1.33.6. Minimum versions are floors, recommended versions are not ceilings, and neither proves tested runtime support. No exact complete-bundle 1.33.6 validation was found in the reviewed release documentation. No comprehensive security/update-status audit is claimed. [Versioned dependencies][prov-mod], [attacher][attach-mod], [resizer][resize-mod], [registrar][registrar-mod], [client-go v0.22.0 policy][clientgo].

### Established incompatibility, deliberately bounded

Provisioner v3.0.0's **optional** capacity controller constructs `storage.k8s.io/v1beta1` CSIStorageCapacity objects and calls `StorageV1beta1().CSIStorageCapacities(...)`. Kubernetes v1.33.6 registers CSIStorageCapacity only under **v1**; its v1beta1 storage registration contains VolumeAttributesClass, not CSIStorageCapacity. Thus **enabling that old capacity-publishing path is API-incompatible with 1.33.6**. More RBAC alone cannot fix it. [Capacity implementation][capacity], [API registration][storage-api].

This does **not** establish failure of the pinned basic bundle: `--enable-capacity` defaults false and is absent from its YAML. Core provisioner/attacher paths reviewed use stable storage/v1; snapshot restore uses snapshot/v1. A valid manifest/API subset is necessary, not sufficient, for runtime correctness. No broad claim of either full support or full incompatibility follows. [Provisioner main][prov-main], [provisioner controller][prov-controller], [attacher main][attach-main].

### Attach/access-mode limitations remain material

The prior pinned-source trace remains applicable: Synology does not advertise `PUBLISH_UNPUBLISH_VOLUME`; attacher v3.3.0 selects its **trivial handler**, which marks VolumeAttachment attached without backend publish/detach/fencing. This is not an automatic RPC failure. Node iSCSI login/stage/publish is separate, and an attached status is not proof of a mounted or exclusively owned LUN. [Attacher selection][attach-main], [trivial handler][trivial], [driver caveats](OBSIDIAN_NAS_DRIVER_CAVEATS.md#2-controller-attach-trace-the-caller-not-just-the-rpc-stub).

Do not assume ReadWriteOncePod repairs ownership: release sidecar minimums alone are insufficient, and the reviewed driver does not advertise the needed newer single-node access-mode capability. Static in-tree iSCSI cannot use RWOP either; Kubernetes documents it as CSI-only. RWO permits multiple pods on one node and is not stale-worker fencing. RWX/multiple sessions must never be used to allow two ordinary ext4/XFS/Btrfs filesystem writers. [Kubernetes 1.33 access modes][modes], [driver caveats](OBSIDIAN_NAS_DRIVER_CAVEATS.md#3-access-modes-session-limits-and-the-multi-node-hazard).

## 4. Static in-tree iSCSI compared at exactly Kubernetes 1.33.6

| Concern | Static in-tree iSCSI | Synology CSI v1.3.1 basic YAML |
|:--|:--|:--|
| Implementation / artifacts | `kubernetes.io/iscsi` implementation is retained at v1.33.6, including filesystem and raw-block handling, RWO/ROX. Release-1.33 docs describe it without an iSCSI deprecation marker. No Synology CSI/sidecar images needed. Presence is not a live-node test or future-support promise. [Plugin][iscsi], [docs][volumes]. | Driver + all four sidecars publish ARM64; exact bundle runtime remains unknown. |
| NAS lifecycle | Administrator must create/manage target/LUN first; maintain portal, IQN, LUN, filesystem, binding/reclaim ownership and capacity records. No dynamic Synology provisioning, CSI cloning/snapshot integration or automatic expansion supplied by this static path. | Automates NAS volume lifecycle through DSM API; introduces credential, old-sidecar and driver-specific behavior. `Retain` is not backup. |
| Credentials / CHAP | No **DSM management credential** is needed by the Kubernetes plugin. Discovery/session CHAP is implemented using referenced Secret values, including mutual-CHAP fields. CHAP credentials remain credentials; authentication does not encrypt iSCSI traffic. [CHAP source][chap], [plugin][iscsi]. | DSM connection secret is mounted in controller and node plugins. Prior source review finds target creation `auth_type=0`, no driver-managed initiator CHAP or IQN allowlist. Do not equate verified DSM TLS with authenticated/encrypted iSCSI. [Driver caveats](OBSIDIAN_NAS_DRIVER_CAVEATS.md#4-authentication-configurable-flush-flags-hardcoded-target-creation). |
| Flush/cache configuration | Administrator can explicitly own NAS target/LUN policy, but the static plugin supplies no end-to-end persistence guarantee. | Documented `enableFuaSyncCache: "true"` sets both creation attributes; omission leaves attributes unset despite README false default. Existing LUNs are not retrofitted by editing a class. |
| Recovery / fencing | Local unmount/logout cannot revoke a partitioned old writer. No automatic backend exclusion/fencing established; manual lifecycle is an operational obligation, not safe failover by itself. | Trivial attachment handler and reviewed node paths likewise do not establish stale-writer revocation. Session limits, RWO, one replica, CHAP and snapshots are not fencing. |

Static iSCSI is therefore a **lower-integration-complexity candidate for a later decision**, not a selected backend or an exemption from safety gates. Both paths require a single writable owner, actual initiator connectivity, loss/reconnect handling and proof the former owner cannot write or reconnect before replacement mounts. Do not force-reschedule an ordinary filesystem LUN merely because a node is NotReady or a VolumeAttachment was deleted. Preserve portable eligible-worker scheduling without permanent pinning. [Kubernetes docs][volumes], [access modes][modes], [driver caveats](OBSIDIAN_NAS_DRIVER_CAVEATS.md).

## 5. Current NAS power/cache evidence and acceptance boundary

Use the **latest** human evidence, not the earlier tentative reports: Volume 1 has a Healthy **read-write RAID 1 SSD cache**, two **SNV3400-400G** devices, Btrfs metadata pinning enabled. USB UPS is now connected; the human enabled UPS support, with **Until low battery** standby selected and displayed 100% charge. This supersedes disabled/disconnected UPS and unknown cache-mode observations. RAID 1 is not power-loss protection; charge percentage is not battery-health/runtime evidence. Protective transitions, low-battery standby/recovery, network-equipment power coverage, SSD hardware protection and full-stack acknowledged-write survival remain untested. [Human evidence](OBSIDIAN_NAS_STORAGE_EVIDENCE.md#human-ups-integration-update-2026-10-18), [cache confirmation](OBSIDIAN_NAS_STORAGE_EVIDENCE.md#confirmed-ssd-cache-configuration-2026-10-18).

| Classification | Conservative conclusion |
|:--|:--|
| **Established unsuitable/incompatible** | Unchanged Cortex ordinary SQLite WAL on NFS (application-specific prior evidence); optional v3.0.0 provisioner **beta capacity API** on 1.33.6; v1.4.0 image unavailable at the checked official tag; concurrent ordinary-filesystem writers violate the intended storage contract. None implies every basic v1.3.1 operation fails. |
| **Established publication/source facts** | All basic images have Linux ARM64 child descriptors; pinned YAML uses stable object API versions; in-tree iSCSI/CHAP remains implemented at 1.33.6; CSI attachment bookkeeping provides no backend fence. |
| **Unknown, not demonstrated incompatible** | Complete basic bundle on actual 1.33.6 ARM64 nodes; actual DSM model/package/target capabilities, security posture, initiator IDs/login, native tools, stage/publish/unstage/logout behavior, expansion and recovery; vulnerability/signature status; effective FUA/Sync Cache, cache/UPS behavior and application durability. |
| **Pilot gates, not work authorized now** | Approve a backend and exact immutable deployment/security policy; settle target authentication/isolation and explicit flush attributes; define capacity/low-space/backup policy; establish enforceable old-owner revocation; then separately authorize synthetic attach/mount/reconnect/crash/fenced node-move and consistent backup/restore evaluation. No tests or provisioning are permitted in this audit. |

No pilot acceptance gate has passed. Existing evidence justifies a later constrained decision between NAS-backed approaches, **not production readiness or relaxing NAS-only durability**. Refer to [application requirements](OBSIDIAN_NAS_APPLICATION_REQUIREMENTS.md) for why Cortex WAL drives the block investigation rather than a blanket ban on all databases over NFS.

## Validation performed and limitations

- Read the three companion notes and issue #75 plus existing comments using read-only GitHub API calls. The issue/comments were not edited.
- Retrieved exact pinned Synology manifests, installer/version selector, README, Helm values and main flag definitions through `gh api`; compared the four versioned sidecar READMEs/dependencies and three controller RBAC examples; traced the optional beta capacity path against v1.33.6 API registration and read v1.33.6 in-tree iSCSI/CHAP source. Versioned sidecar commits above were resolved using GitHub's commit API.
- Queried registry **manifest metadata only** for all five basic images and optional snapshot sidecar. Used Browser Harness for the v1.4.0 Hub recheck; no webfetch/curl substitutes. Snapshot CRDs/common controller/webhook form a **separate integration scope**: the extra sidecar's ARM64 publication does not complete a full snapshot deployment audit. Synology README points to external-snapshotter v4.0.0 prerequisites while supplying sidecar v4.2.1; upstream v4.2.1 documents v1 CRDs and a recommended validating webhook. Do not invent a unified full-bundle version from those mixed references. [README][readme], [snapshotter v4.2.1][snapshot-readme].
- No cluster/node/NAS access, discovery/login, storage creation, test/provisioning, package installation, image execution, secret/vault access, tracker mutation, commit or push. Only this new report file was written. Pre-existing working-tree changes were left untouched.

## Primary sources

All sources accessed **2026-10-18** unless explicitly described as inherited evidence. Synology URLs use exact v1.3.1 commit; core sidecar URLs use resolved release commits. Kubernetes implementation uses exact **v1.33.6**. Website links pin release-1.33's observed commit **`b9ab6105d0e3b6824dc368d3dd3b101fb4774575`**; external-snapshotter/client-go links use exact release tags. Registry tags are mutable observations at the access date, with immutable ARM64 child identities recorded above.

[readme]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/README.md
[selector]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/scripts/functions.sh
[installer]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/scripts/deploy.sh
[helm]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/helm/values.yaml
[controller]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/controller.yml
[node]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/node.yml
[csidriver]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/csi-driver.yml
[class]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/storage-class.yml
[snapshotter]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/snapshotter/snapshotter.yaml
[snapshotclass]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/snapshotter/volume-snapshot-class.yml
[driver-main]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/main.go
[hostexec]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/utils/hostexec/hostexec.go
[reg-driver]: https://registry-1.docker.io/v2/synology/synology-csi/manifests/v1.3.1
[reg-registrar]: https://registry.k8s.io/v2/sig-storage/csi-node-driver-registrar/manifests/v2.3.0
[reg-provisioner]: https://registry.k8s.io/v2/sig-storage/csi-provisioner/manifests/v3.0.0
[reg-attacher]: https://registry.k8s.io/v2/sig-storage/csi-attacher/manifests/v3.3.0
[reg-resizer]: https://registry.k8s.io/v2/sig-storage/csi-resizer/manifests/v1.3.0
[reg-snapshotter]: https://registry.k8s.io/v2/sig-storage/csi-snapshotter/manifests/v4.2.1
[reg-140]: https://hub.docker.com/v2/repositories/synology/synology-csi/tags/v1.4.0
[prov-readme]: https://github.com/kubernetes-csi/external-provisioner/blob/3ebac48aa7a53efbaa599e546f86605f2f81da7f/README.md
[prov-mod]: https://github.com/kubernetes-csi/external-provisioner/blob/3ebac48aa7a53efbaa599e546f86605f2f81da7f/go.mod
[prov-main]: https://github.com/kubernetes-csi/external-provisioner/blob/3ebac48aa7a53efbaa599e546f86605f2f81da7f/cmd/csi-provisioner/csi-provisioner.go
[prov-controller]: https://github.com/kubernetes-csi/external-provisioner/blob/3ebac48aa7a53efbaa599e546f86605f2f81da7f/pkg/controller/controller.go
[prov-rbac]: https://github.com/kubernetes-csi/external-provisioner/blob/3ebac48aa7a53efbaa599e546f86605f2f81da7f/deploy/kubernetes/rbac.yaml
[capacity]: https://github.com/kubernetes-csi/external-provisioner/blob/3ebac48aa7a53efbaa599e546f86605f2f81da7f/pkg/capacity/capacity.go
[attach-readme]: https://github.com/kubernetes-csi/external-attacher/blob/ac8c4deb1954a72d4500aa6398459735c85782e6/README.md
[attach-mod]: https://github.com/kubernetes-csi/external-attacher/blob/ac8c4deb1954a72d4500aa6398459735c85782e6/go.mod
[attach-rbac]: https://github.com/kubernetes-csi/external-attacher/blob/ac8c4deb1954a72d4500aa6398459735c85782e6/deploy/kubernetes/rbac.yaml
[attach-main]: https://github.com/kubernetes-csi/external-attacher/blob/ac8c4deb1954a72d4500aa6398459735c85782e6/cmd/csi-attacher/main.go
[trivial]: https://github.com/kubernetes-csi/external-attacher/blob/ac8c4deb1954a72d4500aa6398459735c85782e6/pkg/controller/trivial_handler.go
[resize-readme]: https://github.com/kubernetes-csi/external-resizer/blob/4a6c116146204bb9bcce0f3697c5f651817575b7/README.md
[resize-mod]: https://github.com/kubernetes-csi/external-resizer/blob/4a6c116146204bb9bcce0f3697c5f651817575b7/go.mod
[resize-rbac]: https://github.com/kubernetes-csi/external-resizer/blob/4a6c116146204bb9bcce0f3697c5f651817575b7/deploy/kubernetes/rbac.yaml
[resize-main]: https://github.com/kubernetes-csi/external-resizer/blob/4a6c116146204bb9bcce0f3697c5f651817575b7/cmd/csi-resizer/main.go
[registrar-readme]: https://github.com/kubernetes-csi/node-driver-registrar/blob/de03348b9dca645b11ab537eb1ef57a703b68d48/README.md
[registrar-mod]: https://github.com/kubernetes-csi/node-driver-registrar/blob/de03348b9dca645b11ab537eb1ef57a703b68d48/go.mod
[clientgo]: https://github.com/kubernetes/client-go/blob/v0.22.0/README.md#compatibility-client-go---kubernetes-clusters
[snapshot-readme]: https://github.com/kubernetes-csi/external-snapshotter/blob/v4.2.1/README.md
[storage-api]: https://github.com/kubernetes/kubernetes/blob/v1.33.6/pkg/registry/storage/rest/storage_storage.go
[iscsi]: https://github.com/kubernetes/kubernetes/blob/v1.33.6/pkg/volume/iscsi/iscsi.go
[chap]: https://github.com/kubernetes/kubernetes/blob/v1.33.6/pkg/volume/iscsi/iscsi_util.go#L87-L145
[volumes]: https://github.com/kubernetes/website/blob/b9ab6105d0e3b6824dc368d3dd3b101fb4774575/content/en/docs/concepts/storage/volumes.md#iscsi
[modes]: https://github.com/kubernetes/website/blob/b9ab6105d0e3b6824dc368d3dd3b101fb4774575/content/en/docs/concepts/storage/persistent-volumes.md#access-modes

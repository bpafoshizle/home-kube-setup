# Obsidian NAS block driver caveats

Deeper primary-source review for [Verify NAS-backed persistence and application storage requirements](https://github.com/bpafoshizle/home-kube-setup/issues/75), 2026-10-12. Supplements [block requirements](OBSIDIAN_NAS_BLOCK_REQUIREMENTS.md); **not backend selection, rollout approval, or a provisioning runbook**. Synology CSI is pinned to **v1.3.1 / `d6e51755fb09dc8e6979aa4f7e14649158c1b6a3`** throughout. This source review accessed or changed no cluster, node, NAS, secrets, sessions, or application runtime. Separate read-only node checks are recorded in the companion evidence. Public sources were read in a separate browser tab; no further agents were delegated.

## Verdict and corrections

- **Do not predict attachment failure merely from the unimplemented controller RPCs.** This driver does **not** advertise `PUBLISH_UNPUBLISH_VOLUME`. Its supplied external-attacher **v3.3.0** deliberately uses a trivial handler that marks Kubernetes `VolumeAttachment.status.attached=true` without publishing anything at the NAS. The manifest's `attachRequired: true` therefore introduces attachment bookkeeping, **not backend attachment exclusion or fencing**. This corrects an interpretation of the earlier note's unresolved RPC/manifest concern; full deployment compatibility remains untested. [Driver][driver], [manifest][csi-object], [attacher selection][attacher-main], [trivial handler][attacher-trivial].
- **Explicit `enableFuaSyncCache: "true"` is a documented, implemented option**, not an unsupported tweak. However, omission is not an explicit write of `false`: the parser emits neither device attribute and leaves their effective values to the DSM create path. The README documents default `false`; actual device behavior still needs confirmation. A successful provision or mount cannot prove crash-safe writes. [README][readme], [parser][parser], [DSM conversion][dev-conversion], [API][lun-create].
- **No proven single-owner recovery mechanism exists in this evidence.** CSI access-mode advertising, RWO, target session limits, TLS, CHAP, snapshots and successful attachment status are not interchangeable with fencing. Node paths do not enforce access-mode ownership; target defaults and stale-session behavior are not established for the actual NAS. [Node staging][stage], [node publishing][publish], [target service][target-service], [Kubernetes access modes][k8s-modes].
- **Initiator packages are not missing.** Companion node metadata establishes all five nodes have Open-iSCSI **`2.1.9-3ubuntu5.4`**, `iscsiadm`, and an available `iscsi_tcp` module via `modinfo`; the module is not loaded. `iscsid.service` is inactive/disabled but `iscsid.socket` is active/enabled, so on-demand activation exists. This supersedes the earlier requirements note's package/module evidence gap, without proving working sessions, network reachability, unique IQNs, mounts or recovery. No fresh node checks were performed by this source investigation. The human reports a UPS present and believes cache is read-write; mode, UPS integration and NAS/drive cache protection remain unverified.

## 1. What the FUA/Sync Cache parameter actually does

The v1.3.1 README's iSCSI parameter table explicitly documents `enableFuaSyncCache` and default `'false'`. `parseDevAttribs` only enters its branch when the supplied string is nonempty; it assigns the same parsed boolean to **both** `emulate_fua_write` and `emulate_sync_cache`. There is no exposed independent switch for the two in that parser. `StringToBoolean` accepts case/whitespace-normalized `yes`, `true`, or `1`; other strings become false without a validation error. Prefer the documented literal `"true"`, not an assumed strict boolean validator. [README][readme], [parser][parser], [boolean parser][boolean].

| Input | Source-derived request behavior | What is established |
|:--|:--|:--|
| Omitted / empty | Neither FUA nor Sync Cache key is added to `DevAttribs`. With no other attributes the service serializes an empty array for `dev_attribs`. | README default is false; the parser does **not** itself force two false attributes. Effective DSM defaults are not independently verified. |
| `"false"` | Both keys are emitted with false, converted to `enable: 0`. | Explicit disable request. Not a tested characterization of the NAS's acknowledgement semantics. |
| `"true"` | Both keys are emitted with true, converted to `enable: 1`, JSON-encoded and submitted to `SYNO.Core.ISCSI.LUN` create. | Supported explicit enable request. API acceptance/readback and actual SCSI behavior on this DSM/package remain untested. |

Evidence chain: controller parser → `CreateK8sVolumeSpec.DevAttribs` → `LunDevAttrib{DevAttrib: key, Enable: BoolToInt(value)}` → `LunCreateSpec.DevAttribs` → `dev_attribs` request. This is configuration plumbing, not a test of the closed-source target's implementation. [Controller][controller], [DSM conversion][dev-conversion], [API][lun-create].

**Changing a StorageClass is not evidence of changing an existing LUN.** `CreateVolume` first looks up an existing volume by name and only invokes backend creation when none exists; this reviewed path does not retrofit those flags on the already-existing object. Clone/restore behavior must also be verified separately rather than inferred from new-LUN creation. [Idempotent create][create-existing].

### Durability boundary

Synology defines FUA as writing data to drives before reporting I/O completion and Sync Cache as flushing cache to the drive. Linux 6.8 documents volatile write-back caches, `REQ_PREFLUSH`, `REQ_FUA`, and the need for lower layers to propagate/implement the operations. The setting is thus directly relevant to applications that depend on `fsync` and ordered persistent writes. **It is neither proof that every ordinary write is synchronous nor an end-to-end persistence certificate.** [Synology terminology][lun-help], [Linux 6.8 cache control][kernel-cache].

Before claiming durability, a later authorized evaluation must establish:

1. Actual LUN attribute readback and SCSI cache/flush capabilities with the intended DSM/SAN Manager version, including any existing/clone/restore path used.
2. Application sync policy and client filesystem/mount behavior, including barriers, error handling and the treatment of interrupted or failed I/O.
3. DSM storage-stack propagation to the underlying drives, volatile NAS/drive cache policies, power-loss protection and UPS/shutdown behavior. Btrfs, RAID, “Healthy” status, and an unknown UPS are not substitutes for those facts.
4. Acknowledged-write survival and filesystem/database integrity through approved crash, NAS reboot, transport loss/reconnect and power-loss scenarios, plus independent backup/restore.

These are **evidence gaps, not claims that corruption has occurred**. Conversely, default false alone does not prove every acknowledged write is lost: effective cache behavior is unobserved. Explicit true addresses a relevant configurable interface but cannot establish the rest of the stack. Linux's documented cache contract explains why configuration and successful I/O are insufficient evidence. [Linux][kernel-cache].

## 2. Controller attach: trace the caller, not just the RPC stub

The exact source/manifests provide this chain:

1. Identity advertises `CONTROLLER_SERVICE`. Controller capabilities include create/delete, list, expand, snapshot, clone and capacity, **not `PUBLISH_UNPUBLISH_VOLUME`**. `ControllerGetCapabilities` returns the driver's capability list. [Identity][identity], [driver][driver], [controller][controller].
2. `ControllerPublishVolume` and `ControllerUnpublishVolume` return `codes.Unimplemented`. This is not independently contradictory to CSI: the spec requires these RPCs when the publish/unpublish capability is present. The driver depends on CSI spec v1.5.0. [RPCs][rpc-stubs], [dependency][go-mod], [CSI spec][spec-publish].
3. The supplied CSIDriver sets `attachRequired: true` with a TODO about implementing publish; the controller manifest selects `csi-attacher:v3.3.0`. [CSIDriver][csi-object], [controller deployment][controller-manifest].
4. External-attacher v3.3.0 resolves to commit **`ac8c4deb1954a72d4500aa6398459735c85782e6`**. Its startup probes controller capabilities; `supportsAttach` comes from the `PUBLISH_UNPUBLISH_VOLUME` entry. With that absent it selects `NewTrivialHandler`, **not** `NewCSIHandler`. [Version identity][attacher-ref], [capability handling][attacher-main].
5. The trivial handler patches an unattached object to attached, passing nil metadata. It uses **no finalizer**, requires no backend detach, does nothing in PV synchronization, and its reconcile method returns nil. Its unit tests expect the successful status patch. [Handler][attacher-trivial], [tests][attacher-test].

**Implication:** assuming sidecar startup, registration, RBAC and Kubernetes API compatibility work, attachment can be reported successful without either unimplemented RPC being called. This is **source-derived expected behavior**, not a live Kubernetes 1.33.6 result. An attached VolumeAttachment, or deletion of that object, is not evidence of a NAS login, logout, storage reservation, old-node write revocation or successful mount. The actual iSCSI discovery/login and device/mount work happens in the node paths. [Node login][node-login], [stage][stage], [publish][publish].

Do not “fix” this by merely advertising the absent capability, changing `attachRequired`, or replacing the sidecar: none implements safe ownership transfer. Manifest/sidecar changes are outside this research and require a release-matched compatibility and lifecycle decision.

## 3. Access modes, session limits and the multi-node hazard

### What is checked, and where

- `CreateVolume` validates requested access modes against only `SINGLE_NODE_WRITER` and `MULTI_NODE_MULTI_WRITER`. The former sets `MultipleSession=false`; the latter sets it true. `ValidateVolumeCapabilities` checks the advertised list. Advertising a capability does not implement a distributed writer lock. [Driver][driver], [controller][controller].
- With `MultipleSession=true`, the DSM service calls `TargetSet(targetId, 0)` to enable multiple sessions via `max_sessions=0`. With false, it **does not explicitly set `max_sessions=1`**; it leaves the target default/existing setting alone. The exact actual default and DSM interpretation/enforcement, including old-session timeout and reconnect, are unverified. The source's “enable multi session” intent is clear; unconditional single-session exclusion is not proven. [Target service][target-service], [target API][target-api].
- `NodeStageVolume` checks volume ID, staging path and a nonnil capability, but does **not inspect `GetAccessMode().GetMode()`**. For filesystem iSCSI it logs in, checks only whether the staging path is already mounted, and calls `FormatAndMount...` with `rw` plus mount flags. Raw block staging returns success without mounting. [Stage dispatch][stage-dispatch], [iSCSI stage][stage].
- `NodePublishVolume` checks IDs/paths and a nonnil capability, handles block/mount and the readonly flag, and returns success for an already-mounted target path without comparing the requested access mode or mount identity. Otherwise iSCSI login is followed by a bind mount of the staged filesystem or block device. There is no access-mode ownership check, cross-node lease, SCSI persistent-reservation acquisition or old-worker fencing in these reviewed paths. [Publish][publish].
- Normal `NodeUnstageVolume` unmounts locally and attempts logout. It requires execution on that worker; it cannot establish that an unreachable worker stopped writing. `Initiator.logout` logs and returns logout errors, but `nodeServer.logoutTarget` discards that return value, so it is not propagated through `NodeUnstageVolume`. A clean unstage is useful lifecycle work, not partition-safe fencing. [Unstage][unstage], [node logout wrapper][node-login], [initiator logout][initiator-logout].

CSI v1.5.0 specifies compatibility/idempotency and single-node publication rules; the node paths above do not compare all of those inputs. This is a source-review caveat, **not a conformance-test result**. Do not substitute Kubernetes `ReadWriteOncePod` as an assumed supported fix: the driver does not advertise CSI's `SINGLE_NODE_SINGLE_WRITER` or `SINGLE_NODE_MULTI_WRITER` access modes/capability. Kubernetes itself documents that RWO allows multiple pods on one node and access modes do not enforce write protection after mounting. [CSI node rules][spec-node], [driver][driver], [Kubernetes][k8s-modes].

### What remains dangerous

If two initiators can access the same writable ordinary ext4/XFS/Btrfs filesystem LUN, each worker has its own filesystem cache and local locks; an advertised RWX/multi-writer mode does **not** turn that filesystem into a clustered filesystem. Kubernetes's iSCSI documentation explicitly prohibits simultaneous writers. Do not choose RWX to make rescheduling easier. [Kubernetes iSCSI][k8s-iscsi-doc], [application requirements](OBSIDIAN_NAS_APPLICATION_REQUIREMENTS.md).

Even if the target rejects a second session today, that is not evidence of safe failover tomorrow: it may block replacement availability, and no reviewed controller path performs an authenticated ownership transfer or revokes the old initiator's right to reconnect. Actual target single-session behavior might reduce concurrent access; **neither guaranteed dual access nor guaranteed fencing is established**. A failover gate must ensure the former owner cannot issue or resume writes before another owner mounts writable storage. Force deletion, node NotReady, simulated attachment success and application-level locks alone do not establish that gate. [Target service][target-service], [trivial handler][attacher-trivial], [node paths][publish].

## 4. Authentication: configurable flush flags, hardcoded target creation

`TargetCreate` hardcodes **`auth_type=0`**; its spec only supplies name/IQN here. This is not a StorageClass-selectable authentication default in the reviewed implementation. The initiator struct has CHAP fields, but discovery/login code does not use them or configure `node.session.auth.*`. `TargetSet` changes only `max_sessions`. **The reviewed driver does not provision CHAP policy or an initiator-IQN allowlist.** Existing host Open-iSCSI configuration might affect login; that is not driver-managed CHAP support. [Target API][target-api], [target service][target-service], [initiator][initiator].

DSM HTTPS certificate verification protects the management channel, not the iSCSI data path. Network isolation and deliberate NAS target authentication/access control remain required. Manually modifying CSI-generated targets is not established as a stable supported policy mechanism across deletion/recreation. Do not treat shared CHAP credentials or an allowlist permitting all eligible nodes as dynamic fencing: authorization to connect is distinct from revocation of the stale writer. The supplied node deployment mounts the DSM connection secret on every driver node; exact least-privilege DSM permissions and rotation remain unverified. [README][readme], [node manifest][node-manifest].

## 5. Minimal managed-static-iSCSI alternative

A separately authorized, administrator-managed **existing NAS LUN and target**, presented through an in-tree iSCSI static PV/PVC at Kubernetes 1.33, removes the Synology CSI controller/node deployment, its legacy CSI sidecar compatibility problem, and the need to distribute **DSM management credentials** to cluster driver pods. Kubernetes v1.33.6 retains the iSCSI plugin; its implementation configures discovery/session CHAP when requested with a referenced secret. This can make NAS-side flush/session/authentication settings explicit without relying on CSI target-create defaults. It does **not** eliminate credentials if CHAP is used. [Prior block note](OBSIDIAN_NAS_BLOCK_REQUIREMENTS.md#static-iscsi-at-kubernetes-133), [Kubernetes plugin][k8s-plugin], [CHAP implementation][k8s-chap].

The minimum design still needs owned portal/IQN/LUN metadata, approved filesystem and reclaim policy, consistent NAS authentication/isolation, usable initiators and services on eligible workers, capacity monitoring, independent backup/restore and **a single-owner recovery/fencing procedure**. Storage remains NAS-backed; node mountpoints must never become durable fallback storage. Static provisioning trades automation for manual lifecycle ownership; it does not provide automatic provisioning, NAS snapshot integration, expansion or safe stale-session recovery. No manifest or provisioning instructions are proposed here.

**Decision boundary:** this alternative reduces DSM-secret exposure and Synology-CSI/sidecar uncertainty, **not the durability or fencing requirements**. Neither path is ready for an integrity-sensitive workload until actual cache/flush semantics and replacement-owner exclusion are established. No permanent worker pinning or concurrent ordinary-filesystem writers is recommended.

## Remaining evidence gates

1. Complete release-matched ARM64 sidecar/artifact and Kubernetes 1.33.6 audit; actual attach/stage/publish/unstage outcomes, not only object status.
2. Human-only non-secret DSM/SAN confirmation: effective device attributes, target authentication/masking and default/session behavior on the running NAS; NAS/drive caches and UPS/shutdown protection. Latest 2026-10-18 update supersedes the initial disabled UPS observation: the human connected USB and reports enabling UPS support; DSM shows Connected, 100% charge and standby Until low battery. Protective transitions/runtime remain untested. Global CHAP is disabled and the unsaved target wizard offers CHAP/mutual CHAP. SSD model is SNV3400-400G; the Volume 1 cache details now confirm Healthy read-write RAID 1 cache with Btrfs metadata pinning enabled. SSD power-loss protection and flush durability remain unverified. See the companion storage evidence for the full observations; UPS configuration was changed by the human, not this agent review.
3. Already-established node package/module metadata must not be mistaken for readiness. Service activation, unique IQN policy, connectivity and reconnect/logout behavior still need separately authorized validation.
4. A concrete stale-owner revocation/fencing mechanism and approved failure/recovery tests. No source reviewed here demonstrates it for this NAS/cluster.
5. Application-specific durability, missing-mount prevention, consistent backup and restore validation. No runtime integrity evidence was gathered.

## Primary sources

Synology links below are pinned to v1.3.1's exact commit. External-attacher links use its resolved v3.3.0 commit; CSI spec links use resolved v1.5.0 commit **`f1ae02418ccc363f089ee952d438f30ffdb4b4dc`** ([tag identity][spec-ref]). Linux and Kubernetes implementation links are version pinned. Public Synology help is mutable and rendered **DSM 7.4**, not an archived DSM 7.3.2 Update 4 guarantee. Kubernetes website links use the release-1.33 branch, not an immutable website commit.

[readme]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/README.md#L201-L220
[driver]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/driver.go#L68-L88
[controller]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/controllerserver.go
[parser]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/controllerserver.go#L84-L97
[boolean]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/utils/utils.go#L50-L53
[dev-conversion]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/dsm/service/dsm.go#L230-L249
[lun-create]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/dsm/webapi/iscsi.go#L137-L158
[create-existing]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/controllerserver.go#L215-L242
[identity]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/identityserver.go#L49-L61
[rpc-stubs]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/controllerserver.go#L266-L272
[go-mod]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/go.mod#L8
[csi-object]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/csi-driver.yml
[controller-manifest]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/controller.yml
[attacher-ref]: https://api.github.com/repos/kubernetes-csi/external-attacher/git/ref/tags/v3.3.0
[attacher-main]: https://github.com/kubernetes-csi/external-attacher/blob/ac8c4deb1954a72d4500aa6398459735c85782e6/cmd/csi-attacher/main.go#L195-L235
[attacher-trivial]: https://github.com/kubernetes-csi/external-attacher/blob/ac8c4deb1954a72d4500aa6398459735c85782e6/pkg/controller/trivial_handler.go#L27-L68
[attacher-test]: https://github.com/kubernetes-csi/external-attacher/blob/ac8c4deb1954a72d4500aa6398459735c85782e6/pkg/controller/trivial_handler_test.go#L40-L112
[spec-ref]: https://api.github.com/repos/container-storage-interface/spec/git/ref/tags/v1.5.0
[spec-publish]: https://github.com/container-storage-interface/spec/blob/f1ae02418ccc363f089ee952d438f30ffdb4b4dc/spec.md#controllerpublishvolume
[spec-node]: https://github.com/container-storage-interface/spec/blob/f1ae02418ccc363f089ee952d438f30ffdb4b4dc/spec.md#nodepublishvolume
[target-service]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/dsm/service/dsm.go#L174-L203
[target-api]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/dsm/webapi/iscsi.go#L278-L319
[node-login]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/nodeserver.go#L269-L318
[stage]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/nodeserver.go#L462-L497
[stage-dispatch]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/nodeserver.go#L605-L637
[publish]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/nodeserver.go#L674-L809
[unstage]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/nodeserver.go#L639-L672
[initiator]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/initiator.go
[initiator-logout]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/pkg/driver/initiator.go#L224-L240
[node-manifest]: https://github.com/SynologyOpenSource/synology-csi/blob/d6e51755fb09dc8e6979aa4f7e14649158c1b6a3/deploy/kubernetes/v1.20/node.yml
[lun-help]: https://kb.synology.com/en-us/DSM/help/ScsiTarget/lun?version=7
[kernel-cache]: https://github.com/torvalds/linux/blob/v6.8/Documentation/block/writeback_cache_control.rst
[k8s-modes]: https://github.com/kubernetes/website/blob/release-1.33/content/en/docs/concepts/storage/persistent-volumes.md#access-modes
[k8s-iscsi-doc]: https://github.com/kubernetes/website/blob/release-1.33/content/en/docs/concepts/storage/volumes.md#iscsi
[k8s-plugin]: https://github.com/kubernetes/kubernetes/blob/v1.33.6/pkg/volume/iscsi/iscsi.go
[k8s-chap]: https://github.com/kubernetes/kubernetes/blob/v1.33.6/pkg/volume/iscsi/iscsi_util.go#L87-L145

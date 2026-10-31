# Disposable vault pilot — implementation preflight

Observed **2026-10-29** against context `kubernetes-admin@kubernetes`.
Execution: [Implement and deploy the approved disposable vault pilot][execution].
Authority: [approved pilot contract][contract] and [storage/recovery contract][storage].
Those contracts control over older research proposals.

## Current outcome (2026-10-29): deployed, not accepted

The initial inventory below is historical. Isolated database/user, fresh pilot
credentials, separate Retain NFS vault/LiveSync PVCs and static Retain ext4 iSCSI
Cortex PVC are now provisioned; both bootstraps completed. Helm revision 3 runs
2/2 Ready, zero restarts at last observation on bletchley002, Pod UID
`47322d58-1906-41d6-a7a1-1e23afa39909`. A positive clean-stop observation and
session-release verification preceded its explicit pre-mount release.

Actual Mac OpenCode v2.1.4 (`barrets-m3-pro.tail55ae3f.ts.net`) connected to
`https://obsidian-pilot.tail55ae3f.ts.net/mcp` using an ignored 0600 token file.
HTTPS health 200, missing/wrong bearer 401; actual serve configs HTTPS enabled,
Funnel disabled, ClusterIP Service without external IPs. Shared grant/route
inventory is not replaced by these endpoint checks. No policy controller added.

The API-only 100-note dataset passed exact reads/properties, FTS freshness 3704 ms,
encrypted outgoing convergence 15809 ms; actual OpenCode passed core note,
frontmatter, link/rename, task, delete/recreate and selected boundary checks.
Latest instantaneous usage Cortex 6m/107 MiB and LiveSync 11m/103 MiB is **not peak
sizing**. Full meaningful health, remaining runtime/watcher/recovery tests,
unlisted-initiator denial, coordinated backup/restore/weekly retention/secure
recovery and human-device gates remain open. No backup implementation or archive
exists, no live-vault cutover occurred, and no disruptive/fencing drill ran.
See [storage checkpoint](OBSIDIAN_PILOT_STORAGE.md) and
[`kube/obsidian-pilot/README.md`](../../kube/obsidian-pilot/README.md).

## Historical outcome: initial network blocker superseded by human agreement

Cluster and SSH access work. No pilot namespace, database, credentials, PVC,
workload, endpoint or NAS resources were created. No existing vault, application
state, secrets or human-client settings were inspected. No runtime acceptance
gate has passed. Existing local changes were preserved.

The initial narrow network boundary was not established, so provisioning was
paused. The human subsequently approved [broader private reachability][network-resolution]:
any cluster workload, tailnet device or home-LAN device (`192.168.0.0/24`) may
reach Cortex. Supported bearer authentication remains mandatory for MCP access;
network reachability does not grant vault authorization. No public exposure,
Funnel, new LAN LoadBalancer or automatic token distribution is authorized.
OpenCode on the designated Mac remains the initial tested client, not the only
permitted network source. Other pilot/storage/safety gates are unchanged.

The networking decision is closed; no policy enforcer is needed or authorized
for the pilot. [Compatibility research][policy-research] is separate and
non-blocking. The observations below explain the original pause, not a current
requirement to isolate Cortex from other private sources.

## Fresh observations

- Five Ready Linux ARM64 nodes, Kubernetes v1.33.6; one tainted control plane
  and four untainted workers.
- Each node reports `4` allocatable CPU and `3772620Ki` allocatable memory
  (about 3.60 GiB). Do not size from the older nominal 8-GB-model description.
- Workers have enough request headroom for the approved combined application
  request of 300m CPU / 768 MiB at this snapshot. This excludes any additional
  helper/proxy budget and is not peak-runtime qualification. Existing memory
  limits are already overcommitted on three workers.
- Flannel v0.26.2 is deployed. No NetworkPolicy objects or policy-enforcement
  controller were observed in DaemonSet/Deployment/pod inventories.
- Worker `bletchley002` has Flannel and portmap in its only CNI conflist.
  A filtered `iptables-save` read found no common policy-enforcer chain names.
  This is not an exhaustive host-firewall audit or an allowed/denied-path test.
- The live Tailscale Connector advertises LAN `192.168.0.0/24`, Service
  `10.96.0.0/12` and Pod `10.244.0.0/16` routes. Route approval, effective
  grants, client route acceptance and the designated Mac identity remain
  unverified. Advertisements alone do not prove reachability.
- Storage inventory contains only NFS PVs, the `managed-nfs-storage` class,
  and no registered CSI driver. There is no pilot iSCSI PV; NAS target/LUN
  inventory was not refreshed. Static iSCSI does not require a CSI driver.
- The local OpenCode CLI reports `opencode v2.1.4`. This alone does not identify
  the approved Mac/device or prove its actual MCP connector compatibility.

### Worker resource snapshot

| Worker | CPU requests | Memory requests | Memory limits | Observed memory usage |
| --- | ---: | ---: | ---: | ---: |
| bletchley002 | 1106m | 1842 MiB | 4016 MiB | 1872 MiB |
| bletchley003 | 402m | 1332 MiB | 5 GiB | 2442 MiB |
| bletchley004 | 2400m | 2496 MiB | 2874 MiB | 927 MiB |
| bletchley005 | 702m | 2100 MiB | 6656 MiB | 2528 MiB |

Metrics are instantaneous, not measured application peaks or reserved capacity.
No node was selected or pinned. Recheck before scheduling; preserve the approved
per-container limits of 1 CPU / 1 GiB rather than silently raising them.

## Reproduce the read-only inventory

Use the explicit context below only after confirming it is still the intended
home cluster. These commands do not create resources or read secrets/content.

```bash
kubectl --context=kubernetes-admin@kubernetes --request-timeout=15s get nodes -o wide
kubectl --context=kubernetes-admin@kubernetes --request-timeout=15s get nodes -L kubernetes.io/arch
kubectl --context=kubernetes-admin@kubernetes --request-timeout=15s describe nodes
kubectl --context=kubernetes-admin@kubernetes --request-timeout=15s top nodes
kubectl --context=kubernetes-admin@kubernetes --request-timeout=15s get daemonsets,deployments -A -o wide
kubectl --context=kubernetes-admin@kubernetes --request-timeout=15s get networkpolicies,ingresses -A
kubectl --context=kubernetes-admin@kubernetes --request-timeout=15s get connectors.tailscale.com -o json
kubectl --context=kubernetes-admin@kubernetes --request-timeout=15s get storageclasses,persistentvolumes,csidrivers
```

Do not infer enforcement from an empty or populated policy list. No
per-source network isolation is claimed under the revised policy. Verify actual
private access paths, no public exposure, and missing/wrong-token rejection.

## Continuation gates

1. Apply the superseding private-reachability agreement. Do not install a
   CNI/controller or modify shared routes/grants simply to resume the pilot.
2. Verify the concrete Mac identity, actual Tailscale grants/routes and private
   HTTPS origin; test bearer-token enforcement and absence of public exposure.
   Denial of other cluster/tailnet/LAN sources is no longer an acceptance gate.
3. Provision static Synology iSCSI prerequisites with secure CHAP delivery,
   eligible-worker ACLs, unique initiators, flush-setting readback, target/LUN
   identity, filesystem, capacity/low-space policy and reclaim policy recorded.
   No worker-local or NFS Cortex-state fallback.
4. Continue reusable per-vault packaging, immutable image availability/native
   ARM64 checks, explicit single-owner release, fail-closed mount/state guards,
   isolated disposable CouchDB database/user and separate storage. Start Cortex
   read-only. Human device setup and all later safety/round-trip/restore tests
   remain unperformed and mandatory.

## Storage continuation — management access required

After the private-access decision, read-only SSH checks on all four workers
confirmed `iscsiadm`, an active `iscsid.socket` and the matching-kernel
`iscsi_tcp` module file. Each `/etc/iscsi/initiatorname.iscsi` currently contains
`GenerateName=yes`, not an explicit `InitiatorName=`. Stable unique initiator
identities still need to be established/read back before configuring NAS ACLs.
No initiator configuration, module load, discovery or login was performed.

The NFS class readback confirms `reclaimPolicy: Delete` and
`archiveOnDelete: "true"`. Archive-on-delete is not a backup or proof of a
recoverable coordinated application snapshot.

Opened a new browser tab to the inventory NAS management address
`https://192.168.0.43:5001`. Chrome stopped at
`NET::ERR_CERT_AUTHORITY_INVALID`; the certificate warning was not bypassed and
no DSM session or NAS inventory was accessed. The human must establish the
trusted management address/session before browser-based provisioning continues.
Do not send DSM passwords or CHAP credentials in chat.

### Subsequent provisioning

The human established the HTTPS DSM session and approved the disposable 5 GB
thick LUN. The LUN, dedicated CHAP target and worker-only permissions are now
created; FUA/Sync Cache enablement was saved and read back. Stable worker
initiator identities were configured through Ansible. See
[pilot storage inventory and outstanding gates](OBSIDIAN_PILOT_STORAGE.md).
The earlier no-mutation statements above describe the initial preflight, not
this later provisioning. No session login, filesystem format/mount, PV/PVC or
application deployment has occurred yet.

### Further continuation: verified iSCSI mapping and Kubernetes diagnostics

The trusted DSM session was rechecked successfully. Discovery and authenticated
single-worker login have now occurred on temporary initialization owner
`bletchley002`; the actual SCSI mapping is **LUN 1**, independently verified by
matching device serial to the approved NAS LUN UUID and exact 5 GiB capacity.
Missing-CHAP login was rejected. See the storage note for the precise path and
remaining access-control evidence limits. No other worker was logged in.

The `obsidian-pilot` namespace and Kubernetes native-binding diagnostic Jobs
were created. Cortex's Job completed successfully on ARM64 as UID 1000:
Node `v24.21.0`, SQLite `3.53.4`, ONNX common/node `1.30.0`. It ran only an
in-memory SQLite query/module loads, with no volumes, secrets, application
entrypoint or endpoint. This is not application startup, mount/permissions,
NFS compatibility or full runtime acceptance. The LiveSync diagnostic also
completed successfully: ARM64, UID 1000, Node `v22.23.3`, LevelDOWN `6.1.1`,
with no database opened. Neither Job ran the application entrypoint.

Ansible is confined to host initiators and controlled one-time block-device
initialization. A host CRI image pre-pull completed, but no host container was
launched; subsequent container checks and all application management use
Kubernetes. The static Retain PV/PVC has passed server dry-run only. The full-device
blank check passed with changed=0, after the first short check timed out without
formatting. Initialization subsequently completed with ext4 UUID readback,
sync/unmount/read-only filesystem check, clean logout and temporary node-record
removal. The kubelet Secret and static Retain PV/PVC were created and bound.
An explicitly Pod-UID-released Kubernetes Job passed an ext4/SQLite WAL/locking/
reopen/directory-fsync smoke check as UID 1000, removed its synthetic files and
released the session. All four workers again show no active sessions.

**New blocker:** subsequent pinned Kubernetes source inspection shows the in-tree
iSCSI plugin passes CHAP Secret values into iscsiadm argv. It suppresses command
logging, but this still conflicts with the strict no-argv instruction. This was
missed before the diagnostic mount; the credential-delivery gate is not passed.
Further mounts and application rollout are paused for
[Resolve pilot CHAP delivery versus kubelet secret-valued process arguments](https://github.com/bpafoshizle/home-kube-setup/issues/84).
No observed credential disclosure/compromise is established. The PV/PVC/Secret
remain idle. No pilot database, application or endpoint exists; no existing
human workflow was changed.

### Credential decision resolved; separate NFS qualification completed

The human accepted the disclosed standard kubelet CHAP implementation and said
“ok proceed”; [the credential decision is resolved](https://github.com/bpafoshizle/home-kube-setup/issues/84#issuecomment-6502567555).
The historical pause above is no longer active. Agent-authored commands still
must keep secrets out of argv/logs. No kubelet patch or custom host credential
distribution was introduced.

Separate Retain NFS claims `vault` and `livesync-state` are Bound on the existing
NAS provisioner. The owner-gated Kubernetes NFS diagnostic completed on
bletchley002/UID 1000: actual NFSv4 source identity, LevelDOWN separate-process
lock exclusion, synchronous put/reopen, file sync/rename and directory sync.
Only storage sentinels and synthetic state diagnostics were written, not notes.
The read-only CouchDB security-metadata audit also passed: one existing application
database checked, zero potentially accessible to a new role-free pilot user, no
vault documents read or shared permissions changed. Provisioning/bootstrap results
must be recorded separately; neither audit is application deployment acceptance.

[execution]: https://github.com/bpafoshizle/home-kube-setup/issues/72
[network]: https://github.com/bpafoshizle/home-kube-setup/issues/80
[network-resolution]: https://github.com/bpafoshizle/home-kube-setup/issues/80#issuecomment-6498974370
[policy-research]: https://github.com/bpafoshizle/home-kube-setup/issues/81
[contract]: https://github.com/bpafoshizle/home-kube-setup/issues/71#issuecomment-6498323062
[storage]: https://github.com/bpafoshizle/home-kube-setup/issues/70#issuecomment-6254996127

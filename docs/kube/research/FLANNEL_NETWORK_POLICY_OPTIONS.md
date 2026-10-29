# NetworkPolicy enforcement while retaining Flannel

Research date: 2026-10-29. Resolution asset for [Research network-policy enforcement compatible with the existing Flannel cluster](https://github.com/bpafoshizle/home-kube-setup/issues/81).

## Decision and boundary

**Evaluate kube-router v2.11.2 in firewall-only, iptables mode first, in a separately authorized lab/canary exercise.** It has independently selectable controllers, a current maintained release, and a published Linux ARM64 image. This is the smallest documented architectural change among the options examined: keep Flannel responsible for pod networking/IPAM and keep kube-proxy responsible for Services. It is **not certification of this exact cluster combination**. No reviewed source supplies a compatibility matrix covering kube-router 2.11.2 + Kubernetes 1.33.6 + Flannel 0.26.2 + these Raspberry Pi kernels + containerd 2.2.1. [KR1–KR7]

This research is **non-blocking** for the disposable Cortex pilot. The human accepted broad cluster/tailnet/home-LAN private reachability with bearer authentication and no public exposure. It neither revises that acceptance nor authorizes an installation, host change, route/grant change, workload rollout, or storage operation. No cluster/NAS/network commands were run; no secrets, vault contents, or private tailnet policy were inspected. Environment facts below are supplied by the ticket, not rediscovered or independently validated.

## Supplied environment and exact-version assessment

Five ARM64 Ubuntu 24.04.3 nodes, Kubernetes 1.33.6, Flannel 0.26.2, kube-proxy present, containerd 2.2.1; worker kernels 6.8.0-1056-raspi / 6.8.0-1057-raspi. Each node has about 3.60 GiB allocatable memory and four CPUs, with existing workload overcommit. Tailscale operator 1.94.2 and a Connector advertise LAN `192.168.0.0/24`, Services `10.96.0.0/12`, and Pods `10.244.0.0/16`; route approvals and grants remain unverified.

| Question | Evidence and limit |
| --- | --- |
| Is Flannel itself policy enforcement? | No. Flannel 0.26.2 explicitly focuses on networking and refers policy enforcement to other projects. Its README requires `br_netfilter`. A stored NetworkPolicy alone is not enforcement. [F1, K1] |
| Is kube-router maintained? | Latest release API returned **2.11.2**, published 2026-10-22 (security/toolchain/Alpine updates). Its support policy generally maintains only the current major.minor; older releases should not be selected just to resemble the Kubernetes version. [KR1, KR3] |
| Does an ARM64 artifact exist? | Docker Hub's publisher tag API returned active `linux/arm64`, digest `sha256:e6d1e6dffe8e4eb5e7a1996c1039240f1310235e58c03559e96f8a5054890c50`, for `cloudnativelabs/kube-router:v2.11.2`. Multi-platform index digest: `sha256:3e80cdbe0681f5c1cfc2e3caa8397a2b34dfe29a6de3e0baf1539ebaf8f339b5`. These are registry metadata observations, not pulled/running-image or signature verification. Build source also includes ARM64. [KR4, KR5] |
| Kubernetes 1.33.6 supported? | kube-router uses `networking.k8s.io/v1` policies, but **exact-version support is unproven**. Its tagged `go.mod` uses Kubernetes libraries 0.36.3; its netpol e2e workflow uses kind Kubernetes **1.36.1**, not 1.33.6. Dependencies and API availability are source evidence, not a backward-compatibility guarantee. [KR6, KR7, KR8] |
| Ubuntu 24.04.3 / kernel 6.8 raspi? | No exact kube-router OS/kernel support table was established. Verify running kernel configuration/modules, bridge filtering, conntrack, ipset and xtables behavior on **both kernel builds**; the version number alone cannot prove required features are present. [F1, KR2, KR9] |
| iptables-nft or native nftables? | The image includes legacy and nft iptables tools, ipset, and an iptables-wrapper selecting the existing host rules backend. That supports evaluation of iptables mode on nft-backed xtables, not blind interchangeability. kube-router's separate `--use-nftables-for-netpol` backend is explicitly **experimental**, requires `nft >= 1.0.1`, and lacks broad CNI/version validation and performance benchmarks. Leave it disabled for first evaluation. [KR9, KR10] |
| Flannel 0.26.2 + kube-proxy? | Separate firewall/router/proxy flags document coexistence architecturally. No reviewed exact Flannel-version test was found. Keep routing and service-proxy controllers off; do not run kube-proxy cleanup. Discover kube-proxy's actual iptables/IPVS/native-nftables mode later; an iptables-nft binary does **not** mean kube-proxy uses native nftables mode. [KR2, KR9, KR10] |
| containerd 2.2.1? | The user guide includes containerd examples, but no exact 2.2.1 certification. Firewall-only mode should not need DSR's CRI socket or new CNI/IPAM; this is an architectural inference. Pod creation, image pull, host mounts and restart tests remain required. Do not change containerd settings for this research. [KR2, KR11] |

## Options and migration contrasts

| Option | What it preserves / changes | Current evidence and disposition |
| --- | --- | --- |
| **kube-router firewall-only 2.11.2** | Preserves Flannel CNI, routes and kube-proxy when configured correctly; adds privileged per-node policy controller and netfilter rules/sets. | Best first candidate by change surface, not measured resource superiority. Current release and ARM64 artifact verified; exact cluster compatibility still a gate. [KR1–KR11] |
| **Calico policy + Flannel (Canal)** | Officially documented combination, but the current installation includes Calico CNI, host-local IPAM and Flannel VXLAN, not a promise to leave an existing standalone Flannel installation untouched. | Latest **3.33.0** released 2026-10-01. Requirements list ARM64, Ubuntu >=20.04, kernel >=5.10, legacy/nft iptables and kube-proxy modes, but its actively tested Kubernetes list is **1.35–1.37**, excluding 1.33. **3.31** docs list 1.32–1.35; that historical test list does not establish current maintenance of a chosen 3.31 patch. Do not recommend an old release without security-maintenance verification. [C1–C4] |
| **Calico full migration** | Replaces Flannel networking with Calico VXLAN/IPAM; not policy-only. | Documented migration requires Flannel >=0.9.1, VXLAN, Kubernetes datastore, DaemonSet installation and DirectRouting disabled. Ticket's version clears only the version prerequisite; backend/datastore/DirectRouting were not inspected. Rollback includes node drain, CNI-file removal, reboot and restoring Flannel labels/selection. Separate migration project, especially with single-writer NAS state. [C5] |
| **Cilium generic-veth chaining** | Can retain the underlying veth CNI but adds `cilium-cni` to its configuration and eBPF enforcement/agent lifecycle. | Latest **1.20.4** released 2026-10-23; current compatibility table includes Kubernetes **1.33–1.36**. AArch64 and kernel >=5.10 documented; Ubuntu >=20.04 listed. Generic-veth chaining is documented only after verifying veth; custom chaining configuration and native routing/masquerade settings are required. L7 policy/IPsec limitations apply. No exact Flannel 0.26.2 + raspi 6.8 + containerd 2.2.1 validation established. [CI1–CI4] |
| **Cilium full migration** | Changes CNI and pod lifecycle; can retain kube-proxy depending on configuration but must deliberately avoid an incidental kube-proxy replacement. | Documented dual-overlay migration uses a new non-overlapping pod CIDR, distinct encapsulation port/protocol and per-node cordon/drain/reboot. Existing policy provider is an untested migration case, and Cilium policy is disabled during migration. Not a low-impact enforcement addon. [CI5] |

The old guessed Cilium Flannel-specific URL returned 404; it is **not** evidence that all Flannel chaining is unsupported. The current generic-veth guide is the relevant conditional primary source. Cilium's requirements specifically mention `linux-modules-extra-raspi` for **Ubuntu 22.04**; do not extrapolate that package prescription to these 24.04.3 kernels without checking their module packaging/configuration. [CI3, CI4]

Flannel latest was **0.28.10** (2026-10-08), whereas this cluster uses 0.26.2. That establishes version distance, not an EOL finding. Keep any Flannel/Kubernetes/kernel upgrade separate from initial enforcement evaluation so failures have an attributable cause. [F2; recommendation]

## Future kube-router installation contract — not an executable manifest

The intended explicit controller settings, subject to review against the pinned image's actual `--help`, are:

```text
--run-firewall=true
--run-router=false
--run-service-proxy=false
--run-loadbalancer=false
--enable-cni=false
--use-nftables-for-netpol=false
--netpol-default-deny=false
--service-cluster-ip-range=10.96.0.0/12
```

These select policy-only functionality; they are **not sufficient installation instructions**. Review RBAC/service-account authentication, probes, resource reservation, host mounts, node coverage, privileges, image digest and rollout/cleanup together. Pin a verified release/digest instead of `latest`. [KR2, KR11]

**Do not apply the upstream `kube-router-firewall-daemonset.yaml` unchanged.** At tag 2.11.2 it still contains an `install-cni` init container that can remove `*.conf`, write `10-kuberouter.conflist`, and install CNI binaries under the host `/opt`. It uses an unversioned image, a host kubeconfig path, host networking/PID and privileged access; it has no resource reservation. Even setting `--enable-cni=false` on the main process cannot neutralize a separate init-container script. A future reviewed policy-only manifest must omit CNI-writing init steps/ConfigMap and unnecessary writable CNI/binary mounts, and retain only justified host access. [KR11]

Required future host investigation (read-only first, separately authorized):

- Inventory **all existing NetworkPolicies** before enabling a controller: previously inert policies anywhere in the cluster could suddenly apply. Namespace-scoped workload rollout is not the same thing as namespace-scoped controller installation. [K1]
- Confirm Flannel backend, bridge/interface layout, CNI configuration ordering, MTU, service CIDR, node PodCIDRs and kube-proxy mode. Do not change bridge/routing/IPAM ownership. For bridged traffic, check `br_netfilter` and `net.bridge.bridge-nf-call-iptables` (and IPv6 equivalent if used), plus `physdev` matches: the tagged policy source explicitly installs bridged FORWARD rules. Validate same-node traffic, not only inter-node overlay traffic. [F1, KR12]
- Verify netfilter/conntrack, ipset/set matches, mark/comment/conntrack/REJECT and relevant TCP/UDP/SCTP facilities on both raspi kernel builds; confirm that host and container userspace tooling can read/update the same rules backend. Upstream advises keeping netfilter tooling versions aligned. Do not change system alternatives speculatively. [KR2, KR9, KR12]
- Account for Flannel, kube-proxy, Tailscale, host firewall/UFW and other netfilter writers: rule ordering, marks, locking and backend coexistence need runtime testing. Review `/run/xtables.lock` sharing and read-only module access; do not flush rules or disable host security as a shortcut. [KR2, KR9, KR11; test requirements]
- Run enforcement on every node that can host selected workloads, with explicitly reviewed tolerations/coverage. A controller absent on a destination node is not an isolation guarantee. A node-limited lab/canary must keep synthetic endpoints on covered nodes and must not be advertised as cluster-wide protection. [KR12; architectural inference]
- Privileged host-level networking is new trusted infrastructure. Standard policies are not isolation from a compromised node, privileged host agent or shared pod loopback; kube-router explicitly excludes `hostNetwork` pods from actionable policy targets. Containers/sidecars in the same pod share the boundary. [KR13, K1]

## Tailscale paths, NAT and principals

The supplied route advertisements potentially offer **alternate paths around an ingress proxy**. Narrowing one proxy's policy does not remove direct Pod/Service/LAN paths. Advertisement, approval, client route acceptance and access grants are separate requirements; none of the private approvals/grants was verified here. Operator documentation describes Connector subnet routing and proxy behavior, while tagged 1.94.2 source provides version-specific packet-path evidence. [T1–T5]

| Path | Identity likely available at the application/policy boundary | Consequence / required verification |
| --- | --- | --- |
| Cluster pod → Service/Pod | Pod IP/labels; Service DNAT changes the destination. Source may also change on some Service paths. | Prefer combined namespace+pod selectors for known pod peers, with port restrictions; test direct Pod IP and ClusterIP, local and remote endpoints. Kubernetes deliberately leaves NAT-versus-policy ordering implementation-dependent. [K1] |
| Tailnet client → operator L7 ingress → Service | Serve terminates the incoming connection and creates a backend connection: peer is the proxy pod (or an additionally translated node), not an end-user pod selector. | Tailnet grants authorize the caller before proxying; backend NetworkPolicy can allow the proxy, not a Tailscale user/tag identity. Treat this as connection-model inference until observed. Keep bearer authentication; do not equate source allowlisting with application authorization. [T2, K1] |
| Tailnet client → operator L3 Service exposure | DNAT from proxy tailnet IP to ClusterIP; default Tailscale subnet SNAT and later kube-proxy translation can erase original source. | Tagged proxy template uses kernel mode (`TS_USERSPACE=false`); tagged forwarding code installs DNAT, and firewall source includes marked subnet MASQUERADE. Inspect actual mode/config and synthetic observed source rather than promising either client-IP preservation or always a proxy-pod IP. [T2, T4, T5] |
| Tailnet client → Connector → advertised Service or Pod CIDR | Default subnet SNAT generally makes the router the source; subsequent Service/Flannel transformations may expose a node instead. | A broad allow for the Connector admits every caller that its tailnet policy allows through that path. NetworkPolicy cannot recover the original user/tag after SNAT. Test both CIDRs independently of ingress DNS. [T1, T3–T5, K1] |
| Tailnet client → Connector → LAN; or direct home-LAN client → node/Service | Router/LAN/node identity, depending on route and Service handling; some traffic never enters a selected pod boundary. | Policy-only workload isolation does not secure the entire NAS/LAN, host ports or host-mounted storage. Preserve the existing accepted private-reachability model until a new human-approved decision changes it. [T3, K1] |

Disabling subnet SNAT is **not** a harmless fix: Linux supports it, but return routing for tailnet addresses then has to exist. That changes routing/security assumptions and is expressly outside this research. Tailscale users/tags are principals evaluated by tailnet access control; Kubernetes labels/IP CIDRs are different identities, and bearer tokens are yet another application-level check. A blanket allow for `100.64.0.0/10`, all node IPs or the whole LAN is not user-level least privilege. [T3, K1; security interpretation]

For any later source-observation test, use synthetic request IDs and connection metadata/counters only. Do not capture application payloads, bearer headers, vault data, credentials or private tailnet policy in the research asset.

## Selective enforcement and dependency accounting

Kubernetes defaults to allow in each direction until a policy selects the pod for that direction. Policies are additive; an allow-all elsewhere can defeat a restrictive-looking policy. Both source egress and destination ingress must permit a pod-to-pod connection. **Enabling kube-router's global `netpol-default-deny` is not the recommended selective rollout.** Keep it false and explicitly select only a disposable test namespace/workload after reviewing dormant policies cluster-wide. NetworkPolicy has no universal dry-run/status proving dataplane enforcement. [K1, KR14]

Future dependency checklist (design/test requirements, not observed traffic):

- DNS: allow both UDP/TCP 53 to the actual resolver path; distinguish CoreDNS pods from node-local/host-network DNS. Test large/truncated answers that fall back to TCP. A blanket egress deny otherwise blocks DNS. [K1]
- Application: enumerate actual LiveSync/Cortex/CouchDB and backup/monitoring paths, peer namespace/pod selectors and configured ports. Include init containers, sidecars, callbacks and readiness probes; shared-loopback containers cannot be separated with pod policy. Do not inspect secrets to discover endpoints. [K1]
- API: kube-router needs API list/watch access; application/API access, when required, may use ClusterIP TCP 443 → API TCP 6443/host endpoint. Validate both policy/NAT processing and RBAC separately. Do not broadly allow all control-plane/node ports. [KR2, K1]
- NAS NFS/iSCSI: separate application-originated network calls from kubelet/kernel/node-initiated mounts/sessions. Pod egress rules are **not** assurance that host-mounted NFS or iSCSI is blocked. Validate node→NAS mount/session/reconnect and actual configured NFS version/ports; NFSv3 can involve auxiliary RPC ports, so do not assume a single-port recipe. Preserve the already-decided single-writer/fencing and storage-recovery contract. No mount, session reset or storage test was performed. Kubernetes documents these as persistent mounted volume types, not application TCP proxies. [K2, K1; boundary inference]
- Tailscale: keep operator/proxy control-plane and data-plane connectivity out of an initial workload-only deny. If later policies select those pods, inventory their DNS, coordination/relay/direct-path and API dependencies separately. Do not copy a generic port allowlist without observing configured paths. [T1, T2; operational recommendation]

## Resources and operational acceptance

There is no measured five-node ARM64 policy-only RSS/CPU budget in the reviewed sources. Upstream's small-footprint description is not a sizing guarantee. A DaemonSet means **five additional agents**, with host-kernel rule/set/conntrack memory as well as container memory; pod/policy/endpoint churn affects update work. Calico/Cilium require their own agent/control-plane and kernel-state budgets; no numerical superiority claim is warranted here. [KR8, KR12, CI3; inference]

For a later lab only, a **proposed reservation envelope**, not vendor guidance: reserve 100m CPU and 128 MiB per agent (500m / 640 MiB cluster-wide), and evaluate at least 256 MiB per-node memory headroom for a trial ceiling (1.25 GiB across five nodes). 128 MiB is ~3.5% of each 3.60 GiB allocatable node; 256 MiB is ~6.9%. These illustrative numbers must be replaced by measured steady-state and churn/restart peaks **before** production approval. They are not evidence the process fits or safe OOM limits. Existing overcommit can make even this reservation infeasible. Include image disk space, kernel slab/conntrack growth, API-watch load and sync latency; avoid low CPU limits that silently delay policy convergence. The upstream example's system-node-critical priority could evict application work under pressure and must be explicitly reviewed. [KR11; proposed budget]

Observe health, last successful sync/errors, ruleset/set growth, actual drops, CPU/RSS/kernel memory, API availability and pod restarts. Health probes alone do not prove enforcement. Assign an owner for CVE/release tracking and pin/review upgrades; do not combine an agent upgrade with Flannel, kube-proxy, containerd or kernel changes. Upgrade one reviewed node at a time and rerun the traffic matrix. kube-router's guide recommends a single-node upgrade trial and calls out minor-release breaking changes. [KR3]

## Required tests before any later compatibility claim

All below require a **new authorized execution task** using synthetic disposable data. They were not run here.

1. **Baseline / preserve ownership:** inventory nonsecret CNI/routing/rules-backend metadata and existing policy specs; record synthetic allow/deny and source-IP observations. After adding the policy-only agent with no new restrictive policies, prove existing pod/Service/DNS/NAS-dependent workload connectivity unchanged and Flannel/kube-proxy still own their original functions. Confirm no CNI files/binaries/routes changed.
2. **Enforcement, not API acceptance:** explicit allow and deny TCP/UDP tests, same-node and cross-node, in both directions; namespace+pod selector intersection, wrong labels/namespaces, named ports if used, ipBlock exceptions, Service versus Pod IP, and new versus established connections. A failed ping is neither necessary nor sufficient: policy semantics for ICMP are not the TCP/UDP contract. [K1]
3. **All reachability paths:** approved and denied synthetic tailnet principals through L7/L3 proxy, direct Connector Service CIDR and Pod CIDR, direct LAN and node/host-network paths. Record translated peer IP at each workload boundary; test allowed proxy identity without assuming it identifies an end user. Confirm missing/invalid application bearer authentication still fails through every allowed path.
4. **Dependencies / negative scope:** DNS UDP/TCP, application peers, API where needed, health checks, and node-side NFS/iSCSI reconnect/recovery with disposable storage only and the existing fencing rules. Confirm unrelated namespaces/workloads and existing CouchDB remain unaffected. No force-rescheduling of a potentially live writer.
5. **Lifecycle / failures:** both raspi kernel builds; pod creation/reschedule/IP reuse, agent restart/OOM/API interruption, policy/label changes, node reboot, policy convergence under churn, and upgrade/downgrade. Measure initial pod exposure and recovery gaps; a watcher-based addon must not be assumed to gate every CNI ADD before traffic can flow. Existing connection behavior is implementation-dependent. [K1, KR12]
6. **Removal:** restore test workload reachability by policy rollback while controller is healthy; remove controller and clean only its owned state with an audited per-node procedure; verify no leftover drops or accidental removal of Flannel/kube-proxy/Tailscale rules. Prove recovery after a failed partial rollout and after reboot, not just happy-path uninstall. [KR2, KR12, KR15]

## Rollback and persistence hazards

- First revert only the newly introduced restrictive policies/labels (or restore a reviewed allow policy), while reconciliation is healthy, and verify **new** synthetic connections. An allow-all is a deliberate temporary loss of isolation, not a successful security test. Existing connections may survive policy changes. [K1]
- Deleting a DaemonSet is not a netfilter cleanup guarantee: kernel chains/sets can remain after process exit. Upstream explicitly instructs removal followed by per-node cleanup. Conversely, a reboot can temporarily remove rules until the agent reconstructs them; do not rely on either persistence or immediate recovery without tests. [KR2, KR12]
- `--cleanup-config` is **not obviously firewall-only**: tagged `CleanupConfigAndExit` invokes policy, service-proxy and routing controller cleanup even when router/proxy were disabled during normal operation. Audit exact release behavior and test it offline before authorizing privileged cleanup; do not paste the documentation's broad `latest` cleanup container into this cluster. Verify no other component shares state it would delete. [KR15]
- Never use a global iptables/nftables flush, indiscriminate ipset destruction, kube-proxy cleanup or CNI-directory removal as addon rollback. Preserve Flannel/CNI/kube-proxy/Tailscale state; hold an independent management path and version-pinned recovery artifacts. Track every node, including unreachable ones with stale policy state. These are safety requirements, not executed steps.
- Backend switches are migrations too: tagged kube-router initialization cleans old policy-backend state when changing iptables/native-nft mode. That introduces a transition to test, not a reason to turn on experimental native nftables. Reverting to an older image may require more than changing its tag if rule formats or defaults changed. [KR10, KR16]
- Calico/Cilium chaining/full-CNI rollback additionally involves CNI configuration, pod recycling and possibly drains/reboots; persistent BPF resources also survive Cilium agent restarts via bpffs. Network downtime must not be turned into unfenced NAS writer failover. [C5, CI3, CI5]

## Remaining limits and next decision

Research establishes a maintained **candidate** and concrete hazards, not tested support. Still unverified: exact kube-router/Kubernetes 1.33.6 interoperability; actual kube-proxy/backend mode; Flannel backend and bridge sysctls; per-kernel modules; agent and kernel memory headroom; dormant policy blast radius; actual Tailscale grants/approved routes/mode/NAT peer identity; controller lifecycle gaps; NAS host paths; and rollback cleanliness. No finding changes the accepted broad private pilot reachability or adds a dependency blocking that pilot.

If the human later wants workload isolation, request approval for a bounded **kube-router policy-only lab/canary**, budget and rollback plan first. If exact-version interoperability or host-backend tests fail, stop rather than certifying by analogy; evaluate a separately planned Calico/Cilium path or an independently approved cluster-version upgrade.

## Primary sources

All accessed 2026-10-29. Tagged source links are preferred where available; `latest`/`stable` documentation is moving and its observed version is stated above.

- **KR1** — [kube-router 2.11.2 release](https://github.com/cloudnativelabs/kube-router/releases/tag/v2.11.2), [latest-release API](https://api.github.com/repos/cloudnativelabs/kube-router/releases/latest).
- **KR2** — [kube-router user guide](https://www.kube-router.io/docs/user-guide/): controller flags, privilege/tooling requirements, containerd and cleanup.
- **KR3** — [2.11.2 upgrade/support policy](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/docs/upgrading.md).
- **KR4** — [publisher Docker Hub 2.11.2 tag metadata](https://hub.docker.com/v2/repositories/cloudnativelabs/kube-router/tags/v2.11.2).
- **KR5** — [2.11.2 build architecture/manifests](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/Makefile).
- **KR6** — [2.11.2 Kubernetes dependencies](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/go.mod).
- **KR7** — [2.11.2 netpol e2e workflow](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/.github/workflows/ci-e2e-netpol.yml).
- **KR8** — [2.11.2 README](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/README.md): NetworkPolicy API and footprint claims.
- **KR9** — [2.11.2 Dockerfile](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/Dockerfile): netfilter tools, wrapper, architecture checks.
- **KR10** — [2.11.2 experimental native-nftables documentation](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/docs/nftables.md). Illustrative commands in this document are not validated installation instructions.
- **KR11** — [2.11.2 firewall DaemonSet example](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/daemonset/kube-router-firewall-daemonset.yaml).
- **KR12** — [2.11.2 iptables policy controller](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/pkg/controllers/netpol/npc_iptables.go), [pod firewall/bridge handling](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/pkg/controllers/netpol/pod.go).
- **KR13** — [2.11.2 actionable-pod predicate excludes hostNetwork](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/pkg/controllers/netpol/utils.go#L34-L36).
- **KR14** — [2.11.2 actual option definitions/defaults](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/pkg/options/options.go).
- **KR15** — [2.11.2 cleanup and controller startup](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/pkg/cmd/kube-router.go#L107-L122).
- **KR16** — [2.11.2 backend selection/old-state cleanup](https://github.com/cloudnativelabs/kube-router/blob/v2.11.2/pkg/controllers/netpol/network_policy_controller.go#L291-L305).
- **F1** — [Flannel 0.26.2 README](https://github.com/flannel-io/flannel/blob/v0.26.2/README.md).
- **F2** — [Flannel 0.28.10 release](https://github.com/flannel-io/flannel/releases/tag/v0.28.10).
- **K1** — [Kubernetes NetworkPolicy semantics and limitations](https://kubernetes.io/docs/concepts/services-networking/network-policies/). Moving page includes newer-version discussion; no new post-1.33 feature is assumed for this cluster.
- **K2** — [Kubernetes NFS and iSCSI volumes](https://kubernetes.io/docs/concepts/storage/volumes/).
- **C1** — [Calico 3.33.0 release](https://github.com/projectcalico/calico/releases/tag/v3.33.0).
- **C2** — [Calico 3.33 system requirements and test matrix](https://docs.tigera.io/calico/3.33/getting-started/kubernetes/requirements).
- **C3** — [Calico policy with Flannel/Canal](https://docs.tigera.io/calico/3.33/getting-started/kubernetes/flannel/flannel).
- **C4** — [Calico 3.31 requirements and Kubernetes test matrix](https://docs.tigera.io/calico/3.31/getting-started/kubernetes/requirements).
- **C5** — [Calico Flannel migration prerequisites and revert procedure](https://docs.tigera.io/calico/3.33/getting-started/kubernetes/flannel/migration-from-flannel).
- **CI1** — [Cilium 1.20.4 release](https://github.com/cilium/cilium/releases/tag/v1.20.4).
- **CI2** — [Cilium stable Kubernetes compatibility](https://docs.cilium.io/en/stable/network/kubernetes/compatibility/), observed 1.20.4-era docs.
- **CI3** — [Cilium system requirements](https://docs.cilium.io/en/stable/operations/system_requirements/).
- **CI4** — [Cilium generic-veth chaining and limitations](https://docs.cilium.io/en/stable/installation/cni-chaining-generic-veth/).
- **CI5** — [Cilium 1.20 migration procedure and limits](https://docs.cilium.io/en/v1.20/installation/k8s-install-migration/).
- **T1** — [Tailscale operator Connector routing](https://tailscale.com/kb/1441/kubernetes-operator-connector).
- **T2** — [Tailscale L7/L3 ingress architectures](https://tailscale.com/kb/1439/kubernetes-operator-cluster-ingress).
- **T3** — [Subnet routers, route approvals, access controls and SNAT](https://tailscale.com/kb/1019/subnets).
- **T4** — Tailscale 1.94.2 [kernel-mode proxy template](https://github.com/tailscale/tailscale/blob/v1.94.2/cmd/k8s-operator/deploy/manifests/proxy.yaml), [ingress forwarding](https://github.com/tailscale/tailscale/blob/v1.94.2/cmd/containerboot/forwarding.go).
- **T5** — [Tailscale 1.94.2 iptables DNAT/SNAT/marked MASQUERADE implementation](https://github.com/tailscale/tailscale/blob/v1.94.2/util/linuxfw/iptables_runner.go).

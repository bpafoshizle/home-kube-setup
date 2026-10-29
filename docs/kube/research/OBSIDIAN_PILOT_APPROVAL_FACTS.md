# Obsidian pilot approval: factual prerequisites for issue 71

Research date: **2026-10-18**. Scope: factual support for [pilot approval #71][71], not approval, implementation, provisioning or runtime acceptance. No application/image execution, cluster/NAS mutation, secret or vault-content inspection, tracker changes, or further agents. Existing local notes were read without modification.

## Evidence and decision precedence

- **Decision evidence:** [closed #70 resolution][70] is authoritative for storage/recovery. All durable workload data stays on Synology: separate NFS vault and **conditional NFS LiveSync state** PVCs; separate administrator-managed **static Synology iSCSI** Cortex state with a single-worker filesystem. No CSI installation, worker-local persistence, empty-directory fallback or permanent storage-driven worker pinning. Do not reopen these choices.
- Exactly one owner; stop-before-start updates; explicit operator release on ownership transfer. Manual recovery requires physical power-off fencing of the former worker, keeping it off through transfer, disappearance of its storage session, NAS/filesystem checks, verified mounts/identity/state on a compatible replacement, then explicit release of one writer. Return of the former worker requires controlled cleanup. Unreachable/NotReady, force deletion, RWO and session disappearance alone are not fencing. [70]
- Weekly coordinated stopped-application backups; retain the latest **two successful** backups, configurable schedule/retention/destination. Cover vault, complete sync state/settings/bookkeeping, Cortex index/auth DBs and sidecars, secure configuration/credential recovery. Initial backup destination is separately on Synology: NAS-loss recovery is explicitly not supplied. Recent acknowledged-write loss is accepted **only for the disposable pilot**. Missing state does not authorize automatic recreation. [70]
- **Inherited technical evidence:** read all #69 comments and its [published commit-pinned runtime contract][runtime]. Its 2026-10-11 registry observations and source review are evidence, not successful runtime tests. This session did not re-query GHCR, so current retention/availability is unverified. Its recommendation to keep LiveSync state off NFS is superseded by #70, not silently carried forward.
- **Fresh source reads:** Cortex config, router, OAuth provider, tool registry and CRUD schemas at the image revision below were read through GitHub's contents API. Local `OBSIDIAN_HEADLESS*.md` and relevant manifests were also read. All proposed fixtures and pass criteria below remain unexecuted; they are not vendor guarantees. [config][router][oauth][registry][crud]

## 1. Exact immutable ARM64 artifact candidates

These are the candidates resolved by #69, not a request to adopt a newer mutable tag. [69][runtime]

| Component | Immutable OCI index deployment reference | Linux ARM64 child manifest |
| --- | --- | --- |
| LiveSync CLI, observed `edge` | `ghcr.io/vrtmrz/livesync-cli@sha256:18bd63c1f7fe7a84121166a4c6f173871f8266b3bcec4bf5a2e4ada64f4b6de5` | `sha256:7aa7f5a33a6bd3ae5b394cd52fef89c2530b7403d5b7485001478cf2e6b2c141` |
| Cortex **MCP-only/local**, observed `v0.54.12` | `ghcr.io/aliasunder/vault-cortex@sha256:2ad32d433956fa96764ca6afffee9470ec4f1cd51dcb734615f52b121be8b0e5` | `sha256:1a0fc1a4d20cb589fdae3213fa049185d7453601db67e7f30738e27c17c69aa1` |

Both indexes were observed containing Linux AMD64 and ARM64; attestation `unknown/unknown` entries are not executable platforms. Pin index or ARM64 child and require `kubernetes.io/arch: arm64`. LiveSync publisher provenance names reviewed source `14141446a14deab3353a8864dee41e44c372d006`. Cortex image revision is **`8a512669aeae9e8318779421d1adcf05624153ab`**, not the later `7e592467…` snapshot used by initial local notes. Later date-error wording must not be assumed present. [runtime]

The older LiveSync stable `1.0.32-cli`/then-`latest` index was `sha256:2d8271d56c8e192f24f92c600a595f102d5d9e7d8f6fa3f0943aadffddf2c1df`, ARM64 child `sha256:ed29f0941f0ec7739d3c798336e7decf3114fedd4ad847a841ba32390e689ebe`; using it requires reviewing its older behavior. `1.0.35-cli` returned 404 in #69. Tag aliases may have moved since then. Signatures, vulnerability posture, reproducibility, successful pulls and Raspberry Pi native-binding boot are **not established**. [runtime]

## 2. Runtime settings, resource defaults and capacity limits of evidence

| Setting | Source fact / inherited contract | What is not established |
| --- | --- | --- |
| LiveSync invocation | Preserve wrapper; `LIVESYNC_DB_PATH=/data`, args `["--vault","/vault","daemon"]`. Empty args print help; `sync` alone does not materialize vault files. Bootstrap is separate and single-owner. [runtime] | Correct disposable DB identity/configuration, actual E2EE/client interoperability and successful bootstrap. |
| State separation | LiveSync `/data` is its own conditional-NFS PVC; `.livesync-snapshot.json` also lives under `/vault`. Cortex `INDEX_DB_PATH=/data/index.db` has sibling `oauth.db`, including WAL/associated files on its own static iSCSI PVC. Read-only vault mode still writes index/auth state. [70][runtime][config][oauth] | Provisioned target/LUN/PV, filesystem, capacity and effective storage permissions. |
| Identity/native code | Cortex local image uses `node` (1000:1000), tini, Node 24, Debian/glibc and native SQLite/ONNX stack. LiveSync uses Node 22/native LevelDOWN and defaults to root. UID/GID 1000 for both is a **proposed** non-root configuration, not a tested property of NAS mounts. [runtime] | ARM64 native boot, root-squash/ACL behavior, security-context and writable-path compatibility. Image chown/fsGroup do not prove mount ownership. |
| Actual Cortex feature defaults | `MEMORY_ENABLED=true`, `EMBEDDING_ENABLED=true`, `RERANK_MODE=blended`, `FILE_TOOLS_ENABLED=true`, `READONLY_MODE=false`, `WINDOWS_MODE=false`, `TRASH_RETENTION_DAYS=30`; proxy-trust hop counts default 0. [config] | Suitability of these defaults for Pi resources or desired note conventions. Memory may bootstrap `About Me/`; embedding/reranking may download models. [runtime] |
| Research starting profile, **not approved sizing** | `READONLY_MODE=true`, read-only Cortex vault mount; `MEMORY_ENABLED=false`, `EMBEDDING_ENABLED=false`, `RERANK_MODE=none`. Later writable phase changes both flag and mount. Keep `OBSIDIAN_SYNC` unset/false: it denotes the different bundled proprietary Sync target. [runtime][config] | Whether optional file tools, task extras and model features are required. No path-scoped write authorization is created by these flags. |
| File/health defaults | File read cap 50 MiB, image output 48 KiB, PDF pages 5. These are not a global indexing/RSS cap. Index rebuild/watcher readiness precede listen. `/healthz` is unauthenticated and returns basic process health, not synchronization/index freshness. [config][runtime] | Startup deadline, backlog/freshness/conflict checks, health thresholds. |
| CPU/RAM | No established Kubernetes CPU/memory defaults or measured pilot requests/limits in the candidate images/runtime report. [runtime] | Per-container requests/limits, namespace quota, schedulable headroom, peak RSS/CPU, NAS metadata load, state growth and scan duration. Do not invent a measured sizing result. |

**Repository capacity evidence, not a fresh live audit:** README says Raspberry Pi 4 **8GB models**; later recorded inventory reports five ARM64 Ubuntu 24.04.3 / Kubernetes 1.33.6 nodes (one control-plane, four workers). README's OS summary is older; do not mistake 5 × nominal RAM for allocatable workload capacity. No current per-node allocatable, requests totals, utilization or placement headroom was collected here. [readme][inventory]

Existing manifest budgets illustrate competing workloads, not spare capacity or pilot sizing: CouchDB requests 100m/256Mi, limits 500m/512Mi; OpenClaw main defaults 200m/512Mi → 2000m/2Gi and Chromium 100m/256Mi → 1000m/1Gi; CitePulse overrides main memory to 1Gi request/4Gi limit; OpenCode main is 200m/512Mi → 2000m/2Gi. These are repository settings, not verified deployed totals. [couch][openclaw][citepulse][opencode]

LiveSync remote `--interval 30` is seconds between replication cycles, **not filesystem polling**. Its candidate Chokidar filesystem polling is `CHOKIDAR_USEPOLLING=1`, `CHOKIDAR_INTERVAL=2000` milliseconds. Cortex `WINDOWS_MODE=true` selects 300ms watcher polling with 2000ms write-stability wait **and changes move/exclusive-write behavior**. Neither native watching nor polling is accepted on this NFS setup yet; benchmark both writer directions. At least 30 seconds pod shutdown grace is a research starting suggestion (Cortex has a 10-second force-exit fallback), not a measured durability guarantee. [runtime][config]

## 3. Cortex operations: supported surface versus acceptance scope

Issue 71 asks the human to approve required operations; this table describes source-supported candidates, not a newly settled mandatory product scope. Query the exact running image's `tools/list` during the later pilot. [71][registry][runtime]

| Candidate operation gate | Supported API / meaningful assertion |
| --- | --- |
| Read/create | `vault_read_note`; `vault_write_note({path,body,properties})`. Default `overwrite:false` refuses collision. Verify Unicode, nested paths, LF/body/frontmatter and preserved unrelated text. [crud] |
| Edit | `vault_patch_note`, `vault_replace_in_note`, span/anchor tools; whole rewrite uses explicit `overwrite:true`, not a merge. Appends/retries can duplicate content. Test failure without unintended mutation. [crud][registry] |
| Frontmatter | `vault_update_properties`: shallow merge, null deletes key, arrays replace; `replace:true` intentionally replaces the full properties block. Verify types/body and invalid YAML handling. [crud] |
| Search/link graph | `vault_search`, tag/property/folder queries, backlinks/outgoing links. Embeddings disabled means full-text rather than semantic search. Verify index catches API writes **and** incoming LiveSync writes. [registry][runtime] |
| Rename/move | `vault_move_note({old_path,new_path})` for `.md` notes, no destination overwrite; rewrites links with index-dependent backlink discovery. Test aliases, headings, relative attachment links, duplicate basenames, case-only rename and failure/retry. It is not a multi-file transaction. [crud][runtime] |
| Delete | `vault_delete_note({path,prune_empty_folders?})`, `.md` only. Absent `.obsidian/app.json` trash setting defaults to `system`, implemented as vault `.trash/`; `local` keeps trash forever, `none` removes permanently. Caller cannot choose outcome per call. Test note disappearance, index removal, replication tombstone and recoverability separately. Hidden trash is not an independent backup or ordinary CLI-synced content. [crud][runtime] |
| Tasks | `vault_create_task`, `vault_list_tasks`, `vault_update_task`; test stable block ID, due/priority/status, completion/reopen, missing/duplicate IDs and invalid dates. Emoji/Dataview format, recurrence/subtasks/Kanban are optional compatibility gates if required; no dedicated task-delete tool exists. [registry][runtime] |
| Attachments | Registry has **`vault_read_file` and `vault_list_files` only**, no generic binary upload/write/move/delete tools. Note CRUD requires `.md`. Thus an attachment round trip must name its supported producer and verifier; do not promise Cortex can write arbitrary attachments. A human pilot peer can originate a synthetic binary, server can verify/read it and edit its referencing note. Requiring server-origin binary writes is a capability gap to resolve explicitly, not permission for direct NAS writes. [registry][crud] |

Neither Cortex nor CLI runs arbitrary Obsidian plugins, Dataview queries or the Tasks UI. CLI excludes dot-prefixed paths including `.obsidian`; task/daily-note/delete settings must be intentional synthetic configuration rather than assumed synced human configuration. Cortex per-file locks are in-process only; they do not serialize LiveSync or remote human writers, provide expected-version writes, or prevent stale edits. Scoped inbox usage is a convention, **not an enforced full-vault authorization boundary**. Lexical path checks are not a realpath symlink sandbox; exclude symlinks or explicitly test escape behavior. [runtime][headless]

## 4. Authentication, actual clients and private exposure

- Cortex requires nonempty `MCP_AUTH_TOKEN` and a bare-origin `PUBLIC_URL` (no `/mcp` suffix/path prefix). `VAULT_PATH=/vault`, `INDEX_DB_PATH=/data/index.db`, HTTP default host `0.0.0.0`, port 8000; endpoint is origin + `/mcp`. No supported unauthenticated switch. Tailscale does not replace application authentication. [runtime][router]
- **Static bearer:** every protected request carries `Authorization: Bearer <MCP_AUTH_TOKEN>`. Exact static-token verification yields client `static`, scope `vault`, effectively perpetual access; no browser onboarding needed. It does not establish per-agent identity or per-path/per-tool privileges. **OAuth:** PKCE/onboarding, consent gated by the same service token, six-hour access JWTs, rotating refresh tokens with 60-day inactivity expiry and SQLite state. Fresh source also shows registration forces **`client_secret_post`** with an issued secret; actual clients must support that flow, not merely advertise generic OAuth. Token rotation invalidates old JWT/refresh verification; any rotation must be scoped/approved, not applied to existing CouchDB users. [oauth]
- Stateful **Streamable HTTP**: initialize → initialized notification → tools/list → tools/call, negotiated protocol, returned `Mcp-Session-Id`; clients need appropriate `Accept: application/json, text/event-stream`. POST/GET/DELETE all require bearer auth; authenticated GET deliberately returns **405** (no standalone SSE stream). Sessions are memory-only and must reinitialize after restart. Old SSE-only or stdio-only clients are not automatically compatible. [router][runtime]
- Repository OpenClaw/OpenCode configuration is **not evidence of a working Cortex HTTP MCP connector**. No actual client connection was tested. Approve named client/version, where its connector runs, private DNS/TLS reachability, header or OAuth capabilities, credential delivery and restart behavior. A hosted connector outside the tailnet cannot reach a private service just because the user's browser can. [headless][runtime]

### Existing network facts and unresolved enforcement

- CouchDB's repository pattern uses Tailscale-class HTTPS Ingress at a dedicated host, backend `couchdb-svc-couchdb:5984`. This is a pattern to evaluate, not a pre-existing Cortex endpoint. CouchDB values also request a LoadBalancer Service; do not copy that blindly into a tailnet-only Cortex design. Existing human CouchDB exposure is not authorized to change. [ingress][couch]
- Connector manifest advertises **home LAN `192.168.0.0/24`, Service CIDR `10.96.0.0/12`, Pod CIDR `10.244.0.0/16`**. Script says route approval/client route acceptance are required; it supplies only an example `autoApprovers` block, not effective allow/deny grants. Consequently **ClusterIP alone is not proof that only chosen tailnet clients can reach a service**, if these routes are approved/accepted and grants permit access. Actual grants, approved routes and operator proxy tags were not inspected. [connector][tailscale]
- Repo installs Flannel; no enforcing policy controller was established. CouchDB disables NetworkPolicy; OpenClaw chart policy defaults disabled and explicitly warns Flannel alone will not enforce it. No active cluster isolation guarantee follows from an example YAML policy or the CouchDB comment that Tailscale handles isolation. [flannel][couch][openclaw]
- Approval still needs a named private hostname/origin, chosen permitted tailnet principals/devices/tags and port, intended in-cluster clients/namespaces, denial of other cluster/LAN/public paths, and demonstrated enforcement. Test allowed and denied paths through both private ingress and subnet-routed Service/Pod addresses. Container application auth remains necessary even if network denial works. These are open facts/policy gates, not authorization to install a new CNI or edit grants. [71][router][connector]

## 5. Human-only interactions versus later automatable tests

**Human-required for this approval/workflow:**

1. Agree isolated synthetic vault/database identity and scope, actual Mac/iOS + installed LiveSync plugin versions, E2EE compatibility scenario, exact required operations and clients; approve read-only then writable phases and explicit convergence/resource/test thresholds. No existing vault/settings export may be repurposed without authorization. [71]
2. On actual human devices, create/connect a disposable Obsidian/LiveSync peer and supply any synthetic setup export/passphrase through a secure path; observe app/plugin behavior. Create/edit/rename/delete notes and a known synthetic attachment, close the Mac app and demonstrate continued server↔CouchDB↔mobile/test-peer convergence, then reopen and compare. An API script cannot attest the real Mac/iOS application's behavior or that Mac is closed. [71][runtime]
3. If OAuth is selected, personally perform actual-client consent/onboarding and private secret entry; otherwise configure static bearer securely in the chosen client. Successful scripted HTTP calls do not prove the user's actual client supports either path. [oauth][71]
4. Approve/verify Tailscale client identities/grants/routes/TLS as needed; do not expose admin credentials. For actual worker transfer, the approved contract specifically requires a human to physically power off and keep off the former worker, and controlled return. Disruptive transport/power tests require separate explicit approval. [70][tailscale]

**Later automatable after authorization:** synthetic API fixtures, exact-content/hash comparison, unauthorized-token and path negatives, watcher/index timing, empty/missing-mount guards, controlled restart/shutdown, approved conflict/state-loss and backup/restore tests. None ran here. A second-NFS-client diagnostic does not relax API-only server writes. Conflict tests requiring concurrent device edits retain a human-client step. [runtime][70]

## 6. Open runtime gates / questions for the next grilling rounds

1. **Approve scope and artifacts:** one disposable DB/vault, exact digests, bootstrap sequence, chosen E2EE test settings, expected fixtures, read-only/write transition; actual ARM64 boot/native dependencies/non-root/NAS permissions remain unpassed. [71][runtime]
2. **Select required Cortex surface:** baseline note/edit/frontmatter/content-search/backlink/move/delete/task checks; decide optional task semantics and attachment producer/verification. No arbitrary binary-write promise. Define conflict recovery rather than enabling blanket newest-wins. [registry][runtime]
3. **Select actual clients/access:** static bearer versus OAuth, client/version and connector location; chosen origin/principals, cluster exposure and effective network denial. Test absent/wrong token, valid session, tool visibility, GET 405, restart and DELETE lifecycle. [router][oauth][71]
4. **Define bounded resources/health:** requests/limits from current headroom, synthetic dataset/file count, startup allowance, polling choice/cost, peak RSS/CPU/state growth, content-free replication/backlog/conflict/index-freshness evidence. Runtime report's **30-second idle convergence deadline is only a proposal**, not agreed SLA. [runtime]
5. **Qualify settled storage, do not redesign it:** LiveSync NFS lock/sync/rename/recovery behavior; both API→LiveSync and LiveSync→Cortex watchers; rapid/same-size/temp-rename/new-directory/delete/recreate/attachment events. If conditional NFS fails, return to the approved decision process, not silently move state to workers. [70][runtime]
6. **Implement/validate static iSCSI prerequisites:** target/LUN identity, CHAP and worker-only NAS access, initiator uniqueness/connectivity, filesystem/allocation/low-space/reclaim policy, explicit flush readback, secure credentials. These resources/settings are not established by selecting the backend. No CSI detour is implied. [70]
7. **Recovery/safety:** expected mount/sentinel/state checks on every restart and during loss; no local fallback; offline changes/deletions, remote outage, graceful stop, single ownership/operator release, physically fenced transfer and safe former-worker return. No claim that HTTP 200, one replica, RWO or Recreate is fencing. [70][runtime]
8. **Restore proof:** stopped coordinated synthetic backup/restore covering all state; index rebuild versus auth invalidation/reauthentication; failed backups retain good copies. NAS-loss gap, roughly weekly backup recovery point and pilot-only acknowledged-write-loss tolerance are already accepted; live-vault cutover/loss tolerance still requires separate approval. [70]

## Sources

[71]: https://github.com/bpafoshizle/home-kube-setup/issues/71
[69]: https://github.com/bpafoshizle/home-kube-setup/issues/69#issuecomment-6112103692
[70]: https://github.com/bpafoshizle/home-kube-setup/issues/70#issuecomment-6254996127
[runtime]: https://github.com/bpafoshizle/home-kube-setup/blob/864f38f236c6089cedf0b8b109bef43cdfcdce70/docs/kube/research/OBSIDIAN_RUNTIME_CONTRACT.md
[config]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/config.ts
[router]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/mcp-core/mcp-router.ts
[oauth]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/oauth/oauth-provider.ts
[registry]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/mcp-core/tool-registry.ts
[crud]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/mcp-core/tools/vault-crud-tools.ts
[headless]: ../OBSIDIAN_HEADLESS.md
[inventory]: ../OBSIDIAN_NAS_STORAGE_EVIDENCE.md#observed-cluster-inventory-after-access-restoration
[readme]: ../../../README.md#infrastructure-stack
[couch]: ../../../kube/couchdb/values.yaml
[ingress]: ../../../kube/couchdb/couchdb-ingress.yaml
[openclaw]: ../../../kube/openclaw/charts/openclaw/values.yaml
[citepulse]: ../../../kube/openclaw/values-citepulse.yaml
[opencode]: ../../../kube/opencode/values.yaml
[connector]: ../../../kube/tailscale/connector.yaml
[tailscale]: ../../../deploy/09-deploy-tailscale.sh
[flannel]: ../../../ansible/01-kube.yml

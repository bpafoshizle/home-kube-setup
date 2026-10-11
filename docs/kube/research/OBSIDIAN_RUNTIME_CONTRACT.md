# ARM64 LiveSync + Vault Cortex: pilot runtime contract

Research snapshot: **2026-10-11**. **No application was built or executed, no runtime tests ran, no deployment occurred, and no real vault or credentials were accessed.** Registry manifest/config/provenance reads and source inspection are not runtime acceptance.

## Context and answer

- Research ticket: [Which ARM64 LiveSync and Cortex artifacts and operations should the pilot validate?](https://github.com/bpafoshizle/home-kube-setup/issues/69).
- Parent map: [Headless Obsidian vault service — execution Wayfinder](https://github.com/bpafoshizle/home-kube-setup/issues/67).
- Builds on the read-only, currently local `docs/kube/OBSIDIAN_HEADLESS.md` and `docs/kube/OBSIDIAN_HEADLESS_RESEARCH.md` in the original working tree. Those assets are **not included in this publication**; the essential contract and primary citations are reproduced below.

**Recommendation:** pilot a digest-pinned LiveSync `edge` artifact corresponding to the already inspected source and digest-pinned Cortex **MCP-only** `v0.54.12`, one pod/owner per disposable vault, shared Synology vault mount, separate non-NFS application state. Start Cortex read-only, embeddings and memory disabled, then enable scoped synthetic writes. This selects test candidates, not production-approved artifacts.

**Important access finding:** Cortex can bypass OAuth onboarding using its static bearer token, but cannot disable application authentication through a supported configuration. Tailscale-only access is compatible with Cortex; “defer OAuth” and “defer all auth” are different decisions. Do not silently turn the map's openness to auth deferral into an unsupported unauthenticated deployment. [C-server][C-router][C-oauth]

## 1. Published artifacts: observed, not merely promised by CI

Anonymous GHCR pull-token requests succeeded for both repositories. Using Python's standard-library HTTP client as registry tooling, this review fetched OCI indexes, Linux ARM64 child manifests, image configurations, and LiveSync's provenance blob. Index byte SHA-256 values matched the registry's `Docker-Content-Digest`. No layer/application download or execution was needed. Cortex tags were enumerated through **all Link-header pages**, not just the first 100 results.

| Candidate / observed tag alias | Immutable multi-platform index digest | Linux ARM64 image manifest digest |
|:--|:--|:--|
| **Recommended LiveSync**, `ghcr.io/vrtmrz/livesync-cli:edge` | `sha256:18bd63c1f7fe7a84121166a4c6f173871f8266b3bcec4bf5a2e4ada64f4b6de5` | `sha256:7aa7f5a33a6bd3ae5b394cd52fef89c2530b7403d5b7485001478cf2e6b2c141` |
| LiveSync stable fallback, `:1.0.32-cli` = `:latest` | `sha256:2d8271d56c8e192f24f92c600a595f102d5d9e7d8f6fa3f0943aadffddf2c1df` | `sha256:ed29f0941f0ec7739d3c798336e7decf3114fedd4ad847a841ba32390e689ebe` |
| **Recommended Cortex MCP-only**, `ghcr.io/aliasunder/vault-cortex:v0.54.12` = `:latest` | `sha256:2ad32d433956fa96764ca6afffee9470ec4f1cd51dcb734615f52b121be8b0e5` | `sha256:1a0fc1a4d20cb589fdae3213fa049185d7453601db67e7f30738e27c17c69aa1` |

All three observed indexes contain **linux/amd64 and linux/arm64**, plus `unknown/unknown` attestation entries; those entries are not runnable platforms. Recommended deploy references are `ghcr.io/vrtmrz/livesync-cli@sha256:18bd63c1f7fe7a84121166a4c6f173871f8266b3bcec4bf5a2e4ada64f4b6de5` and `ghcr.io/aliasunder/vault-cortex@sha256:2ad32d433956fa96764ca6afffee9470ec4f1cd51dcb734615f52b121be8b0e5`, with scheduling restricted to ARM64. A single-platform pilot may pin the ARM64 child instead. Never deploy mutable `edge`/`latest` alone.

Primary registry evidence (authenticated with anonymous, short-lived pull tokens when required):

- [LiveSync edge index][R-live-edge], [edge ARM64 manifest][R-live-arm], [edge ARM64 config][R-live-config]. Config digest `sha256:c3a2ab90c799c2ef7171934581d0a12daac0cf5ef5c278e007fd7a08547c9070`; created `2026-10-05T04:57:27.453866486Z`; Node `22.23.3`, `/app`, entrypoint `livesync-cli`, **no configured User or Healthcheck**.
- [LiveSync stable index][R-live-stable], [stable ARM64 manifest][R-live-stable-arm]. Config digest `sha256:39ecf9c59eb8d406408fe6d10577e5262733047d443cf95e27e5b3b7687b9307`; created `2026-09-27T05:08:49.512008757Z`. It is older than the reviewed source. `1.0.35-cli` returned **HTTP 404**; plugin/root version `1.0.35` is not proof of a stable CLI release image.
- [Cortex index][R-cortex], [ARM64 manifest][R-cortex-arm], [ARM64 config][R-cortex-config]. Config digest `sha256:91f3082c4b642764129e478d8eebb6f0539cf49c452388172e31c2ddc9e2b4a4`; created `2026-10-10T06:10:57.610888033Z`; Node `24.21.0`, `User=node`, `tini` entrypoint, MCP server command, **no bundled Sync command or OBSIDIAN_SYNC environment value**. These corroborate the MCP-only/local target, not the `remote` target. [C-Docker]
- [Cortex release `v0.54.12`][C-release] published `2026-10-10T06:13:21Z` (GitHub releases API). Its image revision label is **`8a512669aeae9e8318779421d1adcf05624153ab`**, not the earlier notes' inspected head `7e59246738a69e43bb92dad1f7331a8da3c607e4`. [Source comparison][C-compare] shows intervening release bookkeeping and later date-validation/error-text changes. Do not claim this image contains those later changes; test semantic rejection of invalid dates, not the newer exact error wording. Contract citations below use the **image revision**, with the existing notes providing investigation leads.
- LiveSync's [ARM64 attestation manifest][R-attestation] references [provenance blob][R-provenance] `sha256:62fac092a22a87de08528199487f5b3e6fb40e6c48f365b7e697fcfc02d26978`. Its SLSA v1 `runDetails.metadata.buildkit_metadata.vcs.revision` is **`14141446a14deab3353a8864dee41e44c372d006`**, matching the notes; builder identifies [upstream workflow run][L-run]. This is publisher-supplied provenance, **not an independently verified signature or reproducible-build proof**. The runtime dependency stage uses `npm install` without a copied lockfile. A source commit alone cannot reconstruct the exact runtime tree. [L-Docker]

Registry availability is verified here; signatures, vulnerability posture, retention guarantees, complete dependency provenance, successful image pulls on the cluster, and native runtime compatibility are **not**. Keep the recorded digests and source pairing even if tags move. Prefer this edge snapshot for the pilot because it matches the reviewed daemon behavior; switching to stable requires re-reviewing its older source and repeating gates.

### Re-check without running software

Registry protocol: request `https://ghcr.io/token?service=ghcr.io&scope=repository:<owner>/<image>:pull`; retain its returned token only in memory; GET `/v2/<owner>/<image>/manifests/<tag-or-digest>` with `Authorization: Bearer <pull-token>` and OCI/Docker index + manifest Accept types. Hash raw response bytes, inspect each child's `platform`, fetch the ARM64 child and `/blobs/<config-digest>`, then compare aliases. Follow tags/list `Link` headers. The links above are registry API citations, not guaranteed browser-rendered pages. GitHub release/source API calls used per-command `GH_TOKEN="$(gh auth token --user bpafoshizle)"`; global authentication was not switched.

## 2. Mounts, identity, startup, and resource contract

| Mount / setting | Pilot contract |
|:--|:--|
| `/vault` | Same NFS vault PVC/path in both containers; LiveSync read/write, Cortex read-only initially then read/write. Only Cortex-mediated server-side writes; do not grant agents direct NAS access. Plaintext notes are not protected by remote E2EE. |
| LiveSync `/data` | Durable **non-NFS**, exclusively owned DB root: LevelDB documents/checkpoints plus `.livesync/settings.json` and `.livesync/runtime/{local-storage,keyvalue-db}.json`. Not shared with Cortex. [L-hub][L-main][L-kv] |
| Cortex `/data` | Separate durable **non-NFS** directory: `INDEX_DB_PATH=/data/index.db`, sibling `/data/oauth.db`. Preserve directory, SQLite sidecars, and auth state; an index can be rebuilt, OAuth client/refresh state is not just a disposable index. Read-only vault mode still writes infrastructure state. [C-server][C-config][C-oauth] |
| LiveSync vault bookkeeping | `.livesync-snapshot.json` remains under `/vault` even with separate DB root. Separation does **not** remove every state write from NFS. [L-watcher] |
| Identity | Cortex local target defaults to `node` UID/GID **1000:1000**; LiveSync defaults to root but base contains UID 1000. Recommend numeric `runAsUser/runAsGroup: 1000` for both, tested against NAS ownership/ACLs/root-squash and local PVC permissions. Mounted volumes replace image directory ownership; do not assume image chown or `fsGroup` fixes Synology permissions. Never perform a blanket recursive chown of a real vault. [C-Docker][L-Docker] |
| Secrets | Only sync container/init gets CouchDB/settings/E2EE material. Only Cortex gets its service auth token. Do not mount either state root or credentials into the other container. Setup export URI and opening passphrase are secrets, not innocuous argv/log strings. [L-command][C-server] |

### LiveSync lifecycle (proposed commands, not executed)

Preserve the image entrypoint and set `LIVESYNC_DB_PATH=/data`. Kubernetes args for steady state: **`["--vault", "/vault", "daemon"]`**. Empty args print help; standalone `sync` replicates DBs but does not materialize a filesystem vault. Do not repeat the DB positional argument through this wrapper. [L-entry][L-main][L-command]

Run initialization as a separate, single-owner phase before either steady-state writer starts:

1. Verify expected NFS mount and vault sentinel, writable state ownership, and disposable remote database identity. An existing directory is insufficient mount health. Stop on absent/unhealthy/replaced mounts.
2. `livesync-cli init-settings /data/.livesync/settings.json` (special wrapper case: **no DB argument prepended**).
3. Import the plugin setup URI using `livesync-cli setup "$SETUP_URI"`, supplying its opening passphrase through stdin. Use a restricted, writable settings file; `setup` persists settings, so a read-only Secret projection cannot be its write target. Do not emit the URI or decoded secrets. Preserve imported E2EE/compatibility settings.
4. `livesync-cli sync`, then `livesync-cli --vault /vault mirror` against a deliberately empty **disposable** working vault and new state. This is reconciliation, not a universal remote-authoritative restore. Check per-file failures and compare expected content before exposing writes.
5. Start daemon; continuous mode requires resulting `liveSync: true`. Alternatively add `--interval 30` before `daemon` for remote polling. Do not assume imported settings enable continuous replication. Never run setup/mirror/ad-hoc DB commands concurrently with its daemon. [L-main][L-command]

Settings creation does not explicitly enforce secret-safe `0600`; initialization must set restrictive ownership/modes. Daemon startup reconciles disk/DB, then replicates; remote failure can abort startup and individual file failures can still coexist with successful daemon startup. Persisted last-seen state can turn offline local disappearance into remote deletion. Require mount guards on **every restart**, not only first boot. One replica plus Recreate prevents ordinary rollout overlap, but is not fencing; manual node recovery must establish the old writer is stopped. [L-main][L-command][L-scanner][L-kv]

SIGINT/SIGTERM unload LiveSync; wrapper uses `exec`, allowing signals to reach Node. Cortex's local target uses tini; SIGTERM drains HTTP with a **10-second force-exit fallback**. Recommend a pod grace period of at least 30 seconds as a pilot starting point, then measure outstanding-write/sync behavior. Its shutdown handler does not prove all detached indexing work finished. Do not mistake graceful process exit for a durable, conflict-free end-to-end checkpoint. [L-entry][L-main][C-server][C-watcher]

### Cortex environment and runtime defaults

Set `VAULT_PATH=/vault`, `INDEX_DB_PATH=/data/index.db`, `PORT=8000`, `HOST=0.0.0.0`, **nonempty secret `MCP_AUTH_TOKEN`**, and `PUBLIC_URL=https://<private-tailnet-hostname>` (bare origin, no `/mcp` suffix, prefix, query, fragment, or credentials). The endpoint is that origin **plus `/mcp`**. One process serves one vault. Distinct vault services need distinct origins rather than proxy path prefixes. Keep public/LAN ingress absent; tailnet reachability does not confer fine-grained application rights. [C-server][C-router]

Initial settings: `READONLY_MODE=true`, `MEMORY_ENABLED=false`, `EMBEDDING_ENABLED=false`, `RERANK_MODE=none`; optionally `FILE_TOOLS_ENABLED=false` for the note-only baseline, then test attachment support separately. For the write phase explicitly change `READONLY_MODE=false` and the Cortex mount to writable. `DISABLED_TOOLS` is subtractive, not path-scoped authorization; unknown tool names fail startup. A restricted agent inbox is an operating convention unless a real path policy is added; the service token otherwise reaches every enabled tool across the served vault. [C-config][C-registry]

- Actual defaults are memory **on**, embeddings **on**, blended cross-encoder reranking **on**, file tools **on**, read-only **off**, Windows mode **off**, and trash retention **30 days**. Memory can bootstrap `About Me/` automatically. With LiveSync + MCP-only, do not set `OBSIDIAN_SYNC=true` (that means the different bundled Sync target and changes behavior). For disposable write testing consider `TRASH_RETENTION_DAYS=none` to avoid automatic retention deletion. Hidden `.trash` content is not replicated by the CLI's ordinary file filters; trash is not a cross-peer backup. [C-config][C-server][L-main]
- Embeddings/reranker can download/load ONNX models and consume CPU/RAM/cache storage. Disabling embedding creation does not remove every native import/SQLite dependency from the image. The native stack includes better-sqlite3 and ONNX; Cortex uses Debian **trixie/glibc**, with Dockerfile binding execution checks because older ARM64 prebuilds required glibc >=2.38. Do not transplant `node_modules` to Alpine or an older base. LiveSync uses Debian Node 22 with native LevelDOWN. Architecture manifests are not proof these bindings boot on the Raspberry Pi. [C-Docker][C-embedder][L-Docker]
- `MAX_FILE_BYTES` defaults to 50 MiB, image output to 48 KiB, PDF pages to 5. File read caps do not establish a global indexing memory cap. Startup rebuilds the vault index and waits for watcher readiness **before listening**. Size startup-probe budgets from measured rebuild time, not a short HTTP liveness budget. [C-config][C-server][C-watcher]
- Neither local image config defines CPU/memory requests/limits or a useful end-to-end health contract. No measured sizing recommendation can be claimed from this research. Pilot must record ARM64 peak RSS, CPU, startup duration, metadata I/O, storage growth, index latency and sync backlog under idle/initial scan/bursts. Set conservative node-compatible trial budgets with headroom and use measurements before production sizing; don't enable model features merely because an image has native dependencies.
- Cortex `GET /healthz` returns `{ok:true}` without auth after startup; it does not check NAS health, index freshness, CouchDB, pending replication or conflicts. Local target has **no Docker HEALTHCHECK** (the remote target's check is not inherited). Configure Kubernetes probes explicitly, and add a synthetic note round-trip/freshness check outside basic liveness. LiveSync has no HTTP health endpoint. Cortex watcher errors log without necessarily terminating the server. [C-server][C-Docker][C-watcher]

## 3. Filesystem polling is not remote replication polling

| Mechanism | Source behavior | Pilot consequence |
|:--|:--|:--|
| LiveSync `--interval 30` | Remote DB replication, seconds | Does not discover missed NFS file events. [L-command] |
| LiveSync filesystem watcher | Chokidar; `awaitWriteFinish` 500 ms stability / 100 ms size checks | Size stabilization only applies after a detected event. Candidate local polling: `CHOKIDAR_USEPOLLING=1`, `CHOKIDAR_INTERVAL=2000` (milliseconds); confirm packaged dependency behavior. [L-watcher][chokidar] |
| Cortex filesystem watcher | Explicit `usePolling` from `WINDOWS_MODE`; polling interval **300 ms**, stability window **2000 ms**, size checks 100 ms | `WINDOWS_MODE=true` is an available polling switch, but also changes exclusive move/write strategy. It is not an NFS-only tuning flag. New-directory rescan safety net is event-triggered, not a periodic full-vault reconciliation. [C-server][C-config][C-watcher][C-files] |

Native `fs.watch` is documented as potentially unreliable/impossible on network filesystems, including NFS. [Node filesystem caveat][node-watch] **Same-pod API-only writes improve the odds of local event visibility**, because both processes share one kernel NFS mount rather than one writing through another NAS client. They do not prove notifications, cache visibility, atomic rename observation, rapid same-size modifications, or stale reads always work. Incoming remote changes are written by LiveSync and must be indexed by Cortex; outgoing API edits must be discovered by LiveSync. Both directions matter.

Do not assume Cortex's `CHOKIDAR_INTERVAL` alone enables polling or provides a documented standalone polling policy. For an unchanged Cortex image, validate `WINDOWS_MODE=true` including its move behavior if native watches fail; otherwise request a dedicated watcher-polling option and publish/re-test a new artifact. Benchmark 300 ms scans before selecting that option on a large NAS tree. Keep API-only policy; a controlled synthetic second-NFS-client event test diagnoses the limitation but does not authorize human/agent direct NAS writes.

NFS acceptance must include temp+rename, new nested directories, overwrite, same-size edit, delete/recreate, attachment, rename and mount outage. Keep LevelDB and SQLite off the NFS vault. Sharing a pod does **not** share in-process Cortex locks with LiveSync; temp-file rename is not a multi-note transaction, stale-write detector, cross-process lock, or backup. [C-files][C-lock][L-watcher]

## 4. Authentication / HTTP client acceptance

Source imposes bearer middleware on **POST, GET and DELETE `/mcp`**. POST creates/routes stateful Streamable HTTP MCP sessions; use `initialize`, `notifications/initialized`, `tools/list`, then `tools/call`, with the negotiated protocol and returned `Mcp-Session-Id`. Client should send `Accept: application/json, text/event-stream`. Authenticated GET returns **405**, intentionally no standalone SSE stream; this is not service failure. Sessions live in memory and must be reinitialized after restart. [C-router]

Two supported auth paths, neither selected as a human policy decision by this research:

1. **Private pilot static bearer:** client sends `Authorization: Bearer <MCP_AUTH_TOKEN>` on every protected request. Verifier accepts the exact static token, effectively perpetual, with `clientId=static` and scope `vault`. No browser consent/OAuth client onboarding needed. This is the smallest unchanged-software path if clients support configurable bearer headers. Shared token is not a separate identity or tool/path authorization boundary per agent. [C-oauth]
2. **OAuth:** discovery/registration/authorization routes support OAuth with PKCE; consent validates the same service token. Access JWT TTL is **6 hours**, refresh tokens rotate with **60-day sliding inactivity expiry**, scope is `vault`; clients/refresh/revocation records persist in `oauth.db`. Token/origin changes affect issuance/verification, and DB loss affects existing authorizations. Validate actual client discovery, consent, refresh/revocation and proxy routing privately if this path is chosen. Hosted clients outside the tailnet cannot use the endpoint merely because OAuth exists. [C-routes][C-oauth]

**No supported unauthenticated mode:** startup requires token, middleware is unconditional, and config exposes no auth-disable option. Omission/empty-token tricks are not a contract. A proxy injecting bearer auth moves the credential/trust boundary, it does not make Cortex auth-free. Truly unauthenticated operation would require changing software or a different service and fresh security/runtime review; flag that mismatch to the access decision owner, rather than force it during packaging.

HTTP/auth gates: absent/incorrect token denied, valid token initializes and enumerates expected tools, healthz deliberately unauthenticated, authenticated GET 405 accepted, DELETE closes session, restart requires new session, and no public/LAN exposure. Test Tailscale TLS/origin, reverse-proxy forwarding and only the actual trusted hop count (`TRUST_PROXY_HOPS` / `TRUST_FORWARDED_HOPS`, default 0). Do not widen proxy trust or publish OAuth routes beyond the approved private surface. [C-server][C-router][C-config]

## 5. Small Cortex operation contract (synthetic data only)

These are proposed MCP `tools/call` name/argument fixtures, **not observed outputs**. Read-only phase checks reads/search/tool gating; write phase reinitializes after config change. Inspect the image's own `tools/list` schemas rather than inferring plugin APIs. For each successful mutation require: immediate direct read reflects intended content; eventual Cortex index matches; LiveSync propagates to a disposable human peer; peer-to-CouchDB-to-daemon changes reach disk and Cortex with the Obsidian app otherwise unnecessary for server operation. Proposed pilot deadline: **30 seconds under an idle synthetic workload** for index and sync convergence; record actual times and treat timeout as failure, not proof the software promises that SLA.

| Requirement | Fixture calls and assertions |
|:--|:--|
| Read / create | `vault_write_note({path:"Pilot/A.md", body:"# Status\n\nquasar-marker original\n\n[[B]]\n", properties:{tags:["pilot"], status:"draft", score:2}})`; `vault_write_note({path:"Pilot/B.md", body:"# Target\n\nTarget note.\n"})`. `vault_read_note({path:"Pilot/A.md"})` preserves Unicode, LF text, properties and wikilink. Repeat creation without `overwrite` must error without changing A. [C-crud] |
| Surgical edit / full overwrite | `vault_patch_note({path:"Pilot/A.md", operation:"append", heading:"Status", content:"\nsecond-marker\n"})`, then `vault_replace_in_note({path:"Pilot/A.md",old_text:"quasar-marker original",new_text:"quasar-marker edited"})`. Assert target changed once and unrelated text/properties survived. Explicit `vault_write_note` with `overwrite:true` is a whole-body replacement, not a merge; never use it as a blind surgical edit. Replays of append are not idempotent. [C-crud][C-registry] |
| Frontmatter | `vault_read_note({path:"Pilot/A.md",properties_only:true})`; `vault_update_properties({path:"Pilot/A.md",properties:{status:"active",score:3,obsolete:null}})`. Assert shallow merge preserves other keys/body, numeric type survives, null removes a key and arrays replace, not append. A separate fixture with `replace:true` verifies deliberate full-property replacement. Invalid YAML must not silently destroy body. [C-crud] |
| Content search | `vault_search({query:"quasar-marker",filters:{folder:"Pilot",tags:["pilot"],properties:{status:"active"}}})`. With embeddings off expect FTS behavior, not semantic matching; assert A returned with edited snippet and correct metadata, then update/remove marker and assert index catches up. Distinguish content search from file-name search. [C-search] |
| Backlinks / outgoing / move | `vault_get_backlinks({path:"Pilot/B.md"})` includes A; `vault_get_outgoing_links({path:"Pilot/A.md"})` resolves B. Include `[[B#Target\|alias]]`, Markdown relative link, broken link and duplicate basename fixtures to reveal resolver behavior. After index convergence `vault_move_note({old_path:"Pilot/B.md",new_path:"Pilot/Renamed.md"})`; assert supported inbound/outgoing rewrites and new backlinks; repeat through a LiveSync-originated edit. Move rewrites are index-dependent and multi-file, not guaranteed GUI/plugin semantics or transactional edits. [C-search][C-crud][C-files] |
| Tasks: create/list/update | First create `Pilot/Tasks.md` with `# Active\n\n# Done\n`. `vault_create_task({path:"Pilot/Tasks.md",heading:"Active",description:"Pilot task",block_id:"pilot-task",due:"2026-10-20",priority:"high",format:"emoji"})`. `vault_list_tasks({path:"Pilot/Tasks.md",status:"all"})` reports path, line, block ID, todo, due and priority after convergence. `vault_update_task({path:"Pilot/Tasks.md",block_id:"pilot-task",status:"done"})`; assert checkbox/status and configured date behavior; reopen with `status:"todo"`, clear due with `due:null`, verify properties/body unaffected. Invalid date, missing task, duplicate ID must error without mutation. Prefer stable block ID over stale line number. [C-task] |
| Task compatibility extras | Separate fixture `format:"dataview"`, parent/subtask, one recurring task and Kanban board if these are required by the chosen human vault. Assert completion spawn/order/date settings explicitly; completion/retry can be non-idempotent. No dedicated task-delete tool is registered: use supported note edit/span operation if deletion is required, and validate separately. [C-task][C-registry] |
| Read-only and boundary negatives | In `READONLY_MODE=true`, write tools absent and no memory bootstrap; vault mount read-only, index/auth remain writable. Reject traversal/absolute/hidden paths; disallow symlinks in pilot serving tree or explicitly test escapes. Lexical containment is not realpath sandboxing. Don't mount sync secrets into Cortex. [C-config][C-files][C-security] |

Cortex reads/writes Markdown, parses frontmatter/links/tasks and supports parts of Tasks/Kanban conventions; it **does not run Obsidian, Dataview queries, Tasks plugin UI, arbitrary plugins, or the full application metadata engine**. CLI excludes dot-prefixed paths, including `.obsidian`; therefore Cortex cannot assume a headless LiveSync peer has human clients' daily-note/task/plugin settings. Cortex captures task status registry at boot and reads some format/date settings on write; supply intentional synthetic config/explicit format and test settings changes/restart if human compatibility requires them. [L-main][C-server][C-task][C-config]

Per-file locks serialize/fail-fast **within one Cortex process only**. They do not protect against a LiveSync write between a read and later mutation; ordinary write API exposes overwrite rather than expected-content version. Simultaneous remote/human/agent edits need a separate conflict gate. Scoped agent-owned notes/inbox reduce risk but do not remove it. No full-vault write authorization policy or stale-write guarantee is claimed. [C-lock][C-files][C-crud]

## 6. Required gates before selecting production artifacts

1. **Artifact/native/identity:** pull the exact recorded ARM64 manifests on a real cluster node; boot as intended numeric non-root UID; demonstrate native DB bindings, writable state/vault ownership, restrictive secret modes, and compatibility with security-context/read-only-root settings. No qemu/build success substituted for this gate.
2. **Bootstrap/interoperability:** empty disposable state/vault, expected mount sentinel, known synthetic CouchDB/E2EE settings; verify notes, binary attachments, Unicode, case and exact content against actual Mac/iOS plugin versions. No real-vault cutover implied.
3. **Operations/transport:** every baseline fixture above, actual agent client Streamable HTTP + chosen bearer/OAuth path, tool gating, restart/session behavior, index and sync deadlines.
4. **Watcher/NFS:** both cross-process directions within shared pod, remote-origin edits, rapid/same-size/new-directory/temp-rename patterns; native vs polling measurements, Cortex move semantics under Windows mode, controlled second-NFS-client negative/control test. Demonstrate missed-event detection/remediation; logs alone are not freshness.
5. **Failure/recovery:** unavailable/empty replacement mount blocks startup; downtime edits/deletions, independent state loss, remote unavailable, pod restart, node failure with old-writer fencing, concurrent conflicting notes/attachments and operator recovery. Cortex locks don't solve LiveSync conflicts; newest-wins can discard edits. [L-scanner][L-command]
6. **Durability/health/resources:** snapshot and restore NAS vault independently of sync, preserve sync config/state and Cortex auth state, collect content-free freshness/replication/conflict health and peak CPU/RSS/I/O. HTTP 200 and one replica are insufficient acceptance. Obtain explicit human approval before a real-vault connection, as required by the parent map.

Research answers the artifact and operation questions sufficiently to define a pilot. Remaining uncertainty is deliberately a **runtime gate**, not a claim of successful validation. Concrete state provisioning and human access-policy decisions remain with their map tickets; this report neither edits the map nor selects those policies.

## Primary citations

[R-live-edge]: https://ghcr.io/v2/vrtmrz/livesync-cli/manifests/sha256:18bd63c1f7fe7a84121166a4c6f173871f8266b3bcec4bf5a2e4ada64f4b6de5
[R-live-arm]: https://ghcr.io/v2/vrtmrz/livesync-cli/manifests/sha256:7aa7f5a33a6bd3ae5b394cd52fef89c2530b7403d5b7485001478cf2e6b2c141
[R-live-config]: https://ghcr.io/v2/vrtmrz/livesync-cli/blobs/sha256:c3a2ab90c799c2ef7171934581d0a12daac0cf5ef5c278e007fd7a08547c9070
[R-live-stable]: https://ghcr.io/v2/vrtmrz/livesync-cli/manifests/sha256:2d8271d56c8e192f24f92c600a595f102d5d9e7d8f6fa3f0943aadffddf2c1df
[R-live-stable-arm]: https://ghcr.io/v2/vrtmrz/livesync-cli/manifests/sha256:ed29f0941f0ec7739d3c798336e7decf3114fedd4ad847a841ba32390e689ebe
[R-attestation]: https://ghcr.io/v2/vrtmrz/livesync-cli/manifests/sha256:fc1b1cc2fdd9c8ac5ba1d9de42afc7137aeb13f3a4f605bee143896f5b981b92
[R-provenance]: https://ghcr.io/v2/vrtmrz/livesync-cli/blobs/sha256:62fac092a22a87de08528199487f5b3e6fb40e6c48f365b7e697fcfc02d26978
[R-cortex]: https://ghcr.io/v2/aliasunder/vault-cortex/manifests/sha256:2ad32d433956fa96764ca6afffee9470ec4f1cd51dcb734615f52b121be8b0e5
[R-cortex-arm]: https://ghcr.io/v2/aliasunder/vault-cortex/manifests/sha256:1a0fc1a4d20cb589fdae3213fa049185d7453601db67e7f30738e27c17c69aa1
[R-cortex-config]: https://ghcr.io/v2/aliasunder/vault-cortex/blobs/sha256:91f3082c4b642764129e478d8eebb6f0539cf49c452388172e31c2ddc9e2b4a4
[L-run]: https://github.com/vrtmrz/obsidian-livesync/actions/runs/37265383510
[L-Docker]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/Dockerfile
[L-entry]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/docker-entrypoint.sh
[L-main]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/main.ts
[L-command]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/commands/runCommand.ts
[L-hub]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/services/NodeServiceHub.ts
[L-kv]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/services/NodeKeyValueDBService.ts
[L-watcher]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/managers/CLIStorageEventManagerAdapter.ts
[L-scanner]: https://github.com/vrtmrz/livesync-commonlib/blob/f0eb9bc2cf99ec7a3e17973ed65c9711318cf465/src/serviceFeatures/offlineScanner.ts
[chokidar]: https://github.com/paulmillr/chokidar/blob/1182965a0d3d884f15db423009262778ddba0ac4/src/index.ts#L365-L397
[node-watch]: https://github.com/nodejs/node/blob/v22.23.3/doc/api/fs.md#availability
[C-release]: https://github.com/aliasunder/vault-cortex/releases/tag/v0.54.12
[C-compare]: https://github.com/aliasunder/vault-cortex/compare/8a512669aeae9e8318779421d1adcf05624153ab...7e59246738a69e43bb92dad1f7331a8da3c607e4
[C-Docker]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/Dockerfile
[C-server]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/server.ts
[C-config]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/config.ts
[C-router]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/mcp-core/mcp-router.ts
[C-oauth]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/oauth/oauth-provider.ts
[C-routes]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/oauth/oauth-routes.ts
[C-registry]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/mcp-core/tool-registry.ts
[C-crud]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/mcp-core/tools/vault-crud-tools.ts
[C-task]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/mcp-core/tools/task-tools.ts
[C-search]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/mcp-core/tools/search-tools.ts
[C-files]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/vault-operations/vault-filesystem.ts
[C-lock]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/utils/file-write-lock.ts
[C-watcher]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/search/file-watcher.ts
[C-embedder]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/src/vault-mcp/search/embedder.ts
[C-security]: https://github.com/aliasunder/vault-cortex/blob/8a512669aeae9e8318779421d1adcf05624153ab/SECURITY.md

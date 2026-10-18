# Obsidian NAS Application Requirements — Pinned Source Investigation

Research for [Verify NAS-backed persistence and application storage requirements](https://github.com/bpafoshizle/home-kube-setup/issues/75), within [Headless Obsidian vault service — execution Wayfinder](https://github.com/bpafoshizle/home-kube-setup/issues/67). Reviewed **2026-10-11**. This establishes application requirements, **not a storage selection or deployment approval**.

**Constraint:** All durable workload state must be Synology-backed. Worker-local durable storage, `hostPath`, and permanent node pinning are disallowed. “Local filesystem” in an upstream database requirement describes filesystem semantics; it must not be translated into permission to retain state on a worker. This review did not inspect vaults, credentials, cluster resources, NAS configuration, or running applications.

## Source scope and dependency correction

| Component | Reviewed pin |
|:--|:--|
| LiveSync CLI | `vrtmrz/obsidian-livesync` `14141446a14deab3353a8864dee41e44c372d006` |
| LiveSync commonlib | `vrtmrz/livesync-commonlib` `f0eb9bc2cf99ec7a3e17973ed65c9711318cf465` (`0.1.36`) |
| Cortex | `aliasunder/vault-cortex` `7e59246738a69e43bb92dad1f7331a8da3c607e4` |
| Active PouchDB adapter dependency | `pouchdb-adapter-leveldb` `9.0.0` → direct `leveldown` **`6.1.1`** |
| LevelDOWN implementation | `Level/leveldown` `d3702b3d6cf598c4f44d52b58f685526dd3806c0` (`v6.1.1`), bundled LevelDB `1.20` |
| Cortex SQLite binding | Lockfile pins `better-sqlite3` `13.0.3`; default build definitions reviewed at that version |

**Important correction to the prior research:** `docs/kube/OBSIDIAN_HEADLESS_RESEARCH.md` cites LevelDOWN `5.6.0`. That version exists under `node_modules/level/node_modules/leveldown`, but the PouchDB adapter directly depends on `6.1.1`. Its published `9.0.0` implementation defaults to `require('leveldown')`; `level` is used by an old-format migration. Therefore use the direct `6.1.1` implementation for the ordinary database path, rather than assuming the nested `5.6.0` is the active driver. Both bundle LevelDB `1.20`, and the locking/sync/rename code examined has the same relevant behavior. [Lockfile][ls-lock], [published adapter][pouch-adapter], [LevelDOWN build][level-build]. The prior file was not modified.

Local checkouts supplied the application evidence; new tabs in the shared Chrome target supplied missing dependency and SQLite primary sources. Versioned npm distribution text was read, but artifact integrity hashes were not independently recomputed. Commonlib source correspondence to the installed npm artifact and actual container dependency resolution remain acceptance gaps.

## Findings at a glance

- **LiveSync:** Embedded PouchDB/LevelDB remains required for ordinary CLI operation even with remote CouchDB. It requires one process owner, functioning POSIX record locking, file/directory sync, and rename semantics. **No explicit blanket NFS prohibition was found in the reviewed pinned LiveSync/LevelDOWN documentation**; the earlier advice against NFS state is a recommendation, not an upstream prohibition. NFS suitability is nevertheless **unverified**, not established by the absence of a prohibition. [CLI driver][ls-driver], [CLI hub][ls-hub], [LevelDB documentation][level-doc], [POSIX implementation][level-posix].
- **Cortex:** Both search and OAuth SQLite initializers unconditionally request WAL. SQLite explicitly says ordinary WAL does not work over a network filesystem. Cortex exposes **no journal-mode or exclusive-locking configuration** in the reviewed initializer/configuration paths. A single replica is not an implementation of SQLite's special exclusive-mode exception. [Search initialization][cx-search], [OAuth initialization][cx-oauth], [configuration][cx-config], [SQLite WAL][sqlite-wal].
- **External databases:** No supported external replacement for LiveSync's local state or Cortex's search/OAuth state was found in the pinned application interfaces. A remote CouchDB service is LiveSync replication, not a replacement for its local DB/JSON state. Cortex's SQL implementation is SQLite-specific. [CLI hub][ls-hub], [commonlib database service][ls-db], [Cortex server][cx-server], [search implementation][cx-search], [OAuth implementation][cx-oauth].
- **Decision boundary:** Synology-backed does not necessarily mean an application opens database files over NFS. This research does not choose a protocol, provision storage, or prove any Synology-backed presentation meets the requirements. Worker-local state is not an acceptable fallback.

## LiveSync: concrete LevelDB filesystem contract

The CLI registers the LevelDB and HTTP PouchDB plugins, injects the positional database-root directory as the local database prefix, and forces `useIndexedDBAdapter: false`. Commonlib constructs the local database through that injected PouchDB implementation. [Driver registration][ls-driver], [hub lines 60–72][ls-hub], [commonlib construction][ls-db]. The LevelDOWN non-Windows build selects `util/env_posix.cc`; these are relevant to the intended Linux workload, not the Windows implementation. [Build selection][level-build].

| Operation | Verified implementation | Requirement / boundary |
|:--|:--|:--|
| Exclusive database owner | LevelDB documentation permits only one process to open a DB. `LockFile` opens the lock file `O_RDWR | O_CREAT`; `LockOrUnlock` uses `fcntl(fd, F_SETLK, ...)`, `F_WRLCK`, `SEEK_SET`, start `0`, length `0` (whole file). An in-process lock table also prevents duplicate opens. | Actual POSIX advisory **record-lock** exclusion is required; this is not `flock()` and not the mere existence of a `LOCK` file. RWX access does not authorize multiple owners. Lifecycle/failover must not overlap owners, including diagnostic CLI invocations. |
| Data flush | `Sync()` calls `fflush_unlocked()` then `fdatasync()` and propagates failures. | Successful data-sync calls and their durable-write/order semantics matter, not only successful `write()` or `close()`. |
| Directory flush | For a `MANIFEST*` file, `SyncDirIfManifest()` opens the containing directory and calls `fsync(directory_fd)` before the file sync, explicitly to ensure referenced new files are present. | Directory fsync must work; a presentation that rejects it can cause database errors. NAS/server power-loss durability is not inferred from client syscall success. |
| Manifest pointer replacement | `SetCurrentFile` writes/syncs a temporary file, then `RenameFile` invokes POSIX `rename()` to replace `CURRENT`; failure deletes the temporary file. | Requires correct same-filesystem rename/replacement and recovery-visible metadata ordering. Atomic replacement is a requirement inferred from this POSIX operation, not a separately tested NAS guarantee. |
| Read behavior | The POSIX environment can use `mmap(..., PROT_READ, MAP_SHARED, ...)` for random-access files, or file-descriptor reads. | File content/size visibility and mapping semantics must remain correct; not every read is a fresh server fetch. |

Sources: [LevelDB concurrency/synchronous-write documentation][level-doc], [POSIX implementation][level-posix], [CURRENT update][level-current].

**Durability nuance:** LevelDB defaults to asynchronous writes; `{ sync: true }` requests a durable synchronous write. Its docs distinguish application-process crashes from OS crashes/power loss, which can lose recent asynchronous updates. LevelDOWN likewise documents `sync` default `false`. The published PouchDB adapter core's ordinary batch execution calls `db.batch(uniqBatches, callback)` without a `sync: true` option. Do not assert “every acknowledged LiveSync update is fsynced.” Structural LevelDB sync operations still exist even when individual writes are asynchronous. [LevelDB docs][level-doc], [LevelDOWN README][level-readme], [published adapter core][pouch-core]. No runtime crash/durability test was performed.

### NFS prohibition versus recommendation

The reviewed LevelDB `doc/index.md`, LevelDOWN `6.1.1` README, and pinned LiveSync CLI documentation provide **no explicit NFS ban or Synology-NFS support guarantee**. LevelDB's explicit restriction is one-process ownership enforced by OS locking. The POSIX implementation does not perform an NFS-type check; it calls the required filesystem primitives and propagates errors. [LevelDB docs][level-doc], [LevelDOWN README][level-readme], [CLI README][ls-readme], [POSIX code][level-posix]. This is a scoped negative finding, not a claim to have searched all historical upstream issues or proved NFS safe.

Accordingly, the previous recommendation for reliable durable local/block-like state should be recorded as **a reliability recommendation based on the required semantics and missing validation**, not “LiveSync upstream forbids NFS.” If an NFS proposal is pursued, it needs evidence for the exact client/server implementation, mount/export settings, lock recovery, sync/rename behavior, and failure/failover lifecycle. A basic successful open/write test is insufficient evidence of crash safety. No such evidence was collected here.

### Durable state beyond LevelDB

| State | Pinned path / behavior |
|:--|:--|
| PouchDB databases | Under positional `<database-root>` via the injected prefix |
| Settings | Default `<database-root>/.livesync/settings.json`; `--settings` can override |
| Runtime local storage | `<database-root>/.livesync/runtime/local-storage.json` |
| Key-value/scan state | `<database-root>/.livesync/runtime/keyvalue-db.json` |
| Storage-event snapshot | `<vault>/.livesync-snapshot.json`, **not** moved by separating the database root |

Sources: [Hub][ls-hub], [main][ls-main], [snapshot adapter][ls-snapshot]. These paths all require durable-state accounting under the Synology constraint. The two runtime JSON stores rewrite files synchronously using `writeFileSync` and recover read/parse failure as empty state; these methods show no temp-file/rename transaction or explicit fsync. “Synchronous Node API” is **not** a disk-durability guarantee. The snapshot uses ordinary `fs.writeFile`. Some settings persistence uses temporary-file rename, but this does not make every state file transactional. [Local-storage implementation][ls-local], [key-value implementation][ls-kv], [snapshot][ls-snapshot], [settings writes][ls-main].

### External backend support

LiveSync's remote HTTP/CouchDB replication is supported, but its local PouchDB database and the JSON bookkeeping above still exist. Commonlib is injectable and PouchDB's LevelDB adapter permits a programmatic `opts.db` alternative; **these library seams are not a documented CLI option to replace local state with PostgreSQL, MariaDB, remote CouchDB, or another database server**. The reviewed CLI database-options override only supplies the local prefix and disables IndexedDB. A different backend would require a supported application change and compatibility testing, including revision/chunk/checkpoint behavior and JSON state that such a change would not automatically remove. [CLI hub][ls-hub], [commonlib DB construction][ls-db], [published adapter][pouch-adapter].

## Cortex: SQLite configuration and state locations

Scope here is Cortex's MCP search/index and remote HTTP OAuth implementation; this is **not** an audit of the separately bundled proprietary Obsidian Sync engine's `state.db`.

| Setting | Search/index SQLite | OAuth SQLite |
|:--|:--|:--|
| Connection | `new Database(dbPath)` (`better-sqlite3`) | `new Database(dbPath)` (`better-sqlite3`) |
| `journal_mode` | Explicit `WAL` | Explicit `WAL` |
| `synchronous` | Explicit `NORMAL` | **Not explicitly set by application** |
| `busy_timeout` | Explicit `5000` ms | Not explicitly set; binding default applies |
| `locking_mode` | Not explicitly set | Not explicitly set |
| Journal/lock configuration option | None in reviewed initializer/options/configuration | None in reviewed initializer/options/configuration |

Sources: [Search lines 335–387][cx-search], [OAuth lines 67–146][cx-oauth], [Cortex configuration][cx-config]. Both initializers ignore the return value of `db.pragma('journal_mode = WAL')`, so source verifies the **request**, not a queried runtime result. SQLite notes that an unsuccessful conversion can leave the previous journal mode in place. [SQLite WAL §3][sqlite-wal].

**OAuth defaults must not be mislabeled FULL:** Cortex pins `better-sqlite3` `13.0.3`. That binding's default build definitions include `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` (`NORMAL`) and no `SQLITE_DEFAULT_LOCKING_MODE` override. Thus the default bundled build is expected to use **NORMAL** synchronization in WAL for OAuth too, despite Cortex not setting it explicitly. SQLite's ordinary locking-mode default is **NORMAL**, not EXCLUSIVE. These are build-derived expectations, not measurements of the deployed native binary; custom builds can differ. [Cortex dependency lock][cx-lock], [binding default definitions, file revision][binding-defines], [versioned binding definitions][binding-version], [SQLite PRAGMA defaults][sqlite-pragma]. Search explicitly requests NORMAL regardless of that binding default.

### Paths and state meaning

- HTTP server: `INDEX_DB_PATH`, when supplied, is the search/index database filename. `dataDir = dirname(INDEX_DB_PATH)`; OAuth is **always `${dataDir}/oauth.db`**. Without that variable, server source uses `/data/search.db` and `/data/oauth.db`. No separate OAuth path variable is exposed in this server setup. [Server lines 116–120, 144–162][cx-server].
- Container initialization supplies `INDEX_DB_PATH=/data/index.db` when unset; with `STORAGE_ROOT`, it derives `<STORAGE_ROOT>/data/index.db`. Therefore the container's normal index filename differs from the bare server fallback. OAuth follows the chosen index's parent directory. Explicit path overrides remain overrides; setting `STORAGE_ROOT` is not proof that every persistent file is on the intended mount. [Derived environment script][cx-derived].
- SQLite ordinarily creates adjacent `<db>-wal` and `<db>-shm` files. The WAL is **part of persistent database state** and can contain committed transactions not yet in the main DB. Do not back up, move, or persist only `index.db`/`search.db` and `oauth.db` while ignoring their WALs. SQLite's WAL-index shared-memory file is regenerated bookkeeping, but its directory must allow the required creation/mapping/locking operations. Use database-consistent backup/checkpoint procedures, not blind live-file copies. [SQLite WAL §§4, 7][sqlite-wal].
- OAuth persists registered clients, refresh tokens, revoked tokens, consumed-refresh-token history, and revoked clients. Pending authorization requests and short-lived authorization codes are in-memory maps; the implementation does not promise that those flows survive restart. OAuth database state is therefore **not just a disposable search cache**. [OAuth schema and provider][cx-oauth].
- The index is opened/rebuilt from the vault at startup, but that does not authorize worker-local durable state under this task's constraint. [Server startup][cx-server].

### Why ordinary WAL conflicts with an NFS database directory

SQLite's authoritative WAL documentation says: **“WAL does not work over a network filesystem”** and requires all processes using the database to be on the same host. Its ordinary WAL-index is an `mmap` of the adjacent shared-memory file. It permits readers with one writer, not arbitrary concurrent writers. [WAL overview and §§2.2, 7][sqlite-wal]. This is stronger evidence than a generic recommendation to avoid NFS.

There is an important documented exception: setting **`locking_mode=EXCLUSIVE` before the first WAL database access**, with guaranteed sole-process access, permits WAL without shared-memory methods. Cortex does **not** set that mode. One replica, no concurrent application traffic, or pre-setting a database file to DELETE does not implement this initializer ordering; Cortex requests WAL each startup. Treat EXCLUSIVE/custom VFS or rollback-mode changes as application changes requiring verification, not an existing supported storage flag or an automatic NFS cure. [SQLite WAL §8][sqlite-wal], [Cortex initializers][cx-search], [OAuth initializer][cx-oauth].

SQLite separately warns that network-filesystem locking and sync reliability vary, corruption can result, and apparent early testing success is not enough. Rollback mode can mitigate network issues but is not an unconditional safety guarantee. SQLite recommends client/server databases when separating data and application by a network; that recommendation does **not** mean Cortex already supports one. [SQLite network-use guidance][sqlite-network].

**Power-loss boundary:** In WAL with `synchronous=NORMAL`, checkpoints provide the important sync barriers, but most individual commits do not sync the WAL. A committed transaction can roll back after power failure/OS crash, though ordinary application crashes do not have the same durability loss. FULL adds a WAL sync at each commit. Synology backing, backups, or correct WAL placement alone do not change the application's NORMAL setting. [SQLite WAL §2.3][sqlite-wal], [synchronous PRAGMA][sqlite-pragma].

### External DB support and configurability

The reviewed pinned production paths instantiate `better-sqlite3` directly for both databases. Search uses SQLite FTS5, loads `sqlite-vec`, and registers JavaScript SQL functions; OAuth prepares SQL against its SQLite connection. No PostgreSQL/MySQL/MariaDB/libSQL server driver, database URL setting, backend selector, WAL disable setting, or locking-mode selector was found in the reviewed server/config/initializer interfaces. `INDEX_DB_PATH` is a **file path**, not an external DB endpoint. [Search implementation][cx-search], [OAuth implementation][cx-oauth], [configuration][cx-config], [server wiring][cx-server], [dependency lock][cx-lock].

Consequently an external DB migration is **not supported by configuration in this pin**. It would be an application development task (schema/query/vector/FTS/transaction/OAuth behavior), not merely provisioning an external database or mounting a different filename. Changing WAL settings would also require source changes or another explicitly supported integration, including handling both index and OAuth initialization.

## Actionable evidence gates and remaining unknowns

1. **Account for every durable path**, including LiveSync JSON/snapshot/settings and both Cortex DB directories/WALs. Do not approve a layout merely because vault Markdown or the main index file is on Synology.
2. **Resolve the Cortex WAL compatibility boundary before storage approval.** Ordinary WAL over an NFS database directory is contrary to the cited upstream contract. No built-in WAL-off/EXCLUSIVE/external-DB setting was found. A filesystem presentation or application change must be evaluated explicitly; this note does not select one.
3. **Demonstrate one-owner/failover behavior for LiveSync**, including rollout overlap, a second opener from another client, stale locks, abrupt termination, partition/reconnection, and rescheduling. The source's `fcntl` lock is not an infrastructure fencing proof.
4. **Establish exact filesystem semantics** for any proposed Synology-backed presentation: `F_SETLK` exclusion/recovery, `fdatasync`, directory `fsync`, rename replacement, file visibility/mapping, crash ordering, mount-loss behavior. Record failures and data-integrity outcomes, not only syscall availability or throughput. These tests were not run.
5. **Inspect the exact built native artifacts before deployment:** actual LevelDOWN/PouchDB versions, `sqlite_version()`, compile options, and both connections' effective `journal_mode`, `locking_mode`, `synchronous`, `busy_timeout`, and checkpoint configuration. Do this in an isolated test database, not the live vault/OAuth state. No image or native runtime was examined here.
6. **Define durability and backup acceptance separately from NAS placement.** LiveSync's normal batches and Cortex's NORMAL WAL do not guarantee each acknowledged transaction survives a machine/power failure. OAuth refresh/revocation state deserves explicit loss/recovery testing. Protect LiveSync's nontransactional JSON state and use SQLite-consistent backup/restore tests.
7. **Additional current SQLite caveat:** The reviewed WAL documentation records a WAL-reset race fixed in SQLite `3.51.3`, with backports `3.44.6`/`3.50.7`, affecting multiple connections performing write/checkpoint concurrently. Verify the actual binding's embedded SQLite version; do not infer exposure solely from the npm binding version. [SQLite WAL §11][sqlite-wal].

**Unresolved:** actual Synology protocol/mount/export capabilities; lock recovery/fencing under failures; directory-sync durability through the NAS stack; exact container native builds; effective OAuth synchronization at runtime; safe live backup strategy; exhaustive historical upstream NFS statements; and any future upstream database-backend support. None is answered by this source-only investigation. No storage was selected or provisioned, and no tracker mutation, commit, or push was performed.

## Primary references

[ls-lock]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/package-lock.json#L8668-L8709
[ls-driver]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/lib/pouchdb-node.ts#L1-L16
[ls-hub]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/services/NodeServiceHub.ts
[ls-db]: https://github.com/vrtmrz/livesync-commonlib/blob/f0eb9bc2cf99ec7a3e17973ed65c9711318cf465/src/services/base/DatabaseService.ts#L57-L87
[ls-main]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/main.ts
[ls-readme]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/README.md
[ls-snapshot]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/managers/CLIStorageEventManagerAdapter.ts
[ls-local]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/services/NodeLocalStorage.ts#L23-L42
[ls-kv]: https://github.com/vrtmrz/obsidian-livesync/blob/14141446a14deab3353a8864dee41e44c372d006/src/apps/cli/services/NodeKeyValueDBService.ts
[pouch-adapter]: https://unpkg.com/pouchdb-adapter-leveldb@9.0.0/lib/index.js
[pouch-core]: https://unpkg.com/pouchdb-adapter-leveldb-core@9.0.0/lib/index.js
[level-build]: https://github.com/Level/leveldown/blob/d3702b3d6cf598c4f44d52b58f685526dd3806c0/deps/leveldb/leveldb.gyp
[level-doc]: https://github.com/Level/leveldown/blob/d3702b3d6cf598c4f44d52b58f685526dd3806c0/deps/leveldb/leveldb-1.20/doc/index.md#concurrency
[level-readme]: https://github.com/Level/leveldown/blob/d3702b3d6cf598c4f44d52b58f685526dd3806c0/README.md
[level-posix]: https://github.com/Level/leveldown/blob/d3702b3d6cf598c4f44d52b58f685526dd3806c0/deps/leveldb/leveldb-1.20/util/env_posix.cc#L250-L299
[level-current]: https://github.com/Level/leveldown/blob/d3702b3d6cf598c4f44d52b58f685526dd3806c0/deps/leveldb/leveldb-1.20/db/filename.cc#L126-L141
[cx-server]: https://github.com/aliasunder/vault-cortex/blob/7e59246738a69e43bb92dad1f7331a8da3c607e4/src/vault-mcp/server.ts#L116-L162
[cx-search]: https://github.com/aliasunder/vault-cortex/blob/7e59246738a69e43bb92dad1f7331a8da3c607e4/src/vault-mcp/search/search-index.ts#L335-L387
[cx-oauth]: https://github.com/aliasunder/vault-cortex/blob/7e59246738a69e43bb92dad1f7331a8da3c607e4/src/vault-mcp/oauth/oauth-provider.ts
[cx-config]: https://github.com/aliasunder/vault-cortex/blob/7e59246738a69e43bb92dad1f7331a8da3c607e4/src/vault-mcp/config.ts
[cx-lock]: https://github.com/aliasunder/vault-cortex/blob/7e59246738a69e43bb92dad1f7331a8da3c607e4/package-lock.json
[cx-derived]: https://github.com/aliasunder/vault-cortex/blob/7e59246738a69e43bb92dad1f7331a8da3c607e4/rootfs/etc/s6-overlay/scripts/print-derived-env
[binding-defines]: https://github.com/WiseLibs/better-sqlite3/blob/ef7d9404bb2fcfd4b77d237ec3eaa8eee96a6fb1/deps/defines.gypi
[binding-version]: https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/deps/defines.gypi
[sqlite-wal]: https://sqlite.org/wal.html
[sqlite-pragma]: https://sqlite.org/pragma.html
[sqlite-network]: https://sqlite.org/useovernet.html

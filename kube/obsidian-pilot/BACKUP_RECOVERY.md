# Backup/recovery implementation boundary

Implementation in progress: the archive core and release policy have synthetic
local tests. **No live backup job, real-data archive, recovery key, destination
PVC, pilot restore or maintenance controller has been created or run.** The approved contract is
[storage/recovery issue 70](https://github.com/bpafoshizle/home-kube-setup/issues/70#issuecomment-6254996127).

The pilot is currently **offline after a real storage I/O failure**; see the
[2026-11-01 incident](STORAGE_INCIDENT_2026-11-01.md). Missing clean-stop proof
blocks ordinary maintenance releases. Backup automation is not recovery authority.

## Required capture

- Stop both applications and positively observe clean actual-container exits.
  A scale request, missing Pod, NotReady node or absent iSCSI session is not proof.
  Bind proof to the exact stopped UID/node; old stop proofs cannot be reused.
- Block all replacement owners before any new mount. Use only the same healthy
  selected worker for ordinary maintenance. Uncertain shutdown, node changes,
  unexpected consumers or incomplete checks leave the service offline/gated.
  No forced release, automatic failover or physical-fencing substitute.
- Mount the three verified storage roots for capture only after ownership checks.
  Capture the whole working vault, including hidden reconciliation/queue state;
  complete LiveSync state including settings, runtime JSON and LevelDB files;
  complete Cortex state including SQLite companion files. Do not choose only
  database main files or synthesize missing upstream state.
- Preserve a secure recovery bundle for pilot configuration, exact image/storage
  identities and pilot credentials, including CHAP/E2EE/database/static bearer.
  Do not export shared CouchDB administrator credentials. Recovery material must
  never appear in argv, logs, Git, tracker comments or unencrypted archives.
- Use a **separate configurable Synology destination**, not a working root or
  worker-local storage. Encryption key recovery must be independent of that
  archive; an inaccessible key means the backup is not recoverable.
- Write a private incomplete generation, verify authenticated decryption and
  complete file inventory/hash/size before atomic successful publication. Crash,
  timeout, partial copy, verification or publication failure cannot count as
  success. Preserve existing successful generations after any failed attempt.
- Default weekly schedule and latest **two successful** generations; make
  schedule, destination and retention configurable. Only prune after verified
  durable publication. Failed/incomplete generations never displace good ones.
  Enforce a single maintenance transaction; a CronJob concurrency setting alone
  does not coordinate manual backups or application release.

## Restore demonstration without rollback propagation

1. Verify archive authentication, inventory and identity before changing anything.
   First demonstrate restoration into a separate NAS staging directory, with no
   application, remote CouchDB connection or MCP ingress attached. It must not
   require another iSCSI LUN or place Cortex SQLite runtime on NFS.
2. Compare exact restored synthetic files and complete state coverage privately.
   This is extraction/integrity evidence, **not** proof of runnable application
   recovery. A full stopped-owner restore drill remains required.
3. Preserve the current good generation before any in-place drill. Stage and
   verify all three roots while stopped; never mix generations. Any partial
   restore leaves applications gated for investigation, not an empty bootstrap.
4. Keep restored LiveSync state offline until deliberate peer reconciliation has
   been reviewed; blindly reconnecting old state can propagate stale changes or
   deletions. Do not modify existing human clients/databases.
5. Do not activate rolled-back Cortex authentication/session state. Define and
   verify pilot-only credential/session invalidation and reauthentication before
   exposure. A disposable index rebuild is different from auth-state recovery;
   neither permits rotating shared credentials or silently resetting sync state.
6. Release one exact owner only after complete verification, then check exact
   synthetic API reads, indexing and controlled synchronization before reopening
   normal access. A passing extraction alone cannot close the restore gate.

## Approved maintenance authorization (2026-10-31)

Weekly unattended capture must stop and later resume the application. The current
chart intentionally requires **explicit operator release for every new Pod**.
An unattended controller that patches this gate is a release authority, not merely
a backup scheduler. After clarification, the human explicitly selected **“Yes,
bounded automation”** for the following scope:

- Bounded same-healthy-worker maintenance authority, with fresh positive stop
  evidence, mount/session/consumer checks and exact-UID one-time releases for
  capture and application restart; all uncertainty remains offline.
- No cross-node failover, forced release or fencing bypass. The approval does not
  authorize automatic restore, stale sync/auth activation or extra LUN allocation.

This authorizes implementing narrowly scoped controller privileges, not claiming
that a controller exists or that backup/restore gates passed. Until implemented
and qualified, the existing operator-release workflow remains in effect.

`maintenance-release.mjs` is the first implementation component: a pure,
fail-closed release-policy evaluator. Its 33 synthetic tests cover exact UID and
same-worker release plans, stale/wrong stop proofs, incomplete worker/session or
consumer inventories, unhealthy workers, expired/foreign maintenance leases,
ungated/already-assigned candidates and unverified backup publication. It checks
storage bindings before release; actual mount/state validation must still run
inside the released Pod before capture/application startup.

This is **not a controller**: it neither collects evidence nor acquires leases,
checks live sessions, patches gates, mounts storage, writes archives or restores
data. The future adapter must collect trustworthy fresh evidence under an
exclusive transaction and apply UID/resourceVersion-tested patches. Pure-policy
success cannot establish real-world fencing or runtime backup acceptance.

## Encrypted archive core (local qualification only)

`backup-archive.mjs` exports `createBackup` and `verifyArchive`, with no CLI,
Kubernetes access, automatic ownership release or default live paths. Callers must
first establish stopped applications, verified roots/mounts and exclusive ownership.
The future capture Pod must also independently verify mount/state guards. Unit
tests use only disposable local synthetic directories and ephemeral test keys.

- Captures all files/directories under exactly four separate roots: `vault`,
  `livesync`, `cortex`, `configuration`. Hidden files, empty files, SQLite companion
  files and file/directory modes are included. Symbolic/hard links and special
  files refuse capture rather than being followed or silently skipped. Source
  metadata is rechecked to detect changes; this never makes a live copy consistent.
- Streams bounded file chunks through gzip and **AES-256-GCM** with a random
  96-bit nonce and a caller-supplied 256-bit key. Neither key nor contents appear
  in command arguments/logs. No unencrypted archive is staged to disk. A private
  incomplete generation is authenticated and its full logical inventory verified
  before fsync, atomic publication and directory fsync.
- Verification authenticates the entire ciphertext before parsing/extraction.
  Restoration only creates a new private directory, never merges or overwrites.
  It rechecks paths, sizes, modes and SHA-256 hashes; files/directories are owned
  by the restoring process (no arbitrary ownership restoration). The caller must
  run as the intended UID 1000 for application restore. Partial failed extraction
  remains isolated for investigation and is never an application root.
- A private NFS-atomic directory lock prevents concurrent core captures. It is
  never stolen automatically after a crash. This does not replace the controller
  lease coordinating applications and manual maintenance.
- Retention defaults to two, configurable upward. All published generations are
  authenticated and verified before any pruning; corruption, key mismatch, read
  failure or backwards clock blocks pruning. Failed/incomplete generations do not
  count. Only exact known generation paths/files can be removed, never broad paths.

### Recovery format v1

This is a versioned application archive container, not tar/age/OpenSSL format.
Keep this decoder and its Node source/runtime available independently of the
cluster alongside key recovery instructions. No standalone CLI/key-delivery path
has been implemented yet; this is not secure recovery acceptance.

Binary framing: ASCII `PILOTBACKUP001\n`, 12 nonce bytes, AES-256-GCM ciphertext,
16 tag bytes. The complete prefix is authenticated additional data. Plaintext is
gzip-compressed UTF-8 JSON Lines: a version/vault/transaction `begin`, then sorted
`directory` or `file` headers (relative root-prefixed path, mode, size); file bytes
are bounded base64 `chunk` records followed by an `end` SHA-256. A final `complete`
record gives counts and a SHA-256 over ordered header/end records. No filenames,
content, settings or credentials are present in unencrypted receipts, which hold
only vault/transaction/generation IDs, counts and aggregate hash. Receipts never
substitute for authenticated inventory verification.

The code has bounded record/file/count limits and synthetic tests; it has not had
an independent security review or NAS/runtime qualification. Restoration here is
offline extraction/integrity only, not permission to activate old sync/auth state.
Startup/runtime guard failures now have a small explicit diagnostic vocabulary
(including `STORAGE_IO_ERROR`); arbitrary exception messages, paths, JSON fragments
and content are never logged. This guard change is local code only, not deployed
into the held/offline service.

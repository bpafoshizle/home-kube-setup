# Pilot storage incident — 2026-11-01

## Current disposition

**Offline, not accepted, no replacement owner released.** The Deployment was
scaled from one replica to zero using a resourceVersion-tested patch. The Pod is
gone; Deployment readback is 0/0. `pilot-values.yaml` now carries an explicit
`maintenanceHold: true` so a later chart upgrade cannot inadvertently request a
restart. Removing the hold is not itself permission to release a new owner.

This was an observed failure, not an agent-initiated disruptive test. No existing
human vault/database/credentials or unrelated workload was changed.

## Evidence (read-only unless stated)

- Fresh check found `obsidian-pilot-6d8cbb8fc4-kvz8l`, UID
  `47322d58-1906-41d6-a7a1-1e23afa39909`, on the same bletchley002, 1/2 Ready.
  Cortex had 215 restarts at detailed inspection; LiveSync had 16 and was running.
  Cortex logs contained the fixed `PILOT_GUARD_START_REFUSED` signal. Raw upstream
  output and note/credential data were withheld.
- LiveSync's actual guard verification passed. Host read-only inspection found
  the exact Cortex ext4 mount at `/dev/sda`, required filenames with nonzero sizes,
  UID/GID 1000 root directory mode 0700 and about 4.91 GB available. This visible
  mount/metadata did **not** establish working storage.
- Bounded reads of `.pilot-storage.json`, `.pilot-cortex-state.json`, `index.db`
  and `oauth.db` all failed with Linux errno **5 (EIO)**. No application-state
  contents were printed or changed. The guard correctly refused startup.
- Kernel categories showed iSCSI transport errors through approximately
  `2026-11-01T06:01:08Z`, block I/O and ext4 errors around `06:05:20Z`, and an
  additional ext4 message at `06:10:31Z`. These are correlation timestamps, not a
  demonstrated root cause. Raw kernel lines were not published.
- Orderly scale-to-zero was the only workload mutation. The termination watcher
  observed container exits but **did not establish clean shutdown within its
  guard limit**. It exited nonzero and generated no successful clean-stop proof.
  Do not reinterpret Pod disappearance as clean shutdown or reuse the older proof.
- After Pod removal, all four eligible workers passed the existing read-only
  no-session check (changed=0). Readback on bletchley002 found no remaining old
  Pod/device mounts. Session disappearance alone is not fencing or recovery proof.
- NAS TCP ports 3260, 2049 and 5001 accepted connections from bletchley002 at the
  later check. Current reachability does not prove the target/LUN is healthy or
  establish why the previous connection failed.
- Browser-harness found no existing DSM tab. A new tab at the previously trusted
  `https://lynott.local:5001/` stopped at a certificate/privacy error. The warning
  was not bypassed, no password was requested, and DSM target/volume health has
  not been inspected. Human-established trusted management access is needed for
  that next read-only check; do not send NAS passwords in chat.

## Recovery boundary

No re-login, remount, filesystem repair, format, state bootstrap, credential
rotation, owner transfer or forced release was attempted. No real backup/key or
archive existed before this failure; a usable backup cannot be claimed now.

The normal maintenance controller must reject this incident's missing clean-stop
proof. It must not use backup authorization to bypass an exceptional recovery
hold. Before a deliberate recovery attempt, inspect NAS target/LUN/Volume health
and relevant transport history, establish no surviving writer/session/mount,
reverify exact LUN/serial/UUID and define a controlled offline filesystem check.
Any repair or application-state reconciliation must be considered separately;
never replace unreadable state with empty databases or reconnect stale sync/auth
state. Cross-node transfer still requires the physical-fencing contract.

Backup code and synthetic local tests may continue while offline. They are not
evidence that the damaged/unreadable pilot state has been backed up or restored.

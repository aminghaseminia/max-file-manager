# Two-folder synchronisation

Status: **implemented** for local and remote endpoints, one-way and two-way, dry run,
saved jobs and a scheduler, history/restore, the optional local rsync engine, per-side age
encryption, and restic version history for local destinations.

The user-facing entry points are the three direction buttons on the pane divider and the
`Sync with the other pane` command (`Ctrl+Shift+Y`).

## Endpoints

A side is either an absolute local path or one of the app's remote URIs:

```
/home/amin/Photos
sftp://user@host/srv/backup
s3://profile@bucket/prefix
```

The same `RemoteFs` the file manager uses for every remote operation (SFTP through `ssh2`, FTPS
through `basic-ftp`, S3 with a hand-rolled SigV4 client) is the only remote transport. The sync
module never starts `ssh`, `rsync`, `rclone` or any other process.

Every path that arrives from the renderer or MCP is validated in main (`path.isAbsolute` or
`isRemotePath`), and relative paths are rejected. The two sides may not be the same path.

## Comparison

| mode | what it compares |
| --- | --- |
| date modified (`mtime`) | size + modification time; differences under 2 s are the same moment (FAT/SMB round to 2 s) |
| content hash (`hash`) | sha256 of the file; timestamps are ignored |

A remote file is hashed by downloading it to a temporary file once per run (the `HashCache` keeps
the result for the duration of the comparison). S3 and FTP have no reliable way to keep a
modification time, so `hash` is the better default for those endpoints; SFTP and local keep the
mtime on every copy, so repeated runs stay stable.

The walk skips `.mfm.json` and `.mfm-versions`, never follows a symbolic link, does not create
empty folders (files below them create the parents), and stops at 20 000 rows or the wall-clock
budget. A truncated result is reported as `capped`, never as a complete list.

## One-way

`ltr` (left → right) and `rtl` (right → left) trust one side:

- a file that exists only on the source is copied;
- a file whose source is newer is copied;
- a file that exists only on the destination is deleted only when `deleteExtra` is on;
- a file that is newer on the destination is **never** overwritten;
- a folder on one side and a file on the other is a conflict, not a guess.

Local deletions go through `shell.trashItem`. A remote deletion is permanent (there is no remote
trash), so the service refuses it unless the caller passes an explicit confirmation; the UI shows
the count and the warning before the run.

## Two-way (`both`)

Two-way needs a **baseline**: the state of every path after the last successful two-way run. It is
stored per pair in the `sync_baseline` table. Without it, «deleted on the left» and «new on the
right» are indistinguishable.

The three-way comparison marks a conflict when:

- both sides moved away from the baseline and still differ (`bothChanged`);
- one side changed and the other deleted the file (`editDelete`);
- the same path appeared on both sides with different content and there is no baseline (`bothNew`);
- one side is a folder and the other is a file (`typeDiff`).

A conflict is **reported, never guessed**. The workspace lists it, the user picks *keep left*,
*keep right* or *skip*, and only then can the run start. The plan refuses to start with an
unresolved conflict.

Deletions propagate in two-way mode only when `deleteExtra` is on; the default is off so a
two-way run never removes a file without the user opting in.

The baseline is updated only after a **successful** two-way run. A copy records the source side;
a delete removes the path; a skipped or unresolved row keeps the previous anchor, so the next run
reports the same difference instead of forgetting it.

## rsync (local, one-way)

`SyncJob.useRsync` / the `Use rsync` checkbox switches one direction to the system `rsync` binary.
It is local ↔ local only: rsync over ssh would bypass the app's own host-key and credential model.
The engine is optional and detected at runtime; a missing binary is a clear error, not a fallback.

- The preview is rsync's own `--dry-run --itemize-changes`, so the plan is not a second
  implementation. Dirs, symlinks and hardlinks are left to rsync and are not separate plan rows.
- `--update` implements newest-wins for mtime comparison; hash comparison switches to
  `--checksum` and drops `--update`.
- Deletions use `--backup --backup-dir=<dest>/.mfm-trash/<stamp>`, not a hard delete. The next
  run excludes `.mfm-trash`, `.mfm-restic`, `.mfm.json` and `.mfm-versions`.
- Advanced switches are opt-in: `compress`, `bwlimitKB`, `partial`, `inplace`, `sparse`,
  `hard-links`, `acls`, `xattrs`. Every switch is a separate argv entry; no shell is involved.
- rsync cannot encrypt; a job with an encrypted side always uses the native engine.
- Two-way sync stays native (it needs the baseline and conflict rules).

## Encryption per side

Each side can store age ciphertext (`age-encryption`, pure JS; X25519 or a passphrase). Jobs keep
only a `secretId`; the passphrase or private identity is encrypted with the OS keyring
(`safeStorage`) and never crosses to the renderer beyond an explicit key-backup reveal.

- **Target side:** every copied file is encrypted before it is written. **Source side:** every read
  is decrypted before comparing or copying. A plaintext side is untouched.
- The file name stays visible; content becomes age ciphertext. An encrypted side is **not** browsable
  by other tools (or the ordinary preview) — the sync workspace is the decrypting surface.
- Comparison is forced to **sha256 of the plaintext**; the encrypted side is decrypted (to a temp
  file) for each hash. That is correct but slower than an mtime comparison; a manifest cache is a
  future optimization.
- A keypair can be generated in the UI and must be backed up (the reveal/copy box). Replacing a
  keypair can make old ciphertext unreadable and asks for confirmation.
- If the OS has no real keyring, the secret is session-only and the UI says so.

## Versions (restic)

A job can keep a local history of its destination with `restic`. The default repository is
`<destination>/.mfm-restic`; a different absolute local path is allowed. The repository password is
another `secretId` in the same keyring store, passed to restic through `RESTIC_PASSWORD` (never
argv).

- One-way local destinations only. A remote destination is refused before any file is touched,
  because restic's own SSH/S3 backends would duplicate the app's credential and host-key model.
- The **first** run takes a pre-snapshot (nothing else exists to fall back on), then a post-snapshot
  after a successful run. Later runs rely on the previous post-snapshot as their «before» state and
  take one after; `forget --keep-last N --prune` keeps the configured number (default 5).
- A failure to take the pre-snapshot aborts the run before touching the destination. A failed
  post-snapshot is recorded as a warning in the run summary.
- The Versions tab lists the tagged snapshots. **Restore** writes a snapshot into a fresh temp
  folder and opens it in the pane opposite the destination; it never overwrites the live trees.
  The temp folder is intentionally left for inspection.
- `.mfm-restic` and `.mfm-trash` are excluded from every backup and from the native/rsync walk.

## Dry run, run, restore

- *Compare* walks both trees and builds the plan, writes nothing, and returns rows + counts.
- *Dry run* re-plans and reports the exact number of copies/deletes/skips without writing.
- *Run* re-compares (never trusts a stale plan), refuses unresolved conflicts, asks for a
  confirmation when the plan deletes anything, then applies it.
- Every real run is stored in `sync_runs` with its plan (the exact copy/delete actions).
- *Restore* reverses the copies of a recorded run while the source still exists. A file that the
  original run **deleted** cannot be restored from a plan alone; it is reported as unrestorable.
  This is why the UI says «no version is kept» before a destructive run — until the restic phase
  lands, a deleted file is gone.

## Jobs and schedules

A job is a saved pair + direction + comparison + ignore list + delete flag + schedule. It lives in
`prefs.syncJobs` (`src/shared/sync.ts` validates it; an invalid entry is dropped and never breaks
boot). The main process reads the same prefs blob, so a job is not duplicated in a second store.

A schedule may combine:

- `onStart` — once, shortly after the app starts;
- `everyMinutes` — a wall-clock interval;
- `cron` — five fields (`minute hour day month weekday`), including ranges, lists and steps;
- `onMount` — after the app mounts a removable drive;
- `onChange` — a local endpoint changed (recursive `fs.watch`, 10 s debounce; a remote endpoint has
  no watcher and simply falls back to the clock).

One sync run is active at a time; the scheduler skips a tick while a run is in progress. A
scheduled run sets `confirmRemoteDelete = false`, so a job that would delete on a remote side
fails with a clear message instead of deleting silently. The sidebar shows the jobs (only when at
least one exists); the progress of the active run also appears in the jobs bar.

## UI

- The **direction pill** sits on the 6 px pane divider. It appears at 55 % opacity and becomes
  fully opaque on hover; the three buttons are left → right, two-way, right → left. Clicking one
  stores the choice for the pair (`prefs.syncPairDirs`) and opens the workspace in that direction.
  `onPointerDown` is stopped so a click never starts the column-resize drag.
- The **workspace** is a full-window dialog (not the old small dialog). It has a compare-by
  selector, ignore list, direction, delete-extra, differences-only, the action buttons, summary
  chips, a virtualised row table (only the visible rows exist in the DOM), a conflicts tab, a
  history tab with restore, and a jobs tab with the schedule form.
- The old flat 500-row dialog was replaced; the old `SyncDialog.tsx` is gone.

## MCP

`sync_compare`, `sync_plan`, `sync_jobs`, `sync_history`, `sync_status` are read-only.
`sync_run`, `sync_apply` (legacy), `sync_job_save`, `sync_job_remove`, `sync_restore`,
`sync_cancel` are mutating and therefore hidden in read-only mode. No tool ever accepts a
passphrase or a secret; a job references no secret today. `sync_apply` re-compares instead of
trusting rows supplied by the caller, and never confirms a remote deletion on its own.

## Files

| file | role |
| --- | --- |
| `src/shared/sync.ts` | job/row/plan shapes shared by main, renderer and MCP; validation |
| `src/main/sync-core.ts` | pure comparison, three-way matrix, plan, baseline, inverse (tested) |
| `src/main/sync-engine.ts` | walk/hash/copy/delete over local or `RemoteFs` (tested against a fake remote) |
| `src/main/sync-store.ts` | `sync_runs` and `sync_baseline` tables in `search.db` |
| `src/main/sync-schedule.ts` | cron/interval due-time maths (tested) |
| `src/main/sync-rsync.ts` | local one-way rsync: argv, itemize/progress parsing, `.mfm-trash` (tested with real rsync) |
| `src/main/sync-crypt.ts` | age file encryption/decryption and plaintext hashing (tested) |
| `src/main/sync-secrets.ts` | sync secrets (age passphrase/key, restic password) in the OS keyring |
| `src/main/sync-versions.ts` | restic init/backup/snapshots/forget/restore (tested with real restic) |
| `src/main/sync-service.ts` | queue, one active run, scheduler, history, restore, encryption and versions |
| `src/main/sync.ts` | the old local-only helpers; only the line diff remains in use |
| `src/renderer/src/SyncWorkspace.tsx` | the full-window workspace |
| `src/renderer/src/SyncPill.tsx` | the three direction buttons on the divider |

## Known limits

- rsync is local/one-way; two-way and remote stay on the native engine.
- An encrypted side is opaque to the ordinary file manager; decryption happens only inside sync.
- restic history is local-destination only, and restore goes to a temp folder rather than rolling
  the live tree back.
- A restic snapshot of a large tree costs seconds; retention runs `--prune` after every post
  snapshot and can take longer.
- The `.mfm-trash` from rsync is recoverable but is not cleaned automatically; the user owns it.

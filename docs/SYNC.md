# Two-folder synchronisation

Status: **implemented** for local and remote endpoints, one-way and two-way, with a dry run,
saved jobs, a scheduler, history and restore. **Not implemented yet:** per-side encryption, the
rsync engine, and restic version history (see *Later phases* at the end).

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
| `src/main/sync-service.ts` | queue, one active run, scheduler, history, restore |
| `src/main/sync.ts` | the old local-only helpers; only the line diff remains in use |
| `src/renderer/src/SyncWorkspace.tsx` | the full-window workspace |
| `src/renderer/src/SyncPill.tsx` | the three direction buttons on the divider |

## Later phases

1. **Encryption per side** (age-compatible, passphrase or X25519). Content-only, names clear;
   the encrypted side stores `name.ext.age`, and hashes are computed on plaintext. The engine must
   stream through the cipher, which is why it needs its own phase.
2. **rsync for local ↔ local** as an optional advanced engine (argv array, never a shell string);
   remote endpoints stay on `RemoteFs`.
3. **restic versions** for local destinations: `keep-last N` (default 5, configurable), snapshot
   before/after, restore via `restic dump`. A remote destination is deliberately out of scope until
   the credential/host-key story for restic's own backends is settled.

# Cloud folders

Status: **implemented** for the WebDAV family (Nextcloud, ownCloud, generic WebDAV and QNAP over
WebDAV) and for Google Drive, Dropbox and OneDrive over OAuth. Proton Drive stays *soon* (no stable
public API).

A cloud folder is a **local folder mirrored with one folder on a cloud account** — not a virtual
mount. The app's preview, editor, index, thumbnails, `.mfm.json` and archives all assume a real file
on disk, so the local copy is the working copy and the cloud is the other side.

## One engine, one adapter

The cloud side is a third `PathOps` backend next to local and the SFTP/FTP/S3 remote:

```
src/shared/cloud.ts     types, provider catalog, validation (shared with the renderer)
src/main/cloud-dav.ts   the WebDAV client (PROPFIND/GET/PUT/MKCOL/DELETE)
src/main/cloud-engine.ts cloudOps(binding): PathOps   →  walk / compare / plan / apply
src/main/cloud-service.ts accounts, bindings, queue, scheduler, watcher, live state
src/main/cloud-store.ts  accounts/bindings/cursors in the SQLite `app` table + keyring secrets
src/main/cloud-core.ts   pure scheduling/path/conflict helpers (tested)
```

A binding is addressed as a virtual path, `cloud://<bindingId>/<rel>`. `createOps(remote, cloud)`
routes any path with that prefix to the cloud adapter, so `compareTrees`, `planRows`, `applyPlan`,
the three-way baseline and the conflict rules are the existing, tested code. There is no second sync
engine.

## Providers

| Provider | Transport | Status |
| --- | --- | --- |
| Nextcloud | WebDAV + app password (`/remote.php/dav/files/<user>`) | ready |
| ownCloud | WebDAV + app password | ready |
| WebDAV | URL + user + password | ready |
| Qsync | QNAP's WebDAV (the Qsync client protocol is not public) | ready |
| Google Drive | OAuth + Drive v3 (path→id resolution) | ready |
| Dropbox | OAuth + `files/list_folder` | ready |
| OneDrive | OAuth + Microsoft Graph path API | ready |
| Proton Drive | no stable public API | soon |

Google Drive needs the **full `drive` scope**, because the picker must list folders that already
exist in the account. That means Google's restricted-scope verification is a prerequisite before a
public release; `drive.file` was rejected on purpose (it can only see folders the app itself
created).

### OAuth (Drive, Dropbox, OneDrive)

- **No client id is shipped.** The connect form asks for the user's own OAuth app (Client ID, and for
  Google the Client Secret), with a link to the provider's page for creating one. Shipping someone
  else's client would break the providers' terms and their rate limits.
- Authorization Code + PKCE (S256). The consent page opens in the system browser; the code returns
  to a loopback listener on the **fixed** `http://127.0.0.1:53682/callback` (a random port only when
  53682 is taken, so Dropbox's exact-match redirect can be registered once). The server closes right
  after the callback, and a mismatched `state` is rejected. The connect form shows and copies the
  redirect URI.
- Access and refresh tokens (and the client id/secret needed for a later refresh) are encrypted with
  `safeStorage` in the account's keyring entry. A token is refreshed 60 seconds before expiry, or on
  the next run after a restart; a missing refresh token parks the binding with a clear error.
- Scopes: Drive `drive openid email`; Dropbox `account_info.read files.metadata.read
  files.content.read files.content.write`; Microsoft `offline_access Files.ReadWrite User.Read`.
- OneDrive compares by **hash**: Graph stamps its own timestamp on upload, so mtime would bounce.
  Dropbox sends `client_modified`, Drive sends `modifiedTime`, so those two keep the timestamp.
- Drive has no path API: the adapter resolves each path segment by name and caches path→id for the
  run. OneDrive and Dropbox are path-addressed natively.
- Limits: OneDrive's single-request upload cap is 250 MB (an upload session is a later phase); Drive
  multipart upload streams the file, so it is not memory-bound. Remote deletes go to the provider's
  own trash (Drive `trashed`, Dropbox deleted files, OneDrive recycle bin).

Credentials never cross the IPC boundary: the password is encrypted with `safeStorage`
(KWallet / GNOME Keyring / DPAPI). If the OS has no real keyring, it lives in memory for this
session only and the account says so.

## Flow

1. Pick a service, enter the server URL, user and an app password; **the connection is tested
   before anything is stored**.
2. Browse the remote folders (or create one); the same dialog then asks for the local folder
   (default: the active pane).
3. The binding starts in two-way mode, deletion propagation **off**.

Deletion is a per-binding switch and only exists when both sides are recoverable: local deletions go
to `shell.trashItem`, Nextcloud/ownCloud keep their own trash, and a plain WebDAV server has none —
the settings page says so.

## Conflicts

A conflict is never guessed and never auto-resolved:

- the row gets an orange dot in the list/grid and a tooltip;
- a short note appears once in the status bar;
- the binding row keeps a conflict count in the sidebar and in settings until it is resolved;
- a background run applies the **non-conflicting** rows only; the conflicting paths are untouched.

Resolving happens in the same two-pane workspace the sync feature uses (left = local, right =
cloud); no `.conflict` copies are invented.

## Scheduling and «lightweight»

- **One 30 s tick for the whole app**, not a timer per folder. A binding is due at
  `lastRunAt + interval`; the floor is 5 minutes for WebDAV and 15 minutes is the default.
- A **recursive `fs.watch`** on the local folder pulls the next run forward after a 1.5 s debounce.
  No directory is scanned on a timer.
- **Catch-up on start**: everything that changed while the app was closed is applied on the first
  tick.
- Failures back off exponentially (up to 30 minutes) and never hammer a server. A missing password
  or an offline network parks the binding until the next tick.
- With zero bindings, nothing runs and no request is made. The app does not start a background
  daemon; if it is closed, nothing syncs.

Local changes reach the cloud within seconds via the watcher. Remote changes are bounded by the
interval: this phase walks the tree again on each run (`list` only; hashing still downloads). Delta
cursors (`changes.list`, `list_folder/continue`, Graph `delta`) and Dropbox's long-poll are the next
optimization behind the same `CloudClient` interface.

## Compare modes

- `mtime` (default for servers that keep the source timestamp: Nextcloud/ownCloud send/receive
  `X-OC-Mtime`).
- `hash` (default for plain WebDAV/Qsync, where a PUT resets the timestamp): the content hash is
  compared, which is correct but downloads both sides. `HashCache` keeps one download per file per
  run.

Both are per-binding in settings.

## Badges in the pane

`main` enriches `fs:list` results: an entry inside a binding gets `cloud: { provider, state, root }`.

- **root**: the provider glyph next to the folder icon (the folder's own colour/icon is preserved);
- **anything below it**: a small state dot (`synced`, `pending`, `syncing`, `paused`, `offline`,
  `conflict`, `error`);
- the type icon is never replaced, and the badge costs no fs call (a prefix lookup over the
  bindings).

## Limits

- No resumable upload yet; a large file is one PUT (Nextcloud chunking / Drive resumable / Graph
  upload sessions are a later phase). OneDrive refuses above 250 MB with a clear message.
- A remote move is a copy + delete; the engine's plan has no rename action.
- `.mfm.json` and `.mfm-*` folders are excluded from every cloud walk, like every other sync.
- A plain WebDAV delete is permanent; a scheduled run never deletes on the cloud side without
  `confirm` (manual *Sync now* can, with the checkbox).

## Tests

- `src/shared/cloud.test.ts` — path/id validation, interval floors, overlapping bindings.
- `src/main/cloud-core.test.ts` — backoff, dirty debounce, entry states, remote path arithmetic.
- `src/main/cloud-dav.test.ts` — Multi-Status parsing (namespaces, encoded names, depth 1).
- `src/main/cloud-engine.test.ts` — a real loopback WebDAV stub and a full two-way run through
  `compareTrees`/`applyPlan`: upload, nested MKCOL, download, delete, and the redirect refusal.

## Tests

OAuth URL/PKCE/token-body and the Drive name query have their own tests (`cloud-oauth.test.ts`);
the adapters take an injected `fetch`, so a provider can be exercised against a stub without a
network. A live sign-in needs a registered app and a real account.

## MCP

`cloud_status`, `cloud_browse` (read) and `cloud_sync`, `cloud_pause` (write). Account creation is
UI-only on purpose: a password must be typed by a human and written to the keyring, never passed
through an agent call.

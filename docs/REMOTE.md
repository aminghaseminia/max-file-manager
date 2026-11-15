# Remote locations — FTP, FTPS, SFTP and S3

Remote folders are first-class locations: a tab, a bookmark, a pane or an MCP argument can point at
one, and the transfer engine copies between local and remote as easily as between two local folders.

## Protocols and URIs

| protocol | scheme | default port | authentication |
| --- | --- | --- | --- |
| FTP | `ftp://user@host/path` | 21 | user + password, or anonymous |
| FTPS (explicit TLS) | `ftps://user@host/path` | 21 | user + password |
| FTPS (implicit TLS) | `ftps://user@host:990/path` | 990 | user + password, ticked in the profile |
| SFTP | `sftp://user@host/path` | 22 | password, private key file, or SSH agent |
| S3 | `s3://profile@bucket/prefix` | — | access key + secret key (or session token) |

The URI never contains a password. Credentials live in a **profile** saved in the SQLite `app`
table and are looked up by the URI:

- FTP/FTPS: scheme + host + port + user.
- SFTP: scheme + host + port + user.
- S3: the optional profile name before `@`; without one the app accepts a bucket only if exactly
  one saved S3 profile uses it (an ambiguous bucket asks you to open the connection from the
  sidebar).

Profiles are managed from **Remote** in the sidebar (the `+` button) or the *Remote connections*
command. The dialog can test a connection before saving it.

## Credentials and the OS keyring

Passwords, S3 secret access keys, session tokens and SFTP key passphrases are encrypted with
Electron's `safeStorage` (KWallet / GNOME Keyring / macOS Keychain / DPAPI). Only profile metadata
(host, user, bucket, key path, access key id) is stored as plain JSON.

If no OS keyring is available, the secret is kept **in memory for this session only** and the
dialog says so. It is never written to disk in plaintext.

## SFTP specifics

- **Everything is bundled.** The app uses the pure-JavaScript `ssh2` client; there is no `ssh`,
  `sftp`, `ssh-keygen` or other program to install, and no external process is started.
- **Import from `~/.ssh/config`.** The SFTP form has *Import from `~/.ssh/config`*. It lists
  concrete `Host` aliases with `HostName`, `User`, `Port` and `IdentityFile` (including `~`, `%d`,
  `%h`, `%r`, `%u` expansion). Wildcard hosts, `Include`, `Match`, `ProxyJump` and `ProxyCommand`
  are not followed; the imported row is ordinary editable data.
- **Keys.** Choose *Private key* and give the key file path (`~/.ssh/id_ed25519`, PEM or OpenSSH
  format). Encrypted keys need their passphrase; the passphrase is stored encrypted, never the key
  itself. The key is read by the app when connecting.
- **Agent.** Choose *SSH agent* to use `SSH_AUTH_SOCK` (Linux/macOS) or Pageant (Windows). The app
  never asks for the agent's key.
- **Host keys.** `~/.ssh/known_hosts` (user) and `/etc/ssh/ssh_known_hosts` (system) are checked,
  including `|1|salt|hash` hashed entries, `[host]:port` entries, wildcard patterns, `!` negation
  and `@revoked`. A host whose pinned key no longer matches is rejected with the new fingerprint.
  A host that is not in `known_hosts` can be accepted with **trust on first use**; the fingerprint
  is then pinned to the profile and the option turns itself off.
- **Password auth** stays available and behaves like the other protocols.

## S3 specifics

The client implements AWS Signature V4 itself (no AWS SDK dependency). It works with AWS and
S3-compatible servers (MinIO, Ceph, Backblaze B2 S3 API, DigitalOcean Spaces):

- custom **endpoint** (`https://minio.example:9000` or `http://127.0.0.1:9000` for a local test
  server), **region**, **path-style** addressing (default on for a custom endpoint, off for AWS),
  session tokens, and an optional *verify TLS* switch for self-signed certificates.
- listing uses `ListObjectsV2` with a `/` delimiter (paginated, capped); folders are common
  prefixes or zero-byte marker objects.
- upload uses a signed streaming `PUT` (up to the 5 GB single-PUT limit; no multipart yet),
  download streams to a temp file and renames it into place.
- copy/rename uses server-side `CopyObject` where possible; deleting a folder lists its keys and
  uses `DeleteObjects` batches. A bucket root is never deleted.

## What works from a remote folder

- listing, navigation, tabs, bookmarks, up/back/forward, breadcrumbs and the status-bar badge;
- copy/move/upload/download in any direction through the **transfer queue** (progress, speed,
  pause, resume, cancel); remote→remote goes through a temp file;
- rename, batch rename, new folder, new file (including the binary document templates) and undo of
  those operations;
- preview, image viewer/gallery, editor, video playback (the file is cached locally first),
  thumbnails, checksum, recursive size, properties (general/checksum/details), “open with” and
  native drag-out (materialized in the cache first);
- saving edited images and pasted clipboard images back to the server.

Remote folders deliberately do **not** support: the local `.mfm.json` metadata (colours, labels,
ratings, pins, folder format), archives (browse/create/extract), the search index, duplicate
finder, sync/diff, terminal/scripts, symbolic links and the permission editor. The UI hides or
refuses those actions with a message instead of pretending they worked.

Deleting a remote entry is **permanent** (there is no remote recycle bin) and always asks first.

## Cache and limits

Remote files that a renderer surface needs as a local path go through
`userData/remote-cache`:

- key = remote URI + listing version (mtime + size), so a changed file gets a new path and never
  hits a stale browser image cache;
- LRU pruning (2 GB / 2000 files) and a 512 MB per-file ceiling; a larger video is refused rather
  than silently filling the disk;
- `thumb://remote/…` and `mfm://remote/…` serve cached files with byte-range support, so audio,
  video and PDF behave like local files once materialized.

## MCP

`remote_connections`, `remote_test`, `remote_add`, `remote_remove`, `remote_connect` and
`ssh_config` expose the same profiles and operations to agents (secrets are redacted from the audit
log). All path-based tools accept remote URIs wherever the UI does. See [MCP.md](MCP.md).

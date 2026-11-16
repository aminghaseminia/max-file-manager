# TODO

## Security review of the 2026-11-16 upstream merge

Both items are real, neither blocks using the app; they widen what a **write-mode** MCP client or a
local process holding the token can reach. Fix before the next release that advertises remote
locations.

- [ ] **`remote_test` is `read: true` but connects anywhere.** With a free-form `profile` draft it
      makes the main process open an FTP/SFTP/S3 connection to any host/port the caller names.
      A read-only agent can therefore use the app as a network probe. Options: require read-write
      mode whenever a draft is supplied, or accept only a saved profile id.
      (`src/main/mcp.ts`, `mcpHandler` in `src/main/index.ts`, `testRemoteDraft` in
      `src/main/remotes.ts`.)
- [ ] **TLS can be downgraded per profile.** `remote_add` (write mode) can save
      `verifyTls: false` or a plain `http://` endpoint. That is a deliberate feature for local
      MinIO/self-signed servers, but an agent can create it silently and the audit log only shows
      the booleans. Add an explicit UI warning and record the downgrade flag in the audit summary.
      (`src/shared/remote-profile.ts`, `src/main/s3.ts`, `src/main/remote-ftp.ts`.)
- [ ] **ssh2's install script needs a C toolchain.** `npm ci` runs `node install.js`, which tries
      `node-gyp rebuild` for an optional crypto binding and exits 0 on failure. The packaged app
      excludes `cpu-features` and `nan`, but a developer machine needs Python/make/g++ for the
      optional speed-up. Say this in the build prerequisites.

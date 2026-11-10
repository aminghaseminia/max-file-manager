# MCP contract — letting other agents drive the file manager

Status: **designed, not implemented.** This file is the spec the implementation phase follows, so
the API shape is agreed before any code lands.

## Why a local API and not a fat MCP server

Everything the UI can do already lives behind the app's own IPC surface (`fs:*`, `job:*`, `meta:*`,
`pdf:*`, `app:*`). An MCP server that re-implements file operations would drift from the app within
a phase. So: the running app exposes its **existing** operations over a loopback JSON-RPC endpoint,
and the MCP server is a thin stdio bridge that renames them into tools. One source of truth, one
implementation, and the agent sees exactly what the user would see (same panes, same state, same
undo stack).

```
agent ──stdio(MCP)──> bin/mfm-mcp.mjs ──HTTP 127.0.0.1:47321 + token──> max-file-manager (main process)
```

## Security rules (not negotiable)

1. **Off by default.** `prefs.mcp.enabled = false`; enabling it writes `~/.config/max-file-manager/mcp.json`
   with `{port, token, mode}` and `chmod 600`.
2. **Loopback only.** Bind `127.0.0.1`, reject any request whose `Origin` is set or whose `Host`
   is not `127.0.0.1:<port>`. No CORS headers at all.
3. **Token required** on every request (`Authorization: Bearer <token>`), compared in constant time.
4. **Two modes.** `read-only` (default) exposes only the read tools; any mutating tool answers
   `E_READONLY` until the user switches to `read-write` in Preferences → «ایجنت‌ها».
5. **Never secrets.** Card numbers, passwords, vault entries and the token itself are never returned
   by any tool. `prefs` reads redact nothing today because prefs hold no secrets — keep it that way.
6. **Audit log.** Every call appends `{ts, tool, args-summary, ok}` to `~/.config/max-file-manager/mcp.log`
   (append-only, no file contents). The Preferences page shows the last 50 lines.
7. **Trash by default.** `trash` uses `shell.trashItem`; `delete` (permanent) needs `confirm: true`
   in the call, exactly like Shift+F8 in the UI.

## Tools

Paths must be absolute; relative paths are rejected with `E_PATH`. Every listing call returns
the same `Entry` shape the UI uses (`name, path, dir, size, mtime, ext, mode, uid, gid, nlink, w, h`).

### read (always available)

| tool | args | returns |
| --- | --- | --- |
| `roots` | – | drives + home |
| `list` | `path`, `hidden?`, `dims?` | entries + `pins` + `labels` |
| `dirs` | `path` | child folders only (for tree walking) |
| `search` | `path`, `query?, regex?, content?, minSize?, maxSize?, newerThan?, olderThan?`, `limit?` | matched entries (cap 5000) |
| `dupes` | `path`, `limit?` | groups of identical files (sha256) |
| `preview` | `path`, `maxKB?` | kind + text/headline, capped |
| `read_text` | `path` | text up to 8 MB |
| `archive_list` | `path` | entries inside a zip/tar |
| `meta_get` | `dir` | `{color, icon, pins, labels}` |
| `hash` | `paths[]`, `algo?` | digests |
| `jobs_list` | – | running/finished jobs with progress |
| `state` | – | panes, tabs, active pane, prefs |

### write (needs `read-write`)

| tool | args | notes |
| --- | --- | --- |
| `write_text` | `path`, `text` | atomic (temp + rename), 8 MB cap |
| `mkdir` | `dir`, `name` | |
| `rename` | `path`, `name` | never overwrites |
| `copy` / `move` | `paths[]`, `dest` | queued as jobs; honour the transfer filters |
| `trash` | `paths[]` | system trash |
| `delete` | `paths[]`, `confirm: true` | permanent, refuses without confirm |
| `extract` | `archive`, `names[]?`, `dest` | |
| `create_zip` | `dir`, `name`, `sources[]`, `level?` | streamed |
| `label_set` | `dir`, `name`, `label\|null` | palette ids only |
| `pin_set` | `dir`, `name`, `on` | |
| `meta_set` | `dir`, `patch` | color/icon |
| `prefs_set` | `patch` | validated through `mergePrefs` |
| `pdf_render` | `path`, `out?` | markdown/text → PDF |

### ui (needs `read-write`, they change what the user sees)

`goto(panes[], path)`, `select(pane, paths[])`, `open_path(path)`, `open_editor(path)`,
`open_gallery(path)`, `open_preview(path)`, `note(text)` — the last one puts a message in the
status bar so a human watching knows an agent is acting.

## Resources and prompts

- `mfm://state` — JSON snapshot of the whole window.
- `mfm://pane/{0,1}/listing` — current entries of that pane.
- `mfm://prefs` — the preference object.
- prompt `organize-folder` — "look at this folder, group obvious duplicates, tag them, propose a
  rename plan; make no changes until I say yes".

## Client wiring (what the user pastes into an agent config)

```json
{
  "mcpServers": {
    "max-file-manager": {
      "command": "node",
      "args": ["/data/Codes/max-file-manager/bin/mfm-mcp.mjs"]
    }
  }
}
```

The bridge reads `~/.config/max-file-manager/mcp.json` for the port and token, so nothing secret
lives in the agent's config file.

## Phases

1. HTTP endpoint + token + audit log + read tools. `mfm-mcp.mjs` bridge with those tools.
2. Write tools behind `read-write`, with a confirmation flag on destructive ones.
3. UI tools and resources; the `organize-folder` prompt.
4. Preferences → «ایجنت‌ها» page: enable, mode switch, token regenerate, log viewer.

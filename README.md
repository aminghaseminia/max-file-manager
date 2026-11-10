# Max File Manager

A dual-pane desktop file manager for KDE and Windows, aiming at Directory Opus level of features — built with Electron, TypeScript and React. The interface is Persian (RTL); paths and file names stay left-to-right.

![screenshot](docs/screenshot.png)

A real copy job in the operations bar, with progress, speed, pause and cancel:

![jobs](docs/screenshot-jobs.png)

Grid view with real image thumbnails (light theme), flat view, and batch rename with a live preview:

![grid view](docs/screenshot-grid.png)
![flat view](docs/screenshot-flat.png)
![batch rename](docs/screenshot-rename.png)

**Status: v0.3** — phases 1–2 are done and most of phase 3; see [docs/FEATURES.md](docs/FEATURES.md) for what is still missing (folder sync, filters on copy, labels, checksums).

## What works today

- Two independent panes (source / destination), tabs in each, per-pane back/forward history
- List view (name / type / size / date, sortable, folders first) and grid view with thumbnails
- Virtualized rendering in both views: a 100k-entry folder mounts only the visible slice
- **Transfers go through a queue**: byte progress, speed, pause/resume, cancel, per-item error list
- File operations: copy (F5), move (F6), new folder (F7), trash (F8), permanent delete (Shift+F8), rename (F2), batch rename (F2 on a multi-selection) with a live preview
- **Undo** (Ctrl+Z) for move, rename and new folder
- **Search** in the current folder tree: name with `*`/`?` or a regular expression, optional text inside content — results arrive as a virtual listing
- **Flat view**: every file under the current folder in one list, with relative paths
- **Duplicate finder**: identical files by size + sha256, grouped and numbered
- Folder size on demand (F9), bookmarks (Ctrl+D), hidden files (Ctrl+H), dark/light theme
- Sidebar folder tree (lazily loaded) plus bookmarked folders
- Session restore: panes, tabs, theme, view, sort and bookmarks survive a restart
- Roots: `/`, home and removable mounts on Linux; drive letters on Windows
- Safety: existing names are never overwritten (`name (2).ext`), relative paths are refused, trash goes through the OS trash, a cancelled transfer removes its partial file

## Keyboard

- `F5` copy selection to the other pane · `F6` move · `F7` new folder · `F2` rename (batch when several are selected)
- `F8` trash · `Shift+F8` delete permanently · `F9` folder size · `F3` refresh · `Ctrl+Z` undo
- `Alt+←` / `Alt+→` back / forward · `Backspace` up · `Tab` switch active pane
- `Ctrl+A` select all · `Esc` clear selection and filter · `Ctrl+F` focus the filter
- `Ctrl+Shift+F` flat view · `Ctrl+H` hidden files · `Ctrl+D` bookmark this folder · `Enter` open selection

## Run it

```sh
npm install
npm run dev        # dev window, hot reload
npm test           # unit tests: transfers, undo, search, rename planner, pure helpers
npm run typecheck
npm run build && npm start
```

Packaging:

```sh
npm run dist:linux   # AppImage + deb
npm run dist:win     # NSIS installer (build on Windows, or via wine on Linux)
```

Headless render check (no desktop needed) — `SMOKE_JS` drives the real UI before the shot:

```sh
SMOKE_SHOT=/tmp/mfm.png xvfb-run -a npx electron .
SMOKE_JS="[...document.querySelectorAll('.tb')][0].click()" SMOKE_SHOT=/tmp/mfm.png xvfb-run -a npx electron .
```

## Why Electron

Directory listing, stat, transfers and hashing are native `fs`/`crypto` calls in the main process — the renderer only paints. What web tech buys here: a UI that can be rebuilt cheaply as the feature set grows (dual panes, tabs, virtual lists, toolbars, dialogs) and one codebase for KDE and Windows. What it costs: a ~150 MB baseline of memory versus a native toolkit, and OS integration (context menus, thumbnails, tray) has to be written by hand instead of coming from the desktop environment.

## Layout

```
src/main/index.ts     window, filesystem IPC, folder sizes, session state, mfm:// protocol
src/main/jobs.ts      transfer queue: progress, pause, cancel, undo, batch rename, mkdir
src/main/search.ts    recursive walk, name matcher, content search, duplicate finder
src/main/ops.ts       remove (trash / permanent) + name-collision helper
src/preload/index.ts  the only bridge into the renderer
src/renderer/src/     React UI: App, Pane (list/grid), Sidebar, JobsBar, RenameDialog, Icons, format.ts
docs/FEATURES.md      Directory Opus feature matrix and phases
AGENTS.md             rules for AI agents working in this repo
```

## License

MIT

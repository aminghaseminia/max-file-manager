# Max File Manager

A dual-pane desktop file manager for KDE and Windows, aiming at Directory Opus level of features — built with Electron, TypeScript and React. The interface is Persian (RTL); paths and file names stay left-to-right.

![screenshot](docs/screenshot.png)

Grid view with real image thumbnails, light theme:

![grid view](docs/screenshot-grid.png)

**Status: v0.2** — phases 1 and 2 of [docs/FEATURES.md](docs/FEATURES.md) are done; the file-operation queue, search and archive/protocol support are next.

## What works today

- Two independent panes (source / destination), tabs in each, per-pane back/forward history
- Real directory listing, breadcrumb, up, refresh; live name filter in the path bar
- List view (name / type / size / date, sortable, folders first) and grid view with thumbnails
- Virtualized rendering in both views: a 100k-entry folder mounts only the visible slice
- Selection: click, Ctrl-click, Shift-range, Ctrl+A, Esc
- File operations: copy (F5), move (F6), new folder (F7), trash (F8), permanent delete (Shift+F8), rename (F2)
- Folder size on demand (F9), bookmarks (Ctrl+D), hidden files (Ctrl+H), dark/light theme
- Sidebar folder tree (lazily loaded) plus bookmarked folders
- Session restore: panes, tabs, theme, view, sort and bookmarks survive a restart
- Roots: `/`, home and removable mounts on Linux; drive letters on Windows
- Destructive-operation safety: existing names are never overwritten (`name (2).ext`), relative paths are refused, trash goes through the OS trash

## Keyboard

- `F5` copy selection to the other pane · `F6` move · `F7` new folder · `F2` rename
- `F8` trash · `Shift+F8` delete permanently · `F9` folder size · `F3` refresh
- `Alt+←` / `Alt+→` back / forward · `Backspace` up · `Tab` switch active pane
- `Ctrl+A` select all · `Esc` clear selection and filter · `Ctrl+F` focus the filter
- `Ctrl+H` hidden files · `Ctrl+D` bookmark this folder · `Enter` open selection

## Run it

```sh
npm install
npm run dev        # dev window, hot reload
npm test           # unit tests (file operations + pure helpers)
npm run typecheck
npm run build && npm start
```

Packaging:

```sh
npm run dist:linux   # AppImage + deb
npm run dist:win     # NSIS installer (build on Windows, or via wine on Linux)
```

Headless render check (no desktop needed):

```sh
SMOKE_SHOT=/tmp/mfm.png xvfb-run -a npx electron .
```

## Why Electron

Directory listing, stat and copy/move are native `fs` calls in the main process — the renderer only paints. What web tech buys here: a UI that can be rebuilt cheaply as the feature set grows (dual panes, tabs, virtual lists, preview panes, custom toolbars) and one codebase for KDE and Windows. What it costs: a ~150 MB baseline of memory versus a native toolkit, and OS integration (context menus, thumbnails, tray) has to be written by hand instead of coming from the desktop environment.

## Layout

```
src/main/index.ts     window, filesystem IPC, folder sizes, session state, mfm:// protocol
src/main/ops.ts       copy / move / trash / delete / mkdir / rename (unit tested)
src/preload/index.ts  the only bridge into the renderer
src/renderer/src/     React UI: App (state, shortcuts), Pane (list/grid), Sidebar, Icons, format.ts
docs/FEATURES.md      Directory Opus feature matrix and phases
AGENTS.md             rules for AI agents working in this repo
```

## License

MIT

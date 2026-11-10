# Max File Manager

A dual-pane desktop file manager for KDE and Windows, aiming at Directory Opus level of features — built with Electron, TypeScript and React.

![screenshot](docs/screenshot.png)

**Status: v0.1** — the core daily driver works; the full feature matrix and its phases live in [docs/FEATURES.md](docs/FEATURES.md).

## What works today

- Two independent panes (source / destination), tabs in each
- Real directory listing, breadcrumb navigation, up, refresh
- Column list (Name / Size / Modified) with sorting and folders-first
- Virtualized rendering: a 100k-entry folder mounts only the visible rows
- Selection: click, Ctrl-click, Shift-range; keyboard-driven operations
- File operations: copy (F5), move (F6), new folder (F7), trash (F8), permanent delete (Shift+F8), rename (F2)
- Hidden files toggle (Ctrl+H), dark/light theme, open with the OS default app
- Roots: `/`, home and removable mounts on Linux; drive letters on Windows
- Destructive-operation safety: existing names are never overwritten (`name (2).ext`), relative paths are refused, trash goes through the OS trash

## Keyboard

- `F5` copy selection to the other pane · `F6` move · `F7` new folder
- `F8` trash · `Shift+F8` delete permanently · `F2` rename
- `F3` refresh · `Backspace` up · `Tab` switch active pane
- `Ctrl+H` hidden files · `Enter` open selection · `Ctrl`/`Shift` click to multi-select

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
src/main/index.ts     window, filesystem IPC, roots
src/main/ops.ts       copy / move / trash / delete / mkdir / rename (unit tested)
src/preload/index.ts  the only bridge into the renderer
src/renderer/src/     React UI: App (state, shortcuts), Pane (list), format.ts (pure helpers)
docs/FEATURES.md      Directory Opus feature matrix and phases
AGENTS.md             rules for AI agents working in this repo
```

## License

MIT

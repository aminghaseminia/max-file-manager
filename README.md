# Max File Manager

A dual-pane desktop file manager for KDE and Windows, aiming at Directory Opus level of features — built with Electron, TypeScript and React. The interface is Persian (RTL); paths and file names stay left-to-right.

![screenshot](docs/screenshot.png)

App-owned title bar, rounded window, settings panel — no system decorations unless you ask for them:

![chrome](docs/screenshot-chrome.png)

Folders carry their own colour and icon inside the folder itself (`.mfm.json`), and any KDE icon pack on the machine can be used:

![folders](docs/screenshot-folders.png)
![folder look](docs/screenshot-folder-look.png)

Full tab support — pinned tabs, drag to reorder, and a tab menu:

![tabs](docs/screenshot-tabs.png)

Configurable columns (permissions, owner, links, image size) with Jalali dates, the gallery editor (crop), and the columns page in preferences:

![columns](docs/screenshot-columns.png)
![crop](docs/screenshot-crop.png)
![columns prefs](docs/screenshot-pref-columns.png)

Preferences dialog, single-pane layout, and the photo gallery (arrows browse the folder):

![preferences](docs/screenshot-preferences.png)
![single pane](docs/screenshot-single-pane.png)
![gallery](docs/screenshot-gallery.png)

Right-click menu and the preview panel (text, image, audio, video):

![context menu](docs/screenshot-menu.png)
![preview](docs/screenshot-preview.png)

A real copy job in the operations bar, a zip browsed as a folder, and the floating sidebar:

![jobs](docs/screenshot-jobs.png)
![archive](docs/screenshot-archive.png)
![float sidebar](docs/screenshot-float-sidebar.png)

Grid view with real image thumbnails (light theme), flat view, and batch rename with a live preview:

![grid view](docs/screenshot-grid.png)
![flat view](docs/screenshot-flat.png)
![batch rename](docs/screenshot-rename.png)

**Status: v0.8** — phases 1–2 done, most of phase 3, phase 4 started (zip/tar browsing + extraction), phase 5 started (context menu, drag and drop, preview, gallery) and the preferences shell landed. The settings roadmap is derived from the Directory Opus, Krusader and FreeCommander manuals: [docs/PREFERENCES.md](docs/PREFERENCES.md). Remaining gaps are listed honestly in [docs/FEATURES.md](docs/FEATURES.md).

## What works today

- **Single pane or dual pane** — dual is a setting, not a requirement; the copy/move target stays tracked and is shown in the status bar
- Two panes (source / destination) with **full tabs** in each — pinned tabs, drag to reorder, middle-click close, a tab menu (pin, duplicate, close others/right, copy path), `Ctrl+T/W/Shift+T/Ctrl+Tab/Ctrl+1…9`, position of new tabs configurable — plus per-pane back/forward history
- **Single instance**: launching again focuses the open window and opens the path you passed
- **Photo gallery**: arrows browse the folder's images, `+`/`-` zoom, `R` rotate, `Space` slideshow, `F` fullscreen, thumbnail strip
- **Simple image edits in the gallery**: rotate 90°, flip, crop by dragging a box, resize with a locked aspect ratio, save as a copy (`name-edit.png`) or overwrite
- **Configurable columns**: type, size, date (ISO or Jalali), permissions, owner, hard links, image dimensions — toggled and ordered in preferences, with a header that scrolls with the rows
- `Ctrl+L` address bar, selection size and free space in the status bar
- **Preview** in the opposite pane (`F3`) or as a side panel: text, image, audio, video
- List view (name / type / size / date, sortable, folders first) and grid view with thumbnails
- Virtualized rendering in both views: a 100k-entry folder mounts only the visible slice
- **Window chrome**: app-owned title bar (drag, minimize/maximize/close, double-click) or the system title bar — your choice, plus **rounded corners** on a transparent frameless window
- **Floating or docked sidebar**, toggled from the toolbar; settings live in an in-app panel
- **Folder look that travels with the folder**: colour and icon stored in a hidden `.mfm.json` inside the folder, with icons taken from any KDE icon pack (Breeze, Papirus, Oxygen, Adwaita…) or your own SVG/PNG folder
- **Transfers go through a queue**: byte progress, speed, pause/resume, cancel, per-item error list
- File operations: copy (F5), move (F6), new folder (F7), trash (F8), permanent delete (Shift+F8), rename (F2), batch rename (F2 on a multi-selection) with a live preview
- **Undo** (Ctrl+Z) for move, rename and new folder
- **Search** in the current folder tree: name with `*`/`?` or a regular expression, optional text inside content — results arrive as a virtual listing
- **Flat view** and a **duplicate finder** (size + sha256, grouped)
- **Right-click menu** with icons and shortcut hints: run, preview, browse archive, copy/move, rename (single or batch), trash, permanent delete, copy path, SHA-256, folder size, folder look, new tab
- **Drag and drop**: drag rows onto the other pane or onto a folder (move, `Ctrl` = copy) through the same transfer queue; drop files from any other app onto a pane to copy them in
- **Preview panel**: text (up to 200 KB), image, audio and video, with size/date and an open button
- **Archives**: zip, tar, tar.gz/tgz open as a listing; F5 extracts the selection into the other pane (no external tools)
- **SHA-256** of the selection from the context menu, copied to the clipboard
- Folder size on demand (F9), bookmarks (Ctrl+D), hidden files (Ctrl+H), dark/light theme
- Status bar with icon actions, not just shortcuts
- **Preferences dialog** (appearance, file display, layout, file operations, launching, advanced) — one typed prefs object, persisted
- Session restore: panes, tabs, sort, bookmarks and every preference survive a restart
- Safety: existing names are never overwritten (`name (2).ext`), relative paths are refused, trash goes through the OS trash, a cancelled transfer removes its partial file

## Keyboard

- `F5` copy selection to the other pane · `F6` move · `F7` new folder · `F2` rename (batch when several are selected)
- `F8` trash · `Shift+F8` delete permanently · `F9` folder size · `F3` refresh · `Ctrl+Z` undo
- `Alt+←` / `Alt+→` back / forward · `Backspace` up · `Tab` switch active pane
- `Ctrl+A` select all · `Esc` clear selection and filter · `Ctrl+F` focus the filter
- `Ctrl+Shift+F` flat view · `Ctrl+H` hidden files · `Ctrl+D` bookmark this folder · `Enter` open selection / open archive

## Run it

```sh
npm install
npm run dev        # dev window, hot reload
npm test           # 42 unit tests: transfers, undo, search, archives, previews, hashes, folder meta, icon packs, pure helpers
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

Directory listing, stat, transfers, hashing and archive reading are native `fs`/`crypto` work in the main process — the renderer only paints. What web tech buys here: a UI that can be rebuilt cheaply as the feature set grows (dual panes, tabs, virtual lists, toolbars, dialogs) and one codebase for KDE and Windows. What it costs: a ~150 MB baseline of memory versus a native toolkit, and OS integration (context menus, thumbnails, tray) has to be written by hand instead of coming from the desktop environment.

## Layout

```
src/main/index.ts     window + chrome, filesystem IPC, folder sizes, session state, mfm:// protocol
src/main/jobs.ts      transfer queue: progress, pause, cancel, undo, batch rename, mkdir
src/main/search.ts    recursive walk, name matcher, content search, duplicate finder
src/main/archives.ts  zip/tar reading and extraction (fflate + built-in tar parser)
src/main/meta.ts      per-folder colour/icon in the folder's own .mfm.json
src/main/icons.ts     discovers KDE/system icon packs and lists their icons
src/main/ops.ts       remove (trash / permanent) + name-collision helper
src/main/preview.ts   text/image/audio/video preview with size caps
src/main/hash.ts      streaming sha256 (checksums and the duplicate finder)
src/preload/index.ts  the only bridge into the renderer
src/renderer/src/     React UI: App, Pane, Sidebar, TitleBar, Preferences, FolderDialog,
                      ContextMenu, PreviewPanel, Gallery, JobsBar, RenameDialog, Icons,
                      format.ts, prefs.ts
docs/FEATURES.md      Directory Opus feature matrix and phases
docs/PREFERENCES.md   settings roadmap derived from Opus / Krusader / FreeCommander
AGENTS.md             rules for AI agents working in this repo
```

## License

MIT

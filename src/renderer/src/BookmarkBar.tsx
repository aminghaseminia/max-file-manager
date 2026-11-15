import { useState } from 'react'
import { t } from './i18n.ts'
import { baseName } from './format.ts'
import { dragOutPaths, lastDragPaths, pathsOf, releaseDragOut } from './drag.ts'
import { EntryIcon, StarIcon } from './Icons.tsx'

/**
 * The bookmark bar: the same bookmarks the sidebar lists, as one strip of buttons under the command
 * bar, for people who work with the sidebar closed. It never owns state — `marks`/`markNames` come
 * from the app (and are shared with the XDG file dialog), so a change made here applies everywhere.
 */
type Props = {
  marks: string[]
  /** custom bookmark titles (path → title); empty means «use the folder name» */
  markNames: Record<string, string>
  /** the active pane's folder, highlighted like a current tab */
  activePath: string
  /** folder look (colour/icon) per bookmark, resolved by the app */
  icons: Record<string, { color?: string; icon?: string }>
  /** the active icon set (Pure pack or the desktop theme), as `EntryIcon` wants it */
  iconSet: Record<string, string>
  onNav(path: string): void
  /** right-click: the app's bookmark menu (open, rename, remove) */
  onMenu(path: string, x: number, y: number): void
  /** the star: bookmark the active folder, or take it back off */
  onToggleHere(): void
  hereBookmarked: boolean
  /** folders dropped on the bar become bookmarks */
  onDropFolders(paths: string[]): void
}

export function BookmarkBar({
  marks,
  markNames,
  activePath,
  icons,
  iconSet,
  onNav,
  onMenu,
  onToggleHere,
  hereBookmarked,
  onDropFolders
}: Props) {
  const [over, setOver] = useState(false)

  /** Same rule as the sidebar: our own rows, a native file list, or an external file manager. */
  const accepts = (dt: DataTransfer): boolean => {
    const types = dt.types
    if (types.includes('application/x-mfm-bookmark')) return false
    return (
      types.includes('application/x-mfm') ||
      types.includes('application/x-mfm-mark') ||
      types.includes('Files') ||
      types.includes('text/uri-list') ||
      types.includes('text/plain') ||
      lastDragPaths().length > 0 ||
      dragOutPaths().length > 0
    )
  }

  return (
    <div
      className={'bmbar' + (over ? ' drop' : '')}
      onDragEnter={(ev) => {
        if (!accepts(ev.dataTransfer)) return
        ev.preventDefault()
        setOver(true)
      }}
      onDragOver={(ev) => {
        if (!accepts(ev.dataTransfer)) return
        ev.preventDefault()
        ev.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={(ev) => {
        // measured against the real box: relatedTarget is null when crossing our own children
        const box = ev.currentTarget.getBoundingClientRect()
        if (ev.clientX < box.left || ev.clientX > box.right || ev.clientY < box.top || ev.clientY > box.bottom) {
          setOver(false)
        }
      }}
      onDrop={(ev) => {
        setOver(false)
        if (!accepts(ev.dataTransfer)) return
        ev.preventDefault()
        ev.stopPropagation()
        const paths = pathsOf(ev.dataTransfer)
        releaseDragOut()
        if (paths.length) onDropFolders(paths)
      }}
    >
      <button
        type="button"
        className={'bmb star' + (hereBookmarked ? ' on' : '')}
        title={hereBookmarked ? t('برداشتن نشان پوشهٔ جاری') : t('نشان‌کردن پوشهٔ جاری')}
        aria-label={hereBookmarked ? t('برداشتن نشان پوشهٔ جاری') : t('نشان‌کردن پوشهٔ جاری')}
        onClick={onToggleHere}
      >
        <StarIcon filled={hereBookmarked} size={13} />
      </button>

      {marks.length === 0 ? (
        <span className="bm-empty">{t('پوشه‌ای را نشان کن یا روی این نوار رها کن')}</span>
      ) : (
        marks.map((m) => {
          const active = activePath === m || activePath.startsWith(m.endsWith('/') ? m : m + '/')
          return (
            <button
              key={m}
              type="button"
              className={'bmb' + (active ? ' on' : '')}
              dir="auto"
              title={markNames[m] ? `${markNames[m]} — ${m}` : m}
              onClick={() => onNav(m)}
              onContextMenu={(ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                onMenu(m, ev.clientX, ev.clientY)
              }}
            >
              <EntryIcon
                size={13}
                iconSet={iconSet}
                entry={{
                  name: baseName(m),
                  path: m,
                  dir: true,
                  size: 0,
                  mtime: 0,
                  ext: '',
                  color: icons[m]?.color,
                  icon: icons[m]?.icon
                }}
              />
              <span className="bmb-label">{markNames[m] || baseName(m)}</span>
            </button>
          )
        })
      )}
    </div>
  )
}

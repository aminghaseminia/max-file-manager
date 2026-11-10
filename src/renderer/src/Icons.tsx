import type { ReactElement, ReactNode } from 'react'
import type { Entry } from './api'
import { kindOf, type Kind } from './format'

/** One stroke style for every icon: flat, 1.7px, inherits the text colour. */
const S = ({ children, size = 15 }: { children: ReactNode; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const FolderIcon = () => (
  <S>
    <path d="M3 8a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.5 8H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </S>
)
export const FolderPlusIcon = () => (
  <S>
    <path d="M3 8a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.5 8H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 12v5M9.5 14.5h5" />
  </S>
)
const FileBase = () => (
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </>
)
export const FileIcon = () => (
  <S>
    <FileBase />
  </S>
)
export const ImageIcon = () => (
  <S>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 18l5-5 3.5 3.5L16 13l4 4" />
  </S>
)
export const VideoIcon = () => (
  <S>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M10.5 9.5l4.5 2.5-4.5 2.5z" />
  </S>
)
export const AudioIcon = () => (
  <S>
    <path d="M9 16.5V6l9-2v10.5" />
    <circle cx="6.5" cy="17.5" r="2.5" />
    <circle cx="15.5" cy="15.5" r="2.5" />
  </S>
)
export const ArchiveIcon = () => (
  <S>
    <FileBase />
    <path d="M12 8v2M12 12v2M12 16v1" />
  </S>
)
export const CodeIcon = () => (
  <S>
    <FileBase />
    <path d="M10.5 12.5l-2 2 2 2M13.5 12.5l2 2-2 2" />
  </S>
)
export const DocIcon = () => (
  <S>
    <FileBase />
    <path d="M9 12.5h6M9 16h4" />
  </S>
)
export const PdfIcon = () => (
  <S>
    <FileBase />
    <path d="M9.5 12.5h5v4h-5z" />
  </S>
)
export const SheetIcon = () => (
  <S>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M10 10v10M15 10v10" />
  </S>
)
export const SlidesIcon = () => (
  <S>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M12 17v3M8.5 20h7" />
  </S>
)

const GLYPHS: Record<Kind, (p: { size?: number }) => ReactElement> = {
  dir: FolderIcon,
  image: ImageIcon,
  video: VideoIcon,
  audio: AudioIcon,
  archive: ArchiveIcon,
  code: CodeIcon,
  text: DocIcon,
  doc: DocIcon,
  pdf: PdfIcon,
  sheet: SheetIcon,
  slides: SlidesIcon,
  file: FileIcon
}

/** Type icon + colour class; one call site per list row and grid tile. */
export function TypeIcon({
  entry,
  size = 15,
  color
}: {
  entry: Entry
  size?: number
  color?: string
}) {
  const kind = kindOf(entry)
  const Glyph = GLYPHS[kind]
  return (
    <span className={'ic ' + kind} style={color ? { color } : undefined}>
      <Glyph size={size} />
    </span>
  )
}

export const ArrowUpIcon = () => (
  <S>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </S>
)
export const ChevronLeftIcon = ({ size = 15 }: { size?: number }) => (
  <S size={size}>
    <path d="M14.5 6l-6 6 6 6" />
  </S>
)
export const ChevronRightIcon = ({ size = 15 }: { size?: number }) => (
  <S size={size}>
    <path d="M9.5 6l6 6-6 6" />
  </S>
)
export const ChevronDownIcon = ({ size = 15 }: { size?: number }) => (
  <S size={size}>
    <path d="M6 9.5l6 6 6-6" />
  </S>
)
export const RefreshIcon = () => (
  <S>
    <path d="M20 12a8 8 0 1 1-2.4-5.7" />
    <path d="M20 4.5V9h-4.5" />
  </S>
)
export const PlusIcon = ({ size = 15 }: { size?: number }) => (
  <S size={size}>
    <path d="M12 5v14M5 12h14" />
  </S>
)
export const XIcon = ({ size = 13 }: { size?: number }) => (
  <S size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </S>
)
export const SearchIcon = () => (
  <S>
    <circle cx="11" cy="11" r="6" />
    <path d="M15.5 15.5L20 20" />
  </S>
)
export const EyeIcon = () => (
  <S>
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
    <circle cx="12" cy="12" r="2.5" />
  </S>
)
export const EyeOffIcon = () => (
  <S>
    <path d="M4 5l16 14" />
    <path d="M9.5 6.4A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.6 3.3" />
    <path d="M6.6 8.2A16.6 16.6 0 0 0 2.5 12s3.5 6 9.5 6a9.6 9.6 0 0 0 3.4-.6" />
  </S>
)
export const SunIcon = () => (
  <S>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
  </S>
)
export const MoonIcon = () => (
  <S>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </S>
)
export const ListIcon = () => (
  <S>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </S>
)
export const GridIcon = () => (
  <S>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </S>
)
export const StarIcon = ({ filled = false, size = 15 }: { filled?: boolean; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3.6l2.6 5.3 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z" />
  </svg>
)
export const TrashIcon = () => (
  <S>
    <path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 13h9l1-13" />
  </S>
)
export const CopyIcon = () => (
  <S>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9" />
  </S>
)
export const MoveIcon = () => (
  <S>
    <path d="M12 3v9M8.8 9l3.2 3.2L15.2 9" />
    <path d="M3.5 15.5v2a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2" />
  </S>
)
export const RenameIcon = () => (
  <S>
    <path d="M4 20h4L20 8l-4-4L4 16z" />
  </S>
)
export const GaugeIcon = () => (
  <S>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="M12 14l4.5-4" />
    <circle cx="12" cy="18" r="1.2" />
  </S>
)
export const HomeIcon = () => (
  <S>
    <path d="M4 11l8-7 8 7v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
  </S>
)
export const DriveIcon = () => (
  <S>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 12h.01M17 12h.01" />
  </S>
)
export const PauseIcon = () => (
  <S>
    <path d="M9 5v14M15 5v14" />
  </S>
)
export const PlayIcon = () => (
  <S>
    <path d="M7 4.5l12 7.5-12 7.5z" />
  </S>
)
export const LayersIcon = () => (
  <S>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </S>
)
export const DupeIcon = () => (
  <S>
    <rect x="3.5" y="3.5" width="12" height="12" rx="2" />
    <path d="M8.5 20.5h10a2 2 0 0 0 2-2v-10" />
  </S>
)
export const UndoIcon = () => (
  <S>
    <path d="M4 10a8 8 0 1 1 2.4 8.6" />
    <path d="M4 4.5V10h5.5" />
  </S>
)

export const MenuIcon = () => (
  <S>
    <path d="M4 6.5h16M4 12h16M4 17.5h10" />
  </S>
)
export const SettingsIcon = () => (
  <S>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 4v2M12 18v2M4.5 7.5l1.7 1.7M17.8 14.8l1.7 1.7M4.5 16.5l1.7-1.7M17.8 9.2l1.7-1.7" />
  </S>
)
export const MinusIcon = () => (
  <S size={13}>
    <path d="M5 12h14" />
  </S>
)
export const MaximizeIcon = () => (
  <S size={13}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </S>
)
export const RestoreIcon = () => (
  <S size={13}>
    <rect x="4" y="8" width="12" height="12" rx="2" />
    <path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
  </S>
)
export const ArchiveOpenIcon = () => (
  <S>
    <path d="M3 8a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.5 8H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11v2M12 15v1" />
  </S>
)
export const PaletteIcon = () => (
  <S>
    <path d="M12 3a9 9 0 1 0 0 18c1.7 0 2.5-1 2.5-2 0-1.6-1.5-1.7-1.5-3 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-3.6-4-6.4-9-6.4z" />
    <path d="M7.5 9.5h.01M11 7h.01M15 8h.01" />
  </S>
)

const BUILTIN: Record<string, (p: { size?: number }) => ReactElement> = {
  folder: FolderIcon,
  star: () => <StarIcon filled />,
  home: HomeIcon,
  archive: ArchiveIcon,
  image: ImageIcon
}

/** A folder's own look: built-in glyph, a themed svg/png from disk, or the plain type icon. */
export function FolderGlyph({ entry, size = 15 }: { entry: Entry; size?: number }) {
  if (entry.icon?.startsWith('g:')) {
    const Glyph = BUILTIN[entry.icon.slice(2)]
    if (Glyph) {
      return (
        <span className="ic dir" style={entry.color ? { color: entry.color } : undefined}>
          <Glyph size={size} />
        </span>
      )
    }
  }
  return <TypeIcon entry={entry} size={size} color={entry.color} />
}
export const PreviewIcon = () => (
  <S>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M14.5 4v16" />
  </S>
)
export const RotateIcon = () => (
  <S>
    <path d="M20 12a8 8 0 1 1-2.4-5.7" />
    <path d="M20 4v4.5h-4.5" />
    <path d="M12 8.5v4l3 2" />
  </S>
)
export const SplitIcon = () => (
  <S>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
  </S>
)
export const ConfirmIcon = () => (
  <S>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4.5M12 16h.01" />
  </S>
)

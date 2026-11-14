/**
 * The Pure icon set, embedded in the bundle: the app's default look must not depend on whatever
 * icon theme the OS happens to have (it was missing entirely on macOS). SVGs are inlined as data
 * URLs via Vite's `?raw`, so nothing is read from disk and `img-src 'self' data:` already allows them.
 *
 * The SVGs are from the Pure icon theme (GPL-3.0, see assets/pure/NOTICE.md); the rest of the app
 * stays MIT.
 */
import folder from './assets/pure/folder.svg?raw'
import folderRed from './assets/pure/folder-red.svg?raw'
import folderOrange from './assets/pure/folder-orange.svg?raw'
import folderYellow from './assets/pure/folder-yellow.svg?raw'
import folderGreen from './assets/pure/folder-green.svg?raw'
import folderBlue from './assets/pure/folder-blue.svg?raw'
import folderPurple from './assets/pure/folder-purple.svg?raw'
import folderPink from './assets/pure/folder-pink.svg?raw'
import folderGrey from './assets/pure/folder-grey.svg?raw'
import folderTeal from './assets/pure/folder-teal.svg?raw'
import folderBlack from './assets/pure/folder-black.svg?raw'
import image from './assets/pure/image-x-generic.svg?raw'
import video from './assets/pure/video-x-generic.svg?raw'
import audio from './assets/pure/audio-x-generic.svg?raw'
import archive from './assets/pure/package-x-generic.svg?raw'
import text from './assets/pure/text-x-generic.svg?raw'
import code from './assets/pure/text-x-script.svg?raw'
import doc from './assets/pure/x-office-document.svg?raw'
import pdf from './assets/pure/application-pdf.svg?raw'
import sheet from './assets/pure/x-office-spreadsheet.svg?raw'
import slides from './assets/pure/x-office-presentation.svg?raw'
import unknown from './assets/pure/unknown.svg?raw'

const inline = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/** kind → icon, the same keys `kindOf()` returns. */
export const PURE_ICONS: Record<string, string> = {
  dir: inline(folder),
  image: inline(image),
  video: inline(video),
  audio: inline(audio),
  archive: inline(archive),
  text: inline(text),
  code: inline(code),
  doc: inline(doc),
  pdf: inline(pdf),
  sheet: inline(sheet),
  slides: inline(slides),
  file: inline(unknown)
}

/**
 * The colour palette from `meta.ts`, mapped onto Pure's coloured folder variants. The key is
 * `dir:<hex>` so `EntryIcon` can look a coloured folder up without knowing about Pure.
 */
export const PURE_FOLDER_COLORS: Record<string, string> = {
  'dir:#e0564d': inline(folderRed),
  'dir:#e08b39': inline(folderOrange),
  'dir:#d8b93f': inline(folderYellow),
  'dir:#4fb56a': inline(folderGreen),
  'dir:#4f8ff0': inline(folderBlue),
  'dir:#9a6ee0': inline(folderPurple),
  'dir:#dd6b9c': inline(folderPink),
  'dir:#8a93a3': inline(folderGrey),
  'dir:#2aa9a0': inline(folderTeal),
  'dir:#2f353d': inline(folderBlack)
}

/** Everything the default icon source needs: kinds plus coloured folders. */
export const PURE_ICON_SET: Record<string, string> = { ...PURE_ICONS, ...PURE_FOLDER_COLORS }

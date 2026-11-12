/**
 * Content copy that works in every paste target: the Async Clipboard API accepts PNG, so the
 * image is decoded from the file (or the gallery's edited data URL) and re-encoded once.
 */
import { api } from './api'

const blobFromDataUrl = (dataUrl: string): Blob => {
  const comma = dataUrl.indexOf(',')
  const mime = /^data:([^;]+)/.exec(dataUrl)?.[1] ?? 'image/png'
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes.buffer as ArrayBuffer], { type: mime })
}

/** Copies the picture itself (not its path) so it can be pasted into a chat or document. */
export async function copyImageContent(path: string, editedDataUrl?: string): Promise<void> {
  const source = editedDataUrl ?? (await api.imageData(path)).dataUrl
  if (!source) throw new Error('read')
  const bmp = await createImageBitmap(blobFromDataUrl(source))
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(bmp, 0, 0)
  const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  bmp.close()
  if (!png) throw new Error('encode')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

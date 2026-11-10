import { useEffect, useState } from 'react'
import { api, type Entry, type Preview } from './api'
import { fa, fmtDate, fmtSize, mediaUrl } from './format'
import { ChevronLeftIcon, ChevronRightIcon, FileIcon, GridIcon, XIcon } from './Icons'

type Props = {
  entry: Entry | null
  /** fill a whole pane instead of the narrow side strip */
  fill?: boolean
  /** position inside the folder's image list, when the entry is an image */
  imageIndex?: { at: number; total: number } | null
  onNavImage?(delta: number): void
  onGallery?(): void
  onOpen(path: string): void
  onClose(): void
}

const MAX_INLINE_IMAGE = 8_000_000

export function PreviewPanel({
  entry,
  fill,
  imageIndex,
  onNavImage,
  onGallery,
  onOpen,
  onClose
}: Props) {
  const [data, setData] = useState<Preview | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setData(null)
    setErr('')
    if (!entry || entry.dir) return
    let live = true
    void api
      .preview(entry.path)
      .then((p) => live && (p ? setData(p) : setErr('پیش‌نمایش ممکن نشد')))
      .catch((e) => live && setErr(String(e?.message ?? e)))
    return () => {
      live = false
    }
  }, [entry])

  return (
    <aside className={'preview' + (fill ? ' fill' : '')}>
      <div className="preview-head">
        {onNavImage && (
          <button className="tb" title="تصویر قبلی (←)" onClick={() => onNavImage(-1)}>
            <ChevronRightIcon />
          </button>
        )}
        <span className="preview-title" dir="auto">
          {entry ? entry.name : 'پیش‌نمایش'}
        </span>
        {imageIndex && (
          <span className="pill">
            {fa(imageIndex.at)} از {fa(imageIndex.total)}
          </span>
        )}
        <span className="spacer" />
        {onGallery && imageIndex && (
          <button className="tb" title="گالری (Space)" onClick={onGallery}>
            <GridIcon />
          </button>
        )}
        {onNavImage && (
          <button className="tb" title="تصویر بعدی (→)" onClick={() => onNavImage(1)}>
            <ChevronLeftIcon />
          </button>
        )}
        <button className="tb" title="بستن پیش‌نمایش (F3)" onClick={onClose}>
          <XIcon size={12} />
        </button>
      </div>

      {!entry ? (
        <div className="preview-empty">یک فایل انتخاب کن</div>
      ) : entry.dir ? (
        <div className="preview-empty">پوشه — برای دیدن محتوا بازش کن</div>
      ) : (
        <>
          <div
            className={'preview-body' + (data?.kind === 'text' ? ' text' : '')}
            onDoubleClick={() => imageIndex && onGallery?.()}
          >
            {data?.kind === 'image' && entry.size < MAX_INLINE_IMAGE && (
              <img className="preview-img" src={mediaUrl(entry.path)} alt="" />
            )}
            {data?.kind === 'image' && entry.size >= MAX_INLINE_IMAGE && (
              <div className="preview-empty">تصویر بزرگ است؛ برای دیدن بازش کن</div>
            )}
            {data?.kind === 'audio' && <audio className="preview-media" controls src={mediaUrl(entry.path)} />}
            {data?.kind === 'video' && (
              <video className="preview-media" controls src={mediaUrl(entry.path)} />
            )}
            {data?.kind === 'text' && (
              <pre className="preview-text" dir="auto">
                {data.text}
              </pre>
            )}
            {data?.kind === 'binary' && (
              <div className="preview-empty">
                <FileIcon />
                پیش‌نمایش برای این نوع فایل نیست
              </div>
            )}
            {err && <div className="preview-empty">{err}</div>}
          </div>

          <div className="preview-foot">
            <div className="preview-meta" dir="auto">
              {!entry.dir && <span>{fmtSize(entry.size, false)}</span>}
              <span>{fmtDate(entry.mtime)}</span>
              {data?.capped && <span className="dim">نمایش بریده شد</span>}
            </div>
            {!entry.dir && (
              <button className="btn" onClick={() => onOpen(entry.path)}>
                باز کردن
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  )
}

import { t } from './i18n.ts'
import { useEffect, useState } from 'react'
import { api, type Entry, type Preview } from './api'
import { fa, fmtDate, fmtSize, mediaUrl } from './format'
import { ChevronLeftIcon, ChevronRightIcon, FileIcon, GridIcon, XIcon } from './Icons'
import { renderMarkdown } from './md'
import { cleanHtml, isHtmlPath } from './html'
import { highlightCode, langFor } from './highlight'

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
  /** text previews stop at this size */
  maxKB?: number
}

const MAX_INLINE_IMAGE = 8_000_000

export function PreviewPanel({
  maxKB = 200,
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
  const [htmlCode, setHtmlCode] = useState(false)
  const [tags, setTags] = useState<Record<string, string> | null>(null)
  /** Chromium's PDF viewer sizes itself once, on load; a remount after layout fixes the zoom */
  const [pdfBoot, setPdfBoot] = useState(0)

  useEffect(() => {
    setData(null)
    setErr('')
    if (!entry || entry.dir) return
    let live = true
    void api
      .preview(entry.path, maxKB)
      .then((p) => live && (p ? setData(p) : setErr(t('پیش‌نمایش ممکن نشد'))))
      .catch((e) => live && setErr(String(e?.message ?? e)))
    return () => {
      live = false
    }
  }, [entry, maxKB])

  const lines = (data?.text ?? '').split(/\r?\n/)
  const lang = entry ? langFor(entry.path) : null

  useEffect(() => {
    if (!entry || !/\.pdf$/i.test(entry.path)) return
    const boot = setTimeout(() => setPdfBoot((n) => n + 1), 450)
    return () => clearTimeout(boot)
  }, [entry])

  useEffect(() => {
    if (!entry || entry.dir) {
      setTags(null)
      return
    }
    let live = true
    void api.tags([entry.path]).then((r) => {
      if (!live) return
      const tagRow = r?.[entry.path]
      setTags(tagRow && tagRow.kind && tagRow.kind !== 'none' ? tagRow : null)
    })
    return () => {
      live = false
    }
  }, [entry])

  return (
    <aside className={'preview' + (fill ? ' fill' : '')}>
      <div className="preview-head">
        {onNavImage && (
          <button className="tb" title={t(t('تصویر قبلی (←)'))} onClick={() => onNavImage(-1)}>
            <ChevronRightIcon />
          </button>
        )}
        {entry && isHtmlPath(entry.path) && (
          <div className="seg preview-html-toggle">
            <button className={htmlCode ? '' : 'on'} onClick={() => setHtmlCode(false)}>
              نمایش
            </button>
            <button className={htmlCode ? 'on' : ''} onClick={() => setHtmlCode(true)}>
              کد
            </button>
          </div>
        )}
        <span className="preview-title" dir="auto">
          {entry ? entry.name : t('پیش‌نمایش')}
        </span>
        {imageIndex && (
          <span className="pill">
            {t('{a} از {b}', { a: fa(imageIndex.at), b: fa(imageIndex.total) })}
          </span>
        )}
        <span className="spacer" />
        {onGallery && imageIndex && (
          <button className="tb" title={t(t('گالری (Space)'))} onClick={onGallery}>
            <GridIcon />
          </button>
        )}
        {onNavImage && (
          <button className="tb" title={t(t('تصویر بعدی (→)'))} onClick={() => onNavImage(1)}>
            <ChevronLeftIcon />
          </button>
        )}
        <button className="tb" title={t(t('بستن پیش‌نمایش (F3)'))} onClick={onClose}>
          <XIcon size={12} />
        </button>
      </div>

      {!entry ? (
        <div className="preview-empty">{t(t('یک فایل انتخاب کن'))}</div>
      ) : entry.dir ? (
        <div className="preview-empty">{t(t('پوشه — برای دیدن محتوا بازش کن'))}</div>
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
              <div className="preview-empty">{t(t('تصویر بزرگ است؛ برای دیدن بازش کن'))}</div>
            )}
            {data?.kind === 'pdf' && (
              <iframe
                className="preview-pdf"
                // the viewer honours these fragment hints; without zoom the page renders tiny
                key={pdfBoot}
                src={`${mediaUrl(entry.path)}#zoom=page-width&view=FitH&t=${pdfBoot}`}
                title={entry.name}
              />
            )}
            {data?.kind === 'office' && (
              <div className="preview-text" dir="auto">
                {(data.text ?? '').split('\n').slice(0, 4000).map((ln, n) => (
                  <div className="pline" key={n}>
                    <span className="pln">{n + 1}</span>
                    <span
                      className="ptext"
                      dangerouslySetInnerHTML={{ __html: ln ? highlightCode(ln, 'xml') : ' ' }}
                    />
                  </div>
                ))}
              </div>
            )}
            {data?.kind === 'audio' && <audio className="preview-media" controls src={mediaUrl(entry.path)} />}
            {data?.kind === 'video' && (
              <video className="preview-media" controls src={mediaUrl(entry.path)} />
            )}
            {data?.kind === 'text' && isHtmlPath(entry.path) && !htmlCode && (
              <iframe
                className="preview-html"
                sandbox=""
                referrerPolicy="no-referrer"
                title={entry.name}
                srcDoc={cleanHtml(data.text ?? '')}
              />
            )}
            {data?.kind === 'text' && isHtmlPath(entry.path) && htmlCode && (
              <div className="preview-text" dir="ltr">
                {(data.text ?? '').split('\n').slice(0, 4000).map((ln, n) => (
                  <div className="pline" key={n}>
                    <span className="pln">{n + 1}</span>
                    <span
                      className="ptext"
                      dangerouslySetInnerHTML={{ __html: ln ? highlightCode(ln, 'xml') : ' ' }}
                    />
                  </div>
                ))}
              </div>
            )}
            {data?.kind === 'text' && /\.(md|markdown|mdx)$/i.test(entry.path) && (
              <div
                className="preview-body md-body"
                dir="auto"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(data.text ?? '') }}
              />
            )}
            {data?.kind === 'text' && !/\.(md|markdown|mdx)$/i.test(entry.path) && !isHtmlPath(entry.path) && (
              <div className="preview-text" dir="auto">
                {lines.slice(0, 4000).map((ln, n) => (
                  <div className="pline" key={n}>
                    <span className="pln">{n + 1}</span>
                    <span
                      className="ptext"
                      // highlight.js escapes first, so the markup is safe to inject
                      dangerouslySetInnerHTML={{ __html: ln ? highlightCode(ln, lang) : ' ' }}
                    />
                  </div>
                ))}
                {lines.length > 4000 && (
                  <div className="pln-more">… {lines.length - 4000} خط دیگر نمایش داده نشد</div>
                )}
              </div>
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
              {tags && tags.title && <span className="tag-pill">🎵 {tags.title}</span>}
              {tags && tags.artist && <span className="tag-pill">{tags.artist}</span>}
              {tags && tags.album && <span className="tag-pill">{tags.album}</span>}
              {tags && tags.camera && <span className="tag-pill">📷 {tags.camera}</span>}
              {tags && tags.date && <span className="tag-pill">{tags.date.slice(0, 10)}</span>}
              {tags && tags.iso && <span className="tag-pill">ISO {tags.iso}</span>}
              {data?.capped && <span className="dim">{t(t('نمایش بریده شد'))}</span>}
            </div>
            {!entry.dir && (
              <button className="btn" onClick={() => onOpen(entry.path)}>
                {t('باز کردن')}
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  )
}

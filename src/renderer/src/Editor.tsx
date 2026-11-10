import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { baseName } from './format'
import { highlightCode, langFor } from './highlight'
import { renderMarkdown } from './md'
import { dirOfText } from './direction'
import { ConfirmIcon, XIcon } from './Icons'
import { createVisualEditor, type VisualEditor } from './visual'

type Props = {
  path: string
  theme: 'dark' | 'light'
  /** sit in the preview slot instead of covering the window */
  docked?: boolean
  onToggleMax?(): void
  onClose(): void
  onNote(msg: string): void
  /** the file changed on disk, so the pane behind the editor reloads */
  onSaved(): void
}

const MD = /\.(md|markdown|mdx)$/i

export function Editor({ path, theme, docked = false, onToggleMax, onClose, onNote, onSaved }: Props) {
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [split, setSplit] = useState(true)
  const [fontSize, setFontSize] = useState(12.5)
  /** markdown opens in the visual (WYSIWYG) surface; source stays one click away */
  const [mode, setMode] = useState<'visual' | 'source'>('visual')
  const [visualReady, setVisualReady] = useState(false)
  const visualRoot = useRef<HTMLDivElement>(null)
  const visual = useRef<VisualEditor | null>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const hl = useRef<HTMLPreElement>(null)
  const gutter = useRef<HTMLDivElement>(null)

  const isMd = MD.test(path)
  const lang = useMemo(() => langFor(path), [path])

  useEffect(() => {
    let live = true
    void api.readText(path).then((r) => {
      if (!live) return
      if ('error' in r) {
        setErr(r.error)
        setText('')
        return
      }
      setText(r.text)
      setSaved(r.text)
    })
    return () => {
      live = false
    }
  }, [path])

  const dirty = text !== null && text !== saved
  const rich = isMd && mode === 'visual'

  useEffect(() => {
    if (!rich || text === null) return
    const el = visualRoot.current
    if (!el) return
    let dead = false
    void createVisualEditor(el, text, (md) => {
      if (!dead) setText(md)
    }).then((v) => {
      if (dead) {
        v.destroy()
        return
      }
      visual.current = v
      setVisualReady(true)
      v.focus()
    }).catch((e) => {
      console.error('visual editor failed', e)
      onNote('ویرایشگر بصری باز نشد؛ از حالت «متن» استفاده کن')
      setMode('source')
    })
    return () => {
      dead = true
      setVisualReady(false)
      visual.current = null
      const node = el.querySelector('.milkdown')
      node?.remove()
    }
    // mount once per file and per mode: `text === null` flips when the file loads, and typing
    // later must not re-create the editor (that would reset the caret)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rich, path, text === null])

  const save = async () => {
    if (text === null || busy) return
    setBusy(true)
    const r = await api.writeText(path, text)
    setBusy(false)
    if ('error' in r) {
      onNote(`ذخیره نشد — ${r.error}`)
      return
    }
    setSaved(text)
    onNote(`${baseName(path)} ذخیره شد`)
    onSaved()
  }

  const toPdf = async () => {
    if (text === null || busy) return
    setBusy(true)
    onNote('در حال ساخت PDF…')
    const body = isMd
      ? renderMarkdown(text)
      : `<pre dir="ltr">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`
    const out = path.replace(/\.[^./\\]+$/, '') + '.pdf'
    const r = await api.htmlToPdf(body, out, theme)
    setBusy(false)
    onNote('error' in r ? `PDF ساخته نشد — ${r.error}` : `PDF ساخته شد: ${baseName(r.path)}`)
    if (!('error' in r)) onSaved()
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        onClose()
        return
      }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 's' || ev.key === 'S')) {
        ev.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // the highlighted layer sits under the transparent textarea; they must scroll together
  const syncScroll = () => {
    const el = ta.current
    if (!el) return
    if (hl.current) {
      hl.current.scrollTop = el.scrollTop
      hl.current.scrollLeft = el.scrollLeft
    }
    if (gutter.current) gutter.current.scrollTop = el.scrollTop
  }

  const value = text ?? ''
  const lineCount = useMemo(() => value.split('\n').length, [value])
  const html = useMemo(
    () => highlightCode(value, lang) + '\n',
    [value, lang]
  )
  const rendered = useMemo(() => (isMd ? renderMarkdown(value) : ''), [isMd, value])
  const dir = isMd ? dirOfText(value) : 'ltr'

  return (
    <div className={'editor' + (docked ? ' docked' : '')}>
      <header className="ed-head">
        <span className="ed-name" dir="auto" title={path}>
          {baseName(path)}
        </span>
        {dirty && <span className="ed-dot" title="تغییرات ذخیره‌نشده" />}
        <span className="ed-lang">{lang ?? (isMd ? 'markdown' : 'text')}</span>
        {isMd && (
          <div className="seg ed-mode">
            <button className={rich ? 'on' : ''} onClick={() => setMode('visual')} title="ویرایشگر بصری">
              بصری
            </button>
            <button
              className={!rich ? 'on' : ''}
              onClick={() => setMode('source')}
              title="متن مارک‌داون"
            >
              متن
            </button>
          </div>
        )}
        <span className="spacer" />
        {!rich && (
          <button className="tb" title="شکستن خطوط" onClick={() => setWrap((w) => !w)}>
            <span className={wrap ? 'on-txt' : ''}>¶</span>
          </button>
        )}
        <button className="tb" title="کوچک‌تر" onClick={() => setFontSize((f) => Math.max(9, f - 1))}>
          <span>ا−</span>
        </button>
        <button className="tb" title="بزرگ‌تر" onClick={() => setFontSize((f) => Math.min(22, f + 1))}>
          <span>ا+</span>
        </button>
        {isMd && !rich && (
          <button
            className={'tb' + (split ? ' on' : '')}
            title="پیش‌نمایش کنار"
            onClick={() => setSplit((s) => !s)}
          >
            ◫
          </button>
        )}
        {isMd && (
          <button className="btn" title="ساخت PDF از این فایل" onClick={() => void toPdf()} disabled={busy}>
            PDF
          </button>
        )}
        <button className="btn" title="ذخیره (Ctrl+S)" onClick={() => void save()} disabled={busy || !dirty}>
          <ConfirmIcon />
          <span>ذخیره</span>
        </button>
        {onToggleMax && (
          <button
            className="tb"
            title={docked ? 'تمام صفحه' : 'برگرداندن به کنار پیش‌نمایش'}
            onClick={onToggleMax}
          >
            {docked ? '⛶' : '❐'}
          </button>
        )}
        <button className="tb" title="بستن (Esc)" onClick={onClose}>
          <XIcon size={12} />
        </button>
      </header>

      {err ? (
        <div className="ed-err">{err}</div>
      ) : (
        <div className={'ed-body' + (isMd && !rich && split ? ' split' : '')}>
          {rich ? (
            <div className="ed-visual" ref={visualRoot} data-ready={visualReady} />
          ) : (
          <div className="ed-code" style={{ fontSize }}>
            <div className="ed-gutter" ref={gutter} aria-hidden>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <div className="ed-wrap">
              <pre
                className={'ed-hl' + (wrap ? ' wrap' : '')}
                ref={hl}
                dir={dir}
                aria-hidden
                dangerouslySetInnerHTML={{ __html: html }}
              />
              <textarea
                className={'ed-ta' + (wrap ? ' wrap' : '')}
                ref={ta}
                dir={dir}
                value={value}
                spellCheck={false}
                onChange={(e) => setText(e.target.value)}
                onScroll={syncScroll}
                autoFocus
              />
            </div>
          </div>
          )}
          {isMd && !rich && split && (
            <div className="ed-md md-body" dir="auto" dangerouslySetInnerHTML={{ __html: rendered }} />
          )}
        </div>
      )}

      <footer className="ed-foot">
        <span>{lineCount} خط</span>
        <span>{value.length} کاراکتر</span>
        <span className="spacer" />
        <span>{dirty ? 'ذخیره‌نشده' : 'ذخیره‌شده'}</span>
        <span className="dim">Ctrl+S ذخیره · Esc بستن</span>
      </footer>
    </div>
  )
}

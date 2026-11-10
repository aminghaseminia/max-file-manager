import { useEffect, useState } from 'react'
import { api } from './api'
import { FolderIcon, MaximizeIcon, MinusIcon, RestoreIcon, XIcon } from './Icons'

type Props = { note: string }

/** App-owned title bar: drag by the empty area, double-click to maximize, real window buttons. */
export function TitleBar({ note }: Props) {
  const [max, setMax] = useState(false)

  useEffect(() => {
    void api.window.isMaximized().then(setMax)
    return api.window.onMaximized(setMax)
  }, [])

  return (
    <div className="titlebar" onDoubleClick={() => void api.window.maximize()}>
      <span className="tb-brand">
        <span className="logo">
          <FolderIcon />
        </span>
        مدیر فایل مکس
      </span>
      <span className="spacer" />
      <span className="tb-note">{note}</span>
      <div className="winbtns" onDoubleClick={(e) => e.stopPropagation()}>
        <button className="winbtn" title="کوچک" onClick={() => void api.window.minimize()}>
          <MinusIcon />
        </button>
        <button
          className="winbtn"
          title={max ? 'بازگردانی' : 'بزرگ'}
          onClick={() => void api.window.maximize()}
        >
          {max ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button className="winbtn close" title="بستن" onClick={() => void api.window.close()}>
          <XIcon size={12} />
        </button>
      </div>
    </div>
  )
}

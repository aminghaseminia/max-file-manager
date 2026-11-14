import { t } from './i18n.ts'
import { useEffect, useState } from 'react'
import { api } from './api'
import { MaximizeIcon, MinusIcon, RestoreIcon, XIcon } from './Icons'
import type { Prefs } from './prefs'

type Props = {
  /** caption-button look; the class names live in style.css */
  theme: Prefs['titlebarButtons']
  /** physical side; on the left the close button sits at the outer edge (mac), on the right it mirrors */
  side: 'left' | 'right'
  style?: React.CSSProperties
}

/** Window buttons live in the title-bar row; the row itself is the drag region. */
export function WindowButtons({ theme, side, style }: Props) {
  const [max, setMax] = useState(false)

  useEffect(() => {
    void api.window.isMaximized().then(setMax)
    return api.window.onMaximized(setMax)
  }, [])

  return (
    <div className={'winbtns winbtns-' + theme + ' side-' + side} style={style}>
      <button className="winbtn min" title={t(t('کوچک'))} onClick={() => void api.window.minimize()}>
        <MinusIcon />
      </button>
      <button
        className="winbtn max"
        title={max ? t('بازگردانی') : t('بزرگ')}
        onClick={() => void api.window.maximize()}
      >
        {max ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button className="winbtn close" title={t(t('بستن'))} onClick={() => void api.window.close()}>
        <XIcon size={12} />
      </button>
    </div>
  )
}

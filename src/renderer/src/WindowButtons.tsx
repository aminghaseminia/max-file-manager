import { t } from './i18n.ts'
import { useEffect, useState } from 'react'
import { api } from './api'
import { MaximizeIcon, MinusIcon, RestoreIcon, XIcon } from './Icons'

/** Window buttons live in the toolbar row now; the toolbar itself is the drag region. */
export function WindowButtons() {
  const [max, setMax] = useState(false)

  useEffect(() => {
    void api.window.isMaximized().then(setMax)
    return api.window.onMaximized(setMax)
  }, [])

  return (
    <div className="winbtns">
      <button className="winbtn" title={t(t('کوچک'))} onClick={() => void api.window.minimize()}>
        <MinusIcon />
      </button>
      <button
        className="winbtn"
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

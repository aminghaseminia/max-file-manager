import type { ReactNode } from 'react'

/**
 * The dialogs' shared header: a soft icon tile, a title and one optional path/subtitle line.
 * It is the same shape the cloud sheet uses, so every modal reads as one family.
 */
export function SheetHead({
  icon,
  title,
  sub,
  subTitle
}: {
  icon?: ReactNode
  title: ReactNode
  sub?: ReactNode
  subTitle?: string
}) {
  return (
    <header className="sheet-head">
      {icon ? <span className="sheet-logo">{icon}</span> : null}
      <div className="sheet-titles">
        <h2>{title}</h2>
        {sub ? (
          <p dir="auto" title={subTitle}>
            {sub}
          </p>
        ) : null}
      </div>
    </header>
  )
}

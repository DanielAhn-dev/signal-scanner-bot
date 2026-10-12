import React from "react"

export default function SheetSectionHeader({
  label,
  value,
  colSpan = 6,
  onClick,
}: {
  label: string
  value?: React.ReactNode
  colSpan?: number
  onClick?: () => void
}) {
  const clickable = typeof onClick === "function"
  return (
    <tr className={`xls-row xls-row--even${clickable ? " sector-sheet__section-row--clickable" : ""}`} onClick={onClick}>
      <td className="xls-cell" colSpan={colSpan}>
        <div className="sector-sheet__section-row-inner">
          <span className="sector-sheet__section-label-inline">{label}</span>
          {value ? <div className="sector-sheet__section-action">{value}</div> : null}
        </div>
      </td>
    </tr>
  )
}

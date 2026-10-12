import type { CSSProperties } from 'react'
import { DROP_DAY_META } from '../../data/dropDayFacts'
import { dropDayFactsStale, dropDayLines, rallyLines, type DropDayView } from '../../lib/dropDay'

const todayKst = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)

const cellText: CSSProperties = { fontSize: 10, whiteSpace: 'normal', lineHeight: 1.5, wordBreak: 'keep-all' }
const labelCell: CSSProperties = { ...cellText, borderRight: '2px solid var(--color-gray-400)', color: 'var(--color-text-secondary)' }
const linkStyle: CSSProperties = { color: 'var(--color-brand)', cursor: 'pointer', fontSize: 10, background: 'none', border: 0, padding: 0 }

/**
 * 코스피가 하루 −1.5% 이하로 빠진 날, +3% 이상 급등한 날, +1.5% 이상 오르며 52주 신고가인 날에만 나오는 안내 행.
 * 평소에는 한 줄 요약과 경계 문구만, '자세히'를 누르면 근거가 펼쳐진다.
 * 원인을 단정하지 않고 얼마나 흔한 일인지와 같이 움직인 것만 보여준다(예측 아님).
 * 컴포넌트가 아니라 대시보드 렌더 중에 바로 부르는 함수다 — 행 번호(rowNum)가 부모 렌더 순서대로 매겨져야 해서.
 */
export function renderDropDayRows({
  view,
  sp500ChangePct,
  rowNum,
  open,
  onToggle,
  onOpenPlan,
}: {
  view: DropDayView | null
  sp500ChangePct: number | null | undefined
  rowNum: () => number
  open: boolean
  onToggle: () => void
  onOpenPlan: () => void
}) {
  if (!view) return null
  const today = todayKst()
  const drop = dropDayLines(view, sp500ChangePct, today)
  const rally = drop ? null : rallyLines(view, today)
  const lines = drop ?? rally
  if (!lines) return null
  const m = DROP_DAY_META
  const label = drop ? '시장 하락 안내' : rally?.kind === 'surge' ? '시장 급등 안내' : '신고가 안내'

  const detail: Array<[string, string]> = []
  if (drop?.us) detail.push(['같이 움직인 것', drop.us])
  if (lines.foreign) detail.push(['외국인', lines.foreign])
  detail.push([drop ? '과거 같은 하락 뒤' : '과거 같은 날 뒤', lines.after])

  return (
    <>
      <tr className="xls-row">
        <td className="xls-row-num">{rowNum()}</td>
        <td className="xls-cell" colSpan={2} style={{ ...labelCell, fontWeight: 700, color: 'var(--color-text-primary)' }}>{label}</td>
        <td className="xls-cell" colSpan={4} style={cellText}>
          <strong>{lines.headline}</strong>
          {lines.sub && <span style={{ color: 'var(--color-text-secondary)' }}> · {lines.sub}</span>}
          <button type="button" style={{ ...linkStyle, marginLeft: 8 }} aria-expanded={open} onClick={onToggle}>
            {open ? '접기' : '자세히'}
          </button>
          <div style={{ marginTop: 2, color: 'var(--color-text-secondary)' }}>{lines.caution}</div>
        </td>
      </tr>
      {open && (
        <>
          {detail.map(([label, text], i) => (
            <tr key={label} className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}`}>
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={2} style={labelCell}>{label}</td>
              <td className="xls-cell" colSpan={4} style={cellText}>{text}</td>
            </tr>
          ))}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={{ ...cellText, color: 'var(--color-text-tertiary)' }}>
              원인을 단정하는 설명이 아니고, 다음 움직임을 예측하지도 않습니다. {m.sample} · 생성 {m.generated} · {m.caveat}
              {dropDayFactsStale() && <span className="acc-warn"> 자료를 만든 지 6개월이 넘었습니다. 다시 확인이 필요합니다.</span>}
              <button type="button" style={{ ...linkStyle, marginLeft: 8, fontWeight: 700 }} onClick={onOpenPlan}>내 계획 다시 보기 →</button>
            </td>
          </tr>
        </>
      )}
    </>
  )
}

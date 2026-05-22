import React, { useState } from 'react'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ToastProvider'

/*
 * 알림 테스트 페이지 — 26열 그리드 정렬
 *
 * 핵심 원칙:
 *  - colgroup 26열 = 배경 격자 26열과 1:1 대응 → 셀 경계선이 격자에 정확히 정렬
 *  - 행 높이 = 22px 배수 → 가로 격자선과 정렬
 *  - colSpan으로 넓이가 부족한 셀을 병합 처리
 *  - 레이블 : 컨텐츠 = 5열 : 21열 (≈ 19% : 81%)
 */

const LABEL_SPAN = 5   // 레이블 열 수 (배경 5번째 격자선에 정렬)
const CONTENT_SPAN = 21 // 컨텐츠 열 수
const TOTAL_COLS = LABEL_SPAN + CONTENT_SPAN // 26

const ROW_H = 22  // 기본 행 높이(px) — 배경 격자와 동일

/** N행 높이의 병합 셀을 위한 px값 */
const rowPx = (n: number) => n * ROW_H

export default function AlertsPage() {
  const [message, setMessage] = useState('테스트 알림입니다. Nexora Web에서 전송됩니다.')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const toast = useToast()

  const send = async () => {
    if (!message.trim()) return
    setSending(true)
    setResult(null)
    try {
      const uiKey = import.meta.env.VITE_UI_READ_KEY || ''
      const res = await fetch('/api/ui/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ui-key': uiKey },
        body: JSON.stringify({ message }),
      })
      const json = await res.json()
      if (res.ok && json?.ok) {
        toast.show('알림 전송 완료 ✓')
        setResult('✓ 텔레그램으로 전송되었습니다')
      } else {
        setResult(String(json?.error || '전송 실패'))
      }
    } catch (e: any) {
      setResult(String(e?.message || e))
    } finally {
      setSending(false)
    }
  }

  /* 배경 격자를 채울 빈 행 수 */
  const EMPTY_ROWS = 36

  return (
    <div className="xls-page-inset">
      <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>

        {/* 26열 colgroup — 배경 격자 26열과 1:1 정렬 */}
        <colgroup>
          {Array.from({ length: TOTAL_COLS }, (_, i) => <col key={i} />)}
        </colgroup>

        <tbody>

          {/* ── 행 1: 페이지 제목 ── */}
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={LABEL_SPAN + 15}
              style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-brand)' }}>
              알림 테스트
            </td>
            <td className="xls-cell" colSpan={6}
              style={{ textAlign: 'right', color: 'var(--color-text-tertiary)', fontSize: 11 }}>
              텔레그램 /alert
            </td>
          </tr>

          {/* ── 행 2: 설명 ── */}
          <tr className="xls-row">
            <td className="xls-cell" colSpan={TOTAL_COLS}
              style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>
              텔레그램 /alert에 대응합니다. 아래 메시지를 텔레그램으로 전송합니다.
            </td>
          </tr>

          {/* ── 행 3: 구분 행 (빈 셀) ── */}
          <tr className="xls-row xls-row--even">
            <td className="xls-cell xls-cell--empty" colSpan={TOTAL_COLS} />
          </tr>

          {/* ── 행 4~9: 알림 메시지 입력 (6행 × 22px = 132px 병합 셀) ── */}
          <tr className="xls-row">
            {/* 레이블: 6행 병합 */}
            <td
              className="xls-cell"
              colSpan={LABEL_SPAN}
              rowSpan={6}
              style={{
                height: rowPx(6),
                verticalAlign: 'middle',
                fontWeight: 600,
                fontSize: 12,
                borderBottom: '1px solid var(--color-excel-grid-border)',
              }}
            >
              알림 메시지
            </td>
            {/* 컨텐츠: 6행 병합 — textarea가 전체를 채움 */}
            <td
              className="xls-cell"
              colSpan={CONTENT_SPAN}
              rowSpan={6}
              style={{
                height: rowPx(6),
                padding: 0,
                verticalAlign: 'top',
                borderBottom: '1px solid var(--color-excel-grid-border)',
              }}
            >
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                style={{
                  display: 'block',
                  width: '100%',
                  height: rowPx(6) - 2, // 셀 높이 - 상하 border 2px
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  padding: '3px 6px',
                  fontFamily: 'var(--font-family-sans)',
                  fontSize: 'var(--font-size-xs)',
                  background: 'transparent',
                  lineHeight: `${ROW_H}px`,
                  color: 'var(--color-text-primary)',
                }}
              />
            </td>
          </tr>
          {/* 행 5~9: rowSpan에 의해 렌더링되는 빈 행들 (실제 셀 없음) */}
          {Array.from({ length: 5 }, (_, i) => (
            <tr key={`ta-${i}`} className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}`} />
          ))}

          {/* ── 행 10: 구분 ── */}
          <tr className="xls-row xls-row--even">
            <td className="xls-cell xls-cell--empty" colSpan={TOTAL_COLS} />
          </tr>

          {/* ── 행 11: 전송 ── */}
          <tr className="xls-row">
            <td className="xls-cell" colSpan={LABEL_SPAN}
              style={{ fontWeight: 600, fontSize: 12 }}>
              전송
            </td>
            <td className="xls-cell" colSpan={CONTENT_SPAN}>
              <Button
                variant="primary"
                onClick={send}
                disabled={sending || !message.trim()}
              >
                {sending ? '전송 중…' : '텔레그램으로 전송'}
              </Button>
              {result && (
                <span style={{
                  marginLeft: 10,
                  fontSize: 11,
                  color: result.startsWith('✓') ? 'var(--color-success)' : 'var(--color-error)',
                }}>
                  {result}
                </span>
              )}
            </td>
          </tr>

          {/* ── 행 12: 구분 ── */}
          <tr className="xls-row xls-row--even">
            <td className="xls-cell xls-cell--empty" colSpan={TOTAL_COLS} />
          </tr>

          {/* ── 빈 행으로 격자 채우기 ── */}
          {Array.from({ length: EMPTY_ROWS }, (_, i) => (
            <tr key={`e-${i}`} className={`xls-row${i % 2 === 0 ? '' : ' xls-row--even'}`}>
              <td className="xls-cell xls-cell--empty" colSpan={TOTAL_COLS} />
            </tr>
          ))}

        </tbody>
      </table>
    </div>
  )
}

import React, { useEffect, useRef, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import Button from '../../components/ui/Button'
import { apiFetch } from '../../lib/api'
import { formatKrwCompact } from '../../lib/format'

type AccountOption = { key: string; label: string; total: number; holdingCount: number }

/**
 * 실계좌 리밸런싱 가이드 — 계좌를 고르고 만들기. 서버 handlers/ui/rebalance-report.ts가 HTML 리포트를 만든다.
 * 계좌 목록의 금액은 매수가 기준 규모(고르는 용도)이고, 리포트 안 금액은 현재가 기준이다.
 */
export default function RebalanceReportStrip({
  onPreview,
  onDownload,
  downloading,
  status,
}: {
  onPreview: (account: string, label: string) => void
  onDownload: (account: string) => void
  downloading: boolean
  status?: string
}) {
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const busyRef = useRef(false)

  useEffect(() => {
    let alive = true
    apiFetch('/api/ui/rebalance-report', { cacheMs: 0, timeoutMs: 15_000 })
      .then((res: any) => {
        if (!alive) return
        if (!res?.ok) throw new Error(res?.error || '계좌 목록을 불러오지 못했습니다.')
        const list = (res.data?.accounts ?? []) as AccountOption[]
        setAccounts(list)
        setSelected((cur) => cur || list[0]?.key || '')
      })
      .catch((e: any) => {
        if (alive) setError(String(e?.message || e))
      })
    return () => {
      alive = false
    }
  }, [])

  const current = accounts?.find((a) => a.key === selected)
  const make = () => {
    if (!current || busyRef.current) return
    busyRef.current = true
    try {
      onPreview(current.key, current.label)
    } finally {
      // 미리보기 모달이 진행 상태를 보여 주므로 연타만 막는다
      setTimeout(() => { busyRef.current = false }, 800)
    }
  }

  return (
    <table className="xls-table reports-plan-strip" style={{ width: '100%', tableLayout: 'fixed', marginBottom: 0 }}>
      <tbody>
        <tr className="xls-row">
          <td className="xls-cell xls-cell--wrap" style={{ fontWeight: 600, width: '21%' }}>실계좌 리밸런싱 가이드</td>
          <td className="xls-cell xls-cell--wrap">
            <div className="reports-rebalance">
              <div className="caption">
                계좌를 고르면 수익 구간에서 정리할 종목, 분배금을 모을 지수 ETF, 가격이 오면 정리할 목록, 실행 순서를 문서로 만듭니다. 주문은 하지 않습니다.
              </div>
              {error && <div className="caption reports-rebalance__error">{error}</div>}
              {accounts && accounts.length === 0 && (
                <div className="caption">입력된 실계좌 보유가 없습니다. 포트폴리오에서 계좌/보유를 추가하면 만들 수 있습니다.</div>
              )}
              {status && <div className="caption">{status}</div>}
              <div className="reports-rebalance__controls">
                <select
                  className="reports-rebalance__select"
                  aria-label="계좌 선택"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  disabled={!accounts?.length}
                >
                  {!accounts && !error && <option value="">계좌 불러오는 중…</option>}
                  {error && !accounts && <option value="">계좌를 불러오지 못했습니다</option>}
                  {accounts?.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label} · {a.holdingCount}종목 · {formatKrwCompact(a.total)}
                    </option>
                  ))}
                </select>
                <Button size="sm" className="reports-action-btn" variant="primary" onClick={make} disabled={!current} data-action-label="만들기">
                  <FileText size={14} />
                  <span className="reports-action-btn__label">만들기</span>
                </Button>
                <Button
                  size="sm"
                  className="reports-action-btn"
                  variant="secondary"
                  onClick={() => current && onDownload(current.key)}
                  disabled={!current || downloading}
                  data-action-label={downloading ? '처리 중' : '파일 저장'}
                >
                  <Download size={14} />
                  <span className="reports-action-btn__label">{downloading ? '처리 중…' : '파일 저장'}</span>
                </Button>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

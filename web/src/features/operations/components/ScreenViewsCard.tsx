import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { MENU_SECTIONS } from '../../../navigation'

type Row = { screen: string; views: number; users: number }

const LABELS: Record<string, string> = Object.fromEntries(
  MENU_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => [i.key, i.label] as const))),
)

/** 화면별 방문 집계(관리자) — 메뉴 정리 대상 판단용. 메뉴에는 있는데 집계에 없는 화면 = 0회 */
export default function ScreenViewsCard() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [since, setSince] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    apiFetch('/api/ui/screen-views?days=21', { cacheMs: 0 })
      .then((j: { screens?: Row[]; since?: string }) => {
        if (!alive) return
        setRows(j.screens || [])
        setSince(j.since || '')
      })
      .catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [])

  const seen = new Set((rows || []).map((r) => r.screen))
  const unused = Object.keys(LABELS).filter((k) => !seen.has(k))

  return (
    <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
      <h2 className="title-lg">화면별 방문 (최근 3주)</h2>
      {failed && <p className="muted">집계를 불러오지 못했습니다. 마이그레이션 040 실행 여부를 확인하세요.</p>}
      {!failed && rows == null && <p className="muted">불러오는 중…</p>}
      {rows && (
        <>
          <p className="caption muted">{since}부터 · 하루 1.5초 이상 머문 화면만 셉니다. 집계 시작 직후에는 표본이 적습니다.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={{ textAlign: 'left' }}>화면</th><th style={{ textAlign: 'right' }}>방문</th><th style={{ textAlign: 'right' }}>사용자</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.screen}>
                  <td>{LABELS[r.screen] || r.screen}</td>
                  <td style={{ textAlign: 'right' }}>{r.views}</td>
                  <td style={{ textAlign: 'right' }}>{r.users}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {unused.length > 0 && (
            <p className="caption muted" style={{ marginTop: 'var(--space-3)' }}>
              방문 0회: {unused.map((k) => LABELS[k]).join(', ')}
            </p>
          )}
        </>
      )}
    </div>
  )
}

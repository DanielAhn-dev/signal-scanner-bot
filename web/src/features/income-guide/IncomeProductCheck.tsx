import React from 'react'
import More from '../../components/ui/More'
import { formatKrwMan } from '../../lib/format'

/** 서버 src/lib/incomeProductCheck.ts의 IncomeCheckRow */
export type IncomeCheckRow = {
  code: string
  name: string
  value: number
  sharePct: number
  familySharePct: number
  yieldPct: number
  yieldSource: 'history' | 'short' | 'naver' | 'assumed'
  payments: number
  historyMonths: number
  cv6: number | null
  trendPct: number | null
  lastVsPeakPct: number | null
  total3mPct: number | null
  verdict: 'add' | 'keep' | 'caution' | 'wait'
  reasons: string[]
}

const VERDICT: Record<IncomeCheckRow['verdict'], { label: string; color: string }> = {
  add: { label: '담을 후보', color: 'var(--color-success)' },
  keep: { label: '유지', color: 'var(--color-text-secondary)' },
  caution: { label: '주의', color: 'var(--color-warning)' },
  wait: { label: '판단 보류', color: 'var(--color-text-tertiary)' },
}
const SOURCE: Record<IncomeCheckRow['yieldSource'], string> = {
  history: '분배금 이력',
  short: '짧은 이력(네이버와 낮은 쪽)',
  naver: '네이버 12개월',
  assumed: '유형별 가정',
}

const card: React.CSSProperties = {
  margin: '8px 12px',
  width: 'auto',
  padding: 14,
  border: '1px solid var(--color-border-default)',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.65,
  background: 'var(--color-bg-elevated, transparent)',
  wordBreak: 'keep-all',
}
const muted: React.CSSProperties = { color: 'var(--color-text-secondary)' }
const faint: React.CSSProperties = { color: 'var(--color-text-tertiary)', fontSize: 12 }
const pct = (v: number | null, digits = 0) => (v == null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`)

/**
 * 일반 계좌 인컴 상품 점검 — 분배금 올리기(관리자)에서 저장한 이력으로 판단한다.
 * 한 줄 요약만 보이고, 상품별 근거는 접어 둔다. 매매 지시가 아니라 점검이다.
 */
export default function IncomeProductCheck({ rows }: { rows: IncomeCheckRow[] }) {
  if (!rows.length) return null
  const add = rows.filter((r) => r.verdict === 'add')
  const caution = rows.filter((r) => r.verdict === 'caution')
  const wait = rows.filter((r) => r.verdict === 'wait')
  const summary =
    add.length > 0
      ? `분배가 안정적이고 쏠리지 않은 후보: ${add.map((r) => r.name).join(', ')}`
      : '지금은 새로 더 담을 만큼 안정적이고 쏠리지 않은 상품이 없습니다'
  return (
    <div style={card}>
      <strong>인컴 상품 점검</strong> <span style={faint}>일반 계좌 · 분배금 이력 기준</span>
      <div style={{ marginTop: 4 }}>{summary}</div>
      {(caution.length > 0 || wait.length > 0) && (
        <div style={muted}>
          {caution.length > 0 && <>주의 {caution.length}개({caution.map((r) => r.name).join(', ')}) </>}
          {wait.length > 0 && <>· 이력이 짧아 보류 {wait.length}개</>}
        </div>
      )}
      <More label="상품별 근거 보기">
        {rows.map((r) => (
          <div key={r.code} style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--color-border-default)' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <strong>{r.name}</strong>
              <span style={{ color: VERDICT[r.verdict].color, fontWeight: 600 }}>{VERDICT[r.verdict].label}</span>
              <span style={faint}>{formatKrwMan(r.value)} · 일반 인컴의 {r.sharePct.toFixed(0)}%</span>
            </div>
            <div style={muted}>
              분배율 연 {r.yieldPct.toFixed(1)}% <span style={faint}>({SOURCE[r.yieldSource]})</span> · 지급 {r.payments}회
              {r.historyMonths >= 1 && <> ({Math.round(r.historyMonths)}개월)</>}
              {r.cv6 != null && <> · 최근 6회 변동 {r.cv6.toFixed(2)}</>}
              {r.trendPct != null && <> · 추세 {pct(r.trendPct)}</>}
              {r.total3mPct != null && <> · 최근 3개월 총수익 약 {pct(r.total3mPct, 1)}</>}
            </div>
            {r.reasons.map((t, i) => <div key={i} style={faint}>· {t}</div>)}
          </div>
        ))}
        <div style={{ marginTop: 10, ...faint }}>
          기준: 지급 12회 이상·변동계수 0.15 이하·추세 −15% 이상·같은 기초 계열 40% 미만이면 담을 후보, 지급 6회 미만이면 판단 보류,
          분배가 25% 넘게 줄었거나 1년 새 2.5배 넘게 늘었으면 주의입니다. 총수익은 네이버 3개월 가격수익률에 최근 3개월 분배금을 더한 세전 근사치입니다.
          한 시기의 표본이고, 분배금은 시장 변동성에 따라 달라집니다. 분배금 이력은 관리자가 올린 운용사 엑셀 기준입니다.
        </div>
      </More>
    </div>
  )
}

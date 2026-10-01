import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import { useCurrentChatId } from '../../stores/profileStore'

type Group = 'growth' | 'income' | 'satellite' | 'cash'
type Warning = { level: 'info' | 'warn' | 'alert'; title: string; text: string }
type View = {
  today: string
  settings: { monthlyNeed: number; incomeStart?: string; satelliteCapPct: number; overseasPct: number }
  total: number
  holdingCount: number
  priceFallbacks?: number
  stage: { key: 'accumulate' | 'transition' | 'income'; title: string; text: string; yearsToIncome: number | null }
  need: {
    annual: number
    ratePct: number
    capitalByDistribution: number
    capitalByWithdrawal4: number
    evidence: { ratePct: number; mixKeepPct: number; mixWorstPct: number; krOnlyKeepPct: number } | null
  }
  groups: Array<{ group: Group; label: string; value: number; actualPct: number; targetPct: number; diffPct: number; diffAmount: number }>
  growthSplit: { krValue: number; globalValue: number; globalPct: number; targetGlobalPct: number }
  buckets: Array<{ bucket: string; label: string; value: number; pct: number }>
  rebalance: {
    needed: boolean
    reason: string
    moves: Array<{ from: Group; to: Group; amount: number }>
    growthShift: { to: 'global_index' | 'kr_index'; amount: number } | null
    trims: Array<{ group: Group; holdings: Array<{ code: string; name: string; accountLabel: string; value: number }> }>
  }
  warnings: Warning[]
  accounts: Array<{ key: string; label: string; taxAdvantaged: boolean; total: number; byGroup: Record<Group, number> }>
  holdings: Array<{ code: string; name: string; accountLabel: string; value: number; label?: string; bucket: string; group: Group; pct: number }>
}

const GROUP_LABEL: Record<Group, string> = { growth: '성장 (지수)', income: '인컴 (분배형)', satellite: '위성 (개별주·테마)', cash: '현금성' }
const BUY_HINT: Record<Group, string> = {
  growth: '국내 지수(KODEX 200 등, 일반 계좌) · 해외 지수(S&P500 등, ISA·연금 계좌)',
  income: '국내 고배당 · 미국 배당성장(SCHD 계열) · 오래 버틴 인프라 펀드. 커버드콜은 인컴의 1/3 이하',
  satellite: '새로 채우지 않습니다 (상한 안에서만 유지)',
  cash: '단기채권·CD금리 ETF 또는 파킹통장 — 1년치 생활비',
}
const man = (v: number) => {
  const m = Math.round(v / 10_000)
  const eok = Math.trunc(m / 10_000)
  const rest = Math.abs(m % 10_000)
  if (eok === 0) return `${m.toLocaleString('ko-KR')}만원`
  return rest ? `${eok}억 ${rest.toLocaleString('ko-KR')}만원` : `${eok}억원`
}
const pct = (v: number) => `${v.toFixed(0)}%`

/**
 * 실계좌 리밸런싱 가이드 — 포트폴리오에서 "계좌/보유 추가"로 넣은 실제 계좌 보유를 성장·인컴·위성·현금성으로 나눠
 * 모으기 → 전환 → 인컴 단계의 목표 비중과 비교한다. 계산은 src/lib/incomeGuide.ts. 주문은 하지 않는다.
 */
export default function IncomeGuidePage() {
  const chatId = useCurrentChatId()
  const navigate = useNavigate()
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ needMan: '', incomeStart: '', satCap: '', overseas: '' })

  const load = useCallback(async (init?: { method: string; body: string }): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/ui/income-guide', { cacheMs: 0, timeoutMs: 20_000, ...(init ?? {}) })
      if (!res?.data) {
        setError(res?.error ?? '가이드를 불러오지 못했습니다.')
        return false
      }
      setView(res.data)
      setError(null)
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [])

  useEffect(() => {
    if (chatId) void load()
  }, [chatId, load])

  const startEdit = () => {
    if (!view) return
    setForm({
      needMan: String(Math.round(view.settings.monthlyNeed / 10_000)),
      incomeStart: view.settings.incomeStart ?? '',
      satCap: String(view.settings.satelliteCapPct),
      overseas: String(view.settings.overseasPct),
    })
    setEditing(true)
  }
  const save = async () => {
    setBusy(true)
    const ok = await load({
      method: 'POST',
      body: JSON.stringify({
        monthlyNeed: Number(form.needMan) * 10_000,
        incomeStart: form.incomeStart,
        satelliteCapPct: Number(form.satCap),
        overseasPct: Number(form.overseas),
      }),
    })
    setBusy(false)
    if (ok) setEditing(false)
  }

  const box: React.CSSProperties = {
    margin: '8px 12px',
    padding: 12,
    border: '1px solid var(--color-border-default)',
    borderRadius: 6,
    fontSize: 12,
    lineHeight: 1.6,
    background: 'var(--color-bg-elevated, transparent)',
  }
  const th: React.CSSProperties = { textAlign: 'left', padding: '4px 8px', color: 'var(--color-text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--color-border-default)' }
  const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid var(--color-border-default)', fontVariantNumeric: 'tabular-nums' }
  const levelColor = (l: Warning['level']) =>
    l === 'alert' ? 'var(--color-error)' : l === 'warn' ? 'var(--color-warning, #b45309)' : 'var(--color-text-secondary)'

  if (error && !view) return <div style={box}>리밸런싱 가이드: {error}</div>
  if (!view) return <div style={box}>불러오는 중…</div>

  const inputStyle: React.CSSProperties = { width: 90, marginRight: 8 }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>
            단계: {view.stage.title}
            {view.stage.yearsToIncome != null && view.stage.yearsToIncome > 0 ? ` · 인컴 시작까지 ${view.stage.yearsToIncome.toFixed(1)}년` : ''}
          </strong>
          {!editing && (
            <Button size="sm" variant="secondary" onClick={startEdit}>
              가이드 설정
            </Button>
          )}
        </div>
        <div style={{ margin: '4px 0' }}>{view.stage.text}</div>
        {editing && (
          <div style={{ margin: '6px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
            인컴 단계 월 생활비(만원, 세후)
            <input style={inputStyle} value={form.needMan} onChange={(e) => setForm({ ...form, needMan: e.target.value })} />
            인컴 시작 월
            <input type="month" style={{ ...inputStyle, width: 130 }} value={form.incomeStart} onChange={(e) => setForm({ ...form, incomeStart: e.target.value })} />
            위성 상한(%)
            <input style={inputStyle} value={form.satCap} onChange={(e) => setForm({ ...form, satCap: e.target.value })} />
            성장 중 해외 비중(%)
            <input style={inputStyle} value={form.overseas} onChange={(e) => setForm({ ...form, overseas: e.target.value })} />
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              저장
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              취소
            </Button>
            <div style={{ width: '100%', color: 'var(--color-text-tertiary)' }}>
              인컴 시작 월을 비워 두면 계속 모으는 단계로 봅니다. 시작 5년 전부터 매년 한 번 분배형·현금성 비중을 계단식으로 늘립니다.
              해외 비중 기본 50%는 2003~2026 코스피·S&amp;P500(원화) 반반이 5년 최악을 가장 줄였기 때문입니다.
            </div>
          </div>
        )}
        <div>
          계좌 보유 {view.holdingCount}개 · 평가 {man(view.total)} · 월 {man(view.settings.monthlyNeed)} 생활비에 필요한 원금: 분배형만으로{' '}
          {man(view.need.capitalByDistribution)}(분배율 4.5%) · 지수에서 연 4%씩 꺼내면 {man(view.need.capitalByWithdrawal4)}
        </div>
        {view.priceFallbacks ? (
          <div style={{ color: 'var(--color-text-tertiary)' }}>실시간가를 못 받은 {view.priceFallbacks}개는 종가나 매수가로 평가했습니다.</div>
        ) : null}
      </div>

      {view.holdingCount === 0 ? (
        <div style={box}>
          아직 입력한 실계좌 보유가 없습니다. 포트폴리오의 <strong>계좌/보유 추가</strong>에서 증권사·계좌명과 보유 종목을 넣으면, 계좌마다 어떤 바구니에
          얼마가 있는지와 옮길 금액을 안내합니다. 계좌 이름에 ISA·연금·IRP가 들어가면 세금 배치도 함께 봅니다.
          <div style={{ marginTop: 6 }}>
            <Button size="sm" onClick={() => navigate('/portfolio')}>
              포트폴리오로 가기
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div style={box}>
            <strong>바구니별 비중 — 목표 대비</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
              <thead>
                <tr>
                  <th style={th}>바구니</th>
                  <th style={th}>현재</th>
                  <th style={th}>목표</th>
                  <th style={th}>옮길 금액</th>
                </tr>
              </thead>
              <tbody>
                {view.groups.map((g) => (
                  <tr key={g.group}>
                    <td style={td}>{g.label}</td>
                    <td style={td}>
                      {pct(g.actualPct)} · {man(g.value)}
                    </td>
                    <td style={td}>{pct(g.targetPct)}</td>
                    <td
                      style={{
                        ...td,
                        color: Math.abs(g.diffPct) > 10 ? 'var(--color-error)' : 'var(--color-text-secondary)',
                        fontWeight: Math.abs(g.diffPct) > 10 ? 600 : 400,
                      }}
                    >
                      {Math.abs(g.diffAmount) < 10_000 ? '-' : `${g.diffAmount > 0 ? '+' : '−'}${man(Math.abs(g.diffAmount))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 4, color: 'var(--color-text-secondary)' }}>
              성장 바구니 안: 국내 {man(view.growthSplit.krValue)} · 해외 {man(view.growthSplit.globalValue)} (해외 {pct(view.growthSplit.globalPct)}, 목표{' '}
              {view.growthSplit.targetGlobalPct}%)
            </div>
            <div style={{ marginTop: 2, color: 'var(--color-text-tertiary)' }}>
              세부: {view.buckets.map((b) => `${b.label} ${pct(b.pct)}`).join(' · ')}
            </div>
          </div>

          <div style={{ ...box, borderColor: view.rebalance.needed ? 'var(--color-error)' : 'var(--color-border-default)' }}>
            <strong>{view.rebalance.needed ? '지금 옮기는 것이 좋습니다' : '정기 점검 때 맞추면 됩니다'}</strong>
            <div>{view.rebalance.reason}</div>
            {view.rebalance.moves.length > 0 && (
              <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                {view.rebalance.moves.map((m, i) => (
                  <li key={i}>
                    {GROUP_LABEL[m.from]} → {GROUP_LABEL[m.to]} <strong>{man(m.amount)}</strong>
                    <span style={{ color: 'var(--color-text-tertiary)' }}> — 채울 곳: {BUY_HINT[m.to]}</span>
                  </li>
                ))}
              </ul>
            )}
            {view.rebalance.growthShift && (
              <div>
                성장 바구니 안에서{' '}
                {view.rebalance.growthShift.to === 'global_index' ? '국내 지수 → 해외 지수' : '해외 지수 → 국내 지수'}{' '}
                <strong>{man(view.rebalance.growthShift.amount)}</strong>
                <span style={{ color: 'var(--color-text-tertiary)' }}>
                  {' '}
                  — 해외 지수는 ISA·연금 계좌에서 사면 매매차익·분배금 과세(15.4%)를 미루거나 줄일 수 있습니다
                </span>
              </div>
            )}
            {view.rebalance.trims.map((t) => (
              <div key={t.group} style={{ color: 'var(--color-text-secondary)' }}>
                {GROUP_LABEL[t.group]}에서 줄일 후보(큰 것부터): {t.holdings.map((h) => `${h.name}(${h.accountLabel}) ${man(h.value)}`).join(', ')}
              </div>
            ))}
            <div style={{ marginTop: 4, color: 'var(--color-text-tertiary)' }}>
              손실 중인지 수익 중인지가 아니라 비중으로 정합니다. 새로 넣는 돈으로 모자란 바구니를 먼저 채우면 팔지 않고도 맞출 수 있습니다.
              국내 주식형 ETF끼리는 매매차익이 비과세라 일반 계좌에서도 옮기는 비용이 거의 없습니다.
            </div>
          </div>

          {view.warnings.length > 0 && (
            <div style={box}>
              <strong>확인할 것</strong>
              {view.warnings.map((w, i) => (
                <div key={i} style={{ marginTop: 6 }}>
                  <span style={{ color: levelColor(w.level), fontWeight: 600 }}>{w.title}</span> — {w.text}
                </div>
              ))}
            </div>
          )}

          <div style={box}>
            <strong>계좌별</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
              <thead>
                <tr>
                  <th style={th}>계좌</th>
                  <th style={th}>평가</th>
                  {(['growth', 'income', 'satellite', 'cash'] as Group[]).map((g) => (
                    <th key={g} style={th}>
                      {GROUP_LABEL[g]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.accounts.map((a) => (
                  <tr key={a.key}>
                    <td style={td}>
                      {a.label}
                      {a.taxAdvantaged ? ' (절세)' : ''}
                    </td>
                    <td style={td}>{man(a.total)}</td>
                    {(['growth', 'income', 'satellite', 'cash'] as Group[]).map((g) => (
                      <td key={g} style={td}>
                        {a.byGroup[g] > 0 ? man(a.byGroup[g]) : '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={box}>
            <strong>보유 분류</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
              <thead>
                <tr>
                  <th style={th}>종목</th>
                  <th style={th}>계좌</th>
                  <th style={th}>분류</th>
                  <th style={th}>평가 · 비중</th>
                </tr>
              </thead>
              <tbody>
                {view.holdings.map((h) => (
                  <tr key={`${h.accountLabel}-${h.code}`}>
                    <td style={td}>
                      {h.name} <span style={{ color: 'var(--color-text-tertiary)' }}>{h.code}</span>
                    </td>
                    <td style={td}>{h.accountLabel}</td>
                    <td style={td}>{view.buckets.find((b) => b.bucket === h.bucket)?.label ?? h.bucket}</td>
                    <td style={td}>
                      {man(h.value)} · {pct(h.pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 4, color: 'var(--color-text-tertiary)' }}>
              분류는 종목 이름으로 정합니다(예: "커버드콜"·"프리미엄" → 커버드콜, "배당" → 배당, S&amp;P500·나스닥100 → 해외 지수). 다르게 잡힌 종목이 있으면 알려 주세요.
            </div>
          </div>
        </>
      )}

      <div style={{ ...box, color: 'var(--color-text-tertiary)' }}>
        근거(2026-10-01 검증): 코스피와 S&amp;P500(원화)은 2003~2026 연수익이 같았고(12.0%), 반반 매년 리밸런싱이 5년 최악을 가장 줄였습니다.
        리밸런싱은 수익보다 낙폭을 줄였습니다(−41.7%→−36.4%). 분배형은 횡보장에서 같은 생활비에 원금을 더 남겼지만 랠리에서 크게 뒤졌고,
        커버드콜은 장기로 연 4~11%p 뒤처졌습니다. 과거 결과는 미래를 보장하지 않으며, 이 화면은 주문을 내지 않는 안내입니다.
      </div>
    </div>
  )
}

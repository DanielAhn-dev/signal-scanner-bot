import React, { useRef, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import Button from '../../components/ui/Button'

/** 서버 src/lib/rebalancePlan.ts의 RebalancePlan */
export type RebalancePlan = {
  headline: string
  income: { monthlyNet: number; source: 'actual' | 'estimate'; estimateNet: number; floor: number; surplus: number }
  growth: { actualPct: number; targetPct: number; needByNewMoney: number; monthlyInflow: number; months: number | null }
  buyTarget: { code: string; name: string; accountLabel: string; price: number } | null
  buyHint: string
  merges: Array<{
    from: { code: string; name: string; accountLabel: string; shares: number; amount: number; realizedGain: number | null }
    to: { code: string; name: string; accountLabel: string; price: number; shares: number; amount: number }
    reason: string
    monthlyIncomeDelta: number
    taxedGain: boolean
  }>
  kinds: { before: number; after: number }
  mergeIncomeDelta: number
  trim: {
    code: string
    name: string
    accountLabel: string
    price: number
    maxAmount: number
    maxShares: number
    incomeLossPerMillion: number
    note: string
  } | null
}

type Props = {
  plan: RebalancePlan
  settings: { actualMonthlyNet?: number; monthlyContribution?: number; feePctByCode?: Record<string, number> }
  /** 설정 일부만 저장한다 (서버가 보낸 키만 고친다). 성공하면 true */
  saveSettings: (patch: Record<string, unknown>) => Promise<boolean>
}

const man = formatKrwMan
const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`
const signedMan = (v: number) => (Math.abs(v) < 5_000 ? '거의 그대로' : `${v > 0 ? '+' : '−'}${man(Math.abs(v))}`)

const card: React.CSSProperties = {
  margin: '8px 12px',
  padding: 14,
  border: '1px solid var(--color-border-default)',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.65,
  background: 'var(--color-bg-elevated, transparent)',
  wordBreak: 'keep-all',
}
const stepTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, display: 'block', marginBottom: 4 }
const muted: React.CSSProperties = { color: 'var(--color-text-secondary)' }
const faint: React.CSSProperties = { color: 'var(--color-text-tertiary)', fontSize: 12 }
const smallInput: React.CSSProperties = { width: 80, marginRight: 4 }

/**
 * 리밸런싱 첫 화면 — "그래서 뭘 하면 되는지"만 쉬운 말로. 숫자 근거·바구니 표는 아래 "자세히 보기"에 둔다.
 * ① 새 돈은 한 곳으로 ② 겹치는 종목 합치기 ③ 파는 건 인컴 하한을 지키는 만큼만
 */
export default function PlanSteps({ plan, settings, saveSettings }: Props) {
  const savingRef = useRef(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [actualMan, setActualMan] = useState(settings.actualMonthlyNet ? String(Math.round(settings.actualMonthlyNet / 10_000)) : '')
  const [contribMan, setContribMan] = useState(settings.monthlyContribution ? String(Math.round(settings.monthlyContribution / 10_000)) : '')
  const [fees, setFees] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(settings.feePctByCode ?? {}).map(([k, v]) => [k, String(v)])),
  )
  const [showOrders, setShowOrders] = useState(false)

  const save = async (patch: Record<string, unknown>, done: string) => {
    if (savingRef.current) return
    savingRef.current = true
    setMsg(null)
    const ok = await saveSettings(patch)
    savingRef.current = false
    setMsg(ok ? done : '저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.')
  }
  const toWon = (v: string) => (v.trim() === '' ? '' : Number(v) * 10_000)

  const { income, growth, merges, trim, buyTarget } = plan
  const growthBar = Math.min(100, Math.max(0, growth.actualPct))
  const short = income.surplus < 0
  const feeCodes = [...new Set(merges.flatMap((m) => [m.from.code, m.to.code]))]

  return (
    <>
      {/* 요약 */}
      <div style={{ ...card, borderColor: short ? 'var(--color-error)' : 'var(--color-border-default)' }}>
        <strong style={{ fontSize: 16 }}>{plan.headline}</strong>
        {growth.targetPct > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...muted }}>
              <span>성장(지수) {growth.actualPct.toFixed(0)}%</span>
              <span>목표 {growth.targetPct.toFixed(0)}%</span>
            </div>
            <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--color-bg-tertiary)', overflow: 'hidden' }}>
              <div style={{ width: `${growthBar}%`, height: '100%', background: 'var(--color-brand)' }} />
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${Math.min(100, growth.targetPct)}%`,
                  width: 2,
                  background: 'var(--color-text-primary)',
                }}
              />
            </div>
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          월 인컴(세후) <strong>{income.source === 'actual' ? '' : '약 '}{man(income.monthlyNet)}</strong>
          {' · '}목표 {man(income.floor)}{' '}
          <span style={{ color: short ? 'var(--color-error)' : 'var(--color-success)', fontWeight: 600 }}>
            {short ? `${man(-income.surplus)} 모자람` : `여유 ${man(income.surplus)}`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 4, ...faint }}>
          {income.source === 'actual' ? '내가 적은 실제 분배금 기준입니다.' : '상품 유형별 분배율로 낸 추정입니다. 최근 몇 달 실제로 받은 분배금을 적으면 그 값으로 계산합니다.'}
          <span>
            실제로 받은 월 분배금(세후)
            <input
              style={{ ...smallInput, marginLeft: 4 }}
              inputMode="numeric"
              placeholder="만원"
              value={actualMan}
              onChange={(e) => setActualMan(e.target.value)}
            />
            만원
          </span>
          <Button size="sm" variant="secondary" onClick={() => void save({ actualMonthlyNet: toWon(actualMan) }, '실제 분배금으로 다시 계산했습니다.')}>
            반영
          </Button>
        </div>
      </div>

      {/* ① 새 돈 */}
      <div style={card}>
        <span style={stepTitle}>① 새 돈은 한 곳으로</span>
        <div>
          내 계좌에 새로 넣는 돈과 목표({man(income.floor)})를 넘게 들어온 분배금은{' '}
          <strong>{buyTarget ? buyTarget.name : '성장 지수 ETF'}</strong>만 삽니다. 인컴 ETF는 더 사지 않습니다.
        </div>
        <div style={faint}>{plan.buyHint}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          내 계좌에 직접 넣는 돈 (매달)
          <input style={smallInput} inputMode="numeric" placeholder="만원" value={contribMan} onChange={(e) => setContribMan(e.target.value)} />
          만원
          <Button size="sm" variant="secondary" onClick={() => void save({ monthlyContribution: toWon(contribMan) }, '내 계좌에 넣는 돈을 저장했습니다.')}>
            저장
          </Button>
        </div>
        <div style={faint}>증권사 계좌에 내가 직접 넣는 금액입니다. 봇 실험 계좌의 월 입금(내 계획의 &lsquo;매달 투자할 돈&rsquo;)과는 따로이고 서로 바뀌지 않습니다.</div>
        {growth.needByNewMoney > 0 ? (
          <div style={{ marginTop: 6 }}>
            새 돈만으로 목표 {growth.targetPct.toFixed(0)}%까지 약 <strong>{man(growth.needByNewMoney)}</strong>
            {growth.months != null ? (
              <>
                {' '}— 매달 {man(growth.monthlyInflow)}씩이면 약 <strong>{growth.months}개월</strong>
                {buyTarget && growth.monthlyInflow >= buyTarget.price ? ` (한 달에 ${buyTarget.name} ${Math.floor(growth.monthlyInflow / buyTarget.price)}주 안팎)` : ''}
              </>
            ) : (
              ' — 내 계좌에 매달 넣는 돈을 적으면 몇 달 걸리는지 보여 드립니다.'
            )}
          </div>
        ) : (
          <div style={{ marginTop: 6, ...muted }}>성장 비중은 이미 목표 이상입니다. 새 돈은 같은 곳에 계속 넣으면 됩니다.</div>
        )}
      </div>

      {/* ② 합치기 */}
      <div style={card}>
        <span style={stepTitle}>
          ② 겹치는 종목 합치기 {merges.length > 0 ? `(${plan.kinds.before}종 → ${plan.kinds.after}종)` : ''}
        </span>
        {merges.length === 0 ? (
          <div style={muted}>겹치거나 너무 작은 인컴 종목이 없습니다.</div>
        ) : (
          <>
            <div style={muted}>
              같은 계좌 안에서 팔고 바로 삽니다. 월 인컴 변화 <strong>{signedMan(plan.mergeIncomeDelta)}</strong> · ETF는 팔 때 거래세가 없습니다.
            </div>
            <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
              {merges.map((m) => (
                <li key={`${m.from.accountLabel}-${m.from.code}`} style={{ marginBottom: 4 }}>
                  <strong>{m.from.name}</strong> {m.from.shares.toLocaleString('ko-KR')}주 팔기 → <strong>{m.to.name}</strong>{' '}
                  {m.to.shares.toLocaleString('ko-KR')}주 사기
                  <div style={faint}>
                    {m.reason}
                    {m.taxedGain ? ' · 일반 계좌의 해외 기초 ETF라 매매차익에 15.4% 과세' : ''}
                    {m.from.realizedGain != null ? ` · 확정 손익 ${m.from.realizedGain >= 0 ? '+' : '−'}${man(Math.abs(m.from.realizedGain))}` : ''}
                  </div>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" onClick={() => setShowOrders((v) => !v)}>
              {showOrders ? '주문표·총보수 접기' : '주문표·총보수 보기'}
            </Button>
            {showOrders && (
              <div style={{ marginTop: 6 }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={muted}>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>순서</th>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>종목</th>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>계좌</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>수량</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {merges.flatMap((m, i) => [
                        <tr key={`s${i}`}>
                          <td style={{ padding: '3px 6px', color: 'var(--color-stock-down)', fontWeight: 600, whiteSpace: 'nowrap' }}>{i + 1}. 매도</td>
                          <td style={{ padding: '3px 6px' }}>{m.from.name}</td>
                          <td style={{ padding: '3px 6px' }}>{m.from.accountLabel}</td>
                          <td style={{ padding: '3px 6px', textAlign: 'right' }}>{m.from.shares.toLocaleString('ko-KR')}주</td>
                          <td style={{ padding: '3px 6px', textAlign: 'right' }}>{won(m.from.amount)}</td>
                        </tr>,
                        <tr key={`b${i}`} style={{ borderBottom: '1px solid var(--color-border-default)' }}>
                          <td style={{ padding: '3px 6px', color: 'var(--color-stock-up)', fontWeight: 600, whiteSpace: 'nowrap' }}>{i + 1}. 매수</td>
                          <td style={{ padding: '3px 6px' }}>{m.to.name}</td>
                          <td style={{ padding: '3px 6px' }}>{m.to.accountLabel}</td>
                          <td style={{ padding: '3px 6px', textAlign: 'right' }}>{m.to.shares.toLocaleString('ko-KR')}주</td>
                          <td style={{ padding: '3px 6px', textAlign: 'right' }}>{won(m.to.amount)}</td>
                        </tr>,
                      ])}
                    </tbody>
                  </table>
                </div>
                <div style={{ ...faint, marginTop: 4 }}>
                  수량은 지금 가격 기준입니다. 매도가 체결된 뒤 들어온 금액으로 매수 수량을 다시 맞추세요. 국내 커버드콜이 매매차익 비과세 대상인지는 증권사 앱의 종목 정보(과세 유형)에서 확인하세요.
                </div>
                <div style={{ marginTop: 8 }}>
                  <strong style={{ fontSize: 12 }}>총보수(연 %, 선택)</strong>
                  <div style={faint}>둘 다 넣으면 0.05%p 이상 싼 쪽을 남기고, 비슷하거나 비어 있으면 보유금액이 큰 쪽을 남깁니다.</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {feeCodes.map((code) => {
                      const name = merges.find((m) => m.from.code === code)?.from.name ?? merges.find((m) => m.to.code === code)?.to.name ?? code
                      return (
                        <label key={code} style={{ fontSize: 12 }}>
                          {name}{' '}
                          <input
                            style={{ width: 60 }}
                            inputMode="decimal"
                            placeholder="%"
                            value={fees[code] ?? ''}
                            onChange={(e) => setFees((f) => ({ ...f, [code]: e.target.value }))}
                          />
                        </label>
                      )
                    })}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void save(
                          { feePctByCode: Object.fromEntries(feeCodes.map((c) => [c, (fees[c] ?? '').trim()])) },
                          '총보수를 저장하고 남길 종목을 다시 골랐습니다.',
                        )
                      }
                    >
                      보수 반영
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ③ 팔기 */}
      <div style={card}>
        <span style={stepTitle}>③ 파는 건 서두르지 않아도 됩니다</span>
        {!trim ? (
          <div style={muted}>
            {growth.needByNewMoney > 0 ? '팔아서 옮길 커버드콜이 없습니다. 새 돈으로만 채우세요.' : '성장 비중이 목표 이상이라 팔 필요가 없습니다.'}
          </div>
        ) : (
          <>
            <div>
              더 빨리 옮기고 싶다면 <strong>{trim.name}</strong>부터 줄입니다. 100만원 팔 때마다 월 인컴이 약 {man(trim.incomeLossPerMillion)} 줄어듭니다.
            </div>
            {trim.maxShares > 0 ? (
              <div style={{ marginTop: 4 }}>
                최대 <strong>{trim.maxShares.toLocaleString('ko-KR')}주 (약 {man(trim.maxAmount)})</strong> → 판 돈으로{' '}
                {buyTarget ? `${buyTarget.name} 약 ${Math.floor(trim.maxAmount / buyTarget.price).toLocaleString('ko-KR')}주` : '성장 지수 ETF'}
              </div>
            ) : null}
            <div style={faint}>
              {trim.note} 같은 커버드콜 중 분배율이 가장 낮은 것을 고릅니다(같은 돈을 팔 때 인컴이 가장 덜 줄어듭니다).
            </div>
          </>
        )}
      </div>

      {msg && <div style={{ margin: '0 12px', ...muted }}>{msg}</div>}
    </>
  )
}

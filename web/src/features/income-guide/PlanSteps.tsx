import React, { useRef, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import Button from '../../components/ui/Button'
import UnitInput from '../../components/ui/UnitInput'

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
  /** 인컴을 분배금으로만 줄여 가는 중 (가이드 설정 incomeMode 'hold') */
  hold: boolean
  cash: {
    value: number
    actualPct: number
    targetPct: number
    bandPp: number
    state: 'filling' | 'ok' | 'take-profit' | 'buy-index'
    amount: number
    months: number | null
    sellFrom: { code: string; name: string; accountLabel: string; price: number; shares: number } | null
  } | null
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
  settings: {
    actualMonthlyNet?: number
    monthlyContribution?: number
    feePctByCode?: Record<string, number>
    cashBalance?: number
    incomeMode?: 'hold'
  }
  /** 설정 일부만 저장한다 (서버가 보낸 키만 고친다). 성공하면 true */
  saveSettings: (patch: Record<string, unknown>) => Promise<boolean>
  /** 요약 바로 아래에 넣을 '받은 분배금' 카드 */
  receiptsSlot?: React.ReactNode
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
const inlineRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }

/**
 * 리밸런싱 첫 화면 — "그래서 뭘 하면 되는지"만 쉬운 말로. 숫자 근거·바구니 표는 아래 "자세히 보기"에 둔다.
 * ① 새 돈은 한 곳으로 ② 겹치는 종목 합치기 ③ 파는 건 인컴 하한을 지키는 만큼만
 */
export default function PlanSteps({ plan, settings, saveSettings, receiptsSlot }: Props) {
  const savingRef = useRef(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [contribMan, setContribMan] = useState(settings.monthlyContribution ? String(Math.round(settings.monthlyContribution / 10_000)) : '')
  const [cashMan, setCashMan] = useState(settings.cashBalance ? String(Math.round(settings.cashBalance / 10_000)) : '')
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

  const { income, growth, merges, trim, buyTarget, hold, cash } = plan
  const growthBar = Math.min(100, Math.max(0, growth.actualPct))
  // 줄여 가는 중이면 월 인컴 목표는 생활비 하한이 아니다 — 모자람을 경고로 보이지 않는다
  const short = !hold && income.surplus < 0
  const filling = cash?.state === 'filling'
  const buyName = buyTarget ? buyTarget.name : '성장 지수 ETF'

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
        {cash && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...muted }}>
              <span>
                현금(예수금 포함) {cash.actualPct.toFixed(1)}% · {man(cash.value)}
              </span>
              <span>
                목표 {cash.targetPct.toFixed(0)}% (±{cash.bandPp.toFixed(0)}%p)
              </span>
            </div>
            <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--color-bg-tertiary)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, (cash.actualPct / Math.max(1, cash.targetPct * 2)) * 100)}%`,
                  height: '100%',
                  background: 'var(--color-brand)',
                }}
              />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, background: 'var(--color-text-primary)' }} />
            </div>
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          월 인컴(세후) <strong>{income.source === 'actual' ? '' : '약 '}{man(income.monthlyNet)}</strong>
          {hold ? (
            <span style={muted}> · 쓰지 않고 {filling ? '현금' : '지수'}으로 보내는 돈</span>
          ) : (
            <>
              {' · '}목표 {man(income.floor)}{' '}
              <span style={{ color: short ? 'var(--color-error)' : 'var(--color-success)', fontWeight: 600 }}>
                {short ? `${man(-income.surplus)} 모자람` : `여유 ${man(income.surplus)}`}
              </span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 4, ...faint }}>
          {income.source === 'actual'
            ? '아래 받은 분배금 기록(최근 주당 분배금 × 지금 수량, 기록 없는 종목은 추정)으로 낸 다음 달 예상입니다.'
            : '종목별 최근 12개월 분배금(자료가 없으면 상품 유형별 가정)으로 낸 추정이고, 세금 15.4%를 모두 뺀 값입니다. 아래에 받은 분배금을 적으면 실제 기준으로 바뀝니다.'}
        </div>
        <div style={inlineRow}>
          <span>증권 계좌 예수금</span>
          <UnitInput unit="만원" width={120} inputMode="numeric" placeholder="0" aria-label="증권 계좌 예수금" value={cashMan} onChange={(e) => setCashMan(e.target.value)} />
          <Button size="sm" variant="secondary" onClick={() => void save({ cashBalance: toWon(cashMan) }, '예수금을 현금에 넣어 다시 계산했습니다.')}>
            반영
          </Button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <span>커버드콜·배당 줄이는 방식</span>
          <Button size="sm" variant={hold ? 'primary' : 'secondary'} onClick={() => void save({ incomeMode: 'hold' }, '분배금으로만 줄이는 방식으로 바꿨습니다.')}>
            분배금으로만 (팔지 않음)
          </Button>
          <Button size="sm" variant={hold ? 'secondary' : 'primary'} onClick={() => void save({ incomeMode: '' }, '목표 비중대로 맞추는 방식으로 바꿨습니다.')}>
            목표 비중대로
          </Button>
        </div>
        <div style={faint}>
          {hold
            ? '커버드콜·배당은 더 사지 않고, 들어오는 분배금을 현금·지수로 보내 비중을 저절로 줄입니다. 현금 목표는 처음엔 분배금으로만 채웁니다.'
            : '인컴 목표 비중에 맞춰 모자라면 사고, 성장이 모자라면 커버드콜을 팔아 옮기는 안까지 보여 줍니다.'}
        </div>
      </div>

      {receiptsSlot}

      {/* ① 새 돈 */}
      <div style={card}>
        <span style={stepTitle}>{filling ? '① 분배금·새 돈은 현금으로 (목표까지)' : '① 새 돈은 한 곳으로'}</span>
        {filling && cash ? (
          <div>
            현금 목표 {cash.targetPct.toFixed(0)}%까지 <strong>{man(cash.amount)}</strong> 남았습니다. 그때까지 분배금과 새 돈은 사지 말고 계좌에 현금으로 두고,
            늘어난 예수금을 위에 적어 주세요.
            {cash.months != null ? ` 지금 속도면 약 ${cash.months}개월 걸립니다.` : ''} 다 채운 뒤부터는 <strong>{buyName}</strong> 한 곳만 삽니다.
          </div>
        ) : hold ? (
          <div>
            새로 넣는 돈과 들어온 분배금은 전부 <strong>{buyName}</strong>만 삽니다. 커버드콜·배당 ETF는 더 사지 않습니다.
          </div>
        ) : (
          <div>
            내 계좌에 새로 넣는 돈과 목표({man(income.floor)})를 넘게 들어온 분배금은 <strong>{buyName}</strong>만 삽니다. 인컴 ETF는 더 사지 않습니다.
          </div>
        )}
        <div style={faint}>{plan.buyHint}</div>
        <div style={inlineRow}>
          <span>내 계좌에 직접 넣는 돈 (매달)</span>
          <UnitInput unit="만원" width={120} inputMode="numeric" placeholder="0" aria-label="내 계좌에 매달 직접 넣는 돈" value={contribMan} onChange={(e) => setContribMan(e.target.value)} />
          <Button size="sm" variant="secondary" onClick={() => void save({ monthlyContribution: toWon(contribMan) }, '내 계좌에 넣는 돈을 저장했습니다.')}>
            저장
          </Button>
        </div>
        <div style={faint}>증권사 계좌에 내가 직접 넣는 금액입니다. 봇 실험 계좌의 월 입금(내 계획의 &lsquo;매달 투자할 돈&rsquo;)과는 따로이고 서로 바뀌지 않습니다.</div>
        {hold ? null : growth.needByNewMoney > 0 ? (
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
            <ul className="ig-merge-list">
              {merges.map((m) => (
                <li key={`${m.from.accountLabel}-${m.from.code}`} className="ig-merge-item">
                  <div className="ig-merge-legs">
                    <span className="ig-merge-leg">
                      <span className="ig-trade-tag ig-trade-tag--sell">팔기</span>
                      <strong>{m.from.name}</strong>
                      <span className="ig-merge-qty">{m.from.shares.toLocaleString('ko-KR')}주</span>
                    </span>
                    <span className="ig-merge-arrow" aria-hidden="true">→</span>
                    <span className="ig-merge-leg">
                      <span className="ig-trade-tag ig-trade-tag--buy">사기</span>
                      <strong>{m.to.name}</strong>
                      <span className="ig-merge-qty">{m.to.shares.toLocaleString('ko-KR')}주</span>
                    </span>
                  </div>
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
                  <div className="ig-fee-grid">
                    {feeCodes.map((code) => {
                      const name = merges.find((m) => m.from.code === code)?.from.name ?? merges.find((m) => m.to.code === code)?.to.name ?? code
                      return (
                        <label key={code} className="ig-fee-item">
                          <span className="ig-fee-name" title={name}>{name}</span>
                          <UnitInput
                            unit="%"
                            width={84}
                            inputMode="decimal"
                            placeholder="0.00"
                            aria-label={`${name} 총보수`}
                            value={fees[code] ?? ''}
                            onChange={(e) => setFees((f) => ({ ...f, [code]: e.target.value }))}
                          />
                        </label>
                      )
                    })}
                  </div>
                  <div style={{ marginTop: 8 }}>
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
        <span style={stepTitle}>{hold ? '③ 현금 규칙 — 정해진 때만 사고팝니다' : '③ 파는 건 서두르지 않아도 됩니다'}</span>
        {hold ? (
          <>
            {!cash ? (
              <div style={muted}>현금 목표가 0%입니다. 가이드 설정의 &lsquo;현금성(%)&rsquo;에 목표를 넣으면 현금 규칙을 안내합니다.</div>
            ) : cash.state === 'take-profit' && cash.sellFrom ? (
              <div>
                현금이 {cash.actualPct.toFixed(1)}%로 목표 아래 {cash.bandPp.toFixed(0)}%p를 넘게 줄었습니다. <strong>{cash.sellFrom.name}</strong>{' '}
                <strong>
                  {cash.sellFrom.shares.toLocaleString('ko-KR')}주 (약 {man(cash.amount)})
                </strong>
                를 팔아 현금으로 둡니다. 지수가 오른 만큼 덜어 두는 규칙형 익절입니다.
              </div>
            ) : cash.state === 'buy-index' ? (
              <div>
                현금이 {cash.actualPct.toFixed(1)}%로 목표보다 {cash.bandPp.toFixed(0)}%p 넘게 많습니다. 넘는 <strong>{man(cash.amount)}</strong>은{' '}
                <strong>{buyName}</strong> 매수에 씁니다.
              </div>
            ) : (
              <div style={muted}>
                지금은 팔 것이 없습니다. 현금이 {Math.max(0, cash.targetPct - cash.bandPp).toFixed(0)}% 아래로 줄면{filling ? '(목표를 한 번 채운 뒤부터)' : ''} 지수 일부를
                팔아 채우고, {(cash.targetPct + cash.bandPp).toFixed(0)}% 위로 늘면 지수를 삽니다.
              </div>
            )}
            <div style={faint}>
              근거: 새 돈 먼저·목표에서 벗어날 때만 매매(가설 장부 C14). &lsquo;오르면 팔고 내리면 다시 사기&rsquo;를 반복하는 건 지수에서 효과가 없었습니다(C53).
              현금은 수익을 늘리는 장치가 아니라 하락을 버티고 살 돈입니다.
            </div>
          </>
        ) : !trim ? (
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

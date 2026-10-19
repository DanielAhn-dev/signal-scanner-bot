import React, { useRef, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import Button from '../../components/ui/Button'
import type { PlanMixLine } from '../../../../src/lib/planMixGuide'
import UnitInput from '../../components/ui/UnitInput'
import { useToast } from '../../components/ToastProvider'

/** 서버 src/lib/rebalancePlan.ts의 RebalancePlan */
export type RebalancePlan = {
  headline: string
  income: { monthlyNet: number; source: 'actual' | 'estimate'; estimateNet: number; floor: number; surplus: number }
  growth: { actualPct: number; targetPct: number; needByNewMoney: number; monthlyInflow: number; months: number | null }
  buyTarget: { code: string; name: string; accountLabel: string; price: number } | null
  buyHint: string
  /** 같은 지수 상품 비교로 정한 이유 (서버 indexProductChoice — 리포트와 같은 판정) */
  buyWhy?: string | null
  /** 계좌별 살 곳 — 분배금·매도 대금은 그 계좌 안에서 다시 산다 */
  buyTargetsByAccount?: Array<{ accountKey: string; accountLabel: string; target: { code: string; name: string; price: number }; heldCode: string; why: string | null }>
  merges: Array<{
    from: { code: string; name: string; accountLabel: string; shares: number; amount: number; realizedGain: number | null }
    to: { code: string; name: string; accountLabel: string; price: number; shares: number; amount: number }
    reason: string
    monthlyIncomeDelta: number
    taxedGain: boolean
  }>
  kinds: { before: number; after: number }
  mergeIncomeDelta: number
  /** 인컴 종목 압축 (설정에 목표 종목 수가 있을 때만) */
  compress: {
    target: number
    before: number
    after: number
    reached: boolean
    incomeAfter: number
    floor: number
    roles: Array<{
      key: string
      label: string
      keeper: { code: string; name: string } | null
      byUser: boolean
      why: string
      kept: Array<{ code: string; name: string }>
      merged: Array<{ code: string; name: string }>
    }>
    blocked: Array<{ code: string; name: string; role: string; reason: string }>
  } | null
  /** 인컴을 분배금으로만 줄여 가는 중 (가이드 설정 incomeMode 'hold') */
  hold: boolean
  /** 입력한 예수금 — 현금 목표 몫(일반 계좌부터)은 두고 넘는 몫으로 그 계좌의 지수를 산다 (hold가 아니고 예수금이 있을 때만) */
  idleCash: {
    balance: number
    cashTargetPct: number
    keep: number
    spendable: number
    spend: number
    accounts: Array<{
      accountKey: string | null
      accountLabel: string
      balance: number
      keep: number
      spendable: number
      buyTarget: { code: string; name: string; price: number } | null
      shares: number
      spend: number
    }>
  } | null
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
    cashByAccount?: Record<string, number>
    incomeMode?: 'hold'
    incomeKindsTarget?: number
    roleKeepers?: Record<string, string>
    indexOverlapMerge?: boolean
  }
  /** 설정 일부만 저장한다 (서버가 보낸 키만 고친다). 성공하면 true */
  saveSettings: (patch: Record<string, unknown>) => Promise<boolean>
  /** 예수금을 계좌별로 받을 실계좌 목록 */
  accounts: Array<{ key: string; label: string }>
  /** 요약 바로 아래에 넣을 '받은 분배금' 카드 */
  receiptsSlot?: React.ReactNode
  /** 내 계획 구성(여러 지수)이면 새 돈을 지수마다 나눈 줄 — 홈 '이번 달 할 일'과 같은 나누기(src/lib/planMixGuide.ts). 없으면 한 곳 */
  planMix?: PlanMixLine[] | null
}

const man = formatKrwMan
/** 계좌를 정하지 않은 예전 예수금 입력값 (settings.cashBalance) */
const LEGACY_CASH = '__legacy'
const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`
/** 1만원 아래는 '0만원'으로 뭉개지지 않게 원 단위 */
const wonOrMan = (v: number) => (Math.abs(v) < 10_000 ? won(v) : man(v))

/**
 * 합치기는 같은 지수·같은 종류끼리라 지금 바꾸든 나중에 바꾸든 손익 흐름은 거의 같다 — 서두를 필요가 없다.
 * 예외: 일반 계좌의 해외 기초 ETF는 차익에 15.4% 과세라, 손익이 0 이하인 지금 옮기면 세금이 없다.
 */
function MergeTiming({ taxedGain, gain }: { taxedGain: boolean; gain: number | null }) {
  if (gain == null) return null
  if (taxedGain && gain <= 0) {
    return <div className="ig-merge-timing ig-merge-timing--now">지금 옮기면 세금 없음 · 오른 뒤에 옮기면 차익의 15.4%가 세금</div>
  }
  if (gain < 0) {
    return <div className="ig-merge-timing">지금은 손실 구간 · 서두르지 않고 오를 때 옮겨도 됩니다</div>
  }
  return null
}

const signedMan =(v: number) => (Math.abs(v) < 5_000 ? '거의 그대로' : `${v > 0 ? '+' : '−'}${man(Math.abs(v))}`)

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
export default function PlanSteps({ plan, settings, saveSettings, accounts, receiptsSlot, planMix }: Props) {
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  // 결과는 토스트로 — 저장하면 설정이 바뀌어 이 컴포넌트가 새로 마운트되므로(key=settings) 안의 상태 메시지는 사라진다
  const toast = useToast()
  const [contribMan, setContribMan] = useState(settings.monthlyContribution ? String(Math.round(settings.monthlyContribution / 10_000)) : '')
  // 예수금은 증권사 앱에 보이는 그대로 원 단위로 받는다(만원 칸에 원 금액을 넣어 1만 배로 저장된 일이 있었다)
  // 계좌별로 받는다 — 분배금·매도 대금이 그 계좌로 들어오고 다시 사는 것도 그 계좌 안에서다. LEGACY_CASH는 계좌를 정하지 않은 예전 입력값
  const [cashWon, setCashWon] = useState<Record<string, string>>(() => {
    const fmt = (v: number) => (v > 0 ? Math.round(v).toLocaleString('ko-KR') : '')
    const init: Record<string, string> = Object.fromEntries(accounts.map((a) => [a.key, fmt(settings.cashByAccount?.[a.key] ?? 0)]))
    if (settings.cashBalance) init[LEGACY_CASH] = fmt(settings.cashBalance)
    return init
  })
  const digitsOf = (v: string | undefined) => (v ?? '').replace(/[^\d]/g, '')
  const cashTotal = Object.values(cashWon).reduce((s, v) => s + Number(digitsOf(v) || 0), 0)
  const [fees, setFees] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(settings.feePctByCode ?? {}).map(([k, v]) => [k, String(v)])),
  )
  const [showOrders, setShowOrders] = useState(false)
  const [kindsTarget, setKindsTarget] = useState(settings.incomeKindsTarget ? String(settings.incomeKindsTarget) : '')

  const save = async (patch: Record<string, unknown>, done: string) => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    const ok = await saveSettings(patch)
    savingRef.current = false
    setSaving(false)
    toast.show(ok ? done : '저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.', ok ? 3500 : 6000)
  }
  const toWon = (v: string) => (v.trim() === '' ? '' : Number(v) * 10_000)

  const { income, growth, merges, trim, buyTarget, hold, cash, idleCash } = plan
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
        <div style={{ marginTop: 6 }}>
          <span>증권 계좌 예수금</span> <span style={faint}>증권사 앱의 &lsquo;D+2 예수금&rsquo;을 계좌마다 원 단위로. 분배금이 들어온 직후에 적으면 가장 정확합니다. 보유 화면에서 매수·매도를 기록하면 그 계좌 예수금에서 자동으로 빼고 더합니다.</span>
          {[...accounts.map((a) => ({ key: a.key, label: a.label })), ...(LEGACY_CASH in cashWon ? [{ key: LEGACY_CASH, label: '계좌 미지정 (예전 입력)' }] : [])].map((a) => (
            <div key={a.key} style={{ ...inlineRow, marginTop: 4 }}>
              <span style={{ minWidth: 140 }}>{a.label}</span>
              <UnitInput
                unit="원"
                width={150}
                inputMode="numeric"
                placeholder="0"
                aria-label={`${a.label} 예수금(원)`}
                value={cashWon[a.key] ?? ''}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, '')
                  setCashWon((cur) => ({ ...cur, [a.key]: digits ? Number(digits).toLocaleString('ko-KR') : '' }))
                }}
              />
            </div>
          ))}
          <div style={{ ...inlineRow, marginTop: 4 }}>
            <Button
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                const cashByAccount = Object.fromEntries(accounts.map((a) => [a.key, digitsOf(cashWon[a.key]) === '' ? '' : Number(digitsOf(cashWon[a.key]))]))
                const patch: Record<string, unknown> = { cashByAccount }
                if (LEGACY_CASH in cashWon) patch.cashBalance = digitsOf(cashWon[LEGACY_CASH]) === '' ? '' : Number(digitsOf(cashWon[LEGACY_CASH]))
                void save(patch, `예수금 합계 ${cashTotal > 0 ? man(cashTotal) : '0원'}을 계좌별로 넣어 다시 계산했습니다.`)
              }}
            >
              {saving ? '반영 중…' : '반영'}
            </Button>
            {cashTotal > 0 && <span style={faint}>합계 약 {man(cashTotal)}</span>}
          </div>
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
        <span style={stepTitle}>{filling ? '① 분배금·새 돈은 현금으로 (목표까지)' : planMix ? '① 새 돈은 내 계획 구성대로' : '① 새 돈은 한 곳으로'}</span>
        {planMix && !filling && (
          <div style={{ marginBottom: 6 }}>
            매달 넣는 돈은 모아가기에서 정한 구성대로 나눠 넣습니다 — 홈 &lsquo;이번 달 할 일&rsquo;과 같은 비율입니다.
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {planMix.map((l) => (
                <li key={l.index}>
                  {l.label} {l.weightPct}% · 매달 {man(l.monthly)} → <strong>{l.product ? l.product.name : '모아가기 1번 추천 상품'}</strong>
                  {l.accountLabel ? ` · ${l.accountLabel}에서` : ''}
                </li>
              ))}
            </ul>
            <div style={faint}>분배금·예수금은 그 계좌 안에서 아래 안내대로 삽니다. 구성은 모아가기 1번에서 바꿉니다.</div>
          </div>
        )}
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
        {idleCash && (
          <div style={{ marginTop: 6 }}>
            예수금 {wonOrMan(idleCash.balance)}
            {idleCash.keep > 0 ? ` 중 현금 목표 ${idleCash.cashTargetPct.toFixed(0)}% 몫 ${wonOrMan(idleCash.keep)}은 일반 계좌부터 남기고,` : ''} 나머지는 그 계좌에서 바로 삽니다.
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {idleCash.accounts.map((a) => (
                <li key={a.accountKey ?? LEGACY_CASH}>
                  {a.accountLabel}:{' '}
                  {a.spendable <= 0 ? (
                    <>{wonOrMan(a.balance)} — 현금 목표 몫이라 그대로 둡니다</>
                  ) : a.buyTarget && a.shares > 0 ? (
                    <>
                      {a.keep > 0 ? `${wonOrMan(a.keep)}은 두고 ` : ''}
                      <strong>
                        {a.buyTarget.name} {a.shares.toLocaleString('ko-KR')}주 (약 {wonOrMan(a.spend)})
                      </strong>
                    </>
                  ) : a.buyTarget ? (
                    <>
                      {wonOrMan(a.spendable)} — {a.buyTarget.name} 1주 값({won(a.buyTarget.price)})보다 작아 다음 분배금·새 돈과 합쳐서
                    </>
                  ) : (
                    <>{wonOrMan(a.spendable)} — 이 계좌에 지수 ETF가 없습니다. 아래 안내대로 하나 정해 삽니다</>
                  )}
                </li>
              ))}
            </ul>
            <div style={faint}>판 대금이 있으면 같은 계좌 예수금과 합쳐 한 번에 삽니다(리포트). 산 뒤에는 위 예수금 칸을 남은 금액으로 고쳐 주세요.</div>
          </div>
        )}
        <div style={faint}>{plan.buyHint}</div>
        {plan.buyWhy && <div style={faint}>{plan.buyWhy}</div>}
        {/* 계좌마다 살 곳이 다르면 나눠 보여 준다 — 분배금은 그 계좌 안에서만 다시 산다 */}
        {(plan.buyTargetsByAccount?.length ?? 0) > 1 && new Set(plan.buyTargetsByAccount!.map((a) => a.target.code)).size > 1 && (
          <ul style={{ ...faint, margin: '4px 0 0', paddingLeft: 18 }}>
            {plan.buyTargetsByAccount!.map((a) => (
              <li key={a.accountKey}>
                {a.accountLabel}: <strong>{a.target.name}</strong>
                {a.target.code !== a.heldCode ? ' (새 돈만, 가진 상품은 그대로)' : ''}
              </li>
            ))}
          </ul>
        )}
        <div style={inlineRow}>
          <span>내 계좌에 직접 넣는 돈 (매달)</span>
          <UnitInput unit="만원" width={120} inputMode="numeric" placeholder="0" aria-label="내 계좌에 매달 직접 넣는 돈" value={contribMan} onChange={(e) => setContribMan(e.target.value)} />
          <Button size="sm" variant="secondary" onClick={() => void save({ monthlyContribution: toWon(contribMan) }, '내 계좌에 넣는 돈을 저장했습니다.')}>
            저장
          </Button>
        </div>
        <div style={faint}>증권사 계좌에 내가 직접 넣는 금액입니다. [가상] 가상 계좌(봇)의 월 입금(내 계획의 &lsquo;매달 투자할 돈&rsquo;)과는 따로이고 서로 바뀌지 않습니다.</div>
        {hold ? null : growth.needByNewMoney > 0 ? (
          <div style={{ marginTop: 6 }}>
            {idleCash && idleCash.spend > 0 ? '예수금으로 산 뒤에도 ' : ''}새 돈만으로 목표 {growth.targetPct.toFixed(0)}%까지 약 <strong>{man(growth.needByNewMoney)}</strong>
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
              정리할 때 어디로 옮길지 정해 둔 목록입니다. 같은 지수·같은 종류끼리라 지금 바꾸든 오른 뒤에 바꾸든 손익 흐름은 거의 같아 급하지 않습니다.
              옮길 때는 같은 계좌 안에서 팔고 바로 삽니다. 월 인컴 변화 <strong>{signedMan(plan.mergeIncomeDelta)}</strong> · ETF는 팔 때 거래세가 없습니다.
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
                  <MergeTiming taxedGain={m.taxedGain} gain={m.from.realizedGain} />
                  <div style={faint}>
                    {m.reason}
                    {m.taxedGain ? ' · 일반 계좌의 해외 기초 ETF라 매매차익에 15.4% 과세' : ''}
                    {m.from.realizedGain != null ? ` · 확정 손익 ${m.from.realizedGain >= 0 ? '+' : '−'}${wonOrMan(Math.abs(m.from.realizedGain))}` : ''}
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
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--color-border-default)' }}>
          <strong style={{ fontSize: 13 }}>인컴 종목을 더 줄이기</strong>
          <div style={faint}>
            남기고 싶은 인컴 종목 수를 적으면 한국·해외 × 고배당·커버드콜·리츠 역할마다 대표 하나로 합칩니다. 월 인컴이 하한({man(income.floor)}) 아래로 내려가거나,
            같은 계좌에 대표가 없으면 합치지 않습니다. 합치기 목록과 리포트(문서 만들기)에 함께 나옵니다.
          </div>
          <div style={inlineRow}>
            <UnitInput unit="종" width={72} inputMode="numeric" placeholder="6" aria-label="남길 인컴 종목 수" value={kindsTarget} onChange={(e) => setKindsTarget(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={() => void save({ incomeKindsTarget: kindsTarget.trim() }, kindsTarget.trim() ? '목표 종목 수를 저장했습니다.' : '종목 수 목표를 지웠습니다.')}>
              저장
            </Button>
          </div>
          <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 13 }}>같은 지수 ETF 겹침도 합치기</strong>
            <div style={faint}>
              KODEX 200·TIGER 200·200TR처럼 운용사만 다른 같은 지수 ETF를 한 종목으로 합칩니다. 같은 계좌 안에서만 옮기고, 일반 계좌는 분배금 과세를 미루는 TR형을 남깁니다.
              국내 지수 ETF는 팔 때 거래세·매매차익 과세가 없고 같은 날 팔고 사면 시장 노출은 그대로입니다. 수익 구간은 지금, 손실 구간은 평단 회복 시로 안내합니다.
            </div>
            <div style={inlineRow}>
              <Button
                size="sm"
                variant={settings.indexOverlapMerge ? 'secondary' : 'primary'}
                onClick={() => void save({ indexOverlapMerge: settings.indexOverlapMerge ? '' : true }, settings.indexOverlapMerge ? '같은 지수 겹침 합치기를 껐습니다.' : '같은 지수 겹침도 합치도록 바꿨습니다.')}
              >
                {settings.indexOverlapMerge ? '끄기' : '켜기'}
              </Button>
              {settings.indexOverlapMerge && <span style={faint}>켜져 있음</span>}
            </div>
          </div>
          {plan.compress && (
            <div style={{ marginTop: 8 }}>
              <div>
                인컴 종목 <strong>{plan.compress.before}종 → {plan.compress.after}종</strong> (목표 {plan.compress.target}종{plan.compress.reached ? '' : ' · 목표까지는 못 줄임'}) · 압축 뒤 월 인컴{' '}
                <strong>{man(plan.compress.incomeAfter)}</strong>
              </div>
              <ul className="ig-merge-list">
                {plan.compress.roles.map((r) => {
                  const options = [...r.kept, ...r.merged]
                  return (
                    <li key={r.key} className="ig-merge-item">
                      <div className="ig-merge-legs">
                        <strong>{r.label}</strong>
                        <span style={muted}>대표</span>
                        {options.length > 1 ? (
                          <select
                            aria-label={`${r.label} 대표 종목`}
                            value={r.keeper?.code ?? ''}
                            onChange={(e) => void save({ roleKeepers: { [r.key]: e.target.value } }, '대표 종목을 바꿨습니다.')}
                            style={{ fontSize: 13, maxWidth: '100%' }}
                          >
                            {options.map((o) => (
                              <option key={o.code} value={o.code}>{o.name}</option>
                            ))}
                          </select>
                        ) : (
                          <strong>{r.keeper?.name ?? '-'}</strong>
                        )}
                      </div>
                      <div style={faint}>
                        {r.merged.length > 0 ? `합쳐짐: ${r.merged.map((m) => m.name).join(', ')}` : '합칠 종목 없음'}
                        {r.byUser ? ' · 직접 고른 대표' : r.why ? ` · ${r.why}` : ''}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {plan.compress.blocked.length > 0 && (
                <ul style={{ ...faint, margin: '4px 0 0', paddingLeft: 18 }}>
                  {plan.compress.blocked.map((b) => (
                    <li key={`${b.role}-${b.code}`}>{b.name}: {b.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
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

    </>
  )
}

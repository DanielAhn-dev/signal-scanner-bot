import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import More from '../../components/ui/More'
import { apiFetch } from '../../lib/api'
import { recommendOverseas } from '../../lib/accumulate'
import type { IndexEtfCandidatesView } from '../../lib/indexEtfCandidates'
import {
  BEGINNER_PRESET_KEY,
  MIX_INDEX_LABEL,
  PLAN_MIX_PRESETS,
  isKospiOnly,
  mixLabel,
  mixStats,
  presetCompareWindow,
  presetEntries,
  presetKeyOf,
  sameMix,
  type MixEntry,
} from '../../lib/planMix'

const ymText = (ym: string) => `${ym.slice(0, 4)}-${ym.slice(4)}`
const times = (v: number) => `${v.toFixed(1)}배`

/** 계좌 안내 — 세법상 일반론. 효과 크기는 가설 H18(자산 위치)로 아직 측정 전이라 규칙으로 강제하지 않는다 */
const ACCOUNT_HINT: Record<MixEntry['index'], string> = {
  kospi200: '일반 계좌도 괜찮습니다. 국내 주식형 ETF는 사고팔아 생긴 차익에 세금이 없고, 분배금에만 15.4%가 붙습니다.',
  sp500: 'ISA·연금저축·IRP를 먼저 생각해 보세요. 일반 계좌에서는 팔아서 생긴 차익과 분배금 모두 15.4% 과세라, 세금을 미루거나 줄여 주는 계좌가 유리할 수 있습니다.',
  nasdaq100: 'S&P500과 같습니다 — ISA·연금저축·IRP가 세금 면에서 유리할 수 있습니다.',
}

type Props = {
  /** 서버에 저장된 구성 (정하지 않았으면 null) */
  saved: MixEntry[] | null
  /** 화면에서 고르는 중인 구성 — 저장 전에도 아래 2·3번 계산에 쓴다 */
  draft: MixEntry[]
  onDraft: (mix: MixEntry[]) => void
  etfView: IndexEtfCandidatesView
  /** 코스피200 상품 고르기(키우기/분배금·추천·직접 지정)는 원래 화면 그대로 받는다 */
  kospiSlot: ReactNode
  /** 저장 성공 뒤 서버가 돌려준 계획 */
  onSaved: (data: any) => void
}

/**
 * 모아가기 1번 — ① 어디에 나눠 모을까(구성) → ② 지수마다 상품 → ③ 어느 계좌에 (docs/plan-screen-map-2026-10-19.md 5절).
 * 순위·"최선의 조합"을 보여 주지 않는다. 프리셋은 같은 기간으로 맞춘 결과 범위·낙폭을 함께 보여 준다.
 */
export default function MixPicker({ saved, draft, onDraft, etfView, kospiSlot, onSaved }: Props) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const span = useMemo(() => presetCompareWindow(), [])
  const stats = useMemo(() => PLAN_MIX_PRESETS.map((p) => ({ key: p.key, s: mixStats(presetEntries(p), span) })), [span])
  const kospiLong = useMemo(() => mixStats(presetEntries(PLAN_MIX_PRESETS[0]), { until: span.until }), [span])
  const draftKey = presetKeyOf(draft)
  const savedKey = saved ? presetKeyOf(saved) : null
  const dirty = !sameMix(draft, saved ?? presetEntries(PLAN_MIX_PRESETS[0]))
  const custom = draftKey == null

  const setProduct = (index: MixEntry['index'], product: MixEntry['product']) =>
    onDraft(draft.map((e) => (e.index === index ? { ...e, product } : e)))

  const save = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setStatus(null)
    try {
      const res = await apiFetch('/api/ui/investment-prefs', { method: 'POST', cacheMs: 0, timeoutMs: 15_000, body: JSON.stringify({ plan: { mix: draft } }) })
      if (res?.error) throw new Error(String(res.error))
      // 저장이 성공한 뒤에만 바꾼다
      onSaved(res?.data)
      setStatus(`내 계획 구성을 '${mixLabel(draft)}'(으)로 정했어요`)
    } catch (e) {
      setStatus(`정하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <h3>① 어디에 나눠 모을까</h3>
      {!saved && <p className="acc-note">아직 구성을 정하지 않았어요. 지금은 <strong>국내만</strong>으로 계산합니다. 무엇을 고를지 모르겠다면 &lsquo;처음이면 이걸로&rsquo;부터 시작하세요.</p>}
      <div className="acc-presets" role="radiogroup" aria-label="구성">
        {PLAN_MIX_PRESETS.map((p) => {
          const s = stats.find((x) => x.key === p.key)?.s
          const active = draftKey === p.key
          return (
            <button key={p.key} type="button" role="radio" aria-checked={active} className={`acc-preset${active ? ' is-active' : ''}`} onClick={() => onDraft(presetEntries(p, draft))}>
              <span className="acc-pick-head">
                <strong>{p.label}</strong>
                {p.key === BEGINNER_PRESET_KEY && <span className="acc-badge">처음이면 이걸로</span>}
                {saved && savedKey === p.key && <span className="acc-badge acc-badge-user">내 계획</span>}
              </span>
              <span className="acc-preset-mix">{mixLabel(presetEntries(p))}</span>
              {s && <span className="acc-preset-stat">{s.years}년 매달 넣었다면 넣은 돈의 보통 {times(s.typical)} · 운 나쁨 {times(s.low)} · 최대 낙폭 {s.mddPct.toFixed(0)}%</span>}
            </button>
          )
        })}
        {custom && (
          <div className="acc-preset is-active" role="radio" aria-checked>
            <span className="acc-pick-head"><strong>직접 정한 구성</strong>{saved && savedKey == null && <span className="acc-badge acc-badge-user">내 계획</span>}</span>
            <span className="acc-preset-mix">{mixLabel(draft)}</span>
          </div>
        )}
        <button type="button" className="acc-preset acc-preset--link" onClick={() => navigate('/plan-sim')}>
          <strong>직접 정하기</strong>
          <span className="acc-preset-mix">시뮬레이터에서 비중을 바꿔 보고 정합니다</span>
        </button>
      </div>
      <p className="acc-note">
        세 구성 모두 같은 기간({ymText(span.since)}~{ymText(span.until)}, 원화 환산·분배금 반영, 매달 비중 맞춤)으로 계산한 과거 결과입니다. 순위가 아니고 앞으로를 약속하지 않습니다.
        &lsquo;처음이면 이걸로&rsquo;는 과거 수익이 높아서가 아니라 <strong>한 나라에 몰지 않으려고</strong> 고른 것입니다.
      </p>
      <More>
        <ul className="acc-limits">
          <li>이 기간에는 2008년 금융위기가 없습니다.{kospiLong ? ` 국내만은 ${kospiLong.fromYear}년부터 보면 최대 낙폭이 ${kospiLong.mddPct.toFixed(0)}%였습니다.` : ''}</li>
          <li>이 기간은 미국 주식, 특히 기술주(나스닥100)가 유난히 강했던 구간입니다. 해외 비중이 클수록 좋게 나오지만, 앞으로도 그렇다는 근거는 아닙니다.</li>
          <li>해외지수는 원화로 바꾼 가격이라 환율 효과가 섞여 있습니다. 원화가 강해지면 같은 지수 상승에도 덜 오릅니다.</li>
          <li>나스닥100만 담는 구성은 넣지 않았습니다 — 이력이 가장 좋았던 14년뿐이고 한 업종에 몰립니다. 원하면 시뮬레이터에서 직접 정할 수 있습니다.</li>
        </ul>
      </More>

      <h3>② 지수마다 상품</h3>
      <p className="acc-note">같은 지수를 따라가는 상품은 과거 수익률이 거의 같아서, 수익률 순위가 아니라 규모·거래대금·보수로 골랐습니다.</p>
      {draft.map((e) => {
        const head = <p className="acc-mix-index"><strong>{MIX_INDEX_LABEL[e.index]}</strong> {Math.round(e.weight * 100)}%</p>
        if (e.index === 'kospi200') return <div key={e.index} className="acc-mix-slot">{!isKospiOnly(draft) && head}{kospiSlot}</div>
        const rec = recommendOverseas(e.index, etfView.overseas, etfView.asOf)
        const chosen = e.product ? rec.eligible.find((c) => c.code === e.product!.code) ?? null : null
        const shown = chosen ?? rec.pick
        return (
          <div key={e.index} className="acc-mix-slot">
            {head}
            {shown ? (
              <div className="acc-pick">
                <div className="acc-pick-head">
                  <span className={`acc-badge${chosen && chosen !== rec.pick ? ' acc-badge-user' : ''}`}>{chosen && chosen !== rec.pick ? '내가 고름' : '추천'}</span>
                  <strong>{shown.name}</strong><span className="acc-code">{shown.code}</span>
                </div>
                {shown === rec.pick && <ul>{rec.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
                <label className="acc-field">
                  <span>같은 지수의 다른 후보</span>
                  <select value={shown.code} onChange={(ev) => {
                    const c = rec.eligible.find((x) => x.code === ev.target.value)
                    setProduct(e.index, !c || c === rec.pick ? null : { code: c.code, name: c.name })
                  }}>
                    {rec.eligible.map((c) => <option key={c.code} value={c.code}>{c.name} · 보수 {c.feePct}% · 순자산 {(c.marketCapEok / 10_000).toFixed(1)}조{c === rec.pick ? ' (추천)' : ''}</option>)}
                  </select>
                </label>
              </div>
            ) : <p className="acc-warn">기준(순자산 1조·일 거래대금 50억·상장 3년)을 넘는 상품이 없습니다.</p>}
            {e.product && !chosen && <p className="acc-warn">전에 고른 {e.product.name}이(가) 지금 기준을 넘지 못해 추천 상품을 보여 줍니다.</p>}
          </div>
        )
      })}
      <p className="acc-note">보수·순자산 기준일 {etfView.asOf}{etfView.live ? ' · 일 거래대금은 최근 20거래일 평균' : ''}</p>

      <h3>③ 어느 계좌에</h3>
      <ul className="acc-limits">
        {draft.map((e) => <li key={e.index}><strong>{MIX_INDEX_LABEL[e.index]}</strong>: {ACCOUNT_HINT[e.index]}</li>)}
      </ul>
      <p className="acc-note">ISA·연금 계좌는 한도와 인출 조건이 있으니 먼저 확인하세요.</p>
      <More label="계좌 배치 자세히"><p className="acc-note">계좌에 따라 얼마나 차이가 나는지는 아직 측정하지 않았습니다(가설 H18). 홈 &lsquo;이번 달 할 일&rsquo;에서 지수마다 산 계좌를 고르면 다음 달부터 그 계좌로 안내합니다.</p></More>

      {(dirty || status) && (
        <div className="acc-summary">
          {dirty && (
            <>
              <p><strong>{mixLabel(draft)}</strong>{saved ? '(으)로 내 계획 구성을 바꿀까요?' : '을(를) 내 계획 구성으로 정할까요?'} 아래 2·3번 계산은 벌써 이 구성으로 보여 드리고 있어요.</p>
              <More label="정하면 무엇이 바뀌나"><p className="acc-note">홈 &lsquo;이번 달 할 일&rsquo;이 지수마다 한 줄씩(계획 금액 × 비중) 안내하고, 리밸런싱 가이드의 해외 비중 목표도 이 구성을 따릅니다. 가상 계좌는 아직 코스피200만 삽니다(규칙 변경은 11/23 판정 뒤).</p></More>
              <button type="button" className="acc-primary" disabled={saving} onClick={save}>{saving ? '정하는 중…' : '이 구성을 내 계획으로 정하기'}</button>
            </>
          )}
          {status && <p className="acc-note" role="status">{status}</p>}
        </div>
      )}
    </>
  )
}

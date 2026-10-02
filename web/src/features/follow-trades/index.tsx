import { useCallback, useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useCurrentClientId } from '../../stores/profileStore'
import { buildFollowMemo, parseFollowMemo, type FollowComparison, type FollowTrade } from '../../../../src/services/followReport'
import './follow-trades.css'

type Report = { windowDays: number; bot: FollowTrade[]; real: FollowTrade[]; prices: Record<string, number>; comparison: FollowComparison; generatedAt: string }

// 실계좌 체결은 기존 거래 입력(/api/ui/virtual-trade)에 이 계좌 이름으로 남긴다. 봇 가상 계좌와 섞이지 않는다.
const REAL_BROKER = '직접 입력'
const REAL_ACCOUNT = '실계좌'

const won = (v: number) => `${v < 0 ? '-' : ''}${Math.abs(Math.round(v)).toLocaleString('ko-KR')}원`
const signedWon = (v: number) => `${v > 0 ? '+' : ''}${won(v)}`
const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)
const day = (iso: string) => iso.slice(5, 10).replace('-', '/')

/** 결산 한 줄 — 가격 차이와 선택 차이를 나눠서 말한다 */
export function buildHeadlines(c: FollowComparison): string[] {
  const lines: string[] = []
  if (c.followedTradeCount === 0 && c.ownTradeCount === 0) return lines
  if (c.followedTradeCount > 0) {
    lines.push(
      c.priceEffect < 0
        ? `봇 가격으로 체결했다면 ${won(-c.priceEffect)} 더 벌었을 거예요. 체결가 차이로 그만큼 손해를 봤습니다.`
        : c.priceEffect > 0
          ? `봇보다 유리하게 체결해서 ${won(c.priceEffect)} 이득을 봤어요.`
          : '봇 가격과 거의 같은 가격에 체결했어요.',
    )
  }
  if (c.followed.chunks > 0 && c.own.chunks > 0 && c.followed.returnPct != null && c.own.returnPct != null) {
    const diff = c.followed.returnPct - c.own.returnPct
    lines.push(
      diff > 0
        ? `봇 신호를 따라 한 거래(${pct(c.followed.returnPct)})가 내 맘대로 한 거래(${pct(c.own.returnPct)})보다 ${diff.toFixed(1)}%p 좋았어요.`
        : diff < 0
          ? `이번엔 내 맘대로 한 거래(${pct(c.own.returnPct)})가 봇을 따라 한 거래(${pct(c.followed.returnPct)})보다 ${(-diff).toFixed(1)}%p 좋았어요. 표본이 적으면 운일 수 있어요.`
          : '따라 한 거래와 내 맘대로 한 거래의 수익률이 같아요.',
    )
  } else if (c.own.chunks > 0 && c.followedTradeCount === 0) {
    lines.push('아직 봇을 따라 한 거래가 없어요. 따라 하면 봇 가격과 비교해 볼 수 있어요.')
  }
  if (c.missed.length > 0 && c.missedAvgReturnPct != null) {
    lines.push(`따라 하지 않은 봇 매수 ${c.missed.length}건은 지금까지 평균 ${pct(c.missedAvgReturnPct)}입니다.`)
  }
  return lines
}

export default function FollowTradesPage() {
  const clientId = useCurrentClientId()
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/ui/follow-report', { cacheMs: 0, timeoutMs: 20_000, retries: 0 })
      setReport(res?.data ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (clientId) void load(); else setLoading(false) }, [clientId, load])

  const followedBy = new Map<string, FollowTrade>()
  for (const t of report?.real ?? []) { const id = parseFollowMemo(t.memo); if (id) followedBy.set(id, t) }

  const openForm = (t: FollowTrade) => { setOpenId(String(t.id)); setPrice(String(t.price)); setQty(String(t.quantity)); setNotice('') }

  const submit = async (t: FollowTrade) => {
    const p = Number(price)
    const q = Number(qty)
    if (!(p > 0) || !Number.isInteger(q) || q <= 0) { setNotice('체결가와 수량(1주 이상의 정수)을 확인해 주세요.'); return }
    setBusy(true)
    setNotice('')
    try {
      const res = await apiFetch('/api/ui/virtual-trade', {
        method: 'POST', cacheMs: 0, timeoutMs: 15_000,
        body: JSON.stringify({ code: t.code, side: t.side, quantity: q, price: p, broker_name: REAL_BROKER, account_name: REAL_ACCOUNT, memo: buildFollowMemo(t.id) }),
      })
      if (res?.error) throw new Error(String(res.error))
      setOpenId(null)
      await load()
    } catch (e) {
      setNotice(`저장 실패: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const c = report?.comparison
  const headlines = c ? buildHeadlines(c) : []

  return (
    <main className="follow-page">
      <header>
        <h1>따라 사기</h1>
        <p>봇이 사고판 뒤 내 증권 앱에서 비슷한 가격에 체결했다면 여기에 기록하세요. 실제 주문은 내지 않고 기록만 합니다.</p>
      </header>

      {loading && <p className="follow-muted">불러오는 중입니다.</p>}
      {error && <p className="follow-bad" role="alert">불러오기 실패: {error}</p>}

      {report && <>
        <section aria-label="봇의 최근 거래">
          <h2>봇의 최근 거래 <small>최근 {report.windowDays}일</small></h2>
          {report.bot.length === 0 ? <p className="follow-muted">봇이 한 거래가 아직 없습니다.</p> : <ul className="follow-list">
            {report.bot.slice(0, 20).map((t) => {
              const mine = followedBy.get(String(t.id))
              const open = openId === String(t.id)
              return <li key={String(t.id)}>
                <div className="follow-row">
                  <span className="follow-date">{day(t.tradedAt)}</span>
                  <strong>{t.name ?? t.code}</strong>
                  <span className={t.side === 'BUY' ? 'follow-buy' : 'follow-sell'}>{t.side === 'BUY' ? '매수' : '매도'}</span>
                  <span>{t.quantity.toLocaleString('ko-KR')}주 · 봇 {won(t.price)}</span>
                  {mine
                    ? <span className="follow-done">내 체결 {won(mine.price)} · {mine.quantity}주</span>
                    : <button type="button" className="follow-btn" onClick={() => (open ? setOpenId(null) : openForm(t))}>{open ? '닫기' : '따라 했어요'}</button>}
                </div>
                {open && !mine && <div className="follow-form">
                  <label>내 체결가 <input type="number" inputMode="numeric" min="1" value={price} onChange={(e) => setPrice(e.target.value)} /> 원</label>
                  <label>수량 <input type="number" inputMode="numeric" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /> 주</label>
                  <button type="button" className="follow-btn is-primary" disabled={busy} onClick={() => void submit(t)}>{busy ? '저장 중' : '기록하기'}</button>
                  <small>봇의 가격·수량이 미리 채워져 있어요. 실제 체결 내용으로 고쳐 주세요.</small>
                  {notice && <p className="follow-bad" role="alert">{notice}</p>}
                </div>}
              </li>
            })}
          </ul>}
        </section>

        {c && <section className="follow-print" aria-label="결산">
          <div className="follow-report-head">
            <h2>따라 샀어요 결산 <small>{report.generatedAt.slice(0, 10)} 기준</small></h2>
            <button type="button" className="follow-btn no-print" onClick={() => window.print()}><Printer size={14} /> PDF로 저장</button>
          </div>
          {headlines.length === 0 ? <p className="follow-muted">실계좌 체결을 기록하면 봇 가격과 비교한 결산이 여기에 나옵니다.</p> : <>
            <ul className="follow-headlines">{headlines.map((h) => <li key={h}>{h}</li>)}</ul>
            <dl className="follow-cards">
              <div><dt>내 실제 손익</dt><dd>{signedWon(c.actualPnl)}</dd></div>
              <div><dt>봇 가격이었다면</dt><dd>{signedWon(c.botPricePnl)}</dd></div>
              <div><dt>체결가 차이 효과</dt><dd className={c.priceEffect < 0 ? 'follow-bad' : ''}>{signedWon(c.priceEffect)}</dd></div>
            </dl>
            <table className="follow-table">
              <caption>따라 한 거래 vs 내 맘대로 한 거래</caption>
              <thead><tr><th scope="col">구분</th><th scope="col">건수</th><th scope="col">투입</th><th scope="col">손익</th><th scope="col">수익률</th></tr></thead>
              <tbody>
                <tr><th scope="row">봇 따라 함</th><td>{c.followed.chunks}</td><td>{won(c.followed.invested)}</td><td>{signedWon(c.followed.actualPnl)}</td><td>{pct(c.followed.returnPct)}</td></tr>
                <tr><th scope="row">내 맘대로</th><td>{c.own.chunks}</td><td>{won(c.own.invested)}</td><td>{signedWon(c.own.actualPnl)}</td><td>{pct(c.own.returnPct)}</td></tr>
              </tbody>
            </table>
            {c.slippage.length > 0 && <table className="follow-table">
              <caption>체결가 차이 (봇 가격 대비)</caption>
              <thead><tr><th scope="col">종목</th><th scope="col">구분</th><th scope="col">봇 가격</th><th scope="col">내 체결</th><th scope="col">차이</th></tr></thead>
              <tbody>{c.slippage.map((s) => <tr key={String(s.tradeId)}><th scope="row">{s.name ?? s.code}</th><td>{s.side === 'BUY' ? '매수' : '매도'}</td><td>{won(s.botPrice)}</td><td>{won(s.fillPrice)}</td><td className={s.costAmount > 0 ? 'follow-bad' : ''}>{s.costAmount > 0 ? `${won(s.costAmount)} 손해` : s.costAmount < 0 ? `${won(-s.costAmount)} 이득` : '같음'}</td></tr>)}</tbody>
            </table>}
            {c.missed.length > 0 && <table className="follow-table">
              <caption>따라 하지 않은 봇 매수</caption>
              <thead><tr><th scope="col">종목</th><th scope="col">봇 가격</th><th scope="col">현재가</th><th scope="col">등락</th></tr></thead>
              <tbody>{c.missed.slice(0, 10).map((m) => <tr key={String(m.botTradeId)}><th scope="row">{m.name ?? m.code}</th><td>{won(m.botPrice)}</td><td>{m.currentPrice ? won(m.currentPrice) : '—'}</td><td>{pct(m.returnPct)}</td></tr>)}</tbody>
            </table>}
            {c.unpriced > 0 && <p className="follow-muted">현재가를 못 찾은 보유 {c.unpriced}건은 평가에서 뺐어요.</p>}
          </>}
          <p className="follow-muted">체결 단가 기준이며 수수료·세금은 제외했습니다. 지난 결과는 앞으로를 보장하지 않으며 투자 권유가 아닙니다.</p>
        </section>}
      </>}
    </main>
  )
}

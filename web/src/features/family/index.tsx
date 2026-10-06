import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { buildCoupleLink, clearStashedCouple, readStashedCouple } from '../../lib/inviteStash'
import { allowance, approxAge, sanitizeChildState } from '../../lib/childGift'
import { evaluateFlowCheck, type FlowCheckInput } from '../../../../src/lib/moneyFlow'
import '../accumulate/accumulate.css'
import './family.css'

type Scope = 'spending' | 'investing' | 'children' | 'plan'
type Shares = Record<Scope, boolean>
type Investing = { seed: number; total: number; cash: number; holdings: number; monthlyDeposit: number | null; principal: number | null } | null
type View =
  | { status: 'none'; ttlDays: number }
  | { status: 'pending'; code: string; expiresAt: string; ttlDays: number }
  | { status: 'active'; since: string; myShares: Shares; partnerShares: Shares; partner: { nickname: string | null; investing?: Investing; children?: unknown; check?: { date: string; input: FlowCheckInput } | null } }

const krw = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const kstToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const kstDate = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const SCOPES: Array<{ key: Scope; label: string; desc: string }> = [
  { key: 'spending', label: '지출', desc: '돈 흐름에 적은 지출 기록. 서로 고치거나 지울 수 있고, 누가 했는지 표시되며 지운 기록은 되돌릴 수 있습니다.' },
  { key: 'plan', label: '지금 상태 점검', desc: '가장 최근 점검 결과(투자 가능액·못 줄이는 생활비·고정지출 비율). 배우자는 보기만 합니다.' },
  { key: 'investing', label: '투자', desc: '가상 계좌 평가액·시드·월 적립 요약. 종목별 내역은 보여 주지 않습니다.' },
  { key: 'children', label: '자녀 계좌', desc: '자녀 별칭·나이·증여 합계·남은 공제 한도.' },
]

/** 공유 규칙 — 초대한 사람과 받은 사람의 권한은 같다. 바꾸려면 이 표와 서버(src/services/household.ts)를 함께 고친다 */
export const SHARE_RULES: Array<[string, string, string]> = [
  ['지출 기록(돈 흐름)', '적기·고치기·지우기', '보기·고치기·지우기 (누가 했는지 표시, 지운 기록 되돌리기)'],
  ['지금 상태 점검', '본인만 작성', '결과 보기만'],
  ['시드 만들기(월 기록·확보)', '본인만', '보이지 않음'],
  ['투자(가상 계좌·실계좌·매매)', '본인만', '요약 보기만 (평가액·원금·월 적립)'],
  ['자녀 계좌(증여 기록)', '등록한 사람만', '보기만 (나이·증여 합계·남은 한도)'],
]

function ShareRules() {
  return (
    <section className="acc-card">
      <h2>무엇을 함께 보나</h2>
      <table className="acc-table fam-rules" aria-label="공유 규칙">
        <thead><tr><th>항목</th><th>내 것</th><th>배우자 것</th></tr></thead>
        <tbody>{SHARE_RULES.map(([item, mine, theirs]) => <tr key={item}><td>{item}</td><td>{mine}</td><td>{theirs}</td></tr>)}</tbody>
      </table>
      <p className="acc-note">초대한 사람과 받은 사람의 권한은 같습니다. 배우자 것은 배우자가 공유를 켠 항목만 보이고, 지출 기록 말고는 누구도 상대 것을 고칠 수 없고, 상대 계좌로 매매할 수 없습니다.</p>
    </section>
  )
}

const post = (body: Record<string, unknown>) => apiFetch('/api/ui/household', { method: 'POST', body: JSON.stringify(body), cacheMs: 0, retries: 0 })

export default function FamilyPage() {
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [code, setCode] = useState(() => readStashedCouple())
  const [busy, setBusy] = useState(false)
  const fromLink = !!readStashedCouple()

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/ui/household', { cacheMs: 0, retries: 0 })
      setView(res?.data ?? null)
    } catch (e) {
      setError(`불러오기 실패: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const run = async (body: Record<string, unknown>, done?: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await post(body)
      if (res?.ok === false) { setError(res.error || '처리하지 못했습니다.'); return }
      if (done) setNotice(done)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const accept = async () => {
    await run({ action: 'accept', code }, '연결했습니다. 이제 서로 공유한 것을 함께 봅니다.')
    clearStashedCouple()
  }

  const share = async (value: string) => {
    const link = buildCoupleLink(value)
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'Nexora 부부 연결', text: `Nexora에서 우리 집 돈을 같이 봐요. 연결 코드: ${value}`, url: link })
      } else {
        await navigator.clipboard.writeText(link)
        setNotice('연결 링크를 복사했습니다. 배우자에게 보내 주세요.')
      }
    } catch { /* 공유 취소 */ }
  }

  return (
    <div className="acc fam">
      <header>
        <p className="acc-eyebrow">부부 연결</p>
        <h1>우리 집 돈, 둘이 같이 보기</h1>
        <p>각자 계정은 그대로 두고, 서로 허락한 것만 함께 봅니다. 무엇을 보여 줄지는 각자 정하고, 언제든 끊을 수 있습니다. 끊어도 각자 기록은 각자에게 남습니다.</p>
      </header>

      {error && <p className="acc-warn fam-msg" role="alert">{error}</p>}
      {notice && <p className="acc-note fam-msg" role="status">{notice}</p>}
      {!view && !error && <p className="acc-note fam-msg">불러오는 중…</p>}

      {view && view.status !== 'active' && (
        <>
          <section className="acc-card">
            <h2>배우자 초대하기</h2>
            {view.status === 'none' ? (
              <>
                <p className="acc-note">연결 코드를 만들어 링크로 보내세요. 아직 가입하지 않았으면 링크로 가입하면서 바로 연결되고(초대권 필요 없음), 이미 가입했으면 코드를 넣는 즉시 연결됩니다. 코드는 한 번만 쓸 수 있고 {view.ttlDays}일 뒤 사라집니다.</p>
                <button type="button" className="acc-primary" disabled={busy} onClick={() => void run({ action: 'create-code' })}>연결 코드 만들기</button>
              </>
            ) : (
              <>
                <p className="fam-code"><code>{view.code}</code></p>
                <p className="acc-note">{kstDate(view.expiresAt)}까지 쓸 수 있습니다. 배우자가 연결하면 이 화면에 바로 나타납니다.</p>
                <div className="fam-actions">
                  <button type="button" className="acc-primary" onClick={() => void share(view.code)}>링크 보내기</button>
                  <button type="button" className="acc-link" disabled={busy} onClick={() => void run({ action: 'cancel-code' }, '코드를 취소했습니다.')}>코드 취소</button>
                </div>
              </>
            )}
          </section>

          <section className="acc-card">
            <h2>{fromLink ? '배우자가 보낸 연결 요청' : '받은 코드로 연결하기'}</h2>
            {fromLink && <p className="acc-note">링크로 들어오셨습니다. 연결하면 서로 지출·투자 요약·자녀 계좌를 볼 수 있습니다(각자 나중에 끌 수 있음).</p>}
            <label className="acc-field">
              <span>연결 코드</span>
              <input value={code} placeholder="XXXXX-XXXXX" maxLength={16} autoCapitalize="characters" autoComplete="off" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </label>
            <div className="fam-actions">
              <button type="button" className="acc-primary" disabled={busy || !code.trim()} onClick={() => void accept()}>연결하기</button>
              {fromLink && <button type="button" className="acc-link" onClick={() => { clearStashedCouple(); setCode('') }}>연결하지 않기</button>}
            </div>
          </section>
        </>
      )}

      {view?.status === 'active' && <Linked view={view} busy={busy} run={run} />}
      {view && <ShareRules />}
    </div>
  )
}

function PartnerCheck({ date, input }: { date: string; input: FlowCheckInput }) {
  const r = evaluateFlowCheck(input)
  return (
    <>
      <dl className="acc-tiles" aria-label="배우자 점검 결과">
        <div className="is-main"><dt>투자 가능액(월)</dt><dd>{krw(r.available)}</dd></div>
        <div><dt>못 줄이는 생활비(월)</dt><dd>{krw(r.mustMonthly)}</dd></div>
        <div><dt>최대로 줄이면</dt><dd>{krw(r.maxIfCut)}</dd></div>
        <div><dt>고정지출 비율</dt><dd>{r.fixedRatio === null ? '-' : `${Math.round(r.fixedRatio * 100)}%`}</dd></div>
      </dl>
      <p className="acc-note">{date} 점검 기준입니다. 같은 집 지출을 둘 다 점검했다면 합치지 말고 한 사람 것을 기준으로 보세요(중복으로 셀 수 있습니다).</p>
    </>
  )
}

function Linked({ view, busy, run }: { view: Extract<View, { status: 'active' }>; busy: boolean; run: (body: Record<string, unknown>, done?: string) => Promise<void> }) {
  const name = view.partner.nickname || '배우자'
  const today = kstToday()
  const inv = view.partner.investing
  const children = view.partnerShares.children ? sanitizeChildState(view.partner.children).children : []
  return (
    <>
      <section className="acc-card">
        <h2>{name}님과 연결됨</h2>
        <p className="acc-note">{kstDate(view.since)}부터 연결되어 있습니다.</p>
      </section>

      <section className="acc-card">
        <h2>내가 보여 주는 것</h2>
        <p className="acc-note">각자 자기 것만 정합니다. 끄면 배우자 화면에서 바로 사라집니다.</p>
        <div className="fam-shares">
          {SCOPES.map((s) => (
            <label key={s.key} className="fam-share">
              <input type="checkbox" checked={view.myShares[s.key]} disabled={busy} onChange={(e) => void run({ action: 'set-shares', shares: { [s.key]: e.target.checked } })} />
              <span><strong>{s.label}</strong><small>{s.desc}</small></span>
            </label>
          ))}
        </div>
      </section>

      <section className="acc-card">
        <h2>{name}님이 보여 주는 것</h2>

        <h3>지출</h3>
        {view.partnerShares.spending
          ? <p className="acc-note"><Link to="/money-flow">돈 흐름</Link>에서 "우리 집 합계"로 함께 봅니다. 지출은 각자 자기 계정으로 적습니다.</p>
          : <p className="acc-note">공유하지 않았습니다.</p>}

        <h3>지금 상태 점검</h3>
        {!view.partnerShares.plan ? <p className="acc-note">공유하지 않았습니다.</p> : !view.partner.check ? <p className="acc-note">아직 점검하지 않았습니다.</p> : <PartnerCheck date={view.partner.check.date} input={view.partner.check.input} />}

        <h3>투자</h3>
        {!view.partnerShares.investing ? <p className="acc-note">공유하지 않았습니다.</p> : !inv ? <p className="acc-note">아직 가상 계좌(시드)를 설정하지 않았습니다.</p> : (
          <dl className="acc-tiles" aria-label="배우자 투자 요약">
            <div className="is-main"><dt>평가액</dt><dd>{krw(inv.total)}</dd></div>
            <div><dt>넣은 돈(원금)</dt><dd>{krw(inv.principal ?? inv.seed)}</dd></div>
            <div><dt>현금 · 보유 종목</dt><dd className="fam-small">{krw(inv.cash)} · {krw(inv.holdings)}</dd></div>
            <div><dt>월 적립</dt><dd>{inv.monthlyDeposit ? krw(inv.monthlyDeposit) : '없음'}</dd></div>
          </dl>
        )}

        <h3>자녀 계좌</h3>
        {!view.partnerShares.children ? <p className="acc-note">공유하지 않았습니다.</p> : children.length === 0 ? <p className="acc-note">등록한 자녀가 없습니다.</p> : (
          <ul className="fam-children">
            {children.map((c) => {
              const a = allowance(c, today)
              const total = c.gifts.reduce((sum, g) => sum + g.amount, 0)
              return (
                <li key={c.id}>
                  <strong>{c.alias} <small>{approxAge(c.birth, today)}세</small></strong>
                  <span>증여 합계 {krw(total)} · 10년 공제 남은 한도 {krw(a.remaining)}</span>
                </li>
              )
            })}
          </ul>
        )}
        {view.partnerShares.children && children.length > 0 && <p className="acc-note">증여 기록은 {name}님 계정에 있습니다. 공제 한도는 부모·조부모 합산이라, 내가 따로 증여하면 이 한도에서 함께 빠집니다.</p>}
      </section>

      <section className="acc-card">
        <h2>연결 끊기</h2>
        <p className="acc-note">둘 중 누구나 끊을 수 있습니다. 끊으면 서로 화면에서 바로 사라지고, 각자 기록은 각자 계정에 그대로 남습니다.</p>
        <button type="button" className="acc-link fam-danger" disabled={busy} onClick={() => { if (window.confirm(`${name}님과 연결을 끊을까요?`)) void run({ action: 'end' }, '연결을 끊었습니다.') }}>연결 끊기</button>
      </section>
    </>
  )
}

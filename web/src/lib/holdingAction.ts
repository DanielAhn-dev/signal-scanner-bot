/**
 * 보유 종목 카드의 "이 종목 대응" — 전문가에게 묻는 질문(팔까·들고 갈까·새 돈은 어디로·지금 어떤가)에 종목별 숫자로 답한다.
 * 등급·점수·진입/추세 같은 봇 판정값은 쓰지 않는다(종목 선별·타이밍에는 우위가 없었다, 2026-09-28 검증).
 * 근거
 *   - 종목의 역할(지수·배당·커버드콜·개별주…), 계좌 안 비중, 같은 계좌 인컴 종목끼리의 비교
 *   - 실시간 지표(네이버 etfKeyIndicator: 최근 12개월 분배율·총보수·1년 수익률, 코스피200 1년) — 서버 positions의 etf_key
 *   - 과거 이력(web/src/data/etfHistoryFacts.ts, scripts/research/build_etf_history_facts.py): 분배금 증감·줄어든 해·가격 잠식·코스피200 대비
 * 규칙
 *   - 커버드콜 장기 연 4~11%p 열위 → 인컴의 1/3 이하 (src/lib/incomeGuide.ts)
 *   - 주당 분배금이 1년 전보다 20% 넘게 줄면 새 돈 멈춤(원인 확인 전까지)
 *   - 같은 역할 ETF가 둘 이상이면 새 돈은 한 곳으로: 분배금 삭감 없는 것 → 분배 이력 3년 이상 → 보수 낮은 것 → 비중 낮은 것
 *     (과거 수익률로 고르지 않는다. 지난 수익 차이는 앞으로를 보장하지 않는다)
 *   - 목표 비중 ±10%p 밴드 리밸런싱 (REBALANCE_BAND_PP), 새 돈 우선 (H14)
 *   - 개별주 한도 10%·손실 −15%에서 추가매수 중단 (holdingAdvice.ts, 보수적 가정)
 *   - 레버리지는 세후 이득 없음
 * 안내만 하며 주문하지 않는다. 순수 함수만 둔다.
 */
import { classifyHolding, REBALANCE_BAND_PP, type AssetBucket } from '../../../src/lib/incomeGuide'
import { ETF_HISTORY, ETF_HISTORY_META, type EtfHistoryFact } from '../data/etfHistoryFacts'
import { SINGLE_STOCK_LIMIT_PCT } from './holdingAdvice'

export type ActionTone = 'keep' | 'watch' | 'act'
export type HoldingAction = {
  bucket: AssetBucket
  /** 이 종목이 계좌에서 맡은 역할 */
  role: string
  tone: ActionTone
  /** 한두 단어 결론 — 칩에 쓴다 */
  verdict: string
  /** 무엇을 하면 되는지 한 문장 */
  todo: string
  /** 지금 상태 한 문장 */
  now: string
  /** 언제·어떤 조건에서 움직이는지 한 문장 */
  when: string
  /** 이 종목만의 숫자 근거 (없으면 빈 배열) */
  facts: string[]
  /** 숫자의 출처·기준일 (facts가 있을 때만) */
  source: string | null
}

/** 서버 positions가 붙이는 ETF 지표 (etf_key) */
export type EtfKey = {
  yieldTtm: number | null
  fee: number | null
  return1m?: number | null
  return3m?: number | null
  return1y: number | null
  /** 같은 시점 코스피200(KODEX 200) 1년 수익률 */
  benchmarkReturn1y?: number | null
}

/** 같은 계좌의 인컴 종목 (비교·새 돈 방향) */
export type IncomePeer = {
  code: string
  name: string
  bucket: AssetBucket
  /** 계좌 평가금 중 비중 % */
  weightPct: number | null
  /** 평가금 (원) — 새 돈으로 비중을 맞출 금액 계산에 쓴다 */
  value?: number | null
  etf?: EtfKey | null
}

export type HoldingActionInput = {
  code: string
  name: string | null | undefined
  /** 평단 대비 손익 % */
  pnlPct: number | null
  /** 같은 계좌 평가금 중 이 종목 비중 % */
  accountWeightPct: number | null
  /** 같은 계좌 인컴(배당·커버드콜·리츠) 중 커버드콜 비중 % */
  coveredCallShareOfIncomePct?: number | null
  /** 같은 계좌 인컴 종목들 (자기 자신 포함 가능) */
  incomePeers?: IncomePeer[]
  /** 실시간 ETF 지표 */
  etf?: EtfKey | null
  /** 과거 이력 — 테스트용 주입. 없으면 생성 데이터에서 찾는다 */
  history?: EtfHistoryFact | null
  /** 비중 조절 경고(개별주 과열·고점 변동성) */
  weightCaution?: { level: 'caution' | 'strong'; message?: string | null } | null
  /** 봇이 관리하는 가상 계좌 종목인가 */
  isBotAccount: boolean
}

/** 커버드콜은 인컴의 1/3 이하 */
export const COVERED_CALL_MAX_SHARE_PCT = 100 / 3
/** 주당 분배금이 1년 전보다 이만큼 줄면 새 돈을 멈춘다 */
export const DIVIDEND_CUT_ALERT_PCT = -20
/** 분배금이 줄어든 적 있는지 볼 수 있는 최소 이력(완결된 해) */
const MIN_HISTORY_YEARS = 3
const LOSS_STOP_ADD_PCT = -15
const STOCK_LIMIT_PCT = SINGLE_STOCK_LIMIT_PCT.balanced
/** 코스피200 ETF 중 가장 싼 보수 수준 — 이보다 크게 비싸면 새 돈은 저보수 상품으로 */
const KR_INDEX_CHEAP_FEE_PCT = 0.05
/** 이 이상이면 싼 상품과 연 0.05%p 넘게 차이 → 새 돈은 저보수 상품으로 */
const KR_INDEX_PRICEY_FEE_PCT = 0.1

const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v)
const pct = (v: number, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}%`
const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`
const shortName = (n: string) => n.replace(/\s*\(.*?\)\s*/g, ' ').trim()
/** 받침에 맞는 조사 (한글이 아니면 받침 없는 쪽) */
function josa(word: string, withFinal: string, withoutFinal: string): string {
  const c = word.charCodeAt(word.length - 1)
  const hasFinal = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0
  return `${word}${hasFinal ? withFinal : withoutFinal}`
}

function pnlLine(pnlPct: number | null, calm: string): string {
  if (pnlPct == null || !Number.isFinite(pnlPct)) return '손익을 계산할 가격이 아직 없어요.'
  if (Math.abs(pnlPct) < 0.5) return '평단과 거의 같은 가격이에요.'
  return pnlPct < 0 ? `평단보다 ${pct(pnlPct)} — ${calm}` : `평단보다 ${pct(pnlPct)}예요.`
}

const REBALANCE_RULE = `돈이 필요할 때, 또는 계좌 목표 비중에서 ${REBALANCE_BAND_PP}%p 넘게 벗어났을 때만 일부 옮겨요. 새로 넣는 돈으로 먼저 맞추고, 확인은 월 1회면 충분해요.`
const rebalanceWhen = (weight: number | null) => (weight != null ? `지금 이 계좌의 ${weight.toFixed(0)}%예요. ` : '') + REBALANCE_RULE

export function lookupHistory(code: string): EtfHistoryFact | null {
  return ETF_HISTORY[String(code).trim()] ?? null
}

// ── 숫자 근거 문장 ─────────────────────────────────────────

/** 실시간: 분배율·보수·1년 수익(코스피200 대비) */
function liveLine(etf: EtfKey | null | undefined, withYield: boolean): string | null {
  if (!etf) return null
  const parts: string[] = []
  if (withYield && fin(etf.yieldTtm) && etf.yieldTtm > 0) parts.push(`분배율 연 ${etf.yieldTtm.toFixed(1)}%(최근 12개월)`)
  if (fin(etf.fee)) parts.push(`총보수 ${etf.fee.toFixed(2)}%`)
  if (fin(etf.return1y)) {
    parts.push(`1년 수익 ${pct(etf.return1y)}` + (fin(etf.benchmarkReturn1y) ? ` (코스피200 ${pct(etf.benchmarkReturn1y)})` : ''))
  }
  return parts.length ? parts.join(' · ') : null
}

/** 분배금 추세: 최근 12개월 vs 1년 전 */
function divTrendLine(h: EtfHistoryFact | null): string | null {
  if (!h || !fin(h.divTtm) || h.divTtm <= 0) return null
  if (fin(h.divChgPct) && fin(h.divPrev)) {
    return `주당 분배금 최근 12개월 ${won(h.divTtm)} — 1년 전(${won(h.divPrev)})보다 ${pct(h.divChgPct, 0)}`
  }
  return `주당 분배금 최근 12개월 ${won(h.divTtm)} (1년 전과 비교할 이력은 아직 없음)`
}

/** 분배금이 줄어든 해 */
function cutHistoryLine(h: EtfHistoryFact | null): string | null {
  if (!h) return null
  if (fin(h.comparedYears) && h.comparedYears >= MIN_HISTORY_YEARS && h.divYearRange) {
    const cuts = h.cutYears ?? 0
    const worst = cuts > 0 && fin(h.worstCutPct) ? ` (가장 크게 준 해 ${h.worstCutYear}년 ${pct(h.worstCutPct, 0)})` : ''
    const skipped = h.scheduleChangeYears?.length ? ` · 지급 주기가 바뀐 ${h.scheduleChangeYears.join('·')}년은 비교에서 뺌` : ''
    return `${h.divYearRange} 비교한 ${h.comparedYears}해 중 분배금이 전년보다 줄어든 해 ${cuts}번${worst}${skipped}`
  }
  if (h.divFirst) return `분배 이력이 ${h.divFirst}부터라 분배금이 줄어든 적이 있는지 볼 만큼 길지 않아요`
  return `${h.first} 상장 — 분배금이 줄어든 적이 있는지 볼 이력이 아직 없어요`
}

/** 받은 분배금 vs 가격 변화(원금 잠식) vs 코스피200 */
function erosionLine(h: EtfHistoryFact | null): string | null {
  if (!h || !h.since || !fin(h.priceChgPct) || !fin(h.divCumPct) || !fin(h.trPct)) return null
  const bench = fin(h.benchTrPct) ? `, 같은 기간 코스피200 ${pct(h.benchTrPct, 0)}` : ''
  return `${h.since}부터 ${h.years}년: 가격 ${pct(h.priceChgPct, 0)} + 받은 분배금 ${h.divCumPct.toFixed(0)}% = 총수익 ${pct(h.trPct, 0)}${bench}`
}

function drawdownLine(h: EtfHistoryFact | null): string | null {
  if (!h || !fin(h.mdd)) return null
  return `${h.first} 이후 최대 낙폭 ${h.mdd.toFixed(0)}%` + (fin(h.benchMdd) ? ` (같은 기간 코스피200 ${h.benchMdd.toFixed(0)}%)` : '')
}

function tr3yLine(h: EtfHistoryFact | null): string | null {
  if (!h || !fin(h.tr3y)) return null
  return `최근 3년 연 총수익 ${pct(h.tr3y)}` + (fin(h.benchTr3y) ? ` (코스피200 연 ${pct(h.benchTr3y)})` : '')
}

function sourceText(hasLive: boolean, h: EtfHistoryFact | null): string | null {
  const parts: string[] = []
  if (hasLive) parts.push('분배율·보수·1년 수익: 네이버 ETF 지표(오늘)')
  if (h) parts.push(`이력: ${ETF_HISTORY_META.source}, ${h.asOf} 기준 (생성 ${ETF_HISTORY_META.generated})`)
  return parts.length ? `${parts.join(' · ')}. ${ETF_HISTORY_META.limits}` : null
}

const compact = (xs: Array<string | null>) => xs.filter((x): x is string => !!x)

// ── 같은 역할 ETF 중 새 돈을 넣을 곳 ─────────────────────────

type PeerEval = IncomePeer & { h: EtfHistoryFact | null; cut: boolean; proven: boolean; fee: number | null }

function evalPeer(p: IncomePeer): PeerEval {
  const h = lookupHistory(p.code)
  return {
    ...p,
    h,
    cut: fin(h?.divChgPct) && h!.divChgPct! <= DIVIDEND_CUT_ALERT_PCT,
    proven: fin(h?.comparedYears) && h!.comparedYears! >= MIN_HISTORY_YEARS,
    fee: fin(p.etf?.fee) ? p.etf!.fee! : null,
  }
}

/** 분배금 삭감 없는 것 → 분배 이력이 검증된 것 → 보수 낮은 것 → 비중 낮은 것 */
export function pickNewMoneyTarget(peers: IncomePeer[]): { target: PeerEval; reason: string } | null {
  const ev = peers.map(evalPeer)
  if (ev.length < 2) return null
  const sorted = [...ev].sort((a, b) =>
    Number(a.cut) - Number(b.cut)
    || Number(b.proven) - Number(a.proven)
    || (a.fee ?? 9) - (b.fee ?? 9)
    || (a.weightPct ?? 0) - (b.weightPct ?? 0))
  const [t, second] = sorted
  let reason: string
  const sn = shortName(second.name)
  if (!t.cut && second.cut) reason = `${josa(sn, '은', '는')} 최근 분배금이 줄었어요`
  else if (t.proven && !second.proven) {
    const feeNote = fin(t.fee) && fin(second.fee) && second.fee < t.fee
      ? `${josa(sn, '이', '가')} 보수는 ${(t.fee - second.fee).toFixed(2)}%p 싸지만 `
      : `${josa(sn, '은', '는')} `
    reason = `${feeNote}${second.h?.first ? `${second.h.first} 상장이라 ` : ''}분배금이 줄어든 적 있는지 아직 볼 수 없고, ${josa(shortName(t.name), '은', '는')} ${t.h?.divYearRange ?? ''} 분배 이력이 있어요`
  } else if (fin(t.fee) && fin(second.fee) && t.fee < second.fee) reason = `보수가 ${(second.fee - t.fee).toFixed(2)}%p 더 싸요`
  else reason = '비중이 더 낮아 한쪽으로 쏠리지 않게 해요'
  return { target: t, reason }
}

/**
 * 커버드콜을 팔지 않고 새 돈만으로 인컴의 1/3에 맞추는 계산.
 * 커버드콜 C, 인컴 합계 I일 때 배당 쪽에 x를 넣으면 C/(I+x) = 1/3 → x = 3C − I.
 * 기준 안이면 커버드콜에 더 넣어도 되는 여유 y: (C+y)/(I+y) = 1/3 → y = (I − 3C)/2.
 */
export function coveredCallPlan(peers: IncomePeer[]): { cc: number; income: number; sharePct: number; needNew: number; headroom: number } | null {
  let cc = 0
  let income = 0
  for (const p of peers) {
    if (!fin(p.value) || p.value <= 0) continue
    income += p.value
    if (p.bucket === 'covered_call') cc += p.value
  }
  if (!(income > 0) || !(cc > 0)) return null
  return {
    cc, income, sharePct: (cc / income) * 100,
    needNew: Math.max(0, 3 * cc - income),
    headroom: Math.max(0, (income - 3 * cc) / 2),
  }
}

/** 계좌에 배당 ETF가 없을 때 새 돈 후보: 한국 배당 ETF 중 분배 이력이 검증된 것(줄어든 해 비율 낮고 비교한 해 많은 순) */
export function defaultDividendCandidate(): { code: string; name: string; why: string } | null {
  const list = Object.entries(ETF_HISTORY)
    .filter(([, f]) => /배당/.test(f.name) && !/커버드콜|프리미엄|리츠/.test(f.name) && regionOf(f.name) === '한국'
      && fin(f.comparedYears) && f.comparedYears >= MIN_HISTORY_YEARS)
    .sort(([, a], [, b]) => (a.cutYears ?? 0) / a.comparedYears! - (b.cutYears ?? 0) / b.comparedYears! || b.comparedYears! - a.comparedYears!)
  if (!list.length) return null
  const [code, f] = list[0]
  return { code, name: f.name, why: `${f.divYearRange} 비교한 ${f.comparedYears}해 중 분배금이 줄어든 해 ${f.cutYears ?? 0}번` }
}

const regionOf =(name: string) => (/미국|글로벌|S&P|다우|나스닥|선진|월드|일본|중국|유럽/i.test(name) ? '해외' : '한국')

// ── 결론 ─────────────────────────────────────────────────

export function resolveHoldingAction(input: HoldingActionInput): HoldingAction {
  const bucket = classifyHolding(input.code, input.name)
  const pnl = fin(input.pnlPct) ? input.pnlPct : null
  const weight = fin(input.accountWeightPct) ? input.accountWeightPct : null
  const h = input.history !== undefined ? input.history : lookupHistory(input.code)
  const etf = input.etf ?? null
  const name = String(input.name ?? input.code)

  if (input.isBotAccount) {
    return {
      bucket, role: '봇 가상 계좌', tone: 'keep', verdict: '봇이 관리',
      todo: '봇이 규칙대로 사고팝니다. 직접 할 일은 없어요.',
      now: pnlLine(pnl, '봇의 손절·익절 규칙이 따로 지켜보고 있어요.'),
      when: '실계좌에서 따라 하고 싶을 때만 "따라 사기"에서 기록하세요.',
      facts: [], source: null,
    }
  }

  const peers = (input.incomePeers ?? []).filter((p) => p.code !== input.code)
  const ccShare = fin(input.coveredCallShareOfIncomePct) ? input.coveredCallShareOfIncomePct : null
  const ccOver = ccShare != null && ccShare > COVERED_CALL_MAX_SHARE_PCT + 0.5
  const withSource = (facts: string[]) => ({ facts, source: facts.length ? sourceText(!!etf, h) : null })

  switch (bucket) {
    case 'kr_index':
    case 'global_index': {
      const facts = compact([liveLine(etf, false), tr3yLine(h), drawdownLine(h)])
      const pricey = bucket === 'kr_index' && fin(etf?.fee) && etf!.fee! >= KR_INDEX_PRICEY_FEE_PCT
      return {
        bucket, role: '성장 (지수)', tone: 'keep', verdict: pricey ? '보유 · 새 돈은 저보수로' : '계속 보유',
        todo: pricey
          ? `팔 이유는 없어요. 다만 총보수 ${etf!.fee!.toFixed(2)}%는 같은 코스피200 ETF 중 싼 상품(약 ${KR_INDEX_CHEAP_FEE_PCT}%)보다 비싸요. 새 돈은 저보수 상품에 넣어도 같은 지수를 삽니다.`
          : '팔 이유가 없어요. 새로 넣을 돈도 여기에 넣으면 됩니다.',
        now: pnlLine(pnl, fin(h?.mdd) ? `이 상품은 최대 ${h!.mdd!.toFixed(0)}%까지 빠진 적이 있어요. 이 정도 흔들림은 가격을 보고 대응하지 않아요.` : '지수에서는 흔한 흔들림이라 가격을 보고 대응하지 않아요.'),
        when: rebalanceWhen(weight),
        ...withSource(facts),
      }
    }
    case 'dividend': {
      const facts = compact([liveLine(etf, true), divTrendLine(h), cutHistoryLine(h), erosionLine(h), drawdownLine(h)])
      const cut = fin(h?.divChgPct) && h!.divChgPct! <= DIVIDEND_CUT_ALERT_PCT
      const divPeers = peers.filter((p) => p.bucket === 'dividend')
      const sameRole = divPeers.filter((p) => regionOf(p.name) === regionOf(name))
      const self: IncomePeer = { code: input.code, name, bucket, weightPct: weight, etf }
      const pick = sameRole.length ? pickNewMoneyTarget([self, ...sameRole]) : null
      const isTarget = pick ? pick.target.code === input.code : true
      const now = pnlLine(pnl, '분배금은 주가와 따로 나오니 내렸다고 팔지 않아요.')
      const when = `주당 분배금이 1년 전보다 ${Math.abs(DIVIDEND_CUT_ALERT_PCT)}% 넘게 줄면 다시 안내해요. 그 밖에는 ${rebalanceWhen(weight)}`

      if (cut) {
        const alt = pick && pick.target.code !== input.code ? shortName(pick.target.name) : '다른 배당 ETF나 지수'
        return {
          bucket, role: '인컴 (배당)', tone: 'watch', verdict: '새 돈 멈춤',
          todo: `최근 12개월 주당 분배금이 1년 전보다 ${pct(h!.divChgPct!, 0)} 줄었어요. 팔 필요는 없지만, 편입 종목 배당이 줄어든 건지 확인될 때까지 새 돈은 ${alt}로.`,
          now, when, ...withSource(facts),
        }
      }
      if (pick && !isTarget) {
        const t = shortName(pick.target.name)
        return {
          bucket, role: '인컴 (배당)', tone: 'keep', verdict: '보유 · 새 돈은 다른 곳',
          todo: `같은 ${regionOf(name)} 고배당 ETF를 ${sameRole.length + 1}개 들고 있어 담긴 종목이 많이 겹쳐요. 이건 그대로 두고, 새 돈은 ${t}에 모으세요 — ${pick.reason}.`,
          now, when, ...withSource(facts),
        }
      }
      const reasons: string[] = []
      if (ccOver) {
        const plan = coveredCallPlan(input.incomePeers ?? [])
        reasons.push(plan && plan.needNew > 0
          ? `이 계좌 인컴의 ${ccShare!.toFixed(0)}%가 커버드콜이에요(목표 1/3 = 33% 이하). 새 돈 약 ${won(plan.needNew)}을 여기에 넣으면 커버드콜은 팔지 않고도 33%로 내려가요`
          : `이 계좌 인컴의 ${ccShare!.toFixed(0)}%가 커버드콜이라(목표 1/3 이하) 배당 쪽을 늘려야 해요`)
      }
      if (pick) reasons.push(`같은 ${regionOf(name)} 고배당 ETF 중 여기가 새 돈 자리예요 — ${pick.reason}`)
      if (fin(h?.divChgPct) && h!.divChgPct! > 0) reasons.push(`주당 분배금이 1년 전보다 ${pct(h!.divChgPct!, 0)} 늘었어요`)
      return {
        bucket, role: '인컴 (배당)', tone: 'keep',
        verdict: ccOver || pick ? '새 돈은 여기로' : '계속 보유',
        todo: reasons.length
          ? `${reasons.join('. ')}.`
          : fin(etf?.yieldTtm) ? `분배율 연 ${etf!.yieldTtm!.toFixed(1)}% 자리예요. 주가보다 분배금이 꾸준한지만 보면 돼요.` : '분배금을 받는 자리예요. 주가보다 분배금이 꾸준한지만 보면 돼요.',
        now, when, ...withSource(facts),
      }
    }
    case 'covered_call': {
      const divPeers = peers.filter((p) => p.bucket === 'dividend')
      const divPick = divPeers.length > 1 ? pickNewMoneyTarget(divPeers) : null
      const divBest = divPick?.target ?? (divPeers.length ? evalPeer(divPeers[0]) : null)
      const fallback = divBest ? null : defaultDividendCandidate()
      // 새 돈을 넣을 곳: 같은 계좌 배당 ETF(여럿이면 한 곳) → 없으면 분배 이력이 검증된 한국 배당 ETF
      const target = divBest ? shortName(divBest.name) : fallback ? `${shortName(fallback.name)}(${fallback.code})` : '배당 ETF'
      // 왜 그 종목인지 한 문장 (이미 있는 배당 ETF가 하나면 따로 설명하지 않는다)
      const targetWhy = divPick
        ? ` ${josa(target, '을', '를')} 고른 이유: ${divPick.reason}.`
        : !divBest && fallback ? ` 계좌에 배당 ETF가 없어 분배 이력이 검증된 상품을 골랐어요(${fallback.why}).` : ''
      const plan = coveredCallPlan(input.incomePeers ?? [])
      const planLine = plan
        ? `이 계좌 인컴 ${won(plan.income)} 중 커버드콜 ${won(plan.cc)}(${plan.sharePct.toFixed(0)}%)${weight != null ? ` · 이 종목은 계좌 전체의 ${weight.toFixed(0)}%` : ''}`
        : null
      // 같은 계좌 배당 ETF와 분배율·1년 수익 비교: 분배금을 더 주는 대가가 숫자로 보이게
      let vsDiv: string | null = null
      if (divBest && fin(etf?.yieldTtm) && fin(divBest.etf?.yieldTtm) && divBest.etf!.yieldTtm! > 0) {
        const ratio = etf!.yieldTtm! / divBest.etf!.yieldTtm!
        const r1 = fin(etf?.return1y) && fin(divBest.etf?.return1y) ? `, 최근 1년 수익은 ${pct(etf!.return1y!)} 대 ${pct(divBest.etf!.return1y!)}` : ''
        vsDiv = `분배율 연 ${etf!.yieldTtm!.toFixed(1)}%로 ${shortName(divBest.name)}(${divBest.etf!.yieldTtm!.toFixed(1)}%)의 ${ratio.toFixed(1)}배${r1}`
      }
      const facts = compact([planLine, liveLine(etf, true), vsDiv, divTrendLine(h), erosionLine(h), tr3yLine(h), drawdownLine(h)])
      const eroding = fin(h?.priceChgPct) && h!.priceChgPct! < 0
      const lag = fin(h?.trPct) && fin(h?.benchTrPct) ? h!.benchTrPct! - h!.trPct! : null
      const costLine = eroding
        ? `${h!.since}부터 가격이 ${pct(h!.priceChgPct!, 0)} — 받은 분배금 일부는 원금이 돌아온 거예요.`
        : lag != null && lag > 0
          ? `${h!.since}부터 총수익이 코스피200보다 ${lag.toFixed(0)}%p 뒤졌어요(오를 때 덜 오르는 대가).`
          : '오를 때 덜 오르는 대가로 분배금을 더 받는 상품이에요.'
      const cut = fin(h?.divChgPct) && h!.divChgPct! <= DIVIDEND_CUT_ALERT_PCT
      const now = pnlLine(pnl, '분배금을 많이 주는 만큼 가격은 천천히 깎일 수 있어요.')
      if (ccOver || cut) {
        const howMuch = plan && plan.needNew > 0
          ? `팔지 말고, 새 돈 약 ${won(plan.needNew)}을 ${target}에 넣으면 커버드콜이 ${plan.sharePct.toFixed(0)}% → 33%로 내려가요. 새 돈이 들어올수록 비중은 저절로 줄어요.`
          : `팔지 말고, 새 돈은 ${target}에 넣어 비중을 낮추세요.`
        return {
          bucket, role: '인컴 (커버드콜)', tone: 'watch', verdict: '보유 · 새 돈 멈춤',
          todo: cut
            ? `주당 분배금이 1년 전보다 ${pct(h!.divChgPct!, 0)} 줄었어요. 팔 필요는 없고, 새 돈은 ${target}로.${targetWhy} ${costLine}`
            : `커버드콜이 이 계좌 인컴의 ${ccShare!.toFixed(0)}%예요(목표 1/3 = 33% 이하). ${howMuch}${targetWhy} ${costLine}`,
          now,
          when: plan && plan.needNew > 0
            ? `그 ${won(plan.needNew)}이 들어갈 때까지 커버드콜 추가매수는 멈춰요. 33% 안으로 들어오고 분배금이 유지되면 '계속 보유'로 바뀌어요.`
            : `커버드콜이 인컴의 1/3 안으로 들어오고 분배금이 유지되면 다시 '계속 보유'로 바뀌어요.`,
          ...withSource(facts),
        }
      }
      return {
        bucket, role: '인컴 (커버드콜)', tone: 'keep', verdict: '계속 보유',
        todo: (ccShare != null ? `이 계좌 인컴의 ${ccShare.toFixed(0)}%로 목표(1/3 = 33%) 안이에요. ` : '')
          + (plan && plan.headroom > 0
            ? `커버드콜에 약 ${won(plan.headroom)}까지는 더 넣어도 33%를 넘지 않지만, 새 돈의 기본 자리는 ${target}예요.${targetWhy} `
            : `새 돈의 기본 자리는 ${target}예요.${targetWhy} `)
          + costLine,
        now,
        when: `커버드콜이 인컴의 1/3을 넘거나 주당 분배금이 1년 전보다 ${Math.abs(DIVIDEND_CUT_ALERT_PCT)}% 넘게 줄면 새 돈부터 ${target}로 돌려요.`,
        ...withSource(facts),
      }
    }
    case 'reit_infra': {
      const facts = compact([liveLine(etf, true), divTrendLine(h), cutHistoryLine(h), drawdownLine(h)])
      return {
        bucket, role: '인컴 (리츠·인프라)', tone: 'keep', verdict: '계속 보유',
        todo: fin(etf?.yieldTtm) ? `임대료·사용료로 연 ${etf!.yieldTtm!.toFixed(1)}%를 나눠 주는 자리예요.` : '임대료·사용료로 분배금을 주는 자리예요.',
        now: pnlLine(pnl, '금리가 오를 때 크게 흔들리는 자산이에요(2022년 −34~−54%).'),
        when: `금리가 빠르게 오르는 시기엔 비중을 늘리지 마세요. 그 밖에는 ${rebalanceWhen(weight)}`,
        ...withSource(facts),
      }
    }
    case 'bond_cash': {
      const facts = compact([liveLine(etf, true)])
      return {
        bucket, role: '현금성', tone: 'keep', verdict: '계속 보유',
        todo: '주식이 크게 빠졌을 때 옮겨 담을 돈이에요.',
        now: pnlLine(pnl, '금리 변동으로 잠깐 흔들릴 수 있어요.'),
        when: '주식이 크게 빠져 목표 비중보다 줄면 여기서 옮겨 채웁니다.',
        ...withSource(facts),
      }
    }
    case 'leveraged': {
      const facts = compact([liveLine(etf, false), drawdownLine(h)])
      return {
        bucket, role: '레버리지·인버스', tone: 'act', verdict: '줄이기 검토',
        todo: '오래 들고 가면 세후 이득이 없었던 상품이에요. 산 목적이 끝났으면 정리하세요.',
        now: pnlLine(pnl, '하락장에서 손실이 배로 커질 수 있어요.'),
        when: '정리한 돈은 지수 ETF로 옮기는 게 기본이에요.',
        ...withSource(facts),
      }
    }
    default: {
      // 개별주·테마 ETF: 오를지 판단하지 않고 비중·손실·과열 경고로만 안내한다
      const role = bucket === 'stock' ? '개별주' : '테마 ETF'
      const facts = bucket === 'stock' ? [] : compact([liveLine(etf, false), tr3yLine(h), drawdownLine(h)])
      const src = withSource(facts)
      if (weight != null && weight > STOCK_LIMIT_PCT) {
        return {
          bucket, role, tone: 'act', verdict: '일부 줄이기',
          todo: `한 종목이 계좌의 ${weight.toFixed(0)}%예요. ${STOCK_LIMIT_PCT}% 안으로 줄여 지수로 옮기세요.`,
          now: pnlLine(pnl, '손실 중이면 한 번에 말고 나눠서 줄여도 돼요.'),
          when: '비중이 한도 안으로 들어오면 그다음은 보유만 합니다.',
          ...src,
        }
      }
      if (input.weightCaution) {
        return {
          bucket, role, tone: 'watch', verdict: '추가매수 멈춤',
          todo: '과열 신호가 켜졌어요. 더 사지 말고, 많이 올랐다면 일부 차익을 검토하세요.',
          now: input.weightCaution.message || pnlLine(pnl, ''),
          when: '고점 시점은 못 맞혀요. 전부 팔기보다 비중을 줄이는 용도로만 쓰세요.',
          ...src,
        }
      }
      if (pnl != null && pnl <= LOSS_STOP_ADD_PCT) {
        return {
          bucket, role, tone: 'watch', verdict: '추가매수 멈춤',
          todo: '물타기는 하지 말고, 새 돈은 지수에 넣으세요.',
          now: `평단보다 ${pct(pnl)} — 지금 팔면 손실이 확정돼요.`,
          when: '반등을 기다릴지, 정리하고 지수로 옮길지 미리 정해 두세요. 이 종목이 오를지는 시스템도 맞히지 못해요.',
          ...src,
        }
      }
      return {
        bucket, role, tone: 'keep', verdict: '보유 · 추가는 지수로',
        todo: weight != null ? `계좌의 ${weight.toFixed(0)}%로 한도(${STOCK_LIMIT_PCT}%) 안이에요. 들고 가되 새 돈은 지수로.` : '들고 가되 새 돈은 지수에 넣으세요.',
        now: pnlLine(pnl, '종목 하나의 흔들림은 지수보다 커요.'),
        when: `비중이 ${STOCK_LIMIT_PCT}%를 넘거나 평단보다 ${Math.abs(LOSS_STOP_ADD_PCT)}% 넘게 내리면 다시 안내해요.`,
        ...src,
      }
    }
  }
}

type AccountRow = { accountKey: string; code: string; name: string | null | undefined; value: number; etf?: EtfKey | null }

/** 계좌별 평가금 합계·인컴 중 커버드콜 비중·인컴 종목 목록 — 카드마다 같은 계좌 기준으로 비교하기 위해 */
export function summarizeAccounts(rows: AccountRow[]) {
  const total = new Map<string, number>()
  const income = new Map<string, number>()
  const covered = new Map<string, number>()
  const incomeRows = new Map<string, Map<string, { code: string; name: string; bucket: AssetBucket; value: number; etf: EtfKey | null }>>()
  for (const r of rows) {
    if (!(r.value > 0)) continue
    total.set(r.accountKey, (total.get(r.accountKey) ?? 0) + r.value)
    const b = classifyHolding(r.code, r.name)
    if (b === 'dividend' || b === 'covered_call' || b === 'reit_infra') {
      income.set(r.accountKey, (income.get(r.accountKey) ?? 0) + r.value)
      const m = incomeRows.get(r.accountKey) ?? new Map()
      const prev = m.get(r.code)
      m.set(r.code, { code: r.code, name: String(r.name ?? r.code), bucket: b, value: (prev?.value ?? 0) + r.value, etf: r.etf ?? prev?.etf ?? null })
      incomeRows.set(r.accountKey, m)
    }
    if (b === 'covered_call') covered.set(r.accountKey, (covered.get(r.accountKey) ?? 0) + r.value)
  }
  return {
    weightPct: (accountKey: string, value: number) => {
      const t = total.get(accountKey) ?? 0
      return t > 0 && value > 0 ? (value / t) * 100 : null
    },
    coveredCallShareOfIncomePct: (accountKey: string) => {
      const inc = income.get(accountKey) ?? 0
      return inc > 0 ? ((covered.get(accountKey) ?? 0) / inc) * 100 : null
    },
    incomePeers: (accountKey: string): IncomePeer[] => {
      const t = total.get(accountKey) ?? 0
      return Array.from(incomeRows.get(accountKey)?.values() ?? []).map((p) => ({
        code: p.code, name: p.name, bucket: p.bucket, etf: p.etf, value: p.value,
        weightPct: t > 0 ? (p.value / t) * 100 : null,
      }))
    },
  }
}

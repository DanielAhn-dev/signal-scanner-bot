/**
 * 보유 종목 카드의 "이 종목 대응" — 전문가에게 묻는 질문(팔까·들고 갈까·언제 움직이나·지금 어떤가)에 한 묶음으로 답한다.
 * 등급·점수·진입/추세 같은 봇 판정값은 쓰지 않는다(종목 선별·타이밍에는 우위가 없었다, 2026-09-28 검증).
 * 근거는 종목의 역할(지수·배당·커버드콜·개별주…), 계좌 안 비중, 손익, 비중 조절 경고뿐이다.
 *   - 커버드콜 장기 연 4~11%p 열위 → 인컴의 1/3 이하 (src/lib/incomeGuide.ts)
 *   - 목표 비중 ±10%p 밴드 리밸런싱 (REBALANCE_BAND_PP), 새 돈 우선 (H14)
 *   - 개별주 한도 10%·손실 −15%에서 추가매수 중단 (holdingAdvice.ts, 보수적 가정)
 *   - 레버리지는 세후 이득 없음
 * 안내만 하며 주문하지 않는다. 순수 함수만 둔다.
 */
import { classifyHolding, REBALANCE_BAND_PP, type AssetBucket } from '../../../src/lib/incomeGuide'
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
  /** 비중 조절 경고(개별주 과열·고점 변동성) */
  weightCaution?: { level: 'caution' | 'strong'; message?: string | null } | null
  /** 봇이 관리하는 가상 계좌 종목인가 */
  isBotAccount: boolean
}

/** 커버드콜은 인컴의 1/3 이하 */
export const COVERED_CALL_MAX_SHARE_PCT = 100 / 3
const LOSS_STOP_ADD_PCT = -15
const STOCK_LIMIT_PCT = SINGLE_STOCK_LIMIT_PCT.balanced

const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

function pnlLine(pnlPct: number | null, calm: string): string {
  if (pnlPct == null || !Number.isFinite(pnlPct)) return '손익을 계산할 가격이 아직 없어요.'
  if (Math.abs(pnlPct) < 0.5) return '평단과 거의 같은 가격이에요.'
  return pnlPct < 0 ? `평단보다 ${pct(pnlPct)} — ${calm}` : `평단보다 ${pct(pnlPct)}예요.`
}

const REBALANCE_WHEN = `돈이 필요할 때, 또는 계좌 목표 비중에서 ${REBALANCE_BAND_PP}%p 넘게 벗어났을 때만 일부 옮겨요. 새로 넣는 돈으로 먼저 맞추고, 확인은 월 1회면 충분해요.`

export function resolveHoldingAction(input: HoldingActionInput): HoldingAction {
  const bucket = classifyHolding(input.code, input.name)
  const pnl = input.pnlPct != null && Number.isFinite(input.pnlPct) ? input.pnlPct : null
  const weight = input.accountWeightPct != null && Number.isFinite(input.accountWeightPct) ? input.accountWeightPct : null

  if (input.isBotAccount) {
    return {
      bucket, role: '봇 가상 계좌', tone: 'keep', verdict: '봇이 관리',
      todo: '봇이 규칙대로 사고팝니다. 직접 할 일은 없어요.',
      now: pnlLine(pnl, '봇의 손절·익절 규칙이 따로 지켜보고 있어요.'),
      when: '실계좌에서 따라 하고 싶을 때만 "따라 사기"에서 기록하세요.',
    }
  }

  switch (bucket) {
    case 'kr_index':
    case 'global_index':
      return {
        bucket, role: '성장 (지수)', tone: 'keep', verdict: '계속 보유',
        todo: '팔 이유가 없어요. 새로 넣을 돈도 여기에 넣으면 됩니다.',
        now: pnlLine(pnl, '지수에서는 흔한 흔들림이라 가격을 보고 대응하지 않아요.'),
        when: REBALANCE_WHEN,
      }
    case 'dividend':
      return {
        bucket, role: '인컴 (배당)', tone: 'keep', verdict: '계속 보유',
        todo: '분배금을 받는 자리예요. 주가보다 분배금이 꾸준히 나오는지가 중요해요.',
        now: pnlLine(pnl, '분배금은 주가와 따로 나오니 내렸다고 팔지 않아요.'),
        when: `분배금이 1년 전보다 크게 줄었을 때 점검하고, 그 밖에는 ${REBALANCE_WHEN}`,
      }
    case 'covered_call': {
      const share = input.coveredCallShareOfIncomePct
      const over = share != null && Number.isFinite(share) && share > COVERED_CALL_MAX_SHARE_PCT + 0.5
      return {
        bucket, role: '인컴 (커버드콜)', tone: over ? 'watch' : 'keep',
        verdict: over ? '보유 · 추가는 배당으로' : '계속 보유',
        todo: over
          ? `이 계좌 인컴의 ${share!.toFixed(0)}%가 커버드콜이에요. 팔 필요는 없고, 새 돈은 배당 ETF에 넣어 1/3 이하로 낮추세요.`
          : '높은 분배금을 받는 대신 오를 때 덜 오르는 상품이에요. 인컴의 1/3 이하로만 들고 가세요.',
        now: pnlLine(pnl, '분배금을 많이 주는 만큼 가격은 천천히 깎일 수 있어요.'),
        when: '장기로는 지수보다 연 4~11%p 뒤처졌어요. 분배금이 줄거나 커버드콜 비중이 인컴의 1/3을 넘으면 새 돈부터 다른 곳으로 돌립니다.',
      }
    }
    case 'reit_infra':
      return {
        bucket, role: '인컴 (리츠·인프라)', tone: 'keep', verdict: '계속 보유',
        todo: '임대료·사용료로 분배금을 주는 자리예요.',
        now: pnlLine(pnl, '금리가 오를 때 크게 흔들리는 자산이에요(2022년 −34~−54%).'),
        when: `금리가 빠르게 오르는 시기엔 비중을 늘리지 마세요. 그 밖에는 ${REBALANCE_WHEN}`,
      }
    case 'bond_cash':
      return {
        bucket, role: '현금성', tone: 'keep', verdict: '계속 보유',
        todo: '주식이 크게 빠졌을 때 옮겨 담을 돈이에요.',
        now: pnlLine(pnl, '금리 변동으로 잠깐 흔들릴 수 있어요.'),
        when: '주식이 크게 빠져 목표 비중보다 줄면 여기서 옮겨 채웁니다.',
      }
    case 'leveraged':
      return {
        bucket, role: '레버리지·인버스', tone: 'act', verdict: '줄이기 검토',
        todo: '오래 들고 가면 세후 이득이 없었던 상품이에요. 산 목적이 끝났으면 정리하세요.',
        now: pnlLine(pnl, '하락장에서 손실이 배로 커질 수 있어요.'),
        when: '정리한 돈은 지수 ETF로 옮기는 게 기본이에요.',
      }
    default: {
      // 개별주·테마 ETF: 오를지 판단하지 않고 비중·손실·과열 경고로만 안내한다
      if (weight != null && weight > STOCK_LIMIT_PCT) {
        return {
          bucket, role: bucket === 'stock' ? '개별주' : '테마 ETF', tone: 'act', verdict: '일부 줄이기',
          todo: `한 종목이 계좌의 ${weight.toFixed(0)}%예요. ${STOCK_LIMIT_PCT}% 안으로 줄여 지수로 옮기세요.`,
          now: pnlLine(pnl, '손실 중이면 한 번에 말고 나눠서 줄여도 돼요.'),
          when: '비중이 한도 안으로 들어오면 그다음은 보유만 합니다.',
        }
      }
      if (input.weightCaution) {
        return {
          bucket, role: bucket === 'stock' ? '개별주' : '테마 ETF', tone: 'watch', verdict: '추가매수 멈춤',
          todo: '과열 신호가 켜졌어요. 더 사지 말고, 많이 올랐다면 일부 차익을 검토하세요.',
          now: input.weightCaution.message || pnlLine(pnl, ''),
          when: '고점 시점은 못 맞혀요. 전부 팔기보다 비중을 줄이는 용도로만 쓰세요.',
        }
      }
      if (pnl != null && pnl <= LOSS_STOP_ADD_PCT) {
        return {
          bucket, role: bucket === 'stock' ? '개별주' : '테마 ETF', tone: 'watch', verdict: '추가매수 멈춤',
          todo: '물타기는 하지 말고, 새 돈은 지수에 넣으세요.',
          now: `평단보다 ${pct(pnl)} — 지금 팔면 손실이 확정돼요.`,
          when: '반등을 기다릴지, 정리하고 지수로 옮길지 미리 정해 두세요. 이 종목이 오를지는 시스템도 맞히지 못해요.',
        }
      }
      return {
        bucket, role: bucket === 'stock' ? '개별주' : '테마 ETF', tone: 'keep', verdict: '보유 · 추가는 지수로',
        todo: weight != null ? `계좌의 ${weight.toFixed(0)}%로 한도(${STOCK_LIMIT_PCT}%) 안이에요. 들고 가되 새 돈은 지수로.` : '들고 가되 새 돈은 지수에 넣으세요.',
        now: pnlLine(pnl, '종목 하나의 흔들림은 지수보다 커요.'),
        when: `비중이 ${STOCK_LIMIT_PCT}%를 넘거나 평단보다 ${Math.abs(LOSS_STOP_ADD_PCT)}% 넘게 내리면 다시 안내해요.`,
      }
    }
  }
}

/** 계좌별 평가금 합계와 인컴 중 커버드콜 비중 — 카드마다 같은 계좌 기준으로 비중을 매기기 위해 */
export function summarizeAccounts(rows: Array<{ accountKey: string; code: string; name: string | null | undefined; value: number }>) {
  const total = new Map<string, number>()
  const income = new Map<string, number>()
  const covered = new Map<string, number>()
  for (const r of rows) {
    if (!(r.value > 0)) continue
    total.set(r.accountKey, (total.get(r.accountKey) ?? 0) + r.value)
    const b = classifyHolding(r.code, r.name)
    if (b === 'dividend' || b === 'covered_call' || b === 'reit_infra') income.set(r.accountKey, (income.get(r.accountKey) ?? 0) + r.value)
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
  }
}

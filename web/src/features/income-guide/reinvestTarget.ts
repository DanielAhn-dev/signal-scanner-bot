/**
 * 받은 분배금을 다시 살 곳 — 분배금은 그 종목이 있는 계좌로 들어오고 그 계좌 안에서 다시 산다.
 * 서버 rebalancePlan의 계좌별 살 곳(buyTargetsByAccount, 리포트와 같은 함수)으로 이 달 받은 종목들의 계좌를 따라간다.
 * 계좌별 자료가 없으면(예전 서버) 전체 기준 살 곳 하나.
 */
type AccountTarget = { accountLabel: string; target: { code: string; name: string } }
type PlanLike = { buyTarget?: { name: string } | null; buyTargetsByAccount?: AccountTarget[] } | null | undefined

export type ReinvestTarget = { accountLabel: string | null; name: string }

export function reinvestTargets(plan: PlanLike, receiptCodes: string[], holdings: Array<{ code: string; accountLabel: string }>): ReinvestTarget[] {
  const byAccount = plan?.buyTargetsByAccount ?? []
  const labels = new Set(holdings.filter((h) => receiptCodes.includes(h.code)).map((h) => h.accountLabel))
  const out = byAccount.filter((a) => labels.has(a.accountLabel)).map((a) => ({ accountLabel: a.accountLabel, name: a.target.name }))
  if (out.length > 0) {
    // 모든 계좌가 같은 상품이면 계좌 이름 없이 하나로
    return new Set(out.map((o) => o.name)).size === 1 ? [{ accountLabel: null, name: out[0].name }] : out
  }
  return plan?.buyTarget ? [{ accountLabel: null, name: plan.buyTarget.name }] : []
}

/** 한 줄 표기 — "KIWOOM 200TR" 또는 "카카오 / 일반: KIWOOM 200TR · 미래 / ISA: TIGER 미국S&P500" */
export function reinvestLabel(targets: ReinvestTarget[]): string | null {
  if (targets.length === 0) return null
  return targets.map((t) => (t.accountLabel ? `${t.accountLabel}: ${t.name}` : t.name)).join(' · ')
}

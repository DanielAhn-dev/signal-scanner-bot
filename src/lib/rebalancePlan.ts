/**
 * 리밸런싱 "할 일" — 실계좌 보유를 넣으면 첫 화면에 보여 줄 세 가지를 계산한다(주문은 하지 않는다).
 *   ① 새 돈·남는 분배금은 성장 ETF 한 곳으로
 *   ② 겹치는 인컴 종목 합치기 (같은 계좌·같은 지역·같은 바구니 안에서만 — 인컴은 거의 그대로)
 *   ③ 파는 건 월 인컴 하한(settings.monthlyNeed, 세후) 아래로 내려가지 않는 만큼만
 *
 * 바구니 목표 비중만 보는 주문안(buildIncomeGuideView의 rebalance)은 "인컴 하한"을 몰라서 생활비 분배금을 깎는 매도를
 * 낼 수 있었다. 여기서는 하한을 먼저 지키고, 성장 비중은 새 돈으로 채우는 것을 기본으로 둔다(2026-10-13 사용자 요청).
 *
 * 분배율은 종목별 최근 12개월 실제값, 없으면 상품 유형별 가정(resolveYieldPct)이다. 사용자가 실제 월 입금액(settings.actualMonthlyNet)을 넣으면
 * 종목별 추정을 같은 비율로 맞춰서 쓴다 — 매도로 줄어드는 인컴도 그 비율로 계산된다.
 */
import {
  REBALANCE_BAND_PP,
  isTaxAdvantagedAccount,
  resolveYieldPct,
  type YieldPctByCode,
  type IncomeGuideView,
  type AssetBucket,
  type BucketGroup,
  type GroupRow,
  type IncomeGuideSettings,
} from "./incomeGuide";

const DISTRIBUTION_TAX = 0.154;
/** 같은 계좌·같은 종류 안에서 전체의 이 비중(%) 미만이면 "소액"으로 보고 큰 종목에 합치자고 안내한다 */
export const SMALL_HOLDING_PCT = 3;
/** 총보수 차이가 이보다 작으면 비슷하다고 보고 보유금액이 큰 쪽을 남긴다 */
export const FEE_TIE_PP = 0.05;

const FOREIGN = /(미국|나스닥|S&P|다우존스|글로벌|선진|중국|차이나|일본|인도|베트남|유럽)/i;

export type PlanHolding = {
  code: string;
  name: string;
  quantity: number;
  price: number;
  value: number;
  accountKey: string;
  accountLabel: string;
  bucket: AssetBucket;
  group: BucketGroup;
  avgPrice?: number | null;
};

/** 상품 유형별 분배율 가정 — 정의는 incomeGuide(resolveYieldPct의 대체값)로 옮겼다 */
export { holdingYieldPct } from "./incomeGuide";

/** 같은 기초자산·같은 운용 방식이면 사실상 같은 상품이다 (예: KODEX·SOL 200타겟위클리커버드콜) */
export function strategyKey(name: string): string {
  const n = name.replace(/\s+/g, "");
  const base = /나스닥/.test(n)
    ? "ndx"
    : /S&P/i.test(n)
      ? "spx"
      : /다우존스/.test(n)
        ? "dow"
        : /밸류업/.test(n)
          ? "valueup"
          : /(200|코스피200)/.test(n)
            ? "k200"
            : // 고배당·배당 ETF는 운용사마다 지수가 달라 이름 전체로만 같다고 본다
              n.replace(/^(KODEX|TIGER|SOL|RISE|ACE|PLUS|HANARO|KOSEF|KBSTAR|ARIRANG|TIMEFOLIO|KIWOOM)/i, "");
  const style = /타겟/.test(n) && /위클리/.test(n) ? "target-weekly" : /위클리/.test(n) ? "weekly" : /액티브/.test(n) ? "active" : /타겟/.test(n) ? "target" : "basic";
  return `${base}|${style}`;
}

/** 남길 종목 — 총보수를 둘 다 알고 차이가 0.05%p 이상이면 싼 쪽, 아니면 보유금액이 큰 쪽 */
export function pickKeeper<T extends { code: string; value: number }>(members: T[], fees: Record<string, number> = {}): { keeper: T; byFee: boolean } {
  let keeper = members[0];
  let byFee = false;
  for (const m of members.slice(1)) {
    const fm = fees[m.code];
    const fk = fees[keeper.code];
    if (fm != null && fk != null && Math.abs(fm - fk) >= FEE_TIE_PP) {
      if (fm < fk) keeper = m;
    } else if (m.value > keeper.value) {
      keeper = m;
    }
  }
  // 남긴 이유가 보수인지 — 남긴 종목보다 더 큰 종목이 있으면 보수 때문에 고른 것이다
  byFee = members.some((m) => m !== keeper && m.value > keeper.value);
  return { keeper, byFee };
}

const ROLE_BUCKET_LABEL: Record<string, string> = { dividend: "고배당·배당", covered_call: "커버드콜", reit_infra: "리츠·인프라" };
/** 압축 역할 키("kr|covered_call")의 화면 이름 */
export function roleLabel(role: string): string {
  const [region, bucket] = role.split("|");
  return `${region === "us" ? "해외" : "한국"} ${ROLE_BUCKET_LABEL[bucket] ?? bucket}`;
}

/** 같은 지수 성장 ETF를 알아보는 키 — 운용사 이름과 끝의 TR만 뗀다 ("KODEX 200"·"TIGER 200"·"KODEX 200TR"). 헤지(H)·다른 지수는 따로 본다 */
export function indexOverlapKey(name: string): string | null {
  const m = String(name ?? "").trim().match(/^\S+\s+(.+)$/);
  const rest = m ? m[1].replace(/\s+/g, "").replace(/TR$/i, "") : "";
  return rest.length >= 2 ? rest : null;
}

export type PlanMerge = {
  from: { code: string; name: string; accountLabel: string; shares: number; amount: number; realizedGain: number | null };
  to: { code: string; name: string; accountLabel: string; price: number; shares: number; amount: number };
  reason: string;
  /** 합친 뒤 월 인컴(세후) 변화 추정 */
  monthlyIncomeDelta: number;
  /** 일반 계좌의 해외 기초 ETF — 매매차익에 15.4%가 붙는다 */
  taxedGain: boolean;
};

export type RebalancePlan = {
  /** 맨 위 한 줄 */
  headline: string;
  income: {
    monthlyNet: number;
    source: "actual" | "estimate";
    estimateNet: number;
    floor: number;
    /** 하한을 넘는 금액 (음수면 모자람) */
    surplus: number;
  };
  growth: {
    actualPct: number;
    targetPct: number;
    /** 새 돈만으로 목표 비중까지 필요한 금액 (이미 넘었으면 0) */
    needByNewMoney: number;
    monthlyInflow: number;
    months: number | null;
  };
  /** ① 새 돈을 넣을 성장 ETF (보유 중인 것 중에서). 없으면 null → buyHint만 */
  buyTarget: { code: string; name: string; accountLabel: string; price: number } | null;
  buyHint: string;
  /** ② 합치기 */
  merges: PlanMerge[];
  kinds: { before: number; after: number };
  mergeIncomeDelta: number;
  /** 인컴 종목 압축 (settings.incomeKindsTarget이 있을 때만). 역할(지역×바구니)별 대표 하나로 합친 결과 */
  compress: {
    /** 남기고 싶은 인컴 종목 수 */
    target: number;
    /** 인컴 종목 수 — 합치기 전/후 */
    before: number;
    after: number;
    reached: boolean;
    /** 압축 뒤 월 인컴(세후)과 하한 */
    incomeAfter: number;
    floor: number;
    roles: Array<{
      key: string;
      label: string;
      keeper: { code: string; name: string } | null;
      byUser: boolean;
      why: string;
      kept: Array<{ code: string; name: string }>;
      merged: Array<{ code: string; name: string }>;
    }>;
    /** 합치지 못한 종목과 이유 */
    blocked: Array<{ code: string; name: string; role: string; reason: string }>;
  } | null;
  /** 인컴을 분배금으로만 줄여 가는 중인지 (settings.incomeMode "hold") */
  hold: boolean;
  /**
   * 현금 목표 (hold일 때만). 처음엔 분배금·새 돈으로만 채우고(filling), 한 번 닿은 뒤에는 목표 ±band를 벗어날 때만
   * 지수를 팔아 채우거나(take-profit, 규칙형 익절) 넘는 현금으로 지수를 산다(buy-index). C14 "새 돈 먼저 + 밴드 밖에서만 매매".
   */
  cash: {
    value: number;
    actualPct: number;
    targetPct: number;
    bandPp: number;
    state: "filling" | "ok" | "take-profit" | "buy-index";
    /** filling: 목표까지 남은 금액, take-profit: 팔 금액, buy-index: 살 금액 */
    amount: number;
    /** filling일 때 분배금·새 돈으로 목표까지 걸리는 달 수 */
    months: number | null;
    /** take-profit일 때 팔 지수 종목 */
    sellFrom: { code: string; name: string; accountLabel: string; price: number; shares: number } | null;
  } | null;
  /** ③ 팔아서 더 빨리 옮길 때: 하한을 지키는 최대 매도 */
  trim: {
    code: string;
    name: string;
    accountLabel: string;
    price: number;
    maxAmount: number;
    maxShares: number;
    /** 100만원 팔 때 줄어드는 월 인컴(세후) */
    incomeLossPerMillion: number;
    note: string;
  } | null;
};

const man = (v: number) => `${Math.round(v / 10_000).toLocaleString("ko-KR")}만원`;

export function buildRebalancePlan(input: {
  holdings: PlanHolding[];
  total: number;
  groups: GroupRow[];
  settings: IncomeGuideSettings;
  cashPlan?: IncomeGuideView["cashPlan"];
  /** 종목별 최근 12개월 실제 분배율 — 없으면 상품 유형별 가정 */
  yieldPctByCode?: YieldPctByCode | null;
}): RebalancePlan | null {
  const { holdings, total, groups, settings } = input;
  const hold = settings.incomeMode === "hold";
  if (total <= 0 || holdings.length === 0) return null;
  const fees = settings.feePctByCode ?? {};
  const keep = (h: PlanHolding) => (isTaxAdvantagedAccount(h.accountLabel) ? 1 : 1 - DISTRIBUTION_TAX);
  const yieldOf = (h: PlanHolding) => resolveYieldPct(h.code, h.bucket, h.name, input.yieldPctByCode).pct;
  const rawNet = (h: PlanHolding, value = h.value) => (value * yieldOf(h)) / 100 / 12 * keep(h);

  // 인컴: 추정 → 실제 입금액이 있으면 그 비율로 보정
  const estimateNet = holdings.reduce((s, h) => s + (h.code === "CASH" ? 0 : rawNet(h)), 0);
  const actual = settings.actualMonthlyNet && settings.actualMonthlyNet > 0 ? settings.actualMonthlyNet : null;
  const scale = actual && estimateNet > 0 ? actual / estimateNet : 1;
  const netOf = (h: PlanHolding, value = h.value) => rawNet(h, value) * scale;
  const monthlyNet = actual ?? estimateNet;
  const floor = Math.max(0, settings.monthlyNeed);
  const surplus = monthlyNet - floor;

  // ② 합치기 — 같은 계좌·같은 지역·같은 바구니(배당/커버드콜/리츠)끼리만
  const families = new Map<string, PlanHolding[]>();
  for (const h of holdings) {
    if (h.group !== "income") continue;
    const k = `${h.accountKey}|${FOREIGN.test(h.name) ? "us" : "kr"}|${h.bucket}`;
    families.set(k, [...(families.get(k) ?? []), h]);
  }
  const merges: PlanMerge[] = [];
  const mergedAway = new Set<PlanHolding>();
  /** src 전량을 팔아 dst를 살 때 월 인컴(세후) 변화 */
  const mergeDelta = (src: PlanHolding, dst: PlanHolding) => {
    const amount = Math.round(src.quantity * src.price);
    return netOf(dst, Math.floor(amount / dst.price) * dst.price) - netOf(src);
  };
  const toMerge = (src: PlanHolding, dst: PlanHolding, reason: string) => {
    const amount = Math.round(src.quantity * src.price);
    const shares = Math.floor(amount / dst.price);
    mergedAway.add(src);
    merges.push({
      from: {
        code: src.code,
        name: src.name,
        accountLabel: src.accountLabel,
        shares: src.quantity,
        amount,
        realizedGain: src.avgPrice && src.avgPrice > 0 ? Math.round((src.price - src.avgPrice) * src.quantity) : null,
      },
      to: { code: dst.code, name: dst.name, accountLabel: dst.accountLabel, price: dst.price, shares, amount: Math.round(shares * dst.price) },
      reason,
      monthlyIncomeDelta: Math.round(netOf(dst, shares * dst.price) - netOf(src)),
      taxedGain: !isTaxAdvantagedAccount(src.accountLabel) && FOREIGN.test(src.name),
    });
  };
  const keeperReason = (keeper: PlanHolding, byFee: boolean) =>
    byFee ? `총보수 ${fees[keeper.code]}%로 더 싼 쪽을 남김` : "보유금액이 큰 쪽을 남김";
  for (const members of families.values()) {
    if (members.length < 2) continue;
    // 1) 같은 기초자산·같은 방식끼리
    const clusters = new Map<string, PlanHolding[]>();
    for (const m of members) clusters.set(strategyKey(m.name), [...(clusters.get(strategyKey(m.name)) ?? []), m]);
    for (const c of clusters.values()) {
      if (c.length < 2) continue;
      const { keeper, byFee } = pickKeeper(c, fees);
      for (const m of c) if (m !== keeper) toMerge(m, keeper, `같은 지수·같은 방식 상품 · ${keeperReason(keeper, byFee)}`);
    }
    // 2) 남은 것 중 소액은 같은 종류의 대표 종목으로
    const survivors = members.filter((m) => !mergedAway.has(m));
    if (survivors.length < 2) continue;
    const { keeper, byFee } = pickKeeper(survivors, fees);
    for (const m of survivors) {
      const p = (m.value / total) * 100;
      if (m !== keeper && p < SMALL_HOLDING_PCT) toMerge(m, keeper, `소액(전체의 ${p.toFixed(1)}%) · 같은 종류 · ${keeperReason(keeper, byFee)}`);
    }
  }

  // ②-a 같은 지수 성장 ETF 겹침 (설정에서 켰을 때만) — 같은 계좌 안, 일반 계좌는 분배금 과세를 미루는 TR형을 남긴다
  if (settings.indexOverlapMerge) {
    const sameIdx = new Map<string, PlanHolding[]>();
    for (const h of holdings) {
      if (h.group !== "growth" || mergedAway.has(h)) continue;
      const key = indexOverlapKey(h.name);
      if (key) sameIdx.set(`${h.accountKey}|${key}`, [...(sameIdx.get(`${h.accountKey}|${key}`) ?? []), h]);
    }
    for (const members of sameIdx.values()) {
      if (members.length < 2) continue;
      const trMembers = members.filter((m) => /TR\s*$/i.test(m.name.trim()));
      const preferTr = !isTaxAdvantagedAccount(members[0].accountLabel) && trMembers.length > 0;
      const { keeper, byFee } = pickKeeper(preferTr ? trMembers : members, fees);
      const why = preferTr ? `일반 계좌라 분배금 과세를 미루는 TR형을 남김${trMembers.length > 1 ? ` · ${keeperReason(keeper, byFee)}` : ""}` : keeperReason(keeper, byFee);
      for (const m of members) if (m !== keeper) toMerge(m, keeper, `같은 지수 겹침 · ${why}`);
    }
  }

  // ②-b 인컴 종목 압축 — 목표 종목 수가 있으면 역할(지역×바구니)별 대표 하나로 더 합친다. 월 인컴 하한과 같은 계좌 안 이동은 지킨다.
  const incomeKindsBefore = new Set(holdings.filter((h) => h.group === "income").map((h) => h.code)).size;
  let compress: RebalancePlan["compress"] = null;
  const target = settings.incomeKindsTarget;
  if (target && target >= 1) {
    const roleOf = (h: PlanHolding) => `${FOREIGN.test(h.name) ? "us" : "kr"}|${h.bucket}`;
    const alive = (h: PlanHolding) => h.group === "income" && !mergedAway.has(h);
    const roles = new Map<string, PlanHolding[]>();
    for (const h of holdings.filter((x) => x.group === "income")) roles.set(roleOf(h), [...(roles.get(roleOf(h)) ?? []), h]);
    const aliveCodes = () => new Set(holdings.filter(alive).map((h) => h.code));
    const dstCodes = new Set(merges.map((m) => m.to.code));

    // 역할별 대표 — 직접 고른 것(보유 중일 때만) → 월 인컴이 큰 상품 → 보수·금액 (pickKeeper)
    const keeperOf = new Map<string, { code: string; byUser: boolean; why: string }>();
    for (const [role, hs] of roles) {
      const live = hs.filter(alive);
      const byCode = new Map<string, { code: string; value: number }>();
      for (const h of live) byCode.set(h.code, { code: h.code, value: (byCode.get(h.code)?.value ?? 0) + h.value });
      const codesInRole = [...byCode.values()];
      if (codesInRole.length === 0) continue;
      const chosen = settings.roleKeepers?.[role];
      if (chosen && byCode.has(chosen)) {
        keeperOf.set(role, { code: chosen, byUser: true, why: "직접 고른 대표" });
        continue;
      }
      let best = pickKeeper(codesInRole, fees).keeper;
      let why = codesInRole.length > 1 ? "보유금액이 큰 쪽" : "";
      const yieldOfCode = (code: string) => yieldOf(live.find((h) => h.code === code)!);
      // 앞 단계에서 이미 다른 종목을 받아 주는 종목은 다시 팔 수 없으니 대표로 우선한다
      const receiving = codesInRole.filter((c) => dstCodes.has(c.code)).sort((a, b) => b.value - a.value)[0];
      if (receiving) {
        best = receiving;
        why = "이미 같은 상품을 합쳐 받는 쪽";
      } else {
        for (const c of codesInRole) {
          if (c.code !== best.code && yieldOfCode(c.code) - yieldOfCode(best.code) >= 1) {
            best = c;
            why = "월 인컴(분배율)이 더 큰 쪽";
          }
        }
      }
      keeperOf.set(role, { code: best.code, byUser: false, why });
    }

    const blocked: NonNullable<RebalancePlan["compress"]>["blocked"] = [];
    // 작은 종목부터 한 종목(코드) 단위로 — 그 종목이 있는 모든 계좌에서 같은 계좌의 대표로 옮길 수 있을 때만
    const units: Array<{ role: string; code: string; value: number }> = [];
    for (const [role, hs] of roles) {
      const k = keeperOf.get(role);
      if (!k) continue;
      const byCode = new Map<string, number>();
      for (const h of hs.filter(alive)) if (h.code !== k.code) byCode.set(h.code, (byCode.get(h.code) ?? 0) + h.value);
      for (const [code, value] of byCode) units.push({ role, code, value });
    }
    units.sort((a, b) => a.value - b.value);
    let delta = [...merges].reduce((s, m) => s + m.monthlyIncomeDelta, 0);
    for (const u of units) {
      if (aliveCodes().size <= target) break;
      const k = keeperOf.get(u.role)!;
      const srcs = holdings.filter((h) => alive(h) && h.code === u.code && roleOf(h) === u.role);
      if (srcs.length === 0) continue;
      const name = srcs[0].name;
      if (dstCodes.has(u.code)) {
        blocked.push({ code: u.code, name, role: u.role, reason: "이미 같은 상품을 합쳐 받는 종목이라 한 번에 두 번 옮길 수 없습니다 (먼저 합친 뒤 다시 확인)" });
        continue;
      }
      const pairs = srcs.map((s) => ({ s, d: holdings.find((h) => alive(h) && h.code === k.code && h.accountKey === s.accountKey) }));
      if (pairs.some((p) => !p.d)) {
        blocked.push({ code: u.code, name, role: u.role, reason: "같은 계좌에 대표 종목이 없어 계좌를 바꾸지 않고는 합칠 수 없습니다" });
        continue;
      }
      const unitDelta = pairs.reduce((s, p) => s + mergeDelta(p.s, p.d!), 0);
      const now = monthlyNet + delta;
      if (now + unitDelta < Math.min(floor, now)) {
        blocked.push({ code: u.code, name, role: u.role, reason: `합치면 월 인컴이 ${man(floor)} 아래(${man(now + unitDelta)})로 내려갑니다` });
        continue;
      }
      for (const p of pairs) {
        delta += mergeDelta(p.s, p.d!);
        toMerge(p.s, p.d!, `역할별 대표로 압축(${roleLabel(u.role)}) · ${k.byUser ? "직접 고른 대표" : k.why || "대표 종목"}`);
      }
    }

    const outRoles: NonNullable<RebalancePlan["compress"]>["roles"] = [];
    for (const [role, hs] of roles) {
      const k = keeperOf.get(role);
      const live = new Map(hs.filter(alive).map((h) => [h.code, h.name]));
      const gone = new Map(hs.filter((h) => mergedAway.has(h) && !live.has(h.code)).map((h) => [h.code, h.name]));
      const keeperName = hs.find((h) => h.code === k?.code)?.name ?? "";
      outRoles.push({
        key: role,
        label: roleLabel(role),
        keeper: k ? { code: k.code, name: keeperName } : null,
        byUser: k?.byUser ?? false,
        why: k?.why ?? "",
        kept: [...live].map(([code, name]) => ({ code, name })),
        merged: [...gone].map(([code, name]) => ({ code, name })),
      });
    }
    outRoles.sort((a, b) => b.merged.length - a.merged.length || a.key.localeCompare(b.key));
    const after = aliveCodes().size;
    compress = { target, before: incomeKindsBefore, after, reached: after <= target, incomeAfter: Math.round(monthlyNet + delta), floor, roles: outRoles, blocked };
  }

  merges.sort((a, b) => b.from.amount - a.from.amount);
  const mergeIncomeDelta = merges.reduce((s, m) => s + m.monthlyIncomeDelta, 0);
  const codes = new Set(holdings.map((h) => h.code));
  const remainingCodes = new Set(holdings.filter((h) => !mergedAway.has(h)).map((h) => h.code));

  // ① 새 돈을 넣을 곳 — 일반 계좌면 분배금 과세를 미루는 TR, 아니면 가장 큰 성장 ETF
  const growthRows = holdings.filter((h) => h.group === "growth" && !mergedAway.has(h)).sort((a, b) => b.value - a.value);
  const trInTaxable = growthRows.find((h) => /TR/i.test(h.name) && !isTaxAdvantagedAccount(h.accountLabel));
  const buy = trInTaxable ?? growthRows[0] ?? null;
  const buyTarget = buy ? { code: buy.code, name: buy.name, accountLabel: buy.accountLabel, price: buy.price } : null;
  const buyHint = buy
    ? trInTaxable
      ? "일반 계좌에서는 분배금을 재투자해 과세를 미루는 TR형이 유리합니다. 기존 성장 ETF는 팔지 않고 그대로 둡니다."
      : "이미 가진 성장 ETF 한 곳에만 넣습니다. 여러 곳에 나눠 사면 종류만 늘어납니다."
    : "성장 ETF가 없습니다. 일반 계좌는 코스피200 TR형, ISA·연금 계좌는 S&P500 같은 해외 지수가 과세 면에서 유리합니다.";

  // 성장 목표까지
  const g = groups.find((x) => x.group === "growth");
  const actualPct = g?.actualPct ?? 0;
  const targetPct = g?.targetPct ?? 0;
  const t = targetPct / 100;
  const growthValue = g?.value ?? 0;
  const needByNewMoney = t < 1 && t * total > growthValue ? Math.round((t * total - growthValue) / (1 - t)) : 0;
  const monthlyInflow = Math.max(0, surplus + mergeIncomeDelta) + Math.max(0, settings.monthlyContribution ?? 0);
  const months = needByNewMoney > 0 && monthlyInflow > 0 ? Math.ceil(needByNewMoney / monthlyInflow) : null;

  // ③ 팔아서 옮길 후보 — 합치고 남은 커버드콜 중 분배율이 가장 낮은 것(같은 돈을 팔 때 인컴이 가장 덜 준다)
  const candidates = holdings
    .filter((h) => h.bucket === "covered_call" && !mergedAway.has(h))
    .sort((a, b) => yieldOf(a) - yieldOf(b) || b.value - a.value);
  const c = candidates[0];
  let trim: RebalancePlan["trim"] = null;
  if (c && needByNewMoney > 0 && !hold) {
    const perWon = netOf(c, 1);
    const room = surplus + mergeIncomeDelta;
    const gap = Math.max(0, t * total - growthValue); // 팔아서 옮기면 총액은 그대로
    const byFloor = perWon > 0 ? Math.max(0, room) / perWon : 0;
    const maxAmount = Math.max(0, Math.min(c.value, gap, byFloor));
    const maxShares = Math.floor(maxAmount / c.price);
    trim = {
      code: c.code,
      name: c.name,
      accountLabel: c.accountLabel,
      price: c.price,
      maxAmount: Math.round(maxShares * c.price),
      maxShares,
      incomeLossPerMillion: Math.round(perWon * 1_000_000),
      note:
        room <= 0
          ? `월 인컴이 목표(${man(floor)})에 여유가 없어 지금은 팔지 않습니다. 새 돈으로만 옮기세요.`
          : maxShares <= 0
            ? "여유가 1주 값보다 작아 지금은 팔 것이 없습니다."
            : `팔아도 월 인컴이 ${man(floor)} 아래로 내려가지 않는 최대치입니다. 한 번에 다 팔 필요는 없습니다.`,
    };
  }

  // 현금 목표 (hold일 때만)
  let cash: RebalancePlan["cash"] = null;
  const cp = input.cashPlan;
  if (hold && cp && cp.targetPct > 0) {
    const bandPp = Math.min(REBALANCE_BAND_PP, Math.max(2, cp.targetPct / 2));
    const targetValue = (cp.targetPct / 100) * total;
    const inflow = Math.max(0, monthlyNet) + Math.max(0, settings.monthlyContribution ?? 0);
    let state: NonNullable<RebalancePlan["cash"]>["state"] = "ok";
    let amount = 0;
    let sellFrom: NonNullable<RebalancePlan["cash"]>["sellFrom"] = null;
    if (!cp.reached) {
      state = "filling";
      amount = Math.max(0, Math.round(targetValue - cp.value));
    } else if (cp.actualPct < cp.targetPct - bandPp) {
      // 지수가 올라 현금 비중이 밴드 아래로 — 목표까지 지수 일부를 판다 (판단이 아니라 비중 규칙)
      const idx = holdings.filter((h) => h.bucket === "kr_index" || h.bucket === "global_index").sort((a, b) => b.value - a.value)[0];
      const want = Math.max(0, targetValue - cp.value);
      if (idx && want >= 10_000) {
        const shares = Math.min(idx.quantity, Math.ceil(want / idx.price));
        state = "take-profit";
        amount = Math.round(shares * idx.price);
        sellFrom = { code: idx.code, name: idx.name, accountLabel: idx.accountLabel, price: idx.price, shares };
      }
    } else if (cp.actualPct > cp.targetPct + bandPp) {
      state = "buy-index";
      amount = Math.max(0, Math.round(cp.value - targetValue));
    }
    cash = {
      value: Math.round(cp.value),
      actualPct: cp.actualPct,
      targetPct: cp.targetPct,
      bandPp,
      state,
      amount,
      months: state === "filling" && amount > 0 && inflow > 0 ? Math.ceil(amount / inflow) : null,
      sellFrom,
    };
  }

  // 맨 위 한 줄
  const parts: string[] = [];
  if (hold) {
    parts.push("커버드콜·배당은 더 사지 않고 분배금으로 줄여 가는 중");
    if (cash?.state === "filling") parts.push(`현금 ${cash.actualPct.toFixed(0)}% → 목표 ${cash.targetPct.toFixed(0)}%: 분배금은 현금으로`);
    else if (cash?.state === "take-profit") parts.push(`현금이 ${cash.actualPct.toFixed(0)}%로 줄었습니다 — 지수 ${man(cash.amount)}어치를 팔아 채울 때`);
    else if (cash?.state === "buy-index") parts.push(`현금이 ${cash.actualPct.toFixed(0)}%로 많습니다 — ${man(cash.amount)}으로 지수를 살 때`);
    else parts.push("분배금·새 돈은 지수로");
  } else if (surplus < 0) parts.push(`월 인컴이 목표보다 ${man(-surplus)} 적습니다 — 지금은 인컴 유지가 먼저입니다`);
  if (merges.length > 0) parts.push(`겹치는 종목 ${merges.length}개를 합치면 ${codes.size}종 → ${remainingCodes.size}종`);
  if (compress) {
    parts.push(
      compress.reached
        ? `인컴 종목 ${compress.before}종 → ${compress.after}종 (목표 ${compress.target}종 · 월 인컴 ${man(compress.incomeAfter)})`
        : `인컴 종목 ${compress.before}종 → ${compress.after}종까지만 줄일 수 있습니다 (목표 ${compress.target}종)`,
    );
  }
  if (needByNewMoney > 0 && !hold) parts.push(`성장 ${actualPct.toFixed(0)}% → 목표 ${targetPct.toFixed(0)}%`);
  const headline = parts.length ? parts.join(" · ") : "지금은 바꿀 것이 없습니다. 새 돈은 계속 성장 ETF 한 곳으로 넣으세요.";

  return {
    headline,
    income: { monthlyNet: Math.round(monthlyNet), source: actual ? "actual" : "estimate", estimateNet: Math.round(estimateNet), floor, surplus: Math.round(surplus) },
    growth: { actualPct, targetPct, needByNewMoney, monthlyInflow: Math.round(monthlyInflow), months },
    buyTarget,
    buyHint,
    merges,
    kinds: { before: codes.size, after: remainingCodes.size },
    mergeIncomeDelta: Math.round(mergeIncomeDelta),
    compress,
    hold,
    cash,
    trim,
  };
}

/**
 * 코어 프로필 전향 측정 — 널리 알려진 자산배분을 한국 상장 ETF로 정의해 앞으로의 실제 성과를 쌓는다.
 *
 * 왜 따로 두나: 과거 데이터로 좋았던 구성을 고르면 후보가 많을수록 우연이 섞인다(백테스트 편향).
 * 그래서 구성·비중을 지금 고정하고, 기준일 이후 실제로 어떻게 됐는지만 본다. 결과를 본 뒤 구성을 바꾸지 않는다.
 * 종목 봇 승격 판정(reviewStrategies)과는 섞지 않는다 — NON_CANDIDATE_STRATEGIES에 들어 있다.
 *
 * 가격: 네이버 일봉 수정주가(분배금이 소급 반영된 총수익 가격). 운용 중 분배금이 나오는 채권·배당 ETF도 가격 하나로 총수익이 되므로
 * 따로 분배금을 더하지 않는다(이중 계산 금지 — 2026-10-02 확인). 기준일 이후 분배금이 반영되면 과거 가격도 같이 조정되므로
 * 매번 전체 이력을 다시 받아 기준일부터 계산한다.
 * 규칙: 기준일 종가에 목표 비중으로 시작, 매년 첫 거래일에 목표 비중으로 되돌림(편도 0.035% × 바뀐 비중). 세금은 넣지 않았다.
 */
import { STRATEGY_LABELS, maxDrawdown, type StrategyName, type StrategyResult } from "./strategyForwardTest";

export type CloseBar = { date: string; close: number };

/** 구성 ETF — 이름은 화면 표기용. 코드를 바꾸면 측정이 끊기므로 상품 폐지 전에는 바꾸지 않는다. */
export const PROFILE_ETFS: Record<string, string> = {
  "069500": "KODEX 200",
  "133690": "TIGER 미국나스닥100",
  "360750": "TIGER 미국S&P500",
  "148070": "KIWOOM 국고채10년",
  "453850": "ACE 미국30년국채액티브(H)",
  "308620": "KODEX 미국10년국채선물",
  "411060": "ACE KRX금현물",
  "459580": "KODEX CD금리액티브(합성)",
};

export type CoreProfile = { name: StrategyName; weights: Record<string, number> };

export const CORE_PROFILES: CoreProfile[] = [
  { name: "sp500-hold", weights: { "360750": 1 } },
  { name: "profile-growth-5050", weights: { "069500": 0.5, "360750": 0.5 } },
  { name: "profile-balanced-4", weights: { "069500": 0.3, "133690": 0.3, "148070": 0.25, "411060": 0.15 } },
  { name: "profile-allweather-kr", weights: { "360750": 0.3, "453850": 0.4, "308620": 0.15, "411060": 0.15 } },
  { name: "profile-permanent", weights: { "360750": 0.25, "453850": 0.25, "411060": 0.25, "459580": 0.25 } },
  { name: "profile-6040", weights: { "360750": 0.6, "308620": 0.4 } },
  { name: "profile-domestic", weights: { "069500": 0.4, "148070": 0.4, "411060": 0.2 } },
];

/** 측정에 필요한 모든 ETF 코드 */
export const PROFILE_CODES: string[] = [...new Set(CORE_PROFILES.flatMap((p) => Object.keys(p.weights)))];

const ETF_SIDE_COST = 0.00035;

/** 네이버 siseJson 응답 → 일별 종가. 날짜는 YYYY-MM-DD */
export function parseNaverSiseJson(text: string): CloseBar[] {
  const bars: CloseBar[] = [];
  const re = /\["(\d{8})",\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+),/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const close = Number(m[2]);
    if (close > 0) bars.push({ date: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`, close });
  }
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchNaverCloses(code: string, fromDate: string): Promise<CloseBar[]> {
  const from = fromDate.replace(/-/g, "");
  const url = `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${from}&endTime=20991231&timeframe=day`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`네이버 시세 ${code} ${res.status}`);
  return parseNaverSiseJson(await res.text());
}

/**
 * 한 프로필의 기준일 이후 총수익·낙폭. 구성 ETF가 모두 존재하는 거래일만 쓴다.
 * 기준일 직전 거래일 종가를 출발점(1)으로 삼아 기존 지수 전략(simulateIndexStrategies)과 같은 구간을 잰다.
 */
export function simulateCoreProfile(input: {
  profile: CoreProfile;
  closesByCode: Map<string, CloseBar[]>;
  startDate: string;
}): StrategyResult | null {
  const codes = Object.keys(input.profile.weights);
  const byDate = codes.map((c) => new Map((input.closesByCode.get(c) ?? []).map((b) => [b.date, b.close])));
  if (byDate.some((m) => m.size === 0)) return null;
  const dates = [...byDate[0].keys()].filter((d) => byDate.every((m) => m.has(d))).sort();
  const startIdx = dates.findIndex((d) => d >= input.startDate);
  if (startIdx < 1) return null;
  const target = codes.map((c) => input.profile.weights[c]);
  let cur = [...target];
  const equity = [1];
  for (let i = startIdx; i < dates.length; i += 1) {
    const grown = cur.map((w, k) => w * (byDate[k].get(dates[i])! / byDate[k].get(dates[i - 1])!));
    const sum = grown.reduce((a, b) => a + b, 0);
    let value = equity[equity.length - 1] * sum;
    cur = grown.map((g) => g / sum);
    const yearChanged = i + 1 < dates.length && dates[i + 1].slice(0, 4) !== dates[i].slice(0, 4);
    if (yearChanged) {
      // 다음 거래일(새해 첫 거래일) 시작 전에 목표 비중으로 되돌린다 — 바뀐 비중만큼 비용
      const turn = cur.reduce((a, w, k) => a + Math.abs(w - target[k]), 0);
      value *= 1 - turn * ETF_SIDE_COST;
      cur = [...target];
    }
    equity.push(value);
  }
  return {
    name: input.profile.name,
    label: STRATEGY_LABELS[input.profile.name],
    totalReturnPct: (equity[equity.length - 1] - 1) * 100,
    maxDrawdownPct: maxDrawdown(equity),
    periods: equity.length - 1,
  };
}

export function simulateAllCoreProfiles(closesByCode: Map<string, CloseBar[]>, startDate: string): StrategyResult[] {
  return CORE_PROFILES.map((profile) => simulateCoreProfile({ profile, closesByCode, startDate })).filter(
    (r): r is StrategyResult => r != null
  );
}

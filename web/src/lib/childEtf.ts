/**
 * 자녀 계좌에서 담을 수 있는 종목 기준 — 개별 종목은 막고 ETF만, 그중에서도 위험이 구조적으로 큰 유형은 뺀다.
 * 목적은 '오래 두는 계좌'다. 종목 이름만으로 판별하는 간단한 규칙이라 완벽하지 않으며, 애매하면 막는 쪽으로 기울인다.
 * 아직 화면의 가상 매매에 연결돼 있지 않다 — 자녀 계좌에 매매 기록·가상 계좌가 붙을 때 이 함수를 쓴다.
 */

/** 처음 보여주는 기본 후보 — 이미 비교·검증해 둔 코스피200·미국지수 ETF */
export const CHILD_ETF_DEFAULTS: Array<{ code: string; name: string; note: string }> = [
  { code: '069500', name: 'KODEX 200', note: '코스피200 — 규모가 가장 큰 국내 지수 ETF' },
  { code: '360750', name: 'TIGER 미국S&P500', note: '미국 대형주 지수 — 환율 영향을 같이 받습니다' },
]

type Rule = { re: RegExp; reason: string }

const BLOCKED: Rule[] = [
  { re: /레버리지|2X|3X|\bX2\b|곱버스/i, reason: '레버리지는 하락 때 손실이 빨리 커져 오래 두는 계좌에 맞지 않습니다' },
  { re: /인버스|숏|short|bear/i, reason: '인버스는 지수가 오를수록 손해라 장기 계좌에 맞지 않습니다' },
  { re: /커버드콜|프리미엄|옵션|버퍼|부스터/i, reason: '커버드콜·옵션형은 분배금이 커서 과세와 건강보험 소득에 먼저 잡히고 상승분을 놓칩니다' },
  { re: /\bETN\b|ETN$/i, reason: 'ETN은 발행사 신용위험이 있어 ETF만 허용합니다' },
  { re: /선물|원유|천연가스|VIX|변동성/i, reason: '선물·변동성 상품은 구조상 장기 보유에 불리합니다' },
  { re: /단일종목|\b1주\b|테슬라|엔비디아|애플|삼성전자|하이닉스/i, reason: '단일 종목에 몰리는 상품은 분산이 되지 않습니다' },
]

export type EtfCheck = { ok: boolean; reason: string }

export function childEtfCheck(name: string): EtfCheck {
  const n = name.trim()
  if (!n) return { ok: false, reason: '종목 이름을 입력하세요' }
  for (const r of BLOCKED) if (r.re.test(n)) return { ok: false, reason: r.reason }
  if (!/ETF|KODEX|TIGER|ACE|RISE|SOL|PLUS|KIWOOM|HANARO|ARIRANG|KOSEF|1Q|WON|TIMEFOLIO/i.test(n)) {
    return { ok: false, reason: 'ETF로 보이지 않습니다. 자녀 계좌는 ETF만 담습니다(개별 주식 불가)' }
  }
  return { ok: true, reason: '지수를 따라가는 일반 ETF로 보입니다. 상품 설명서에서 추종 지수를 한 번 더 확인하세요' }
}

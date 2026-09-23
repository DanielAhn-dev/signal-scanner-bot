/**
 * 시드 재계산(복리 반영).
 *
 * virtual_seed_capital은 원래 사용자가 처음 설정한 고정값이라, 포지션 사이징
 * (calculateAutoTradeBuySizing의 baseTargetBudget/maxPositionBudget)이 계좌가 아무리 불어나도
 * 항상 같은 기준으로만 계산됐다. 실현손익은 가용현금엔 반영되지만 "1종목당 몇 % 베팅할지"의
 * 기준 자체는 안 커져서, 번 돈이 재투자 없이 현금(→유휴현금 스윕)으로만 쌓이는 문제가 있었다.
 *
 * 이 모듈은 일정 주기(기본 7일)마다 그동안의 실현손익만큼 시드를 재계산한다.
 * 보유 중인 종목의 평가손익(미실현)은 포함하지 않는다 — 팔아서 확정된 손익만 반영해
 * 하루 시세 출렁임으로 포지션 사이징 기준이 흔들리는 걸 막기 위함이다.
 * 손실이 나면 시드도 같이 줄어든다(양방향) — 계좌가 줄어든 만큼 다음 베팅도 보수적으로 줄이는
 * 표준적인 리스크관리 방식.
 *
 * 재계산 후 virtual_realized_pnl은 0으로 리셋된다(그만큼 seed로 흡수됐으므로).
 * derivedCash = seedCapital + realizedPnl - invested 공식과 수학적으로 중립적이라
 * (newSeed + 0 == oldSeed + realizedPnl) 캐시 계산 로직은 건드릴 필요가 없다.
 */

const DEFAULT_MIN_INTERVAL_DAYS = 7;

export type SeedRebaseInput = {
  seedCapital: number;
  /** 마지막 재계산 이후 누적된 실현손익 (virtual_realized_pnl) */
  realizedPnl: number;
  lastRebaseAt: string | null | undefined;
  nowMs?: number;
  minIntervalDays?: number;
};

export type SeedRebaseResult = {
  shouldRebase: boolean;
  nextSeedCapital: number;
  /** 이번에 시드에 반영된 손익 (표시/로그용) */
  deltaApplied: number;
};

export function resolveSeedRebase(input: SeedRebaseInput): SeedRebaseResult {
  const seedCapital = Math.max(0, Math.round(input.seedCapital));
  const nowMs = input.nowMs ?? Date.now();
  const minIntervalDays = Math.max(1, input.minIntervalDays ?? DEFAULT_MIN_INTERVAL_DAYS);
  const lastMs = input.lastRebaseAt ? Date.parse(input.lastRebaseAt) : NaN;
  const dueForRebase =
    !Number.isFinite(lastMs) || nowMs - lastMs >= minIntervalDays * 24 * 60 * 60 * 1000;

  if (!dueForRebase || seedCapital <= 0) {
    return { shouldRebase: false, nextSeedCapital: seedCapital, deltaApplied: 0 };
  }

  const deltaApplied = Math.round(input.realizedPnl);
  if (deltaApplied === 0) {
    // 손익이 없으면 재계산할 것도 없으니 재계산 시각만 갱신할 필요는 없다 — 다음 실행에서 다시 판단
    return { shouldRebase: false, nextSeedCapital: seedCapital, deltaApplied: 0 };
  }

  const nextSeedCapital = Math.max(0, Math.round(seedCapital + deltaApplied));
  return { shouldRebase: true, nextSeedCapital, deltaApplied };
}

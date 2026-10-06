import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import { useUserState } from './userState'

/**
 * 우리 집 수입 — 가구 형태·본인/배우자 세후 월수입·급여일을 한곳에 둔다.
 * 시작하기·돈 흐름 '지금 상태 점검'·시드 만들기가 모두 이 값을 읽고, 어느 화면에서 고쳐도 바로 저장된다
 * (단계를 끝까지 마치지 않아도 남는다). 시드 만들기의 달별 기록은 그달 실제 값으로 따로 남는다.
 *
 * 저장값이 없던 사용자는 예전 기록에서 가져와 보여 준다: 시드 만들기의 최근 수입 → 최근 점검의 수입 합계.
 * 가져온 값은 사용자가 한 번 고치기 전까지 저장하지 않는다.
 */
export type Household = 'solo' | 'single-income' | 'dual-income'
export type HouseholdIncome = { household: Household; ownIncome: number; partnerIncome: number; ownPayday: number | null; partnerPayday: number | null }

export const HOUSEHOLDS: ReadonlyArray<[Household, string]> = [['solo', '혼자'], ['single-income', '외벌이'], ['dual-income', '맞벌이']]
export const EMPTY_HOUSEHOLD_INCOME: HouseholdIncome = { household: 'solo', ownIncome: 0, partnerIncome: 0, ownPayday: null, partnerPayday: null }

/** 수입 합계 — 맞벌이가 아니면 배우자 수입은 넣지 않는다 */
export const householdTotal = (h: HouseholdIncome) => h.ownIncome + (h.household === 'dual-income' ? h.partnerIncome : 0)

const amount = (v: unknown) => { const n = Math.round(Number(v)); return Number.isSafeInteger(n) && n > 0 ? n : 0 }
const payday = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null }

export function normalizeHouseholdIncome(raw: unknown): HouseholdIncome | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const household = HOUSEHOLDS.some(([h]) => h === r.household) ? r.household as Household : 'solo'
  const dual = household === 'dual-income'
  return { household, ownIncome: amount(r.ownIncome), partnerIncome: dual ? amount(r.partnerIncome) : 0, ownPayday: payday(r.ownPayday), partnerPayday: dual ? payday(r.partnerPayday) : null }
}

/** 가구 형태를 바꿀 때 — 맞벌이가 아니면 배우자 칸을 비운다 */
export const withHousehold = (h: HouseholdIncome, household: Household): HouseholdIncome =>
  ({ ...h, household, partnerIncome: household === 'dual-income' ? h.partnerIncome : 0, partnerPayday: household === 'dual-income' ? h.partnerPayday : null })

const kstMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 7)

/** 저장값이 없을 때 예전 기록에서 찾는다. 1월에는 올해 기록이 없을 수 있어 작년도 본다 */
async function deriveFromRecords(): Promise<HouseholdIncome | null> {
  const year = Number(kstMonth().slice(0, 4))
  const latest = (y: number) => apiFetch(`/api/ui/seed-builder?year=${y}`, { cacheMs: 0, retries: 0 })
    .then((res) => [...(Array.isArray(res?.data) ? res.data : [])].reverse().find((r: any) => Number(r?.ownIncome) > 0) ?? null)
    .catch(() => null)
  const seed = (await latest(year)) ?? (await latest(year - 1))
  if (seed) return normalizeHouseholdIncome(seed)
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const check = await apiFetch(`/api/ui/money-flow?from=${today}&to=${today}`, { cacheMs: 0, retries: 0 })
    .then((res) => (Array.isArray(res?.checks) ? res.checks[0] : null)).catch(() => null)
  // 점검에는 합계만 있다 — 나눠 적은 적이 없으니 혼자로 두고, 화면에서 고치게 한다
  const total = amount(check?.input?.monthlyIncome)
  return total > 0 ? { ...EMPTY_HOUSEHOLD_INCOME, ownIncome: total } : null
}

/**
 * value: 저장값(없으면 예전 기록에서 가져온 값, 그것도 없으면 null). saved: 저장값인지.
 * ready: 저장값 조회와 예전 기록 찾기가 끝났다는 뜻 — 그 전에는 빈 칸으로 덮어쓰지 않도록 화면이 기다린다.
 */
export function useHouseholdIncome(): { value: HouseholdIncome | null; saved: boolean; set: (next: HouseholdIncome) => void; ready: boolean } {
  const stored = useUserState<HouseholdIncome>('householdIncome')
  const storedValue = normalizeHouseholdIncome(stored.value)
  const [derived, setDerived] = useState<HouseholdIncome | null>(null)
  const [derivedDone, setDerivedDone] = useState(false)
  const needDerive = stored.ready && !storedValue
  useEffect(() => {
    if (!needDerive) return
    let cancelled = false
    void deriveFromRecords().then((v) => { if (!cancelled) { setDerived(v); setDerivedDone(true) } })
    return () => { cancelled = true }
  }, [needDerive])
  return {
    value: storedValue ?? derived,
    saved: !!storedValue,
    set: (next) => stored.set(normalizeHouseholdIncome(next) ?? EMPTY_HOUSEHOLD_INCOME),
    ready: !!storedValue || (stored.ready && derivedDone),
  }
}

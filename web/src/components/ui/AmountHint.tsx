import { formatKrwReadable } from '../../lib/format'

/**
 * 금액 입력칸 아래 "= 1억원" — 100000000처럼 숫자만 보면 자릿수가 감이 안 온다(2026-10-19 사용자 요청).
 * unit='man'(만원 입력)은 1억 이상일 때만 보인다 — 50만원을 "= 50만원"으로 다시 적는 건 군더더기라서.
 */
export default function AmountHint({ value, unit = 'won' }: { value: string | number; unit?: 'won' | 'man' }) {
  const n = Number(String(value).replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n <= 0) return null
  const won = unit === 'man' ? n * 10_000 : n
  if (won < (unit === 'man' ? 100_000_000 : 10_000)) return null
  return <small className="amount-hint" aria-live="polite">= {formatKrwReadable(won)}</small>
}

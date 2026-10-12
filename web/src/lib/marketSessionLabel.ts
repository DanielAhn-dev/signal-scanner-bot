import { isKrxTradingDay } from '../../../src/lib/krxCalendar'

/**
 * 상태줄의 장 상태 한 줄. 예전엔 "국장 본장 / 미장 데이터핫" 고정 문구라 장 마감 뒤·주말에도 그대로 떴다.
 * 국장은 KRX 휴장일 목록(src/lib/krxCalendar)을 쓰고, 미장은 휴장일 목록이 없어 요일·시각만 본다(그래서 '시간대'로 표기).
 */
export function krxSessionLabel(now: Date = new Date()): string {
  if (!isKrxTradingDay(now)) return '국장 휴장'
  const kst = new Date(now.getTime() + 9 * 3_600_000)
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes()
  if (minutes < 9 * 60) return '국장 개장 전'
  if (minutes < 15 * 60 + 30) return '국장 장중'
  return '국장 마감'
}

export function usSessionLabel(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekday = get('weekday')
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'))
  if (weekday === 'Sat' || weekday === 'Sun') return '미장 주말'
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60 ? '미장 정규장 시간' : '미장 장외 시간'
}

export function marketSessionLabel(now: Date = new Date()): string {
  return `${krxSessionLabel(now)} / ${usSessionLabel(now)}`
}

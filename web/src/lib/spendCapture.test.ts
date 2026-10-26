import { describe, expect, it } from 'vitest'
import { parseQuickLine } from '../../../src/lib/moneyFlow'
import { parseSpendCapture } from './spendCapture'

const today = '2026-10-26'

describe('지출 내역 캡처 읽기', () => {
  it('날짜 머리글 아래 줄들에 날짜를 붙이고 "이름 금액원"으로 돌려준다', () => {
    const text = `10월 9일 (목)
롯데마트(캠핑)    66,890원
다이소 화장품(경희) 2개    10,000원
10월 7일
다이소(과자 5개)    5,000원
일리윤 세라마이드 아토로션 무향    48,700원`
    const r = parseSpendCapture(text, today)
    expect(r.lines).toEqual([
      '2026-10-09 롯데마트(캠핑) 66,890원',
      '2026-10-09 다이소 화장품(경희) 2개 10,000원',
      '2026-10-07 다이소(과자 5개) 5,000원',
      '2026-10-07 일리윤 세라마이드 아토로션 무향 48,700원',
    ])
  })

  it('줄 앞 날짜(10/09)와 시각·구분 글자는 이름에서 떼고, 쉼표를 마침표로 읽어도 금액을 맞춘다', () => {
    const r = parseSpendCapture('10/06 | 롯데리아 데리 1인팩 14:23    5.600원\n10/05 CU 과자번들 4팩 1,540원', today)
    expect(r.lines).toEqual(['2026-10-06 롯데리아 데리 1인팩 5,600원', '2026-10-05 CU 과자번들 4팩 1,540원'])
  })

  it('만든 줄은 지금 빠른 기록 입력으로 그대로 읽힌다(날짜·금액이 확실)', () => {
    const [line] = parseSpendCapture('10월 9일\n다이소(이소가스) 2,000원', today).lines
    expect(parseQuickLine(line, today)).toEqual({ amount: 2000, memo: '다이소(이소가스)', date: '2026-10-09', amountGuessed: false })
  })

  it('입금(+)은 빼고, 같은 날·같은 금액이 이미 기록돼 있으면 중복으로 뺀다', () => {
    const text = '10월 9일\n월급 입금 +3,000,000원\n롯데마트(캠핑) 66,890원\n다이소(이소가스) 2,000원'
    const r = parseSpendCapture(text, today, [{ date: '2026-10-09', amount: 66_890 }])
    expect(r.lines).toEqual(['2026-10-09 다이소(이소가스) 2,000원'])
    expect(r.income).toBe(1)
    expect(r.duplicates).toBe(1)
  })

  it('날짜가 없으면 날짜 없이 내보내고(화면의 날짜 칸을 씀), 금액을 못 읽은 줄은 세어 알린다', () => {
    const r = parseSpendCapture('CU 제기점 1,800원\n10/09 롯데마트(캠핑) 징보기(마트)', today)
    expect(r.lines).toEqual(['CU 제기점 1,800원'])
    expect(r.unread).toBe(1)
  })

  it('월/일만 있는 날짜가 오늘 이후면 작년으로 본다, 합계 줄·이름 없는 금액·너무 작은 숫자는 버린다', () => {
    const r = parseSpendCapture('12/30 편의점 3,500원\n이번 달 총 지출 1,234,000원\n합계 1,234,000원\n5,000원\n20 500원', '2027-01-03')
    expect(r.lines).toEqual(['2026-12-30 편의점 3,500원'])
    // "총"으로 시작하는 가게 이름은 합계로 보지 않는다
    expect(parseSpendCapture('12/30 총각네야채가게 12,000원', '2027-01-03').lines).toEqual(['2026-12-30 총각네야채가게 12,000원'])
  })
})

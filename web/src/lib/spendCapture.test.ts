import { describe, expect, it } from 'vitest'
import { parseQuickLine } from '../../../src/lib/moneyFlow'
import { looksLikeBlockStatement, parseBlockStatement, parseSpendCapture, parseStatementText, readAmountTail, spendNotice } from './spendCapture'

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

// 2026-10-26 현대카드 명세서 캡처(가로 160px로 줄어든 저해상도)를 OCR로 읽은 결과 일부 — "원"이 8로, 이름이 깨지는 최악 경우
const HYUNDAI_OCR = `NU 12월 형세서
613,900원
화근숲 고역순
20.10. 2500)
MRCuNBAATY                        4.5608
일시불 네이버 pans
NU MY 450.0%)
26.10. 24(%)
히주야비인후과의원                             7.2008
일시불 om pans
릭입 예절 7201.0%)
우리보강약국                                    58008
26.10. 23 (#)
서물사상하수도                                28,0308
갈마커피                                         3/600
26.10.18(%)
대황도술불갈피                               116,500#8
NU 애칭 1.165(1.0^9]
EEN UN
다이소어성산업                                  30008
지파크                                            1,0008
26. 10. 185(빠1
Gop                                         127,900`

describe('카드 명세서 캡처(현대카드) 읽기', () => {
  it('날짜가 "26. 10. 25 (토)" 꼴이고 "원"이 8로 읽혀도 금액·날짜를 맞춘다(적립·안내 줄은 건너뜀)', () => {
    const r = parseSpendCapture(HYUNDAI_OCR, '2026-10-26')
    expect(r.lines.map((l) => l.replace(/^(\S+) .* (\S+)$/, '$1 $2'))).toEqual([
      '2026-10-25 4,560원',
      '2026-10-24 7,200원',
      '2026-10-24 5,800원',
      '2026-10-23 28,030원',
      '2026-10-23 3,600원',
      '2026-10-18 116,500원',
      '2026-10-18 3,000원',
      '2026-10-18 1,000원',
      '2026-10-18 127,900원',
    ])
    // 상단 "12월 명세서 613,900원"은 합계라 지출로 넣지 않는다
    expect(r.lines.some((l) => l.includes('613,900'))).toBe(false)
  })

  it('날짜의 연도가 오독돼도(20→26) 월·일로 가까운 날짜를 잡는다', () => {
    expect(parseSpendCapture('20.10. 2500)\n씨유CU 4.5608', '2026-10-26').lines).toEqual(['2026-10-25 씨유CU 4,560원'])
  })
})

describe('삼성 모니모 메일 복사 붙여넣기', () => {
  const MONIMO = `네이버페이 네이버
42,120원

26. 9. 25본 인 6163
보너스P 421P

컴포즈커피 방화역점
4,600원

26. 9. 25본 인 6163
보너스P 46P

쿠팡 취소
-12,900원

26. 9. 24본 인 6163`

  it('가맹점 / 금액 / 날짜 줄 블록을 읽고 본인·카드 끝자리·보너스P는 버린다', () => {
    expect(looksLikeBlockStatement(MONIMO)).toBe(true)
    const r = parseBlockStatement(MONIMO, '2026-10-26')
    expect(r.lines).toEqual(['2026-09-25 네이버페이 네이버 42,120원', '2026-09-25 컴포즈커피 방화역점 4,600원'])
    expect(r.cancelled).toBe(1)
  })

  it('같은 명세서를 두 번 붙여도 이미 있는 건은 빼서 중복 저장되지 않는다', () => {
    const r = parseStatementText(MONIMO, '2026-10-26', [{ date: '2026-09-25', amount: 42_120 }, { date: '2026-09-25', amount: 4_600 }])
    expect(r.block).toBe(true)
    expect(r.lines).toEqual([])
    expect(r.duplicates).toBe(2)
  })

  it('한 줄형 글자는 블록형으로 오인하지 않는다', () => {
    expect(looksLikeBlockStatement('10월 9일\n롯데마트(캠핑) 66,890원')).toBe(false)
    expect(parseStatementText('10월 9일\n롯데마트(캠핑) 66,890원', '2026-10-26').block).toBe(false)
  })

  it('안내 문구에 빠진 건수를 알린다', () => {
    const r = parseBlockStatement(MONIMO, '2026-10-26', [{ date: '2026-09-25', amount: 4_600 }])
    const msg = spendNotice(r, '붙여넣은 글')
    expect(msg).toContain('1줄을 읽었습니다')
    expect(msg).toContain('이미 있는 1건')
    expect(msg).toContain('취소·환불 1건')
  })
})

describe('금액 끝 읽기', () => {
  it('쉼표를 마침표·슬래시로 읽어도, 끝 8(원 오독)은 4자리 묶음일 때만 뗀다', () => {
    expect(readAmountTail('가게 5.600원')?.amount).toBe(5600)
    expect(readAmountTail('가게 3/600')?.amount).toBe(3600)
    expect(readAmountTail('가게 12,348원')?.amount).toBe(12_348) // 정상 3자리 묶음은 그대로
    expect(readAmountTail('가게 160,0008')?.amount).toBe(160_000)
    expect(readAmountTail('가게 54008')?.amount).toBe(5400)
    expect(readAmountTail('가게 450.0%)')).toBeNull() // 적립 예정 같은 소수 표기는 금액이 아니다
    expect(readAmountTail('가게 99')).toBeNull() // 너무 작은 수
  })
})

describe('현대카드 명세서 텍스트 복사 붙여넣기', () => {
  // 날짜 머리글이 위에 있고 항목이 줄줄이 이어지는 모양(가맹점 / 금액 / 결제 안내 / 적립 예정)
  const BLOCK = [
    '11월 12일 명세서', '613,900원', '',
    '26. 10. 25 (토)', '씨유CU청랑리스카이점', '4,560원', '일시불 · 네이버 현대카드', '적립 예정 45(1.0%)', '',
    '26. 10. 24 (금)', '미주이비인후과의원', '7,200원', '일시불 · 네이버 현대카드', '적립 예정 72(1.0%)',
    '우리보강약국', '5,800원', '일시불 · 네이버 현대카드', '',
    '26. 10. 18 (일)', '대황도술불갈피', '116,500원', '일시불 · 네이버 현대카드', '분할결제 신청하기 >', '적립 예정 1,165(1.0%)',
  ].join('\n')

  it('머리글 날짜를 아래 항목들에 이어 붙이고 상단 합계·결제 안내·적립 줄은 건너뛴다', () => {
    expect(looksLikeBlockStatement(BLOCK)).toBe(true)
    const r = parseBlockStatement(BLOCK, '2026-10-26')
    expect(r.lines).toEqual([
      '2026-10-25 씨유CU청랑리스카이점 4,560원',
      '2026-10-24 미주이비인후과의원 7,200원',
      '2026-10-24 우리보강약국 5,800원',
      '2026-10-18 대황도술불갈피 116,500원',
    ])
  })

  it('가맹점과 금액이 한 줄인 모양(웹 표 복사)도 머리글 날짜로 읽고, 첫 머리글 위의 합계는 뺀다', () => {
    const oneLine = ['11월 12일 명세서 613,900원', '26. 10. 25 (토)', '씨유CU청랑리스카이점 4,560원', '일시불 · 네이버 현대카드', '26. 10. 24 (금)', '우리보강약국 5,800원'].join('\n')
    const r = parseStatementText(oneLine, '2026-10-26')
    expect(r.lines).toEqual(['2026-10-25 씨유CU청랑리스카이점 4,560원', '2026-10-24 우리보강약국 5,800원'])
  })

  it('모니모(금액 아래 날짜)와 현대카드(위 머리글)가 섞여도 각자 날짜를 쓴다', () => {
    const mixed = ['26. 10. 25 (토)', '씨유CU', '4,560원', '일시불', '컴포즈커피 방화역점', '4,600원', '', '26. 9. 25본 인 6163', '보너스P 46P'].join('\n')
    const r = parseBlockStatement(mixed, '2026-10-26')
    expect(r.lines).toEqual(['2026-10-25 씨유CU 4,560원', '2026-09-25 컴포즈커피 방화역점 4,600원'])
  })
})

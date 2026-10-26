import { describe, expect, it } from 'vitest'
import { looksLikeBlockStatement, parseBlockStatement, statementNotice } from './statementPaste'

const today = '2026-10-26'

// 현대카드 이용내역을 복사한 글(2026-10-26 실제 모양): 건마다 구분선 + "이용 일자:" + 가맹점 + 금액 + 결제구분·카드명·적립 예정
const HYUNDAI = `총 5건 총금액 17,160원

--------------------

이용 일자: 26. 10. 25
씨유CU청량리스카이점
4,560원
결제구분: 일시불
카드명: 네이버 현대카드
적립 예정 45(1.0%)

--------------------

이용 일자: 26. 10. 18
지파크
1,000원
결제구분: 일시불
카드명: 네이버 현대카드
적립 예정 10(1.0%)

--------------------

이용 일자: 26. 10. 18
지파크
1,000원
결제구분: 일시불
카드명: 네이버 현대카드
적립 예정 10(1.0%)

--------------------

이용 일자: 26. 10. 11
구리휴게소
10,000원
결제구분: 일시불
카드명: 네이버 현대카드
적립 예정 100(1.0%)

--------------------

이용 일자: 26. 10. 7
나이스 - 쿠팡
600원
결제구분: 일시불
카드명: 네이버 현대카드`

describe('현대카드 이용내역 복사 붙여넣기', () => {
  it('"이용 일자:" 머리글 아래 가맹점·금액을 읽고 결제구분·카드명·적립 줄은 건너뛴다', () => {
    expect(looksLikeBlockStatement(HYUNDAI)).toBe(true)
    const r = parseBlockStatement(HYUNDAI, today)
    expect(r.lines).toEqual([
      '2026-10-25 씨유CU청량리스카이점 4,560원',
      '2026-10-18 지파크 1,000원',
      '2026-10-18 지파크 1,000원', // 같은 날 같은 금액 두 건은 둘 다 남긴다
      '2026-10-11 구리휴게소 10,000원',
      '2026-10-07 나이스 - 쿠팡 600원',
    ])
    expect(r.declared).toBe(5)
  })

  it('이미 기록된 건수만큼만 중복으로 빼서, 같은 날 같은 금액 두 건 중 하나만 있으면 하나는 남긴다', () => {
    const r = parseBlockStatement(HYUNDAI, today, [{ date: '2026-10-18', amount: 1_000 }, { date: '2026-10-25', amount: 4_560 }])
    expect(r.lines).toEqual([
      '2026-10-18 지파크 1,000원',
      '2026-10-11 구리휴게소 10,000원',
      '2026-10-07 나이스 - 쿠팡 600원',
    ])
    expect(r.duplicates).toBe(2)
  })

  it('붙여넣은 글의 "총 N건"과 읽은 건수가 다르면 안내 문구에 알린다', () => {
    const short = HYUNDAI.replace('총 5건', '총 6건')
    expect(statementNotice(parseBlockStatement(short, today))).toContain('총 6건이라 적혀 있는데 5건을 읽었습니다')
    expect(statementNotice(parseBlockStatement(HYUNDAI, today))).not.toContain('적혀 있는데')
  })

  it('날짜 머리글보다 위의 금액(상단 합계)과 입금·취소는 지출로 넣지 않는다', () => {
    const text = ['11월 12일 명세서', '613,900원', '이용 일자: 26. 10. 25', '씨유CU', '4,560원', '이용 일자: 26. 10. 24', '쿠팡 취소', '-12,900원', '환급 입금', '+5,000원'].join('\n')
    const r = parseBlockStatement(text, today)
    expect(r.lines).toEqual(['2026-10-25 씨유CU 4,560원'])
    expect(r.cancelled).toBe(1)
    expect(r.income).toBe(1)
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
    const r = parseBlockStatement(MONIMO, today)
    expect(r.lines).toEqual(['2026-09-25 네이버페이 네이버 42,120원', '2026-09-25 컴포즈커피 방화역점 4,600원'])
    expect(r.cancelled).toBe(1)
  })

  it('같은 명세서를 두 번 붙여도 이미 있는 건은 빼서 중복 저장되지 않는다', () => {
    const r = parseBlockStatement(MONIMO, today, [{ date: '2026-09-25', amount: 42_120 }, { date: '2026-09-25', amount: 4_600 }])
    expect(r.lines).toEqual([])
    expect(r.duplicates).toBe(2)
    expect(statementNotice(r)).toContain('읽은 지출이 없습니다')
  })

  it('현대카드(위 머리글)와 모니모(금액 아래 날짜)가 섞여도 각자 날짜를 쓴다', () => {
    const mixed = ['이용 일자: 26. 10. 25', '씨유CU', '4,560원', '컴포즈커피 방화역점', '4,600원', '26. 9. 25본 인 6163'].join('\n')
    expect(parseBlockStatement(mixed, today).lines).toEqual(['2026-10-25 씨유CU 4,560원', '2026-09-25 컴포즈커피 방화역점 4,600원'])
  })
})

describe('직접 적은 글은 건드리지 않는다', () => {
  it('"가게 금액" 한 줄씩 적은 글은 블록형으로 보지 않는다', () => {
    expect(looksLikeBlockStatement('냉동피자 4판 15170\n곰곰 우유 900ml 2개 3690')).toBe(false)
    expect(looksLikeBlockStatement('261001 카스 디지털 체중계 21500원')).toBe(false)
    expect(looksLikeBlockStatement('피자 2만원')).toBe(false)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoCandidate, GuideRow } from '../types'

vi.mock('../../../lib/api', () => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer t' })) }))
vi.mock('../../../stores/profileStore', () => ({ getCurrentClientIdFromStore: () => 'client-1' }))

import { getCandidateScoreByVersion, rankHighlightCandidate, rankScanCandidate } from './candidateRank'
import { formatFlowBadgeLabel, normalizeSectorKey, pickDiversifiedCandidates } from './diversify'
import { buildGuideRow } from './guideRow'
import { appendQueryParam, buildUiRequest } from './request'
import { toExecutionGuideSnapshotText } from './snapshotText'

const cand = (code: string, sector: string | null, score: number): AutoCandidate => ({
  code, name: code, source: 'scan', sector, score, scoreLegacy: score - 1, upsideSignal: 50, riskSignal: 10,
  confidencePct: null, liquidity: null, intradayChangePct: null, netFlow5d: null, netFlow20d: null, reason: '사유',
})

describe('후보 점수화 (대표 입력의 점수를 고정)', () => {
  const scan = {
    code: '111111', name: '스캔A', sector_id: 'S1', entry_score: 4, trend_grade: 'A', quick_trade_score: 80, adaptive_score: 70,
    lead_accumulation_score: 60, lead_accumulation_stage: 'lead', liquidity: 50_000_000_000, intraday_change_pct: 2.5, warn_score: 1,
    foreign_net_buy_5d: 1e9, quick_signal_age_days: 1,
  }
  const hl = {
    code: '222222', name: '하이', score_momentum: 70, score_safety: 60, lead_accumulation_score: 50, lead_accumulation_stage: 'breakout',
    expected_upside_pct: 10, expected_drawdown_pct: -5, confidence_pct: 60,
  }

  it('스캔 후보: 모드별 점수·후보점수·리스크', () => {
    const b = rankScanCandidate(scan, 'balanced')
    expect(b).toMatchObject({ code: '111111', name: '스캔A', source: 'scan', sector: 'S1' })
    expect(b.score).toBeCloseTo(79.2064512, 4)
    expect(b.scoreLegacy).toBeCloseTo(83.132, 3)
    expect(b.upsideSignal).toBeCloseTo(74.136, 3)
    expect(b.riskSignal).toBeCloseTo(13.16, 3)
    expect(b.reason).toContain('모드 밸런스')
    expect(b.reason).toContain('리드단계 리드 축적')
    expect(rankScanCandidate(scan, 'multibagger').score).toBeCloseTo(75.115328, 4)
    const swing = rankScanCandidate(scan, 'swing')
    expect(swing.score).toBeCloseTo(92.2839552, 4)
    expect(swing.riskSignal).toBeCloseTo(14.6, 3)
  })
  it('하이라이트 후보: 모드별 점수, 후보점수·리스크는 모드와 무관', () => {
    const b = rankHighlightCandidate(hl, 'balanced')
    expect(b).toMatchObject({ code: '222222', source: 'highlights' })
    expect(b.score).toBeCloseTo(56.992, 3)
    expect(b.scoreLegacy).toBeCloseTo(58.1, 3)
    expect(b.upsideSignal).toBeCloseTo(53.5, 3)
    expect(b.riskSignal).toBeCloseTo(45.5, 3)
    expect(rankHighlightCandidate(hl, 'multibagger').score).toBeCloseTo(58.6928, 4)
    expect(rankHighlightCandidate(hl, 'swing').score).toBeCloseTo(51.0058, 4)
  })
  it('점수 버전 선택', () => {
    const c = cand('A', null, 80)
    expect(getCandidateScoreByVersion(c, 'v2')).toBe(80)
    expect(getCandidateScoreByVersion(c, 'legacy')).toBe(79)
  })
})

describe('다양화', () => {
  it('섹터 표기 통일', () => {
    expect(normalizeSectorKey('반도체 장비')).toBe('semiconductor')
    expect(normalizeSectorKey('Battery')).toBe('battery')
    expect(normalizeSectorKey('')).toBe('__unknown__')
    expect(normalizeSectorKey('기타업종')).toBe('기타업종')
  })
  it('점수 순을 유지하되 섹터당 2개로 제한하고, 자리가 남으면 점수 순으로 채운다', () => {
    const input = [cand('A', '반도체', 90), cand('B', '반도체', 80), cand('C', '반도체', 70), cand('D', '바이오', 60)]
    expect(pickDiversifiedCandidates(input, 3, 2).map((c) => c.code)).toEqual(['A', 'B', 'D'])
    expect(pickDiversifiedCandidates(input, 4, 2).map((c) => c.code)).toEqual(['A', 'B', 'D', 'C'])
    expect(pickDiversifiedCandidates([cand('A', null, 1), cand('A', null, 1)], 5, 2).map((c) => c.code)).toEqual(['A'])
  })
  it('수급 배지 문구', () => {
    expect(formatFlowBadgeLabel(null, null)).toBe('수급액 데이터 없음')
    expect(formatFlowBadgeLabel(30_000, null)).toBe('수급액 유입 5D +3만원 · 20D —')
    expect(formatFlowBadgeLabel(-5_000, 30_000)).toContain('유출')
  })
})

describe('buildGuideRow', () => {
  const stockRes = {
    profile: { name: '삼성전자', close: 70000, indicators_as_of: '2026-10-08' },
    latest: { trade_date: '2026-10-09' },
    advisor: {
      finalScore: 72.4, statusLabel: '진입 관심', summary: '요약 &amp; 문구', entryLow: 49000, entryHigh: 51000, stopPrice: 47000,
      target1: 54000, target2: 58000, target1Pct: 0.08, target2Pct: 0.15, holdDays: [5, 10], riskReward: 2.2, warnings: ['w1', 'w2', 'w3'],
    },
  }
  const base = { code: '005930', stockRes, newsRes: null, includeNews: false, riskMode: 'neutral' as const, budgetPerName: 2_500_000, slots: 4 }

  it('수량 = ⌊예산 ÷ 진입 기준가⌋, 1회 주문 = 수량×기준가 ÷ 분할, 경고는 2개까지', () => {
    const r = buildGuideRow(base)
    expect(r).toMatchObject({
      code: '005930', name: '삼성전자', score: 72.4, entryRef: 50000, qty: 50, plannedBudget: 2_500_000, firstOrderAmount: 625_000,
      stopPrice: 47000, target1: 54000, holdDays: [5, 10], summary: '요약 & 문구', marketDataDate: '2026-10-08~2026-10-09',
    })
    expect(r.warnings).toEqual(['w1', 'w2'])
    expect(r.headlines).toEqual([])
    expect(r.newsDataDate).toBeNull()
  })
  it('진입 구간이 없으면 종가를 기준가로 쓰고, 기준가가 없으면 수량 0', () => {
    const noEntry = { ...stockRes, advisor: { ...stockRes.advisor, entryLow: undefined, entryHigh: undefined }, profile: { ...stockRes.profile, close: 70000 } }
    expect(buildGuideRow({ ...base, stockRes: noEntry }).entryRef).toBe(70000)
    const none = { profile: { name: 'x' }, advisor: {} }
    const r = buildGuideRow({ ...base, stockRes: none })
    expect(r).toMatchObject({ entryRef: null, qty: 0, firstOrderAmount: 0, score: null, holdDays: null, name: 'x' })
  })
  it('위험 성향에 따라 손절·목표를 보정한다', () => {
    const r = buildGuideRow({ ...base, riskMode: 'aggressive' })
    expect(r.stopPrice).toBe(54050)
    expect(r.target1).toBe(63720)
    expect(buildGuideRow({ ...base, riskMode: 'conservative' }).stopPrice).toBe(42300)
  })
  it('뉴스: 포함이면 상위 3건과 날짜, 제외면 비움', () => {
    const newsRes = {
      data: [
        { title: '제목1 &amp; A', originallink: 'https://n.example/1', source: '언론1', pubDate: '2026-10-09' },
        { title: '', link: 'x' },
        { title: '제목2', url: '//n.example/2', press: '언론2', published_at: '2026-10-07' },
        { title: '제목3' }, { title: '제목4' },
      ],
    }
    const on = buildGuideRow({ ...base, includeNews: true, newsRes })
    expect(on.headlines).toEqual(['제목1 & A', '제목2', '제목3'])
    expect(on.headlineLinks[1]).toEqual({ title: '제목2', url: 'https://n.example/2', source: '언론2' })
    expect(on.newsDataDate).toBe('2026-10-07~2026-10-09')
    const off = buildGuideRow({ ...base, includeNews: false, newsRes })
    expect(off.headlines).toEqual([])
    expect(off.newsDataDate).toBeNull()
  })
})

describe('request', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })
  it('쿼리 파라미터 추가: 값이 없거나 이미 있으면 그대로', () => {
    expect(appendQueryParam('/a', 'k', '')).toBe('/a')
    expect(appendQueryParam('/a?k=1', 'k', '2')).toBe('/a?k=1')
    expect(appendQueryParam('/a', 'k', '한 글')).toBe('/a?k=%ED%95%9C%20%EA%B8%80')
    expect(appendQueryParam('/a?x=1', 'k', 'v')).toBe('/a?x=1&k=v')
  })
  it('UI 요청: 클라이언트·채팅 ID와 인증 헤더를 붙인다', async () => {
    const r = await buildUiRequest('/api/ui/report-pdf?topic=x', '123')
    expect(r.url).toContain('/api/ui/report-pdf?topic=x')
    expect(r.url).toContain('client_id=client-1')
    expect(r.url).toContain('chat_id=123')
    expect(r.headers).toMatchObject({ Authorization: 'Bearer t', 'x-user-chat-id': '123' })
  })
  it('채팅 ID가 없으면 chat_id·헤더를 붙이지 않는다', async () => {
    const r = await buildUiRequest('/api/ui/report-pdf', '')
    expect(r.url).not.toContain('chat_id=')
    expect(r.headers['x-user-chat-id']).toBeUndefined()
  })
})

describe('toExecutionGuideSnapshotText', () => {
  const row: GuideRow = {
    code: '005930', name: '삼성전자', score: 72.4, statusLabel: '진입 관심', summary: null, entryLow: 49000, entryHigh: 51000, entryRef: 50000,
    stopPrice: 47000, target1: 54000, target2: 58000, target1Pct: 0.08, target2Pct: 0.15, holdDays: [5, 10], riskReward: 2.2, warnings: [],
    headlines: [], headlineLinks: [], marketDataDate: '2026-10-09', newsDataDate: null, plannedBudget: 2_500_000, qty: 50, firstOrderAmount: 625_000,
  }
  it('설정·종목 요약이 들어간 텍스트를 만든다', () => {
    const text = toExecutionGuideSnapshotText({
      generatedAtIso: '2026-10-09T01:00:00Z', sourceLabel: '수동 입력', codeList: ['005930'], capital: '10000000', maxWeightPct: '25',
      splitCount: '4', riskMode: 'neutral', scoreVersion: 'v2', includeNews: false, autoCandidates: [], rows: [row],
    })
    expect(text).toContain('<b>매매 실행 계획서</b>')
    expect(text).toContain('출처: 수동 입력')
    expect(text).toContain('코드 1개: 005930')
    expect(text).toContain('데이터 기준일: 시세 2026-10-09')
    expect(text).toContain('• 분할 횟수: 4')
    expect(text).toContain('• 뉴스 요약 포함: 아니오')
    expect(text).toContain('삼성전자')
  })
  it('자동 후보가 있으면 TOP 구간과 점수 버전 비교 요약을 넣는다', () => {
    const text = toExecutionGuideSnapshotText({
      generatedAtIso: '2026-10-09T01:00:00Z', sourceLabel: '자동 후보(밸런스)', codeList: ['005930'], capital: '0', maxWeightPct: '', splitCount: '',
      riskMode: 'aggressive', scoreVersion: 'legacy', includeNews: true, autoCandidates: [cand('111111', 'S', 80)], rows: [row],
    })
    expect(text).toContain('<b>자동 추천 후보 TOP</b>')
    expect(text).toContain('점수 버전 비교 요약')
    expect(text).toContain('• 종목당 최대 비중: 25%')
    expect(text).toContain('• 분할 횟수: 4')
  })
})

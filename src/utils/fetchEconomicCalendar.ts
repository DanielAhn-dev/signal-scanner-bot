/**
 * 경제 달력 데이터 페칭 및 처리
 *
 * 공식 출처(BLS·BEA·연준·한국은행)에서 주 1회 받아 둔 일정(scripts/economic_calendar_sync.ts → Storage)을 우선 쓰고,
 * 아래 하드코딩 일정은 수집 전·실패 시의 기본값이다.
 */

import type {
  EconomicEvent,
  EconomicCalendarResponse,
  HistoricalImpact,
  EventImportance,
} from '../types/economics'
import { getUpcomingMarketEvents, type MarketEvent } from './marketEventCalendar'
import {
  SYNCED_CALENDAR_BUCKET,
  SYNCED_CALENDAR_PATH,
  type SyncedCalendarFile,
  type SyncedEventKind,
} from '../lib/economicCalendarSources'

/**
 * 주요 경제 지표 이벤트 데이터베이스
 * - 날짜는 실제 발표 일정 기준 (UTC 기준 발표 예정 시각)
 * - actualValue: 이미 발표된 경우에만 채움
 */
const MAJOR_ECONOMIC_EVENTS: EconomicEvent[] = [
  // ── 미국 CPI ──────────────────────────────────────────────────────────────
  // 4월 CPI: 2026-05-13 발표 (이미 발표됨, 실제치 3.8%)
  {
    id: 'us-cpi-apr-2026',
    name: '미국 CPI (YoY)',
    country: 'US',
    category: 'inflation',
    importance: 'critical',
    scheduledAt: '2026-05-12T12:30:00Z', // 동부 8:30 AM (BLS 공식 5/12)
    forecastValue: 3.2,
    actualValue: 3.8,                    // 2026-05-13 발표됨
    unit: '%',
    source: 'BLS',
    historicalImpacts: [
      { date: '2024-01-10', eventName: '미국 CPI (YoY)', expectedVsForecast: 0.1, marketReactionKospi: -1.5, marketReactionSp500: -0.8, volatilityChange: 2.5, dominantTheme: '인플레이션 우려' },
      { date: '2023-12-13', eventName: '미국 CPI (YoY)', expectedVsForecast: -0.3, marketReactionKospi: 1.2, marketReactionSp500: 1.1, volatilityChange: -1.8, dominantTheme: '금리 인하 기대' },
    ],
    averageKospiReaction: -0.15,
    averageVolatilityIncrease: 2.1,
    impactSeverity: 95,
  },
  // 5월 CPI: 2026-06-11 발표 예정
  {
    id: 'us-cpi-may-2026',
    name: '미국 CPI (YoY)',
    country: 'US',
    category: 'inflation',
    importance: 'critical',
    scheduledAt: '2026-06-10T12:30:00Z', // BLS 공식 6/10
    forecastValue: 3.5,
    unit: '%',
    source: 'BLS',
    averageKospiReaction: -0.15,
    averageVolatilityIncrease: 2.1,
    impactSeverity: 95,
  },

  // ── 미국 PPI ──────────────────────────────────────────────────────────────
  // 4월 PPI: 2026-05-15 발표 예정
  {
    id: 'us-ppi-apr-2026',
    name: '미국 PPI (YoY)',
    country: 'US',
    category: 'inflation',
    importance: 'high',
    scheduledAt: '2026-05-15T12:30:00Z',
    forecastValue: 2.8,
    unit: '%',
    source: 'BLS',
    averageKospiReaction: -0.4,
    averageVolatilityIncrease: 1.5,
    impactSeverity: 70,
  },
  // 5월~11월 PPI: CPI 발표 이틀 뒤 통상 발표 (누락되어 있던 후속 월 보강)
  {
    id: 'us-ppi-may-2026',
    name: '미국 PPI (YoY)',
    country: 'US', category: 'inflation', importance: 'high',
    scheduledAt: '2026-06-13T12:30:00Z',
    forecastValue: 2.7, unit: '%', source: 'BLS',
    averageKospiReaction: -0.4, averageVolatilityIncrease: 1.5, impactSeverity: 70,
  },
  {
    id: 'us-ppi-jun-2026',
    name: '미국 PPI (YoY)',
    country: 'US', category: 'inflation', importance: 'high',
    scheduledAt: '2026-07-16T12:30:00Z',
    forecastValue: 2.6, unit: '%', source: 'BLS',
    averageKospiReaction: -0.4, averageVolatilityIncrease: 1.5, impactSeverity: 70,
  },
  {
    id: 'us-ppi-jul-2026',
    name: '미국 PPI (YoY)',
    country: 'US', category: 'inflation', importance: 'high',
    scheduledAt: '2026-08-14T12:30:00Z',
    forecastValue: 2.5, unit: '%', source: 'BLS',
    averageKospiReaction: -0.4, averageVolatilityIncrease: 1.5, impactSeverity: 70,
  },
  {
    id: 'us-ppi-aug-2026',
    name: '미국 PPI (YoY)',
    country: 'US', category: 'inflation', importance: 'high',
    scheduledAt: '2026-09-13T12:30:00Z',
    forecastValue: 2.4, unit: '%', source: 'BLS',
    averageKospiReaction: -0.4, averageVolatilityIncrease: 1.5, impactSeverity: 70,
  },
  {
    id: 'us-ppi-sep-2026',
    name: '미국 PPI (YoY)',
    country: 'US', category: 'inflation', importance: 'high',
    scheduledAt: '2026-10-16T12:30:00Z',
    forecastValue: 2.3, unit: '%', source: 'BLS',
    averageKospiReaction: -0.4, averageVolatilityIncrease: 1.5, impactSeverity: 70,
  },
  {
    id: 'us-ppi-oct-2026',
    name: '미국 PPI (YoY)',
    country: 'US', category: 'inflation', importance: 'high',
    scheduledAt: '2026-11-13T13:30:00Z', // BLS 공식 11/13
    forecastValue: 2.2, unit: '%', source: 'BLS',
    averageKospiReaction: -0.4, averageVolatilityIncrease: 1.5, impactSeverity: 70,
  },
  {
    id: 'us-ppi-nov-2026',
    name: '미국 PPI (YoY)',
    country: 'US', category: 'inflation', importance: 'high',
    scheduledAt: '2026-12-15T13:30:00Z', // BLS 공식 12/15
    forecastValue: 2.1, unit: '%', source: 'BLS',
    averageKospiReaction: -0.4, averageVolatilityIncrease: 1.5, impactSeverity: 70,
  },

  // ── FOMC 의사록 (5월 6-7일 회의록) ───────────────────────────────────────
  {
    id: 'us-fomc-minutes-may-2026',
    name: 'FOMC 의사록',
    country: 'US',
    category: 'interest_rate',
    importance: 'high',
    scheduledAt: '2026-05-28T18:00:00Z',
    source: 'Fed',
    averageKospiReaction: 0.2,
    averageVolatilityIncrease: 1.0,
    impactSeverity: 72,
  },

  // ── 미국 GDP Q1 2026 (2차 추정치) ─────────────────────────────────────────
  {
    id: 'us-gdp-q1-2026-2nd',
    name: '미국 GDP (QoQ)',
    country: 'US',
    category: 'gdp',
    importance: 'high',
    scheduledAt: '2026-05-29T12:30:00Z',
    forecastValue: 2.1,
    unit: '%',
    source: 'BEA',
    averageKospiReaction: 0.1,
    averageVolatilityIncrease: 1.8,
    impactSeverity: 75,
  },

  // ── 한국 기준금리 결정 ─────────────────────────────────────────────────────
  {
    id: 'kr-base-rate-may-2026',
    name: '한국 기준금리 결정',
    country: 'KR',
    category: 'interest_rate',
    importance: 'critical',
    scheduledAt: '2026-05-29T01:00:00Z', // 한국 오전 10시
    source: 'BOK',
    averageKospiReaction: 0.3,
    averageVolatilityIncrease: 1.2,
    impactSeverity: 85,
  },

  // ── 미국 NFP / 실업률 (5월) ────────────────────────────────────────────────
  {
    id: 'us-nfp-may-2026',
    name: '미국 비농업고용 / 실업률',
    country: 'US',
    category: 'employment',
    importance: 'critical',
    scheduledAt: '2026-06-05T12:30:00Z', // 첫째 금요일
    forecastValue: 4.1,
    unit: '%',
    source: 'BLS',
    historicalImpacts: [
      { date: '2024-01-05', eventName: '미국 NFP', expectedVsForecast: 0.2, marketReactionKospi: -2.1, marketReactionSp500: -1.5, volatilityChange: 3.2, dominantTheme: '노동시장 강세' },
    ],
    averageKospiReaction: -0.8,
    averageVolatilityIncrease: 2.8,
    impactSeverity: 92,
  },

  // ── FOMC 금리 결정 (6월 17-18일) ──────────────────────────────────────────
  {
    id: 'us-fomc-jun-2026',
    name: 'FOMC 금리 결정',
    country: 'US',
    category: 'interest_rate',
    importance: 'critical',
    scheduledAt: '2026-06-17T18:00:00Z', // 동부 오후 2시 (공식 6/16-17)
    source: 'Fed',
    historicalImpacts: [
      { date: '2024-01-31', eventName: 'FOMC 금리 결정', expectedVsForecast: 0, marketReactionKospi: 1.8, marketReactionSp500: 0.9, volatilityChange: -1.2, dominantTheme: '금리 동결에 안도' },
    ],
    averageKospiReaction: 0.5,
    averageVolatilityIncrease: -0.8,
    impactSeverity: 98,
  },

  // ── 중국 제조업 PMI (5월) ─────────────────────────────────────────────────
  {
    id: 'china-pmi-may-2026',
    name: '중국 제조업 PMI',
    country: 'CN',
    category: 'manufacturing',
    importance: 'high',
    scheduledAt: '2026-05-31T01:00:00Z',
    forecastValue: 49.5,
    source: 'NBS',
    averageKospiReaction: 0.2,
    averageVolatilityIncrease: 1.0,
    impactSeverity: 68,
  },

  // ── 미국 Core PCE (Fed 선호 물가) ──────────────────────────────────────────
  {
    id: 'us-pce-apr-2026',
    name: '미국 Core PCE (YoY)',
    country: 'US',
    category: 'inflation',
    importance: 'critical',
    scheduledAt: '2026-05-30T12:30:00Z',
    forecastValue: 2.7,
    unit: '%',
    source: 'BEA',
    averageKospiReaction: -0.3,
    averageVolatilityIncrease: 1.9,
    impactSeverity: 88,
  },

  // ════════════════════ 2026년 하반기 ════════════════════

  // ── 미국 CPI (6월, 7월, 8월, 9월, 10월, 11월) ────────────────────────────
  {
    id: 'us-cpi-may-2026-rev',
    name: '미국 CPI (YoY)',
    country: 'US', category: 'inflation', importance: 'critical',
    scheduledAt: '2026-06-10T12:30:00Z', // BLS 공식 6/10
    forecastValue: 3.5, unit: '%', source: 'BLS',
    averageKospiReaction: -0.15, averageVolatilityIncrease: 2.1, impactSeverity: 95,
  },
  {
    id: 'us-cpi-jun-2026',
    name: '미국 CPI (YoY)',
    country: 'US', category: 'inflation', importance: 'critical',
    scheduledAt: '2026-07-14T12:30:00Z',
    forecastValue: 3.4, unit: '%', source: 'BLS',
    averageKospiReaction: -0.15, averageVolatilityIncrease: 2.1, impactSeverity: 95,
  },
  {
    id: 'us-cpi-jul-2026',
    name: '미국 CPI (YoY)',
    country: 'US', category: 'inflation', importance: 'critical',
    scheduledAt: '2026-08-12T12:30:00Z',
    forecastValue: 3.3, unit: '%', source: 'BLS',
    averageKospiReaction: -0.15, averageVolatilityIncrease: 2.1, impactSeverity: 95,
  },
  {
    id: 'us-cpi-aug-2026',
    name: '미국 CPI (YoY)',
    country: 'US', category: 'inflation', importance: 'critical',
    scheduledAt: '2026-09-11T12:30:00Z',
    forecastValue: 3.2, unit: '%', source: 'BLS',
    averageKospiReaction: -0.15, averageVolatilityIncrease: 2.1, impactSeverity: 95,
  },
  {
    id: 'us-cpi-sep-2026',
    name: '미국 CPI (YoY)',
    country: 'US', category: 'inflation', importance: 'critical',
    scheduledAt: '2026-10-14T12:30:00Z',
    forecastValue: 3.1, unit: '%', source: 'BLS',
    averageKospiReaction: -0.15, averageVolatilityIncrease: 2.1, impactSeverity: 95,
  },
  {
    id: 'us-cpi-oct-2026',
    name: '미국 CPI (YoY)',
    country: 'US', category: 'inflation', importance: 'critical',
    scheduledAt: '2026-11-10T13:30:00Z', // BLS 공식 11/10
    forecastValue: 3.0, unit: '%', source: 'BLS',
    averageKospiReaction: -0.15, averageVolatilityIncrease: 2.1, impactSeverity: 95,
  },
  {
    id: 'us-cpi-nov-2026',
    name: '미국 CPI (YoY)',
    country: 'US', category: 'inflation', importance: 'critical',
    scheduledAt: '2026-12-10T13:30:00Z',
    forecastValue: 2.9, unit: '%', source: 'BLS',
    averageKospiReaction: -0.15, averageVolatilityIncrease: 2.1, impactSeverity: 95,
  },

  // ── FOMC 금리 결정 (7월, 9월, 11월, 12월) ────────────────────────────────
  {
    id: 'us-fomc-jul-2026',
    name: 'FOMC 금리 결정',
    country: 'US', category: 'interest_rate', importance: 'critical',
    scheduledAt: '2026-07-29T18:00:00Z',
    source: 'Fed',
    averageKospiReaction: 0.5, averageVolatilityIncrease: -0.8, impactSeverity: 98,
  },
  {
    id: 'us-fomc-sep-2026',
    name: 'FOMC 금리 결정',
    country: 'US', category: 'interest_rate', importance: 'critical',
    scheduledAt: '2026-09-16T18:00:00Z',
    source: 'Fed',
    averageKospiReaction: 0.5, averageVolatilityIncrease: -0.8, impactSeverity: 98,
  },
  {
    id: 'us-fomc-oct-2026',
    name: 'FOMC 금리 결정',
    country: 'US', category: 'interest_rate', importance: 'critical',
    scheduledAt: '2026-10-28T18:00:00Z', // 공식 10/27-28 (예전 값 11/4는 틀렸다)
    source: 'Fed',
    averageKospiReaction: 0.5, averageVolatilityIncrease: -0.8, impactSeverity: 98,
  },
  {
    id: 'us-fomc-dec-2026',
    name: 'FOMC 금리 결정',
    country: 'US', category: 'interest_rate', importance: 'critical',
    scheduledAt: '2026-12-09T19:00:00Z', // 공식 12/8-9 (예전 값 12/16은 틀렸다)
    source: 'Fed',
    averageKospiReaction: 0.5, averageVolatilityIncrease: -0.8, impactSeverity: 98,
  },

  // ── 미국 NFP / 실업률 (7~12월) ───────────────────────────────────────────
  {
    id: 'us-nfp-jun-2026',
    name: '미국 비농업고용 / 실업률',
    country: 'US', category: 'employment', importance: 'critical',
    scheduledAt: '2026-07-02T12:30:00Z',
    unit: '%', source: 'BLS',
    averageKospiReaction: -0.8, averageVolatilityIncrease: 2.8, impactSeverity: 92,
  },
  {
    id: 'us-nfp-jul-2026',
    name: '미국 비농업고용 / 실업률',
    country: 'US', category: 'employment', importance: 'critical',
    scheduledAt: '2026-08-07T12:30:00Z',
    unit: '%', source: 'BLS',
    averageKospiReaction: -0.8, averageVolatilityIncrease: 2.8, impactSeverity: 92,
  },
  {
    id: 'us-nfp-aug-2026',
    name: '미국 비농업고용 / 실업률',
    country: 'US', category: 'employment', importance: 'critical',
    scheduledAt: '2026-09-04T12:30:00Z',
    unit: '%', source: 'BLS',
    averageKospiReaction: -0.8, averageVolatilityIncrease: 2.8, impactSeverity: 92,
  },
  {
    id: 'us-nfp-sep-2026',
    name: '미국 비농업고용 / 실업률',
    country: 'US', category: 'employment', importance: 'critical',
    scheduledAt: '2026-10-02T12:30:00Z',
    unit: '%', source: 'BLS',
    averageKospiReaction: -0.8, averageVolatilityIncrease: 2.8, impactSeverity: 92,
  },
  {
    id: 'us-nfp-oct-2026',
    name: '미국 비농업고용 / 실업률',
    country: 'US', category: 'employment', importance: 'critical',
    scheduledAt: '2026-11-06T13:30:00Z',
    unit: '%', source: 'BLS',
    averageKospiReaction: -0.8, averageVolatilityIncrease: 2.8, impactSeverity: 92,
  },
  {
    id: 'us-nfp-nov-2026',
    name: '미국 비농업고용 / 실업률',
    country: 'US', category: 'employment', importance: 'critical',
    scheduledAt: '2026-12-04T13:30:00Z',
    unit: '%', source: 'BLS',
    averageKospiReaction: -0.8, averageVolatilityIncrease: 2.8, impactSeverity: 92,
  },

  // ── 한국 기준금리 결정 (하반기) ──────────────────────────────────────────
  {
    id: 'kr-base-rate-jul-2026',
    name: '한국 기준금리 결정',
    country: 'KR', category: 'interest_rate', importance: 'critical',
    scheduledAt: '2026-07-16T01:00:00Z',
    source: 'BOK',
    averageKospiReaction: 0.3, averageVolatilityIncrease: 1.2, impactSeverity: 85,
  },
  {
    id: 'kr-base-rate-aug-2026',
    name: '한국 기준금리 결정',
    country: 'KR', category: 'interest_rate', importance: 'critical',
    scheduledAt: '2026-08-27T01:00:00Z',
    source: 'BOK',
    averageKospiReaction: 0.3, averageVolatilityIncrease: 1.2, impactSeverity: 85,
  },
  {
    id: 'kr-base-rate-oct-2026',
    name: '한국 기준금리 결정',
    country: 'KR', category: 'interest_rate', importance: 'critical',
    scheduledAt: '2026-10-22T01:00:00Z', // 한국은행 공식 10/22 (예전 값 10/15는 틀렸다)
    source: 'BOK',
    averageKospiReaction: 0.3, averageVolatilityIncrease: 1.2, impactSeverity: 85,
  },
  {
    id: 'kr-base-rate-nov-2026',
    name: '한국 기준금리 결정',
    country: 'KR', category: 'interest_rate', importance: 'critical',
    scheduledAt: '2026-11-26T01:00:00Z',
    source: 'BOK',
    averageKospiReaction: 0.3, averageVolatilityIncrease: 1.2, impactSeverity: 85,
  },
]

/**
 * 2027 FOMC 금리 결정 — 연준 공식 일정(federalreserve.gov/monetarypolicy/fomccalendars.htm, 2026-09-29 확인).
 * 발표 동부 14:00 = 서머타임(3/14~11/6) 18:00Z, 그 외 19:00Z.
 * 수집 배치(economic_calendar_sync)가 같은 페이지를 주 1회 받아 오므로 여기는 수집 전 기본값이다.
 */
const FOMC_2027: Array<[string, string]> = [
  ['2027-01-27', '19:00'], ['2027-03-17', '18:00'], ['2027-04-28', '18:00'], ['2027-06-09', '18:00'],
  ['2027-07-28', '18:00'], ['2027-09-15', '18:00'], ['2027-10-27', '18:00'], ['2027-12-08', '19:00'],
]
for (const [date, utc] of FOMC_2027) {
  MAJOR_ECONOMIC_EVENTS.push({
    id: `us-fomc-${date}`,
    name: 'FOMC 금리 결정',
    country: 'US',
    category: 'interest_rate',
    importance: 'critical',
    scheduledAt: `${date}T${utc}:00Z`,
    source: 'Fed',
    impactSeverity: 98,
  })
}

/** 미국 동부 시각 → UTC ISO. 서머타임: 3월 둘째 일요일 ~ 11월 첫째 일요일. */
function usEasternToUtc(date: string, hour: number, minute: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay()
    return 1 + ((7 - first) % 7) + 7 * (n - 1)
  }
  const md = m * 100 + d
  const dst = md >= 300 + nthSunday(3, 2) && md < 1100 + nthSunday(11, 1)
  return new Date(Date.UTC(y, m - 1, d, hour + (dst ? 4 : 5), minute)).toISOString().replace('.000Z', 'Z')
}

/** 종류별 이벤트 형태와 발표 시각 — 아래 기본 일정과 수집 일정이 같이 쓴다 */
const KIND_SPECS: Record<SyncedEventKind, { template: Omit<EconomicEvent, 'id' | 'scheduledAt'>; at: (date: string) => string }> = {
  'us-cpi': {
    template: { name: '미국 CPI (YoY)', country: 'US', category: 'inflation', importance: 'critical', unit: '%', source: 'BLS', averageKospiReaction: -0.15, averageVolatilityIncrease: 2.1, impactSeverity: 95 },
    at: (d) => usEasternToUtc(d, 8, 30),
  },
  'us-ppi': {
    template: { name: '미국 PPI (YoY)', country: 'US', category: 'inflation', importance: 'high', unit: '%', source: 'BLS', averageKospiReaction: -0.4, averageVolatilityIncrease: 1.5, impactSeverity: 70 },
    at: (d) => usEasternToUtc(d, 8, 30),
  },
  'us-nfp': {
    template: { name: '미국 비농업고용 / 실업률', country: 'US', category: 'employment', importance: 'critical', unit: '%', source: 'BLS', averageKospiReaction: -0.8, averageVolatilityIncrease: 2.8, impactSeverity: 92 },
    at: (d) => usEasternToUtc(d, 8, 30),
  },
  'us-gdp': {
    template: { name: '미국 GDP (QoQ)', country: 'US', category: 'gdp', importance: 'high', unit: '%', source: 'BEA', averageKospiReaction: 0.1, averageVolatilityIncrease: 1.8, impactSeverity: 75 },
    at: (d) => usEasternToUtc(d, 8, 30),
  },
  'us-pce': {
    template: { name: '미국 Core PCE (YoY)', country: 'US', category: 'inflation', importance: 'critical', unit: '%', source: 'BEA', averageKospiReaction: -0.3, averageVolatilityIncrease: 1.9, impactSeverity: 88 },
    at: (d) => usEasternToUtc(d, 8, 30),
  },
  'us-fomc': {
    template: { name: 'FOMC 금리 결정', country: 'US', category: 'interest_rate', importance: 'critical', source: 'Fed', averageKospiReaction: 0.5, averageVolatilityIncrease: -0.8, impactSeverity: 98 },
    at: (d) => usEasternToUtc(d, 14, 0),
  },
  'kr-base-rate': {
    template: { name: '한국 기준금리 결정', country: 'KR', category: 'interest_rate', importance: 'critical', source: 'BOK', averageKospiReaction: 0.3, averageVolatilityIncrease: 1.2, impactSeverity: 85 },
    at: (d) => `${d}T01:00:00Z`, // 한국 오전 10시
  },
}

function eventOf(kind: SyncedEventKind, date: string): EconomicEvent {
  const spec = KIND_SPECS[kind]
  return { ...spec.template, id: `${kind}-${date}`, scheduledAt: spec.at(date) }
}

/**
 * 공식 연간 발표 일정 (2026-10-12 확인) — 수집 배치가 아직 안 돌았거나 Storage를 못 읽을 때의 기본값.
 * 평소에는 scripts/economic_calendar_sync.ts(.github/workflows/economic_calendar.yml, 주 1회)가 같은 출처에서 받아 온 일정이 우선한다.
 */
const OFFICIAL_SCHEDULES: Array<{ kind: SyncedEventKind; dates: string[] }> = [
  { kind: 'us-cpi', dates: ['2027-01-13', '2027-02-11', '2027-03-10', '2027-04-13', '2027-05-12', '2027-06-10', '2027-07-14', '2027-08-11', '2027-09-14', '2027-10-14', '2027-11-10', '2027-12-10'] },
  { kind: 'us-ppi', dates: ['2027-01-14', '2027-02-12', '2027-03-12', '2027-04-14', '2027-05-13', '2027-06-11', '2027-07-15', '2027-08-10', '2027-09-10', '2027-10-15', '2027-11-12', '2027-12-15'] },
  { kind: 'us-nfp', dates: ['2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02', '2027-05-07', '2027-06-04', '2027-07-02', '2027-08-06', '2027-09-03', '2027-10-08', '2027-11-05', '2027-12-03'] },
  { kind: 'us-gdp', dates: ['2026-10-29', '2026-11-25', '2026-12-23'] },
  { kind: 'us-pce', dates: ['2026-10-29', '2026-11-25', '2026-12-23'] },
]
for (const { kind, dates } of OFFICIAL_SCHEDULES) {
  for (const date of dates) MAJOR_ECONOMIC_EVENTS.push(eventOf(kind, date))
}

// ── 수집 일정 (Storage) ────────────────────────────────────────────────────
const SYNC_CACHE_MS = 6 * 60 * 60 * 1000
const SYNC_RETRY_MS = 10 * 60 * 1000
let syncCache: { until: number; file: SyncedCalendarFile | null } | null = null

/** 수집 일정 파일. 환경변수가 없거나(테스트·로컬) 읽기에 실패하면 직전 값 또는 null — 기본 일정만으로도 동작한다. */
async function loadSyncedCalendar(): Promise<SyncedCalendarFile | null> {
  if (syncCache && Date.now() < syncCache.until) return syncCache.file
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) return null
  let file: SyncedCalendarFile | null = null
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const client = createClient(url, key, { auth: { persistSession: false } })
    // 자동매매 흐름을 붙잡지 않도록 3초 안에 못 읽으면 기본 일정으로 간다
    const download = client.storage.from(SYNCED_CALENDAR_BUCKET).download(SYNCED_CALENDAR_PATH)
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
    const res = await Promise.race([download, timeout])
    if (res?.data) file = JSON.parse(await res.data.text()) as SyncedCalendarFile
  } catch {
    file = null
  }
  // 실패는 짧게 캐시하고 직전에 읽은 파일을 계속 쓴다
  syncCache = file
    ? { until: Date.now() + SYNC_CACHE_MS, file }
    : { until: Date.now() + SYNC_RETRY_MS, file: syncCache?.file ?? null }
  return syncCache.file
}

/**
 * 기본 일정 + 수집 일정 + 규칙 일정을 합친 전체 목록.
 * 수집 일정이 덮는 기간(이름별 첫 날~마지막 날) 안에서는 수집 쪽이 정본이다 — 하드코딩 날짜가 틀린 적이 있다
 * (한국 기준금리 10/15 → 공식 10/22, PPI 토요일 날짜).
 */
async function allMajorEvents(): Promise<EconomicEvent[]> {
  return mergeEconomicEvents(MAJOR_ECONOMIC_EVENTS, await loadSyncedCalendar())
}

export function mergeEconomicEvents(baseEvents: EconomicEvent[], file: SyncedCalendarFile | null, now = new Date()): EconomicEvent[] {
  const synced = Object.values(file?.sources ?? {})
    .flatMap((s) => s.events ?? [])
    .filter((e) => e.kind in KIND_SPECS)
    .map((e) => eventOf(e.kind, e.date))
  const span = new Map<string, [string, string]>()
  for (const e of synced) {
    const d = e.scheduledAt.slice(0, 10)
    const cur = span.get(e.name)
    span.set(e.name, cur ? [d < cur[0] ? d : cur[0], d > cur[1] ? d : cur[1]] : [d, d])
  }
  const base = baseEvents.filter((e) => {
    const s = span.get(e.name)
    const d = e.scheduledAt.slice(0, 10)
    return !s || d < s[0] || d > s[1]
  })
  const merged = new Map<string, EconomicEvent>()
  for (const e of [...synced, ...base]) {
    const k = `${e.name}|${e.scheduledAt.slice(0, 10)}`
    if (!merged.has(k)) merged.set(k, e)
  }
  const events = [...merged.values()]

  // 규칙으로 정해지는 일정 — 사람이 갱신하지 않아도 이어진다.
  // - FOMC 의사록: 연준 관행상 금리 결정 3주 뒤 수요일 동부 14:00 (위 FOMC 일정에서 파생)
  // - 중국 제조업 PMI: 국가통계국이 매월 말일 베이징 09:30 발표 (명절 등으로 하루이틀 밀릴 수 있는 추정치)
  for (const fomc of events.filter((e) => e.name === 'FOMC 금리 결정')) {
    const minutes = new Date(Date.parse(fomc.scheduledAt) + 21 * 86_400_000).toISOString().slice(0, 10)
    events.push({
      id: `us-fomc-minutes-${minutes}`,
      name: 'FOMC 의사록',
      country: 'US', category: 'interest_rate', importance: 'high',
      scheduledAt: usEasternToUtc(minutes, 14, 0),
      source: 'Fed',
      averageKospiReaction: 0.2, averageVolatilityIncrease: 1.0, impactSeverity: 72,
    })
  }
  for (let i = 0; i < 12; i++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 0)).toISOString().slice(0, 10)
    events.push({
      id: `china-pmi-${date}`,
      name: '중국 제조업 PMI',
      country: 'CN', category: 'manufacturing', importance: 'high',
      scheduledAt: `${date}T01:30:00Z`,
      source: 'NBS',
      averageKospiReaction: 0.2, averageVolatilityIncrease: 1.0, impactSeverity: 68,
    })
  }
  return events
}

/**
 * 이 일정표가 어디까지 채워져 있는지 — 이벤트별 마지막 날짜. 일정이 끝나면 경고·표시가 조용히 사라진다.
 * 무결성 점검(handlers/cron/integrityAudit.ts)이 60일 안에 끝나는 항목과 수집 배치 상태를 관리자에게 알린다.
 */
export async function economicCalendarCoverage(): Promise<Array<{ name: string; lastDate: string }>> {
  const last = new Map<string, string>()
  for (const e of await allMajorEvents()) {
    const d = e.scheduledAt.slice(0, 10)
    if ((last.get(e.name) ?? '') < d) last.set(e.name, d)
  }
  return [...last.entries()].map(([name, lastDate]) => ({ name, lastDate })).sort((a, b) => a.lastDate.localeCompare(b.lastDate))
}

/** 수집 배치 상태 — 파일 생성 시각과 실패한 출처 */
export async function economicCalendarSyncStatus(): Promise<{ generatedAt: string | null; failed: string[] }> {
  const file = await loadSyncedCalendar()
  return {
    generatedAt: file?.generatedAt ?? null,
    failed: Object.entries(file?.sources ?? {}).filter(([, s]) => !s.ok).map(([k, s]) => `${k}(${s.error ?? '오류'})`),
  }
}


function marketEventToEconomicEvent(e: MarketEvent): EconomicEvent {
  return {
    id: `market-${e.type.toLowerCase()}-${e.date}`,
    name: e.label,
    country: e.type.startsWith('US') ? 'US' : 'KR',
    category: 'options_expiry' as any,
    importance: e.importance,
    scheduledAt: `${e.date}T00:00:00Z`,
    source: e.type.startsWith('US') ? 'CBOE' : 'KRX',
    averageKospiReaction: e.averageKospiReaction,
    averageVolatilityIncrease: 1.5,
    impactSeverity: e.impactSeverity,
  }
}

/**
 * 지정된 시간 범위의 경제 이벤트 조회 (네마녀/옵션만기 자동 포함)
 */
export async function fetchEconomicCalendar(
  startDate?: string,
  endDate?: string,
  importance?: EventImportance
): Promise<EconomicCalendarResponse> {
  try {
    const start = startDate ? new Date(startDate) : new Date()
    const end = endDate
      ? new Date(endDate)
      : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

    const daysAhead = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
    const marketEvents = getUpcomingMarketEvents(daysAhead, start).map(marketEventToEconomicEvent)

    // MAJOR_ECONOMIC_EVENTS의 과거 반응 수치(averageKospiReaction·historicalImpacts)는 출처 없는 값이라
    // 검증 전까지 내보내지 않는다 — 만기일 이벤트의 같은 종류 수치는 실측과 방향이 반대였다 (2026-09-29)
    const allEvents = [
      ...(await allMajorEvents()).map(({ averageKospiReaction: _r, historicalImpacts: _h, ...rest }) => rest as EconomicEvent),
      ...marketEvents,
    ]

    const filteredEvents = allEvents.filter(event => {
      const eventDate = new Date(event.scheduledAt)
      const dateInRange = eventDate >= start && eventDate <= end
      const importanceMatch =
        !importance ||
        (importance === 'critical' && event.importance === 'critical') ||
        (importance === 'high'     && ['critical', 'high'].includes(event.importance)) ||
        (importance === 'medium'   && ['critical', 'high', 'medium'].includes(event.importance)) ||
        (importance === 'low')
      return dateInRange && importanceMatch
    }).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())

    const nextHighRiskEvent = filteredEvents.find(
      e => e.importance === 'critical' && new Date(e.scheduledAt) > new Date()
    )

    return {
      events: filteredEvents,
      timeRange: { start: start.toISOString(), end: end.toISOString() },
      nextHighRiskEvent,
      fetchedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.error('[fetchEconomicCalendar] error:', error)
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * 향후 7일 이내의 주요(critical/high) 경제 이벤트 조회
 */
export async function fetchUpcomingHighRiskEvents(): Promise<EconomicEvent[]> {
  const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const response = await fetchEconomicCalendar(undefined, sevenDaysLater, 'high')
  return response.events.filter(e => ['critical', 'high'].includes(e.importance))
}

// 순수 계산은 웹과 같이 쓰는 별도 파일에 있다
export { calculateEventImpactScore, generateEventTradeRestriction } from './economicEventImpact'

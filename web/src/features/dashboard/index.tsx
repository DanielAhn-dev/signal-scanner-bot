/**
 * Dashboard — 중앙 패널: 엑셀 셀 병합 스타일 대시보드
 * 오늘 점검 / 포트폴리오 요약 / 점수 상위 섹터 Top 8
 */
import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useCurrentChatId } from '../../stores/profileStore'
import EconomicEventBadge from '../../components/EconomicEventBadge'
import SheetHeaderBar from '../../components/SheetHeaderBar'
import { FLOW_STEPS } from '../../navigation'
import { useProfileStore } from '../../stores/profileStore'
import { useDetailed } from '../../stores/viewModeStore'
import GoalSummaryStrip from '../goal-tracker/GoalSummaryStrip'
import { useGoalTracker } from '../goal-tracker/useGoalTracker'
import { useJourney } from '../../lib/journey'
import { loadTradeCostSettings, resolveSellCostPct } from '../../lib/tradeCost'
import { adviseHoldings, type Holding } from '../../lib/holdingAdvice'
import { satelliteStatus, SATELLITE_LOSS_LIMIT_PCT, SATELLITE_MAX_WEIGHT_PCT } from '../../lib/satelliteGuard'
import { formatKrw } from '../../lib/format'
import { readUserState } from '../../lib/userState'
import { personalSetup, type InvestorProfile } from '../../lib/startPlan'

type SectorItem = {
  name?: string
  score?: number
  change?: number
  changeRate?: number
  /** 섹터 API가 실제로 주는 필드 — changeRate/change만 읽어서 등락률이 한 번도 안 보였다 */
  change_rate?: number
}

type MarketShiftView = {
  asOf: string
  unusualCount: number
  message: string
  indicators: Array<{
    key: 'gap60' | 'breadth' | 'foreign20' | 'vol20'
    label: string
    value: number | null
    asOf: string
    samples: number
    rank: number | null
    move: 'up' | 'down' | 'flat' | null
    unusual: boolean
  }>
  evidence: { windowDays: number; lookbackDays: number; unusualRule: string; limit: string }
}

function fmtShiftValue(key: MarketShiftView['indicators'][number]['key'], v: number | null): string {
  if (v == null) return '—'
  if (key === 'foreign20') return `${v >= 0 ? '+' : ''}${(v / 10_000).toFixed(1)}조원`
  if (key === 'breadth') return `${(v * 100).toFixed(0)}% 상승`
  if (key === 'gap60') return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
  return `${(v * 100).toFixed(2)}%`
}

/** 위치 0~1 → "상위 8%" / "하위 20%" / "중간대" */
function fmtShiftRank(rank: number | null): string {
  if (rank == null) return '자료 부족'
  if (rank >= 0.7) return `상위 ${Math.max(1, Math.round((1 - rank) * 100))}%`
  if (rank <= 0.3) return `하위 ${Math.max(1, Math.round(rank * 100))}%`
  return '중간대'
}

const SHIFT_MOVE_TEXT = { up: '▲ 높아짐', down: '▼ 낮아짐', flat: '→ 비슷함' } as const

type PortfolioSummary = {
  total_pnl?: number
  positions?: unknown[]
}

// 관리자의 오늘 점검 — 2026-09-29 방향 전환(지수 적립·행동 실수 차단·위험 관리) 뒤 매일 볼 것만 둔다.
// 종목 선별 흐름(FLOW_STEPS 1~7)은 '종목 연구' 탭과 각 화면 위 n/7 안내에 남기고 여기서는 링크 하나로 줄였다.
const ADMIN_TODO_STEPS: Array<{ key: string; label: string; desc: string; route?: string }> = [
  { key: 'control-audit', route: 'control?tab=audit', label: '관제 검산', desc: '어젯밤 배치·기록에 이상이 없는지 먼저 확인' },
  { key: 'portfolio', label: '비중 경고', desc: '아래 보유 종목 대응(한도 초과분 KODEX 200으로)을 처리했는지 확인' },
  { key: 'goal-tracker', label: '적립 진행', desc: '이번 달 입금이 들어갔고 계획선을 따라가는지 확인' },
  { key: 'market', label: `종목 연구 (${FLOW_STEPS.length}단계)`, desc: '매일 볼 필요 없음 — 봇 판단 근거를 따질 때만 1 시장부터' },
]

type MarketTileKey = 'kospi' | 'kosdaq' | 'sp500' | 'nasdaq' | 'usdkrw' | 'gold'
const MARKET_TILES: Array<{ key: MarketTileKey; label: string }> = [
  { key: 'kospi', label: '코스피' },
  { key: 'kosdaq', label: '코스닥' },
  { key: 'sp500', label: 'S&P 500' },
  { key: 'nasdaq', label: '나스닥' },
  { key: 'usdkrw', label: '원/달러' },
  { key: 'gold', label: '금' },
]
const NEWS_LIMIT = 5

// 셀 스타일 헬퍼
const S = {
  header: {
    background: 'var(--color-excel-cell-header)',
    fontWeight: 700,
    fontSize: 10,
  } as React.CSSProperties,
  sectionTitle: {
    background: '#E2EFDA',
    borderBottom: '1px solid #A9D18E',
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: '0.02em',
    color: '#276221',
  } as React.CSSProperties,
  divider: {
    height: 3,
    background: '#E2EFDA',
    borderTop: '1px solid #A9D18E',
    borderBottom: '1px solid #A9D18E',
    padding: 0,
  } as React.CSSProperties,
  midBorder: {
    borderRight: '2px solid var(--color-gray-400)',
  } as React.CSSProperties,
  link: {
    color: 'var(--color-brand)',
    cursor: 'pointer',
    fontSize: 10,
  } as React.CSSProperties,
}

function fmtPnl(v?: number): string {
  if (v == null) return '—'
  return (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('ko-KR') + '원'
}

function fmtChange(v?: number): string {
  if (v == null) return ''
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

function changeColor(v?: number): string | undefined {
  if (v == null) return undefined
  return v >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)'
}

/** "9/28 기준 · 9/29 19:13 갱신" — 스캔 기준 거래일 + 섹터 점수 갱신 시각(KST) */
function formatLastScan(scan: { tradeDate: string | null; updatedAt: string | null } | null): string {
  if (!scan?.tradeDate && !scan?.updatedAt) return '—'
  const parts: string[] = []
  if (scan.tradeDate) {
    const [, m, d] = scan.tradeDate.slice(0, 10).split('-')
    parts.push(`${Number(m)}/${Number(d)} 기준`)
  }
  if (scan.updatedAt) {
    const t = new Date(scan.updatedAt)
    if (!Number.isNaN(t.getTime())) {
      const kst = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(t)
      const get = (type: string) => kst.find((p) => p.type === type)?.value ?? ''
      parts.push(`${get('month')}/${get('day')} ${get('hour')}:${get('minute')} 갱신`)
    }
  }
  return parts.join(' · ')
}

export default function Dashboard({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const isAdmin = useProfileStore((s) => s.isAdmin)
  const detailed = useDetailed()
  const showMarketDetail = detailed && isAdmin
  const { view: goalView } = useGoalTracker()
  // 일반 사용자: '다음 할 일' 길잡이(lib/journey.ts) — 내 돈 점검 → 시작하기 → 매달 넣기 → 떨어질 때 할 일 → 월 1회 확인.
  // 끝난 단계는 ✓, 지금 할 단계에는 왜 하는지까지 붙인다
  const journey = useJourney(!isAdmin)
  const nextTodoKey: string | null = isAdmin ? null : journey?.next.key ?? null
  const todoSteps = isAdmin ? ADMIN_TODO_STEPS : (journey?.steps ?? []).map((s) => ({
    key: s.key, route: s.route, label: s.done ? `✓ ${s.label}` : s.label, desc: s.key === nextTodoKey ? `${s.desc} ${s.why}` : s.desc,
  }))
  const chatId = useCurrentChatId()
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null)
  const [sectors, setSectors]     = useState<SectorItem[]>([])
  const [topSector, setTopSector] = useState<string>('')
  const [lastScan, setLastScan] = useState<{ tradeDate: string | null; updatedAt: string | null } | null>(null)
  const [fillerRows, setFillerRows] = useState(0)
  const [marketShift, setMarketShift] = useState<MarketShiftView | null>(null)
  const [indices, setIndices] =useState<Partial<Record<MarketTileKey, { price?: number; changeRate?: number }>> | null>(null)
  const [realHoldings, setRealHoldings] = useState<Holding[] | null>(null)
  const [news, setNews] = useState<Array<{ title: string; link?: string; source?: string }>>([])

  // chatId가 준비되면 포트폴리오 로드 (스토어 hydration 완료 후 실행)
  useEffect(() => {
    if (!chatId) return
    apiFetch('/api/ui/portfolio-realtime', {
      method: 'GET',
      headers: { 'x-user-chat-id': chatId },
      cacheMs: 0,
    }).then(res => {
      if (res?.ok && res.data) setPortfolio(res.data)
    }).catch(() => {})
  }, [chatId])

  // 실계좌로 직접 입력한 보유 종목 — 있으면 종목별 대응, 없으면 지수 따라 하기 예상치를 보여준다
  useEffect(() => {
    if (!chatId) return
    const params = new URLSearchParams({ page: '1', pageSize: '50', includeLots: '0', positionType: 'holding' })
    apiFetch(`/api/ui/positions?${params}`, { cacheMs: 30_000, timeoutMs: 15_000, retries: 0 })
      .then((res) => {
        const rows: any[] = Array.isArray(res?.data) ? res.data : []
        setRealHoldings(rows.filter((r) => r?.account_kind === 'account').map((r) => ({
          code: String(r.code ?? ''), name: String(r.stock_name ?? r.name ?? r.code ?? ''),
          quantity: Number(r.quantity) || 0, avgPrice: Number(r.avg_price) || 0, currentPrice: Number(r.current_price) || 0,
        })))
      })
      .catch(() => {})
  }, [chatId])

  // 오늘의 시장·뉴스: 누구에게나 보이는 사실 정보
  useEffect(() => {
    apiFetch('/api/market-overview', { cacheMs: 60_000, timeoutMs: 20_000, retries: 0 })
      .then(res => {
        if (res?.data?.indices) setIndices(res.data.indices)
        if (res?.data?.marketShift) setMarketShift(res.data.marketShift)
      })
      .catch(() => {})
    apiFetch('/api/ui/news?page=1&pageSize=8', { cacheMs: 60_000, timeoutMs: 12_000 })
      .then(res => {
        const rows: unknown[] = Array.isArray(res?.data) ? res.data : []
        setNews(rows.map((r: any) => ({
          title: String(r?.title ?? '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim(),
          link: String(r?.link ?? r?.url ?? '').trim() || undefined,
          source: String(r?.source ?? '').trim() || undefined,
        })).filter(n => n.title).slice(0, NEWS_LIMIT))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    apiFetch('/api/ui?route=sectors&top=8', { cacheMs: 300_000 }).then(res => {
      const list: SectorItem[] = res?.data ?? res?.sectors ?? []
      setSectors(list)
      if (list.length > 0) setTopSector(list[0]?.name ?? '')
      if (res?.lastScan) setLastScan(res.lastScan)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const BASE_ROWS = 21
    const updateFillerRows = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const rowHeight = width < 640 ? 26 : width < 1024 ? 26 : 22
      const chromeHeight = width < 640 ? 280 : 230
      const estimatedVisibleRows = Math.floor(Math.max(0, height - chromeHeight) / rowHeight)
      const needed = Math.max(0, estimatedVisibleRows - BASE_ROWS)
      setFillerRows(Math.min(60, needed))
    }
    updateFillerRows()
    window.addEventListener('resize', updateFillerRows)
    return () => window.removeEventListener('resize', updateFillerRows)
  }, [])

  const nav = (r: string) => onNavigate?.(r)

  const advice = (() => {
    if (!realHoldings) return null
    const profile = readUserState<InvestorProfile>('investorProfile')
    const level = profile ? personalSetup(profile, 0).level : 'safe'
    const { buyFeeRatePct, sellFeeRatePct } = loadTradeCostSettings()
    return adviseHoldings({ holdings: realHoldings, level, sellCostPct: (code) => resolveSellCostPct({ code, sellRatePct: sellFeeRatePct, feeRatePct: buyFeeRatePct }) })
  })()

  const satellite = realHoldings ? satelliteStatus(realHoldings) : null

  const posCount = portfolio?.positions?.length ?? 0
  // 포트폴리오 화면의 매매비용 설정(차감 여부·요율)을 그대로 따른다
  const pnl = (() => {
    if (!portfolio) return undefined
    const { includeCost, buyFeeRatePct, sellFeeRatePct } = loadTradeCostSettings()
    const cost = (portfolio.positions ?? []).reduce((acc: number, p: any) => {
      const invested = Number(p.invested_amount || 0)
      const value = Number(p.current_value || 0)
      const sellPct = resolveSellCostPct({ code: p.code, sellRatePct: sellFeeRatePct, feeRatePct: buyFeeRatePct })
      return acc + invested * (buyFeeRatePct / 100) + (value > 0 ? value * (sellPct / 100) : 0)
    }, 0)
    const gross = (portfolio.positions ?? []).reduce((acc: number, p: any) => acc + Number(p.pnl_amount || 0), 0)
    return includeCost ? gross - cost : gross
  })()
  const pnlColor = pnl == null ? undefined : pnl >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)'
  const colWidths: Array<number | string | undefined> = [28, '17%', '17%', '17%', '17%', '20%', undefined]

  // 행번호 카운터
  let rn = 0
  const rowNum = () => ++rn

  return (
    <div className="dashboard-sheet" style={{ flex: 1, overflow: 'auto', width: '100%', minWidth: 0 }}>
      <GoalSummaryStrip />
      <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
        <colgroup>{colWidths.map((width, index) => (
          <col key={index} style={width == null ? undefined : { width }} />
        ))}</colgroup>
        <thead>
          <tr className="xls-letter-row">
            <th className="xls-corner"/>
            <th className="xls-col-letter">A</th>
            <th className="xls-col-letter">B</th>
            <th className="xls-col-letter">C</th>
            <th className="xls-col-letter">D</th>
            <th className="xls-col-letter">E</th>
            <th className="xls-col-letter">F</th>
          </tr>
        </thead>
        <tbody>

          {/* ── 상단 헤더 ── */}
          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={{ padding: '8px 10px' }}>
              <SheetHeaderBar
                title="대시보드"
                action={<EconomicEventBadge onNavigateToCalendar={() => nav('market')} />}
              />
            </td>
          </tr>

          {/* 빈 행 */}
          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell xls-cell--empty" colSpan={6}/>
          </tr>

          {/* ── 오늘의 플로우 헤더 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.sectionTitle}>
              {isAdmin ? '오늘 점검' : detailed ? '오늘 할 일' : '다음 할 일'}
              {isAdmin && (
                <span style={{ float: 'right', color: 'var(--color-brand)', cursor: 'pointer', fontSize: 10, fontWeight: 400 }} onClick={() => nav('reports')}>
                  복기 보기 →
                </span>
              )}
            </td>
          </tr>

          {/* 관리자: 오늘 점검(ADMIN_TODO_STEPS) · 사용자: 시드 모으기 가이드 */}
          {todoSteps.map((s, i) => (
            <tr key={s.key} className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}`}>
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={2} style={{ ...S.header, ...S.midBorder }}>
                <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400, marginRight: 4, fontSize: 10 }}>{i + 1}</span>
                <span style={{ color: 'var(--color-brand)', fontWeight: 700, fontSize: 10 }}>{s.label.replace(/^\d+\s+/, '')}</span>
              </td>
              <td className="xls-cell" colSpan={2} style={{ fontSize: 10, color: 'var(--color-text-secondary)', whiteSpace: 'normal', lineHeight: 1.5 }}>
                {s.desc}
              </td>
              {/* 마지막 열(F)은 폭이 남는 만큼만이라 링크가 잘렸다 — E·F 두 칸을 묶어 "지금 하기 →"가 온전히 보이게 한다 */}
              <td className="xls-cell" colSpan={2} style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <span style={{ ...S.link, ...(s.key === nextTodoKey ? { fontWeight: 700 } : {}) }} onClick={() => nav(s.route ?? s.key)}>{s.key === nextTodoKey ? '지금 하기 →' : '열기 →'}</span>
              </td>
            </tr>
          ))}

          {/* ── 시장 분위기 변화: 자기 과거 대비 위치·변화 현황(예측 아님). 관리자 또는 자세히 보기에서만 ── */}
          {(isAdmin || detailed) && marketShift && (<>
            <tr className="xls-row">
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={2} style={{ ...S.header, ...S.midBorder }}>시장 분위기 변화</td>
              <td className="xls-cell" colSpan={4} style={{ ...S.header, fontWeight: 400, color: 'var(--color-text-tertiary)' }}>
                코스피 · {marketShift.asOf} 기준 · 최근 {marketShift.evidence.windowDays}거래일 대비 위치
              </td>
            </tr>
            {marketShift.indicators.map((x, i) => (
              <tr key={x.key} className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}`}>
                <td className="xls-row-num">{rowNum()}</td>
                <td className="xls-cell" colSpan={2} style={{ ...S.midBorder, fontSize: 10 }}>{x.label}</td>
                <td className="xls-cell" style={{ fontSize: 10 }}>{fmtShiftValue(x.key, x.value)}</td>
                <td className="xls-cell" style={{ fontSize: 10, fontWeight: x.unusual ? 700 : 400, color: x.unusual ? 'var(--color-brand)' : undefined }}>
                  {x.rank == null ? `자료 부족 (${x.samples}/120일)` : fmtShiftRank(x.rank)}
                  {x.rank != null && x.asOf !== marketShift.asOf && (
                    <span style={{ fontWeight: 400, color: 'var(--color-text-tertiary)' }}> ({x.asOf.slice(5)} 기준)</span>
                  )}
                </td>
                <td className="xls-cell" colSpan={2} style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
                  {x.move ? `${SHIFT_MOVE_TEXT[x.move]} (${marketShift.evidence.lookbackDays}거래일 전 대비)` : '—'}
                </td>
              </tr>
            ))}
            <tr className="xls-row">
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={6} style={{ fontSize: 10, whiteSpace: 'normal', lineHeight: 1.5, color: 'var(--color-text-secondary)' }}>
                {marketShift.message} · {marketShift.evidence.limit}
              </td>
            </tr>
          </>)}

          {/* ── 구분선 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.divider} />
          </tr>

          {/* ── 보유 종목 | 미실현 손익 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={{ ...S.header, ...S.midBorder }}>보유 종목</td>
            <td className="xls-cell" colSpan={3} style={S.header}>미실현 손익</td>
          </tr>

          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={{ ...S.midBorder, fontSize: 20, fontWeight: 700, lineHeight: 1.2, padding: '4px 6px' }}>
              {/* 불러온 뒤 보유가 0이면 0 — '—'는 아직 못 불러온 상태만 */}
              {portfolio ? posCount : '—'}
              <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-secondary)', marginLeft: 4 }}>종목</span>
            </td>
            <td className="xls-cell" colSpan={3} style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, padding: '4px 6px', color: pnlColor }}>
              {fmtPnl(pnl)}
            </td>
          </tr>

          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={S.midBorder}>
              <span style={S.link} onClick={() => nav('portfolio')}>가상 포트폴리오 →</span>
            </td>
            <td className="xls-cell" colSpan={3} style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
              평가손익 합계 ({loadTradeCostSettings().includeCost ? '수수료·세금 반영' : '보유 포지션 기준'})
            </td>
          </tr>

          {/* ── 구분선 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.divider} />
          </tr>

          {/* ── 내 대응: 실계좌 개별 종목이 있으면 종목별 할 일, 없으면 지수를 따라 했을 때의 예상 ── */}
          {advice && (
            <>
              <tr className="xls-row">
                <td className="xls-row-num">{rowNum()}</td>
                <td className="xls-cell" colSpan={6} style={S.sectionTitle}>
                  {advice.length > 0 ? '내 보유 종목, 이렇게 대응하세요' : '이대로 따라 하면'}
                  <span style={{ float: 'right', color: 'var(--color-brand)', cursor: 'pointer', fontSize: 10, fontWeight: 400 }} onClick={() => nav(advice.length > 0 ? 'portfolio' : 'goal-tracker')}>
                    {advice.length > 0 ? '보유 입력·수정 →' : '목표 자세히 →'}
                  </span>
                </td>
              </tr>
              {advice.length === 0 && (
                <tr className="xls-row xls-row--even">
                  <td className="xls-row-num">{rowNum()}</td>
                  <td className="xls-cell" colSpan={6} style={{ whiteSpace: 'normal', lineHeight: 1.6, fontSize: 11, padding: '6px 8px' }}>
                    {goalView ? (
                      <>
                        지금 목표 달성률 <strong>{goalView.target.progressPct.toFixed(0)}%</strong>
                        {goalView.target.etaMonth
                          ? <> · 매달 적립하며 과거 평균(연 {goalView.settings.planAnnualPct}%) 수익이 이어지면 <strong>{goalView.target.etaMonth}</strong> 무렵 도달 예상</>
                          : <> · 지금 속도로는 도달 시점을 잡기 어렵습니다. 월 적립이나 목표를 조정해 보세요</>}
                        <span style={{ display: 'block', color: 'var(--color-text-tertiary)', fontSize: 10 }}>과거 평균일 뿐 보장이 아닙니다. 개별 종목을 직접 사셨다면 포트폴리오에 입력하면 종목별 대응을 알려드려요.</span>
                      </>
                    ) : '시작하기를 마치면 예상 달성 시점을 보여드립니다.'}
                  </td>
                </tr>
              )}
              {/* 개별주 묶음 전체: 상한 10%·손실 한도 -15% (종목 하나씩은 아래 행) */}
              {satellite && (satellite.overWeight || satellite.overLoss) && (
                <tr className="xls-row">
                  <td className="xls-row-num">{rowNum()}</td>
                  <td className="xls-cell" colSpan={6} style={{ whiteSpace: 'normal', lineHeight: 1.5, fontSize: 11, padding: '6px 8px', background: 'var(--color-warning-bg)' }}>
                    <span style={{ fontWeight: 700 }}>개별주 묶음 {satellite.stockCount}종목</span>
                    <span style={{ marginLeft: 6, fontSize: 10, color: changeColor(satellite.pnlPct) }}>{fmtChange(satellite.pnlPct)}</span>
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-text-tertiary)' }}>비중 {satellite.weightPct.toFixed(0)}%</span>
                    {satellite.overWeight && (
                      <span style={{ display: 'block', color: 'var(--color-brand)', fontWeight: 700 }}>
                        → 개별주가 전체의 {SATELLITE_MAX_WEIGHT_PCT}%를 넘었어요. 새로 사지 말고, 약 {formatKrw(satellite.trimAmount)}만큼 줄이면 {SATELLITE_MAX_WEIGHT_PCT}%로 돌아와요
                      </span>
                    )}
                    {satellite.overLoss && (
                      <span style={{ display: 'block', color: 'var(--color-brand)', fontWeight: 700 }}>
                        → 개별주 묶음이 {SATELLITE_LOSS_LIMIT_PCT}% 손실 한도에 닿았어요. 이번 분기엔 개별주를 새로 사지 않는 걸 권해요
                      </span>
                    )}
                    <span style={{ display: 'block', color: 'var(--color-text-secondary)', fontSize: 10 }}>
                      종목 고르기로 지수를 이긴 근거를 못 찾았기 때문에(검증 C1·C15~C27) 개별주는 작게, 잃는 한도를 정해 두는 게 원칙이에요. 비중은 이 앱에 입력한 실계좌 보유 기준이고, 이미 팔아 확정한 손실은 빠져 있어요.
                    </span>
                  </td>
                </tr>
              )}
              {advice.map((a, i) => (
                <tr key={`adv${a.code}`} className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}`}>
                  <td className="xls-row-num">{rowNum()}</td>
                  <td className="xls-cell" colSpan={6} style={{ whiteSpace: 'normal', lineHeight: 1.5, fontSize: 11, padding: '6px 8px' }}>
                    <span style={{ fontWeight: 700 }}>{a.name}</span>
                    <span style={{ marginLeft: 6, fontSize: 10, color: changeColor(a.pnlPct) }}>{fmtChange(a.pnlPct)}</span>
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-text-tertiary)' }}>비중 {a.weightPct.toFixed(0)}%</span>
                    <span style={{ display: 'block', color: 'var(--color-brand)', fontWeight: 700 }}>→ {a.headline}</span>
                    <span style={{ display: 'block', color: 'var(--color-text-secondary)', fontSize: 10 }}>{a.detail}</span>
                  </td>
                </tr>
              ))}
              <tr className="xls-row">
                <td className="xls-row-num">{rowNum()}</td>
                <td className="xls-cell" colSpan={6} style={S.divider} />
              </tr>
            </>
          )}

          {/* ── 오늘의 시장: 지수·환율 (사실 정보만, 봇 판단 근거는 제외) ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.sectionTitle}>
              오늘의 시장
              <span style={{ float: 'right', color: 'var(--color-brand)', cursor: 'pointer', fontSize: 10, fontWeight: 400 }} onClick={() => nav('market')}>
                더 보기 →
              </span>
            </td>
          </tr>
          {Array.from({ length: Math.ceil(MARKET_TILES.length / 2) }, (_, i) => (
            <tr key={`mk${i}`} className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}`}>
              <td className="xls-row-num">{rowNum()}</td>
              {[MARKET_TILES[i * 2], MARKET_TILES[i * 2 + 1]].map((tile, j) => {
                const idx = tile ? indices?.[tile.key] : undefined
                const rate = idx?.changeRate
                return (
                  <td key={j} className="xls-cell" colSpan={3} style={{ padding: '4px 6px', ...(j === 0 ? S.midBorder : {}) }}>
                    {tile && (
                      <>
                        <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{tile.label}</span>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>
                          {idx?.price != null ? idx.price.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '—'}
                          {rate != null && (
                            <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 6, color: changeColor(rate) }}>{fmtChange(rate)}</span>
                          )}
                        </span>
                      </>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}

          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.divider} />
          </tr>

          {/* ── 주요 뉴스 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.sectionTitle}>
              주요 뉴스
              <span style={{ float: 'right', color: 'var(--color-brand)', cursor: 'pointer', fontSize: 10, fontWeight: 400 }} onClick={() => nav('news')}>
                전체 보기 →
              </span>
            </td>
          </tr>
          {news.length === 0 && (
            <tr className="xls-row xls-row--even">
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={6} style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                뉴스를 불러오는 중이거나 아직 없습니다
              </td>
            </tr>
          )}
          {news.map((n, i) => (
            <tr key={`nw${i}`} className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}`}>
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={6} style={{ whiteSpace: 'normal', lineHeight: 1.5, fontSize: 11 }}>
                {n.link ? (
                  <a href={n.link} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{n.title}</a>
                ) : n.title}
                {n.source && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--color-text-tertiary)' }}>{n.source}</span>}
              </td>
            </tr>
          ))}

          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.divider} />
          </tr>

          {/* 스캔·섹터는 봇 판단 근거라 관리자의 자세히 보기에서만 */}
          {showMarketDetail && (<>
          {/* ── 마지막 스캔 | 1위 섹터 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={{ ...S.header, ...S.midBorder }}>마지막 스캔</td>
            <td className="xls-cell" colSpan={3} style={S.header}>1위 섹터</td>
          </tr>

          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={{ ...S.midBorder, fontSize: 14, fontWeight: 700, padding: '4px 6px' }}>
              {formatLastScan(lastScan)}
            </td>
            <td className="xls-cell" colSpan={3} style={{ fontSize: 14, fontWeight: 700, padding: '4px 6px', color: 'var(--color-brand)' }}>
              {topSector || '—'}
            </td>
          </tr>

          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={S.midBorder}>
              <span style={S.link} onClick={() => nav('scan')}>스캔 실행 시작</span>
            </td>
            <td className="xls-cell" colSpan={3}>
              <span style={S.link} onClick={() => nav('sectors')}>섹터 페이지 →</span>
            </td>
          </tr>

          {/* ── 구분선 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.divider} />
          </tr>

          {/* ── 유망 섹터 Top 8 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.sectionTitle}>
              점수 상위 섹터 Top 8
              <span style={{ float: 'right', color: 'var(--color-brand)', cursor: 'pointer', fontSize: 10, fontWeight: 400 }} onClick={() => nav('sectors')}>
                전체 보기 →
              </span>
            </td>
          </tr>

          {/* 섹터 헤더 행 */}
          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={2} style={S.header}>섹터명</td>
            <td className="xls-cell" style={{ ...S.header, ...S.midBorder }}>점수</td>
            <td className="xls-cell" colSpan={2} style={S.header}>섹터명</td>
            <td className="xls-cell" style={S.header}>점수</td>
          </tr>

          {/* 섹터 데이터 행 (4행 × 2열) */}
          {Array.from({ length: 4 }, (_, i) => {
            const s1 = sectors[i * 2]
            const s2 = sectors[i * 2 + 1]
            const c1 = s1?.change_rate ?? s1?.changeRate ?? s1?.change
            const c2 = s2?.change_rate ?? s2?.changeRate ?? s2?.change
            return (
              <tr key={i} className={`xls-row${i % 2 === 0 ? '' : ' xls-row--even'}`}>
                <td className="xls-row-num">{rowNum()}</td>

                {/* 섹터 1 이름 */}
                <td className="xls-cell" colSpan={2} style={{ fontWeight: 600, fontSize: 11 }}>
                  {s1 ? (
                    <>
                      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 9, marginRight: 3 }}>#{i * 2 + 1}</span>
                      {s1.name}
                    </>
                  ) : null}
                </td>

                {/* 섹터 1 점수 */}
                <td className="xls-cell xls-cell--wrap" style={{ fontSize: 10, ...S.midBorder }}>
                  {s1 ? (
                    <>
                      <span style={{ display: 'block', color: 'var(--color-brand)', fontWeight: 600 }}>{s1.score}점</span>
                      {c1 != null && (
                        <span style={{ display: 'block', color: changeColor(c1), fontSize: 9, whiteSpace: 'nowrap' }}>{fmtChange(c1)}</span>
                      )}
                    </>
                  ) : null}
                </td>

                {/* 섹터 2 이름 */}
                <td className="xls-cell" colSpan={2} style={{ fontWeight: 600, fontSize: 11 }}>
                  {s2 ? (
                    <>
                      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 9, marginRight: 3 }}>#{i * 2 + 2}</span>
                      {s2.name}
                    </>
                  ) : null}
                </td>

                {/* 섹터 2 점수 */}
                <td className="xls-cell xls-cell--wrap" style={{ fontSize: 10 }}>
                  {s2 ? (
                    <>
                      <span style={{ display: 'block', color: 'var(--color-brand)', fontWeight: 600 }}>{s2.score}점</span>
                      {c2 != null && (
                        <span style={{ display: 'block', color: changeColor(c2), fontSize: 9, whiteSpace: 'nowrap' }}>{fmtChange(c2)}</span>
                      )}
                    </>
                  ) : null}
                </td>
              </tr>
            )
          })}

          </>)}

          {/* ── 남는 높이만 채우는 빈 여백 ── */}
          {Array.from({ length: fillerRows }, (_, i) => (
            <tr key={`empty${i}`} className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}`}>
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell xls-cell--empty" colSpan={6}/>
            </tr>
          ))}

        </tbody>
      </table>
    </div>
  )
}

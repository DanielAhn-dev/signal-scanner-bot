/**
 * Dashboard — 중앙 패널: 엑셀 셀 병합 스타일 대시보드
 * 오늘 점검 / 포트폴리오 요약 / 점수 상위 섹터 Top 8
 */
import React, { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useCurrentChatId } from '../../stores/profileStore'
import EconomicEventBadge from '../../components/EconomicEventBadge'
import SheetHeaderBar from '../../components/SheetHeaderBar'
import { FLOW_STEPS } from '../../navigation'
import { useProfileStore } from '../../stores/profileStore'
import { useDetailed } from '../../stores/viewModeStore'
import AccountTag from '../../components/ui/AccountTag'
import MonthTaskCard from '../month-task/MonthTaskCard'
import RaiseNudge from '../month-task/RaiseNudge'
import SavingProgressCard from '../saving-progress/SavingProgressCard'
import { useJourney, type EntryPath } from '../../lib/journey'
import { useToast } from '../../components/ToastProvider'
import { loadTradeCostSettings, resolveSellCostPct } from '../../lib/tradeCost'
import { adviseHoldings, type Holding } from '../../lib/holdingAdvice'
import { satelliteStatus, SATELLITE_LOSS_LIMIT_PCT, SATELLITE_MAX_WEIGHT_PCT, SATELLITE_SELL_WEIGHT_PCT } from '../../lib/satelliteGuard'
import { formatKrw } from '../../lib/format'
import { useUserState } from '../../lib/userState'
import { sanitizeDropPlan, type DropPlan } from '../../lib/dropPlan'
import type { DropDayView } from '../../lib/dropDay'
import { renderDropDayRows } from './dropDayRows'
import { daysUntil, fmtScheduleDate, useDistributionSchedule } from '../distribution-schedule/schedule'
import { useFillerRows } from '../../hooks/useFillerRows'
import { pickIndustrySectors, sectorChange } from '../../lib/sectorDisplay'

type SectorItem = {
  name?: string
  score?: number
  change?: number
  changeRate?: number
  /** 섹터 API가 실제로 주는 필드 — changeRate/change만 읽어서 등락률이 한 번도 안 보였다 */
  change_rate?: number
  metrics?: { change_sample?: number } | null
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
// 종목 선별 흐름(FLOW_STEPS)은 '종목 연구' 탭과 각 화면 위 n/N 안내에 남기고 여기서는 링크 하나로 줄였다.
const ADMIN_TODO_STEPS: Array<{ key: string; label: string; desc: string; route?: string }> = [
  { key: 'control-audit', route: 'control?tab=audit', label: '관제 검산', desc: '어젯밤 배치·기록에 이상이 없는지 먼저 확인' },
  { key: 'portfolio', label: '비중 경고', desc: '아래 내 계좌 [실제] 줄의 대응 필요(한도 초과분 KODEX 200으로)를 처리했는지 확인' },
  { key: 'goal-tracker', label: '적립 진행', desc: '이번 달 입금이 들어갔고 계획선을 따라가는지 확인' },
  { key: 'market', label: `종목 연구 (${FLOW_STEPS.length}단계)`, desc: '매일 볼 필요 없음 — 봇 판단 근거를 따질 때만 1 시장부터' },
]

type MarketTileKey = 'kospi' | 'kosdaq' | 'sp500' | 'nasdaq' | 'usdkrw' | 'gold'
/** 대시보드에는 한 줄 요약만 — 나머지 지수·뉴스는 시장 화면에서 */
const MARKET_TILES: Array<{ key: MarketTileKey; label: string }> = [
  { key: 'kospi', label: '코스피' },
  { key: 'kosdaq', label: '코스닥' },
  { key: 'usdkrw', label: '원/달러' },
]

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
  summary: {
    fontSize: 11,
    whiteSpace: 'normal',
    lineHeight: 1.5,
    wordBreak: 'keep-all',
    padding: '5px 8px',
  } as React.CSSProperties,
  quiet: {
    fontSize: 10,
    color: 'var(--color-text-tertiary)',
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

/** "9/28 스캔 · 섹터 점수 9/29 19:13" — 스캔 기준 거래일 + 섹터 점수 갱신 시각(KST). 둘은 따로 갱신되니 무엇의 날짜인지 붙인다 */
function formatLastScan(scan: { tradeDate: string | null; updatedAt: string | null } | null): string {
  if (!scan?.tradeDate && !scan?.updatedAt) return '—'
  const parts: string[] = []
  if (scan.tradeDate) {
    const [, m, d] = scan.tradeDate.slice(0, 10).split('-')
    parts.push(`${Number(m)}/${Number(d)} 스캔`)
  }
  if (scan.updatedAt) {
    const t = new Date(scan.updatedAt)
    if (!Number.isNaN(t.getTime())) {
      const kst = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(t)
      const get = (type: string) => kst.find((p) => p.type === type)?.value ?? ''
      parts.push(`섹터 점수 ${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`)
    }
  }
  return parts.join(' · ')
}

export default function Dashboard({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const isAdmin = useProfileStore((s) => s.isAdmin)
  const detailed = useDetailed()
  const showMarketDetail = detailed && isAdmin
  // 일반 사용자: '다음 할 일' 길잡이(lib/journey.ts) — 내 돈 점검 → 시작하기 → 매달 넣기 → 떨어질 때 할 일 → 월 1회 확인.
  // 끝난 단계는 ✓, 지금 할 단계에는 왜 하는지까지 붙인다
  const journey = useJourney(!isAdmin)
  const nextTodoKey: string | null = isAdmin ? null : journey?.next.key ?? null
  const todoSteps: Array<{ key: string; route?: string; label: string; desc: string; side?: { label: string; route: string } }> = isAdmin ? ADMIN_TODO_STEPS : (journey?.steps ?? []).map((s) => ({
    key: s.key, route: s.route, label: s.done ? `✓ ${s.label}` : s.label, desc: s.key === nextTodoKey ? `${s.desc} ${s.why}` : s.desc, side: s.side,
  }))
  // 길을 아직 안 골랐고 추정할 근거(시드·실계좌)도 없으면 홈에서 고르게 한다. 저장이 확인된 뒤에만 화면이 바뀐다
  const toast = useToast()
  const choosingRef = useRef(false)
  const choosePath = async (path: EntryPath) => {
    if (!journey || choosingRef.current) return
    choosingRef.current = true
    const ok = await journey.choosePath(path)
    choosingRef.current = false
    if (!ok) toast.show('저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.')
  }
  const needsPathChoice = !isAdmin && journey != null && journey.path === null
  const chatId = useCurrentChatId()
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null)
  const [sectors, setSectors]     = useState<SectorItem[]>([])
  const [topSector, setTopSector] = useState<string>('')
  const [lastScan, setLastScan] = useState<{ tradeDate: string | null; updatedAt: string | null } | null>(null)
  const [marketShift, setMarketShift] = useState<MarketShiftView | null>(null)
  const [dropDay, setDropDay] = useState<DropDayView | null>(null)
  const [dropDayOpen, setDropDayOpen] = useState(false)
  const { value: dropPlanRaw } = useUserState<DropPlan>('dropPlan')
  const dropPlan = sanitizeDropPlan(dropPlanRaw)
  const [indices, setIndices] =useState<Partial<Record<MarketTileKey, { price?: number; changeRate?: number }>> | null>(null)
  const [realHoldings, setRealHoldings] = useState<Holding[] | null>(null)
  const [allTodosOpen, setAllTodosOpen] = useState(false)
  const distSchedule = useDistributionSchedule()

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
    // 50건이면 실계좌 보유가 많은 계정에서 '보유 50종목'으로 잘렸다 — API 상한(200)까지 받는다
    const params = new URLSearchParams({ page: '1', pageSize: '200', includeLots: '0', positionType: 'holding' })
    apiFetch(`/api/ui/positions?${params}`, { cacheMs: 30_000, timeoutMs: 15_000, retries: 0 })
      .then((res) => {
        const rows: any[] = Array.isArray(res?.data) ? res.data : []
        setRealHoldings(rows.filter((r) => r?.account_kind === 'account').map((r) => ({
          code: String(r.code ?? ''), name: String(r.stock_name ?? r.name ?? r.code ?? ''),
          quantity: Number(r.quantity) || 0, avgPrice: Number(r.avg_price) || 0, currentPrice: Number(r.current_price) || 0,
          productType: r.stock_product_type ?? null,
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
        if (res?.data?.dropDay) setDropDay(res.data.dropDay)
      })
      .catch(() => {})
  }, [])

  // 스캔·섹터는 관리자의 자세히 보기에서만 보여 준다 — 안 보일 때는 부르지 않는다
  useEffect(() => {
    if (!showMarketDetail) return
    // 지수 묶음(코스피 200 TOP 10 등)을 빼고도 8개가 남도록 넉넉히 받는다
    apiFetch('/api/ui?route=sectors&top=16', { cacheMs: 300_000 }).then(res => {
      const list = pickIndustrySectors<SectorItem>(res?.data ?? res?.sectors ?? [], 8)
      setSectors(list)
      if (list.length > 0) setTopSector(list[0]?.name ?? '')
      if (res?.lastScan) setLastScan(res.lastScan)
    }).catch(() => {})
  }, [showMarketDetail])

  // 표 아래 빈 셀 줄 — 화면에 남는 높이만큼만(useFillerRows 참고)
  const sheetRef = useRef<HTMLDivElement>(null)
  const fillerRows = useFillerRows(sheetRef)

  const nav = (r: string) => onNavigate?.(r)

  const advice = (() => {
    if (!realHoldings) return null
    // 한도는 종목 카드(holdingAction)·개별주 묶음 경고(satelliteGuard)와 같은 10%. 프로필의 level은 종목 봇 기본값이라 쓰지 않는다
    const level = 'balanced' as const
    const { buyFeeRatePct, sellFeeRatePct } = loadTradeCostSettings()
    // 코드만으로는 알려진 몇 종목 말고는 ETF를 못 알아봐 거래세를 붙였다 — 이름·상품 유형을 함께 넘긴다
    const byCode = new Map(realHoldings.map((h) => [h.code, h]))
    return adviseHoldings({
      holdings: realHoldings,
      level,
      sellCostPct: (code) =>
        resolveSellCostPct({ code, name: byCode.get(code)?.name, productType: byCode.get(code)?.productType, sellRatePct: sellFeeRatePct, feeRatePct: buyFeeRatePct }),
    })
  })()

  const satellite = realHoldings ? satelliteStatus(realHoldings) : null
  // 대응 필요 = 그대로 보유가 아닌 것(줄이기·옮기기). 비중이 큰 것부터
  const actionNeeded = (advice ?? []).filter((a) => a.action !== 'keep').sort((x, y) => y.weightPct - x.weightPct)
  // 마지막 매수일이 2주 안인 가장 이른 분배 — 같은 날이 여러 종목이면 첫 종목 + 외 N종목
  const nextDist = (() => {
    if (!distSchedule) return null
    const soon = distSchedule.items.filter((it) => daysUntil(distSchedule.today, it.lastBuyDate) <= 14)
    if (soon.length === 0) return null
    const day = soon[0].lastBuyDate
    return { first: soon[0], more: soon.filter((it) => it.lastBuyDate === day).length - 1 }
  })()
  const visibleTodos = isAdmin || allTodosOpen ? todoSteps : todoSteps.filter((s) => s.key === nextTodoKey)

  // portfolio-realtime은 실계좌 행까지 준다 — '가상 계좌' 줄은 증권사·계좌명이 둘 다 빈 행만 센다
  // (전에는 실계좌 82종목 손익이 가상 계좌 손익·종목 수로 보였다)
  const virtualPositions = (portfolio?.positions ?? []).filter((p: any) => !String(p?.broker_name ?? '').trim() && !String(p?.account_name ?? '').trim())
  const posCount = virtualPositions.length
  // 포트폴리오 화면의 매매비용 설정(차감 여부·요율)을 그대로 따른다
  const pnl = (() => {
    if (!portfolio) return undefined
    const { includeCost, buyFeeRatePct, sellFeeRatePct } = loadTradeCostSettings()
    const cost = virtualPositions.reduce((acc: number, p: any) => {
      const invested = Number(p.invested_amount || 0)
      const value = Number(p.current_value || 0)
      const sellPct = resolveSellCostPct({ code: p.code, name: p.name, productType: p.product_type, sellRatePct: sellFeeRatePct, feeRatePct: buyFeeRatePct })
      return acc + invested * (buyFeeRatePct / 100) + (value > 0 ? value * (sellPct / 100) : 0)
    }, 0)
    const gross = virtualPositions.reduce((acc: number, p: any) => acc + Number(p.pnl_amount || 0), 0)
    return includeCost ? gross - cost : gross
  })()
  const pnlColor = pnl == null ? undefined : pnl >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)'
  const colWidths: Array<number | string | undefined> = [28, '17%', '17%', '17%', '17%', '20%', undefined]

  // 행번호 카운터
  let rn = 0
  const rowNum = () => ++rn

  return (
    <div ref={sheetRef} className="dashboard-sheet" style={{ flex: 1, overflow: 'auto', width: '100%', minWidth: 0 }}>
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

          {/* 내 계획(MyPlanCard)은 모아가기 화면으로 옮겼다 — 홈은 [실제] 이번 달 할 일 + '내 모으기' 요약.
              카드는 표 밖이 아니라 A~F 머리글 아래 병합 셀 안에 둔다(밖에 두면 머리글이 카드 밑으로 밀려 보였다) */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td colSpan={6} style={{ padding: 0, whiteSpace: 'normal', verticalAlign: 'top', border: '1px solid var(--color-excel-grid-border)' }}>
              <RaiseNudge />
              <MonthTaskCard />
              <SavingProgressCard variant="home" />
            </td>
          </tr>

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

          {/* ── 큰 하락일 안내: 코스피 하루 −1.5% 이하일 때만, 평소엔 한 줄(예측 아님) ── */}
          {renderDropDayRows({ view: dropDay, sp500ChangePct: indices?.sp500?.changeRate, rowNum, open: dropDayOpen, onToggle: () => setDropDayOpen((v) => !v), onOpenPlan: () => nav('plan'), dropPlan, onOpenDropPlan: () => nav('plan-sim#drop-plan') })}

          {/* ── 다음 할 일: 관리자는 오늘 점검 전체, 일반 사용자는 다음 1개만(펼치면 전체) ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.sectionTitle}>
              {isAdmin ? '오늘 점검' : needsPathChoice ? '어디서 시작할까요' : '다음 할 일'}
              {isAdmin ? (
                <span style={{ float: 'right', color: 'var(--color-brand)', cursor: 'pointer', fontSize: 10, fontWeight: 400 }} onClick={() => nav('reports')}>
                  복기 보기 →
                </span>
              ) : !needsPathChoice && todoSteps.length > 1 && (
                <button type="button" style={{ float: 'right', ...S.link, background: 'none', border: 0, padding: 0, fontWeight: 400 }} aria-expanded={allTodosOpen} onClick={() => setAllTodosOpen((v) => !v)}>
                  {allTodosOpen ? '접기' : `전체 ${todoSteps.length}단계 보기`}
                </button>
              )}
            </td>
          </tr>

          {/* 처음 들어온 일반 사용자: 길 고르기. 고르면 사라지고 그 길의 다음 할 일 1개만 보인다 */}
          {needsPathChoice && (<>
            <tr className="xls-row xls-row--even">
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={6} style={{ whiteSpace: 'normal', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                <strong style={{ fontSize: 12 }}>흔들릴 때 결정하지 않아도 되게</strong>
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginLeft: 8 }}>지출 확인부터 지수 정기매수까지, 한 번 정해 두고 따라가요.</span>
              </td>
            </tr>
            {([
              ['start', '처음 시작해요', '남는 돈부터 찾고, 정해진 길로'],
              ['invested', '이미 투자하고 있어요', '물린 종목은 두고, 새 돈부터 제자리로'],
            ] as Array<[EntryPath, string, string]>).map(([path, label, desc], i) => (
              <tr key={path} className={`xls-row${i % 2 === 1 ? ' xls-row--even' : ''}`}>
                <td className="xls-row-num">{rowNum()}</td>
                <td className="xls-cell" colSpan={2} style={{ ...S.header, ...S.midBorder }}>
                  <span style={{ color: 'var(--color-brand)', fontWeight: 700, fontSize: 10 }}>{label}</span>
                </td>
                <td className="xls-cell" colSpan={2} style={{ fontSize: 10, color: 'var(--color-text-secondary)', whiteSpace: 'normal', lineHeight: 1.5, wordBreak: 'keep-all' }}>{desc}</td>
                <td className="xls-cell" colSpan={2} style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button type="button" style={{ ...S.link, background: 'none', border: 0, padding: 0, fontWeight: 700 }} onClick={() => void choosePath(path)}>이 길로 →</button>
                </td>
              </tr>
            ))}
            <tr className="xls-row">
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={6} style={S.quiet}>나중에 다음 할 일의 전체 단계 보기에서 바꿀 수 있어요</td>
            </tr>
          </>)}

          {/* 길잡이를 불러오기 전에는 '할 일 없음'을 띄우지 않는다 */}
          {!needsPathChoice && visibleTodos.length === 0 && (isAdmin || journey) && (
            <tr className="xls-row xls-row--even">
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={6} style={S.quiet}>할 일 없음 — 계획대로 두면 됩니다</td>
            </tr>
          )}
          {!needsPathChoice && visibleTodos.map((s, i) => (
            <tr key={s.key} className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}`}>
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={2} style={{ ...S.header, ...S.midBorder }}>
                <span style={{ color: 'var(--color-brand)', fontWeight: 700, fontSize: 10 }}>{s.label.replace(/^\d+\s+/, '')}</span>
              </td>
              <td className="xls-cell" colSpan={2} style={{ fontSize: 10, color: 'var(--color-text-secondary)', whiteSpace: 'normal', lineHeight: 1.5 }}>
                {s.desc}
              </td>
              <td className="xls-cell" colSpan={2} style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <span style={{ ...S.link, ...(s.key === nextTodoKey ? { fontWeight: 700 } : {}) }} onClick={() => nav(s.route ?? s.key)}>{s.key === nextTodoKey ? '지금 하기 →' : '열기 →'}</span>
                {s.side && s.key === nextTodoKey && (
                  <div><span style={{ ...S.link, fontSize: 10 }} onClick={() => nav(s.side!.route)}>{s.side.label} →</span></div>
                )}
              </td>
            </tr>
          ))}
          {/* 전체 단계를 펼쳤을 때만 길 바꾸기 — 평소 홈은 다음 할 일 1개로 단순하게 */}
          {!isAdmin && !needsPathChoice && allTodosOpen && journey?.path && (
            <tr className="xls-row">
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={6} style={S.quiet}>
                지금 길: {journey.path === 'invested' ? '이미 투자하고 있어요' : '처음 시작해요'} ·{' '}
                <button type="button" style={{ ...S.link, background: 'none', border: 0, padding: 0, fontSize: 'inherit' }} onClick={() => void choosePath(journey.path === 'invested' ? 'start' : 'invested')}>
                  {journey.path === 'invested' ? '처음 시작해요' : '이미 투자하고 있어요'}로 바꾸기
                </button>
              </td>
            </tr>
          )}

          {/* ── 시장 분위기 변화: 자기 과거 대비 위치·변화 현황(예측 아님). 관리자의 자세히 보기에서만 ── */}
          {showMarketDetail && marketShift && (<>
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

          {/* ── 보유 ETF 다음 분배: 마지막 매수일이 2주 안일 때만 한 줄(전체는 시장 캘린더) ── */}
          {nextDist && (
            <tr className="xls-row">
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell" colSpan={2} style={{ ...S.header, ...S.midBorder }}>
                <span style={{ color: 'var(--color-brand)', fontWeight: 700, fontSize: 10 }}>분배 일정</span>
              </td>
              <td className="xls-cell" colSpan={3} style={{ fontSize: 10, color: 'var(--color-text-secondary)', whiteSpace: 'normal', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                {nextDist.first.name}{nextDist.more > 0 ? ` 외 ${nextDist.more}종목` : ''} · {fmtScheduleDate(nextDist.first.lastBuyDate)}까지 보유하면 받아요 · 분배락 {fmtScheduleDate(nextDist.first.exDate)}{nextDist.first.estimated ? ' (예상)' : ''}
              </td>
              <td className="xls-cell" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <span style={S.link} onClick={() => nav('market?tab=calendar')}>캘린더 →</span>
              </td>
            </tr>
          )}

          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.divider} />
          </tr>

          {/* ── 요약 세 줄: 실제 계좌 · 실험 계좌 · 오늘 시장. 자세한 건 각 페이지에서 ── */}
          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={2} style={{ ...S.header, ...S.midBorder }}>내 계좌 <AccountTag kind="real" /></td>
            <td className="xls-cell" colSpan={3} style={S.summary}>
              {realHoldings == null ? '불러오는 중…' : realHoldings.length === 0 ? (
                <span style={{ color: 'var(--color-text-secondary)' }}>직접 매매하는 계좌를 입력하면 종목별 대응을 알려드려요</span>
              ) : (
                <>
                  보유 {realHoldings.length}종목 · {actionNeeded.length > 0 ? <strong>대응 필요 {actionNeeded.length}종목</strong> : '대응할 것 없음'}
                  {actionNeeded[0] && (
                    <span style={{ display: 'block', color: 'var(--color-brand)' }}>가장 급한 것: {actionNeeded[0].name} — {actionNeeded[0].headline}</span>
                  )}
                  {satellite && (satellite.overWeight || satellite.overLoss) && (
                    <span style={{ display: 'block', color: 'var(--color-brand)' }}>
                      {satellite.overSellBand
                        ? `개별주가 전체의 ${satellite.weightPct.toFixed(0)}% — ${SATELLITE_SELL_WEIGHT_PCT}%를 넘어 약 ${formatKrw(satellite.trimAmount)} 정리하면 ${SATELLITE_MAX_WEIGHT_PCT}%로 돌아와요`
                        : satellite.overWeight
                          ? `개별주가 전체의 ${satellite.weightPct.toFixed(0)}% — 팔 필요는 없어요. 더 사지 말고 새로 넣는 돈은 지수로 (${SATELLITE_SELL_WEIGHT_PCT}% 넘으면 그때 정리)`
                          : `개별주 묶음이 ${SATELLITE_LOSS_LIMIT_PCT}% 손실 한도에 닿았어요 — 이번 분기엔 새로 사지 않기`}
                    </span>
                  )}
                </>
              )}
            </td>
            <td className="xls-cell" style={{ textAlign: 'right' }}>
              <span style={S.link} onClick={() => nav('portfolio?account=real')}>{realHoldings && realHoldings.length === 0 ? '입력하기 →' : '자세히 →'}</span>
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={2} style={{ ...S.header, ...S.midBorder }}>가상 계좌 <AccountTag kind="virtual" /></td>
            <td className="xls-cell" colSpan={3} style={S.summary}>
              {portfolio ? (
                <>평가손익 <strong style={{ color: pnlColor }}>{fmtPnl(pnl)}</strong> · {posCount}종목</>
              ) : '불러오는 중…'}
            </td>
            <td className="xls-cell" style={{ textAlign: 'right' }}>
              <span style={S.link} onClick={() => nav('portfolio?account=virtual')}>자세히 →</span>
            </td>
          </tr>
          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={2} style={{ ...S.header, ...S.midBorder }}>오늘 시장</td>
            <td className="xls-cell" colSpan={3} style={S.summary}>
              {indices ? MARKET_TILES.map((tile) => {
                const idx = indices[tile.key]
                return (
                  <span key={tile.key} style={{ marginRight: 10, whiteSpace: 'nowrap' }}>
                    {tile.label} {idx?.price != null ? idx.price.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '—'}
                    {idx?.changeRate != null && <span style={{ marginLeft: 3, color: changeColor(idx.changeRate) }}>{fmtChange(idx.changeRate)}</span>}
                  </span>
                )
              }) : '불러오는 중…'}
            </td>
            <td className="xls-cell" style={{ textAlign: 'right' }}>
              <span style={S.link} onClick={() => nav('market')}>시장 →</span>
            </td>
          </tr>

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
            const c1 = sectorChange(s1)
            const c2 = sectorChange(s2)
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
                <td className="xls-cell" style={{ fontSize: 10, ...S.midBorder }}>
                  {s1 ? (
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--color-brand)', fontWeight: 600 }}>{s1.score}점</span>
                      <span style={{ marginLeft: 6, color: c1 == null ? 'var(--color-text-tertiary)' : changeColor(c1), fontSize: 9 }} title={c1 == null ? '구성 종목 등락 자료 없음' : undefined}>
                        {c1 == null ? '—' : fmtChange(c1)}
                      </span>
                    </span>
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
                <td className="xls-cell" style={{ fontSize: 10 }}>
                  {s2 ? (
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--color-brand)', fontWeight: 600 }}>{s2.score}점</span>
                      <span style={{ marginLeft: 6, color: c2 == null ? 'var(--color-text-tertiary)' : changeColor(c2), fontSize: 9 }} title={c2 == null ? '구성 종목 등락 자료 없음' : undefined}>
                        {c2 == null ? '—' : fmtChange(c2)}
                      </span>
                    </span>
                  ) : null}
                </td>
              </tr>
            )
          })}

          </>)}

          {/* ── 남는 높이만 채우는 빈 여백 ── */}
          {Array.from({ length: fillerRows }, (_, i) => (
            <tr key={`empty${i}`} data-filler className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}`}>
              <td className="xls-row-num">{rowNum()}</td>
              {/* 사이드 패널처럼 열마다 빈 셀 — 한 칸으로 합치면 세로 격자선이 사라진다 */}
              {Array.from({ length: 6 }, (_, c) => <td key={c} className="xls-cell xls-cell--empty"/>)}
            </tr>
          ))}

        </tbody>
      </table>
    </div>
  )
}

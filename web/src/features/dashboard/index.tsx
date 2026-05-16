import React from 'react'
import { formatKrw } from '../../lib/format'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState } from '../../components/StateViews'
import TelegramLinkCallout from '../../components/TelegramLinkCallout'
import EconomicEventBadge from '../../components/EconomicEventBadge'
import { requestOpenProfileModal } from '../../lib/profileModal'
import { useDashboardSummary, useSectors } from '../../lib/queries'
import type { DashboardSummary, SectorItem } from '../../lib/types'
import { useCurrentChatId } from '../../stores/profileStore'

export default function Dashboard({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const chatId = useCurrentChatId()
  const flowSteps = [
    {
      step: '01',
      title: '시장 확인',
      desc: '거시·변동성·섹터 흐름부터 먼저 본다.',
      route: 'economy',
      action: '경제 / 시장 보기',
    },
    {
      step: '02',
      title: '후보 압축',
      desc: '스캔과 눌림목으로 3~5개만 남긴다.',
      route: 'scan',
      action: '스캔 열기',
    },
    {
      step: '03',
      title: '종목 검증',
      desc: '분석·수급·재무로 진입 전 걸러낸다.',
      route: 'analyze',
      action: '분석 열기',
    },
    {
      step: '04',
      title: '실행 / 복기',
      desc: '포트폴리오와 리포트로 실행을 닫는다.',
      route: 'portfolio',
      action: '포트폴리오 보기',
    },
  ]

  const {
    data: summaryRaw,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
    isFetching: summaryFetching,
    dataUpdatedAt,
  } = useDashboardSummary()

  const {
    data: sectorsRaw,
    isLoading: sectorsLoading,
    refetch: refetchSectors,
  } = useSectors(8)

  // API 응답 구조 정규화
  const summary: DashboardSummary | null = (summaryRaw as any)?.data ?? summaryRaw ?? null
  const sectors: SectorItem[] = Array.isArray((sectorsRaw as any)?.data)
    ? (sectorsRaw as any).data
    : Array.isArray(sectorsRaw) ? sectorsRaw : []

  const loading = summaryLoading
  const refreshing = summaryFetching && !summaryLoading

  const handleRefresh = () => {
    void refetchSummary()
    void refetchSectors()
  }

  const pnl = (summary as any)?.unrealized_pnl_sum ?? null
  const pnlClass = pnl != null ? (pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : '') : ''
  const topSector = sectors.length > 0 ? sectors[0]?.name : '-'
  const refreshLabel = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '-'
  const lastScan = (summary as any)?.last_scan_at
    ? new Date((summary as any).last_scan_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-'

  const go = (r: string) => onNavigate?.(r)

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>대시보드</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div className="caption muted">
            {refreshing ? '업데이트 중...' : `마지막 갱신 ${refreshLabel}`}
          </div>
          <Button variant="secondary" onClick={handleRefresh} disabled={loading || refreshing}>
            {refreshing ? '새로고침 중...' : '새로고침'}
          </Button>
        </div>
      </div>

      <EconomicEventBadge onNavigateToCalendar={() => go('economy')} />

      {!chatId && (
        <div className="mb-4">
          <TelegramLinkCallout
            title="아직 텔레그램 연동 전입니다"
            description="웹 기능은 바로 사용 가능하지만, 알림 전송/텔레그램 연동은 Chat ID 연결이 필요합니다."
            onAction={() => requestOpenProfileModal()}
          />
        </div>
      )}

      <div className="mb-4">
        <div className="dashboard-section-head">
          <div className="title-md">오늘의 플로우</div>
          <button type="button" className="dashboard-section-link" onClick={() => go('reports')}>복기 보기 →</button>
        </div>
        <div className="dashboard-flow-grid">
          {flowSteps.map((step) => (
            <button
              key={step.step}
              type="button"
              className="card dashboard-flow-card card-action-btn"
              onClick={() => go(step.route)}
            >
              <div className="dashboard-flow-step">{step.step}</div>
              <div className="dashboard-flow-title">{step.title}</div>
              <div className="dashboard-flow-desc">{step.desc}</div>
              <div className="dashboard-flow-action">{step.action} →</div>
            </button>
          ))}
        </div>
      </div>

      <div className="cards-grid cols-2 mb-4">
        {loading && !summary ? (
          [0,1,2,3].map(i => <div key={i} className="card"><Skeleton lines={2} height={14} /></div>)
        ) : (
          <>
            <button type="button" className="card stat-card stat-card--accent card-action-btn" onClick={() => go('portfolio')}>
              <div className="stat-label">보유 종목</div>
              <div className="stat-value">
                {(summary as any)?.positions ?? '-'}{(summary as any)?.positions != null && <span className="stat-unit">종목</span>}
              </div>
              <div className="stat-sub">가상 포트폴리오 →</div>
            </button>

            <div className="card stat-card">
              <div className="stat-label">미실현 손익</div>
              <div className={`stat-value ${pnlClass}`}>
                {pnl != null ? formatKrw(pnl) : '-'}
              </div>
              <div className="stat-sub">평가손익 합계</div>
            </div>

            <div className="card stat-card">
              <div className="stat-label">마지막 스캔</div>
              <div className="stat-value stat-value--sm">{lastScan}</div>
              <div className="stat-sub">스캔 실행 시각</div>
            </div>

            <button type="button" className="card stat-card stat-card--accent card-action-btn" onClick={() => go('sectors')}>
              <div className="stat-label">1위 섹터</div>
              <div className="stat-value stat-value--sm">{topSector}</div>
              <div className="stat-sub">섹터 페이지 →</div>
            </button>
          </>
        )}
      </div>

      <div className="mb-4">
        <div className="dashboard-section-head">
          <div className="title-md">유망 섹터 Top 8</div>
          <button type="button" className="dashboard-section-link" onClick={() => go('sectors')}>전체 보기 →</button>
        </div>

        {sectorsLoading && sectors.length === 0 ? (
          <div className="cards-grid cols-2">
            {[0,1,2,3].map(i => <div key={i} className="card"><Skeleton lines={2} height={12} /></div>)}
          </div>
        ) : sectors.length === 0 ? (
          <div className="card"><div className="muted">섹터 데이터 없음</div></div>
        ) : (
          <div className="cards-grid cols-2">
            {sectors.slice(0, 8).map((s: SectorItem, idx: number) => {
              const score = s.score != null ? Math.round(Number(s.score)) : null
              const cr = s.change_rate != null ? Number(s.change_rate) : null
              const crClass = cr != null ? (cr > 0 ? 'positive' : cr < 0 ? 'negative' : 'neutral') : ''
              return (
                <button
                  key={s.id}
                  type="button"
                  className="card sector-mini-card sector-mini-card--accent card-action-btn"
                  onClick={() => go('sectors')}
                >
                  <div className="sector-mini-rank">#{idx + 1}</div>
                  <div className="sector-mini-name">{s.name}</div>
                  <div className="sector-mini-footer">
                    {score != null && <span className="sector-mini-score">{score}점</span>}
                    {cr != null && (
                      <span className={`sector-mini-cr ${crClass}`}>
                        {cr >= 0 ? '+' : ''}{cr.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

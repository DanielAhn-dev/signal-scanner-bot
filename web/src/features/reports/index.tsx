import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { getCurrentUserChatId } from '../../lib/userContext'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ToastProvider'
import ShareModal from '../../components/ShareModal'
import { readSimulationPlan, type HighlightSimulationPlan } from '../simulator/planStore'
import { buildTelegramMessage, calcExpectedValue, calcSplitInvested } from '../simulator/telegramFormat'
import { formatKrw } from '../../lib/format'
import { useShareManager } from '../../hooks/useShareManager'

type ReportAction = {
  key: string
  label: string
  desc: string
  kind: 'trigger' | 'download'
  endpoint: string
  method?: 'GET' | 'POST'
  fileName?: string
}

const REPORT_ACTIONS: ReportAction[] = [
  {
    key: 'briefing',
    label: '장전 브리핑',
    desc: '오늘 장전 핵심 브리핑을 큐에 등록합니다. (/브리핑)',
    kind: 'trigger',
    endpoint: '/api/ui/trigger-briefing',
    method: 'POST',
  },
  {
    key: 'update',
    label: '데이터 업데이트',
    desc: '종목/지표 데이터 패치를 실행합니다.',
    kind: 'trigger',
    endpoint: '/api/ui/trigger-update',
    method: 'POST',
  },
  {
    key: 'candidate-pdf',
    label: '오늘 후보 리포트 PDF',
    desc: '웹에서 즉시 생성 후 PDF 파일로 다운로드합니다. (/리포트 추천 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=추천',
    method: 'GET',
    fileName: 'daily_candidate_report.pdf',
  },
  {
    key: 'conviction-candidate-pdf',
    label: '하이라이트 종목',
    desc: '눌림목·점수·리스크를 종합한 확신 후보 하이라이트 리포트를 생성합니다. (/리포트 확신추천 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=확신추천',
    method: 'GET',
    fileName: 'conviction_candidate_report.pdf',
  },
  {
    key: 'public-candidate-pdf',
    label: '공유용 후보 PDF',
    desc: '개인 보유/자금 정보를 제거한 버전을 다운로드합니다. (/리포트 공개추천 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=공개추천',
    method: 'GET',
    fileName: 'public_candidate_report.pdf',
  },
  {
    key: 'weekly-report-pdf',
    label: '주간 리포트 PDF',
    desc: '시장+포트폴리오 종합 리포트를 다운로드합니다. (/리포트 주간 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=주간',
    method: 'GET',
    fileName: 'weekly_market_report.pdf',
  },
  {
    key: 'pullback-report-pdf',
    label: '눌림목 리포트 PDF',
    desc: '다음 주 선진입 후보 중심 리포트를 다운로드합니다. (/리포트 눌림목 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=눌림목',
    method: 'GET',
    fileName: 'weekly_pullback_report.pdf',
  },
  {
    key: 'portfolio-report-pdf',
    label: '포트폴리오 리포트 PDF',
    desc: '보유 종목/거래 중심 리포트를 다운로드합니다. (/리포트 포트폴리오 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=포트폴리오',
    method: 'GET',
    fileName: 'watchlist_report.pdf',
  },
  {
    key: 'watchonly-report-pdf',
    label: '관심종목 리포트 PDF',
    desc: '관심 추적 종목 중심 리포트를 다운로드합니다. (/리포트 관심종목 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=관심종목',
    method: 'GET',
    fileName: 'watchonly_report.pdf',
  },
  {
    key: 'macro-report-pdf',
    label: '거시 리포트 PDF',
    desc: '금리/환율/변동성 중심 거시 리포트를 다운로드합니다. (/리포트 거시 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=거시',
    method: 'GET',
    fileName: 'economy_report.pdf',
  },
  {
    key: 'flow-report-pdf',
    label: '수급 리포트 PDF',
    desc: '외국인/기관 자금 흐름 리포트를 다운로드합니다. (/리포트 수급 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=수급',
    method: 'GET',
    fileName: 'flow_report.pdf',
  },
  {
    key: 'sector-report-pdf',
    label: '섹터 리포트 PDF',
    desc: '섹터 강도 랭킹 리포트를 다운로드합니다. (/리포트 섹터 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=섹터',
    method: 'GET',
    fileName: 'sector_report.pdf',
  },
  {
    key: 'guide-pdf',
    label: '운영 가이드 PDF',
    desc: '운영 가이드 문서를 웹에서 바로 다운로드합니다. (/guidepdf 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=가이드',
    method: 'GET',
    fileName: 'user-operating-guide.pdf',
  },
  {
    key: 'auto-guide-pdf',
    label: '자동매매 가이드 PDF',
    desc: '자동매매 명령어 가이드를 다운로드합니다. (/리포트 자동매매 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=자동매매',
    method: 'GET',
    fileName: 'automate-trade-command-guide.pdf',
  },
]

export default function ReportsPage() {
  const [states, setStates] = useState<Record<string, { loading: boolean; msg?: string }>>({})
  const toast = useToast()
  const [simPlan, setSimPlan] = useState<HighlightSimulationPlan | null>(null)
  const [simSending, setSimSending] = useState(false)
  const shareManager = useShareManager({
    endpoint: '/api/ui/report-share',
    scopeKey: 'topic',
    requiresCode: true,
  })

  useEffect(() => {
    setSimPlan(readSimulationPlan())
  }, [])

  const buildUiRequest = (endpoint: string): { url: string; headers: Record<string, string> } => {
    const base = import.meta.env.VITE_API_BASE || ''
    const uiKey = import.meta.env.VITE_UI_READ_KEY
    const chatId = getCurrentUserChatId() || ''
    let resolvedEndpoint = endpoint
    if (uiKey) resolvedEndpoint = `${resolvedEndpoint}${resolvedEndpoint.includes('?') ? '&' : '?'}ui_key=${encodeURIComponent(uiKey)}`
    if (chatId) resolvedEndpoint = `${resolvedEndpoint}${resolvedEndpoint.includes('?') ? '&' : '?'}chat_id=${encodeURIComponent(chatId)}`
    const url = base
      ? `${base.replace(/\/$/, '')}${resolvedEndpoint.startsWith('/') ? resolvedEndpoint : `/${resolvedEndpoint}`}`
      : resolvedEndpoint
    const headers: Record<string, string> = {}
    if (uiKey) headers['x-ui-key'] = uiKey
    if (chatId) headers['x-user-chat-id'] = chatId
    return { url, headers }
  }

  const navigateSimulator = () => {
    window.history.pushState({}, '', '#simulator')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const sendSimPlanTelegram = async () => {
    if (!simPlan) return
    setSimSending(true)
    try {
      const items = simPlan.items || []
      const totalCapital = simPlan.totalCapital || 0
      const feePct = 0.15
      const taxPct = 0.2
      const fillRatePct = 100
      const splitInvested = items.reduce((acc, row) => acc + calcSplitInvested(row, fillRatePct), 0)
      const expected = items.reduce((acc, row) => acc + calcExpectedValue(row), 0)
      const feeTax = splitInvested * ((feePct + taxPct) / 100)
      const expectedAfterCost = expected - feeTax
      const remaining = totalCapital - items.reduce((acc, row) => acc + (row.amount || 0), 0)

      const header = simPlan.notes
        ? `저장: ${new Date(simPlan.createdAt).toLocaleString('ko-KR')} · 메모: ${String(simPlan.notes).slice(0, 60)}\n`
        : `저장: ${new Date(simPlan.createdAt).toLocaleString('ko-KR')}\n`

      const body = buildTelegramMessage({
        totalCapital,
        fillRatePct,
        feePct,
        taxPct,
        expectedAfterCost,
        remaining,
        items,
        format: 'detailed',
      })

      await apiFetch('/api/ui/notify', {
        method: 'POST',
        body: JSON.stringify({ message: header + body }),
        cacheMs: 0,
        timeoutMs: 12_000,
      })
      toast.show('시뮬레이션 계획을 텔레그램으로 전송했습니다.')
    } catch (e: any) {
      toast.show(`전송 실패: ${e?.message || String(e)}`)
    } finally {
      setSimSending(false)
    }
  }

  const runTrigger = async (key: string, endpoint: string, method: 'GET' | 'POST' = 'POST') => {
    setStates(s => ({ ...s, [key]: { loading: true } }))
    try {
      const body = key === 'update'
        ? JSON.stringify({ runScripts: true, pipeline: 'dbview-default' })
        : undefined
      const res = await apiFetch(endpoint, {
        method: method as 'GET' | 'POST',
        body,
        cacheMs: 0,
        timeoutMs: key === 'update' ? 180_000 : 20_000,
      })
      const msg = res?.ok ? (res?.message || '완료') : (res?.error || '실패')
      setStates(s => ({ ...s, [key]: { loading: false, msg } }))
      if (res?.ok) toast.show(`${key} 완료 ✓`)
    } catch (e: any) {
      setStates(s => ({ ...s, [key]: { loading: false, msg: e?.message || String(e) } }))
    }
  }

  const runDownload = async (key: string, endpoint: string, fileName = 'report.pdf') => {
    setStates(s => ({ ...s, [key]: { loading: true } }))
    try {
      const request = buildUiRequest(endpoint)

      const res = await fetch(request.url, { method: 'GET', headers: request.headers })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `다운로드 실패 (${res.status})`)
      }

      const blob = await res.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      const today = new Date()
      const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
      const dotIdx = fileName.lastIndexOf('.')
      const datedFileName = dotIdx !== -1
        ? `${fileName.slice(0, dotIdx)}_${dateStr}${fileName.slice(dotIdx)}`
        : `${fileName}_${dateStr}`
      a.download = datedFileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(downloadUrl)

      setStates(s => ({ ...s, [key]: { loading: false, msg: 'PDF 다운로드 완료' } }))
      toast.show('PDF 다운로드 완료 ✓')
    } catch (e: any) {
      setStates(s => ({ ...s, [key]: { loading: false, msg: e?.message || String(e) } }))
    }
  }

  const runShare = async (endpoint: string) => {
    setStates(s => ({ ...s, ['share']: { loading: true } }))
    try {
      const topicMatch = endpoint.match(/topic=([^&]+)/)
      const topic = topicMatch ? decodeURIComponent(topicMatch[1]) : '추천'
      const shared = await shareManager.createShare(topic, { topic })
      if (!shared) throw new Error('공유 생성 실패')
      setStates(s => ({ ...s, ['share']: { loading: false, msg: '공유 URL 생성됨' } }))
    } catch (e: any) {
      setStates(s => ({ ...s, ['share']: { loading: false, msg: String(e?.message || e) } }))
      toast.show(String(e?.message || e))
    }
  }

  return (
    <section className="container-app">
      <h1 className="title-xl">리포트</h1>

      {simPlan && simPlan.items?.length > 0 && (
        <div className="card mb-4" style={{ borderLeft: '3px solid var(--color-stock-up)' }}>
          <div className="flex-between" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <div>
              <div className="title-md">시뮬레이터 저장 계획</div>
              <div className="caption mt-1">
                {new Date(simPlan.createdAt).toLocaleString('ko-KR')} · 총 {formatKrw(simPlan.totalCapital)} · 종목 {simPlan.items.length}개
              </div>
              {simPlan.notes && <div className="muted mt-1">{String(simPlan.notes).slice(0, 80)}</div>}
              <div className="caption mt-2">
                {simPlan.items.slice(0, 5).map((it: any) => it.name || it.code).join(', ')}
                {simPlan.items.length > 5 ? ` 외 ${simPlan.items.length - 5}개` : ''}
              </div>
            </div>
            <div className="flex-gap-sm">
              <Button variant="secondary" onClick={navigateSimulator}>시뮬레이터 열기</Button>
              <Button variant="ghost" onClick={sendSimPlanTelegram} disabled={simSending}>텔레그램 전송</Button>
            </div>
          </div>
        </div>
      )}

      <div className="card mb-4">
        <div className="muted">텔레그램 명령(/리포트, /브리핑, /guidepdf)에 대응하는 기능을 웹에서 실행/다운로드합니다.</div>
      </div>

      <div className="cards-list">
        {REPORT_ACTIONS.map(r => {
          const s = states[r.key]
          return (
            <div key={r.key} className="card">
              <div className="report-action-card-body">
                <div className="report-action-card-info">
                  <div className="title-md">{r.label}</div>
                  <div className="muted mt-1">{r.desc}</div>
                  {s?.msg && (
                    <div className="caption mt-2" style={{ color: 'var(--color-text-secondary)' }}>{s.msg}</div>
                  )}
                </div>
                {r.kind === 'download' ? (
                  <div className="report-action-card-btns">
                    <Button variant="secondary" onClick={() => runDownload(r.key, r.endpoint, r.fileName)} disabled={s?.loading}>
                      {s?.loading ? '처리 중…' : '다운로드'}
                    </Button>
                    <Button variant="secondary" onClick={() => runShare(r.endpoint)} disabled={states['share']?.loading}>공유</Button>
                  </div>
                ) : (
                  <div className="report-action-card-btns">
                    <Button
                      variant="secondary"
                      onClick={() => runTrigger(r.key, r.endpoint, r.method)}
                      disabled={s?.loading}
                    >
                      {s?.loading ? '처리 중…' : '실행'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <ShareModal
        open={shareManager.open}
        onClose={shareManager.close}
        url={shareManager.info?.url}
        code={shareManager.info?.code}
        requiresCode={shareManager.requiresCode}
        expiresAt={shareManager.info?.expiresAt}
        shares={shareManager.list}
        loading={shareManager.loading}
        onRefresh={() => { void shareManager.loadList() }}
        includeAll={shareManager.includeAll}
        onChangeIncludeAll={shareManager.setIncludeAll}
        onRevoke={shareManager.revokeShare}
        revokingId={shareManager.revokingId}
      />
    </section>
  )
}

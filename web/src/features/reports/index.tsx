import React, { useEffect, useState } from 'react'
import { apiFetch, getAuthHeaders } from '../../lib/api'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ToastProvider'
import ReportPreviewModal from '../../components/ReportPreviewModal'
import ShareModal from '../../components/ShareModal'
import { Download, Eye, FlaskConical, Play, Send, Share2 } from 'lucide-react'
import { readSimulationPlan, type HighlightSimulationPlan } from '../simulator/planStore'
import { buildTelegramMessage, calcExpectedValue, calcSplitInvested } from '../simulator/telegramFormat'
import { formatKrw, formatKrwCompact, formatKstDateTime } from '../../lib/format'
import { useShareManager } from '../../hooks/useShareManager'
import { useCurrentChatId, useCurrentClientId } from '../../stores/profileStore'

type ReportAction = {
  key: string
  section: 'run' | 'decision' | 'portfolio' | 'market' | 'guide'
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
    section: 'run',
    label: '장전 브리핑',
    desc: '오늘 장전 핵심 브리핑을 큐에 등록합니다. (/브리핑)',
    kind: 'trigger',
    endpoint: '/api/ui/trigger-briefing',
    method: 'POST',
  },
  {
    key: 'update',
    section: 'run',
    label: '데이터 업데이트',
    desc: '종목/지표 데이터 패치를 실행합니다.',
    kind: 'trigger',
    endpoint: '/api/ui/trigger-update',
    method: 'POST',
  },
  {
    key: 'candidate-pdf',
    section: 'decision',
    label: '오늘 후보 리포트 PDF',
    desc: '웹에서 즉시 생성 후 PDF 파일로 다운로드합니다. (/리포트 추천 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=추천',
    method: 'GET',
    fileName: 'daily_candidate_report.pdf',
  },
  {
    key: 'conviction-candidate-pdf',
    section: 'decision',
    label: '집행우선 종목',
    desc: '점수 상위 후보와 과거 20일 분포를 담은 집행우선 리포트를 생성합니다. (/리포트 확신추천 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=확신추천',
    method: 'GET',
    fileName: 'conviction_candidate_report.pdf',
  },
  {
    key: 'execution-guide-report-pdf',
    section: 'decision',
    label: '매매 실행 계획서 PDF',
    desc: '실행가이드 화면에서 생성한 자동추천 후보/진입계획 스냅샷을 PDF로 다운로드합니다.',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=실행가이드',
    method: 'GET',
    fileName: 'execution_guide_report.pdf',
  },
  {
    key: 'public-candidate-pdf',
    section: 'decision',
    label: '공유용 후보 PDF',
    desc: '개인 보유/자금 정보를 제거한 버전을 다운로드합니다. (/리포트 공개추천 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=공개추천',
    method: 'GET',
    fileName: 'public_candidate_report.pdf',
  },
  {
    key: 'weekly-report-pdf',
    section: 'portfolio',
    label: '주간 리포트 PDF',
    desc: '시장+포트폴리오 종합 리포트를 다운로드합니다. (/리포트 주간 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=주간',
    method: 'GET',
    fileName: 'weekly_market_report.pdf',
  },
  {
    key: 'pullback-report-pdf',
    section: 'portfolio',
    label: '눌림목(스윙/중기) 리포트 PDF',
    desc: '다음 주 선진입 후보 중심 리포트를 다운로드합니다. (/리포트 눌림목 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=눌림목',
    method: 'GET',
    fileName: 'weekly_pullback_report.pdf',
  },
  {
    key: 'portfolio-report-pdf',
    section: 'portfolio',
    label: '포트폴리오 리포트 PDF',
    desc: '보유 종목/거래 중심 리포트를 다운로드합니다. (/리포트 포트폴리오 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=포트폴리오',
    method: 'GET',
    fileName: 'watchlist_report.pdf',
  },
  {
    key: 'watchonly-report-pdf',
    section: 'portfolio',
    label: '관심종목 리포트 PDF',
    desc: '관심 추적 종목 중심 리포트를 다운로드합니다. (/리포트 관심종목 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=관심종목',
    method: 'GET',
    fileName: 'watchonly_report.pdf',
  },
  {
    key: 'macro-report-pdf',
    section: 'market',
    label: '거시 리포트 PDF',
    desc: '금리/환율/변동성 중심 거시 리포트를 다운로드합니다. (/리포트 거시 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=거시',
    method: 'GET',
    fileName: 'economy_report.pdf',
  },
  {
    key: 'flow-report-pdf',
    section: 'market',
    label: '수급 리포트 PDF',
    desc: '외국인/기관 자금 흐름 리포트를 다운로드합니다. (/리포트 수급 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=수급',
    method: 'GET',
    fileName: 'flow_report.pdf',
  },
  {
    key: 'sector-report-pdf',
    section: 'market',
    label: '섹터 리포트 PDF',
    desc: '섹터 강도 랭킹 리포트를 다운로드합니다. (/리포트 섹터 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=섹터',
    method: 'GET',
    fileName: 'sector_report.pdf',
  },
  {
    key: 'guide-pdf',
    section: 'guide',
    label: '운영 가이드 PDF',
    desc: '운영 가이드 문서를 웹에서 바로 다운로드합니다. (/guidepdf 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=가이드',
    method: 'GET',
    fileName: 'user-operating-guide.pdf',
  },
  {
    key: 'auto-guide-pdf',
    section: 'guide',
    label: '자동매매 가이드 PDF',
    desc: '자동매매 명령어 가이드를 다운로드합니다. (/리포트 자동매매 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=자동매매',
    method: 'GET',
    fileName: 'automate-trade-command-guide.pdf',
  },
]

const REPORT_SECTIONS: Array<{ key: ReportAction['section']; label: string; desc: string }> = [
  { key: 'run', label: '실행 작업', desc: '브리핑 발송과 원천 데이터 갱신' },
  { key: 'decision', label: '오늘의 판단', desc: '후보 선정과 실제 주문 준비' },
  { key: 'portfolio', label: '보유와 주간 점검', desc: '보유 상태, 눌림목, 주간 성과 검토' },
  { key: 'market', label: '시장 배경', desc: '거시, 수급, 섹터 흐름 확인' },
  { key: 'guide', label: '운영 문서', desc: '서비스와 자동매매 사용 기준' },
]

export default function ReportsPage() {
  const chatId = useCurrentChatId()
  const clientId = useCurrentClientId()
  const [states, setStates] = useState<Record<string, { loading: boolean; msg?: string }>>({})
  const toast = useToast()
  const [simPlan, setSimPlan] = useState<HighlightSimulationPlan | null>(null)
  const [simSending, setSimSending] = useState(false)
  const [preview, setPreview] = useState<{ open: boolean; title: string; url: string; generatedAt?: string }>({ open: false, title: '', url: '' })
  const shareManager = useShareManager({
    endpoint: '/api/ui/report-share',
    scopeKey: 'topic',
    requiresCode: true,
  })

  useEffect(() => {
    setSimPlan(readSimulationPlan())
  }, [])

  const buildUiRequest = async (endpoint: string): Promise<{ url: string; headers: Record<string, string> }> => {
    const base = import.meta.env.VITE_API_BASE || ''
    const uiKey = import.meta.env.VITE_UI_READ_KEY
    let resolvedEndpoint = endpoint
    if (uiKey) resolvedEndpoint = `${resolvedEndpoint}${resolvedEndpoint.includes('?') ? '&' : '?'}ui_key=${encodeURIComponent(uiKey)}`
    if (clientId) resolvedEndpoint = `${resolvedEndpoint}${resolvedEndpoint.includes('?') ? '&' : '?'}client_id=${encodeURIComponent(clientId)}`
    if (chatId) resolvedEndpoint = `${resolvedEndpoint}${resolvedEndpoint.includes('?') ? '&' : '?'}chat_id=${encodeURIComponent(chatId)}`
    const url = base
      ? `${base.replace(/\/$/, '')}${resolvedEndpoint.startsWith('/') ? resolvedEndpoint : `/${resolvedEndpoint}`}`
      : resolvedEndpoint
    const headers: Record<string, string> = { ...(await getAuthHeaders()) }
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
        ? `저장: ${formatKstDateTime(simPlan.createdAt)} · 메모: ${String(simPlan.notes).slice(0, 60)}\n`
        : `저장: ${formatKstDateTime(simPlan.createdAt)}\n`

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
      const request = await buildUiRequest(endpoint)

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

  const runPreview = async (endpoint: string, title: string) => {
    const topicMatch = endpoint.match(/topic=([^&]+)/)
    const topic = topicMatch ? decodeURIComponent(topicMatch[1]) : ''
    if (!topic) {
      toast.show('미리보기를 지원하지 않는 항목입니다.')
      return
    }
    const request = await buildUiRequest(`/api/ui/report-web?topic=${encodeURIComponent(topic)}&fresh=1`)
    try {
      // iframe은 Authorization 헤더를 보낼 수 없어, 인증 헤더로 받아온 HTML을 blob URL로 연다.
      const res = await fetch(request.url, { headers: request.headers })
      if (!res.ok) throw new Error(`미리보기 실패 (${res.status})`)
      const blobUrl = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html;charset=utf-8' }))
      setPreview({ open: true, title, url: blobUrl, generatedAt: new Date().toISOString() })
    } catch (e: any) {
      toast.show(String(e?.message || e))
    }
  }

  return (
    <section className="container-app reports-sheet" style={{ padding: 0, margin: 0, maxWidth: 'none', width: '100%' }}>
      <header className="reports-output-header">
        <div>
          <div className="reports-output-header__eyebrow">출력 및 공유</div>
          <h1>리포트</h1>
          <p>매매 판단에 필요한 PDF를 미리 확인하고 내려받거나 공유합니다.</p>
        </div>
        <div className="reports-output-header__meta">PDF {REPORT_ACTIONS.filter((item) => item.kind === 'download').length}종 · 실행 작업 {REPORT_ACTIONS.filter((item) => item.kind === 'trigger').length}종</div>
      </header>

      <table className="xls-table reports-plan-strip" style={{ width: '100%', tableLayout: 'fixed', marginBottom: 0 }}>
        <tbody>
          {simPlan && simPlan.items?.length > 0 && (
            <tr className="xls-row">
              <td className="xls-cell" style={{ fontWeight: 600 }}>시뮬레이터 저장 계획</td>
              <td className="xls-cell">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <div>
                    <div className="caption">
                      {formatKstDateTime(simPlan.createdAt)} · 총 {formatKrwCompact(simPlan.totalCapital)} · 종목 {simPlan.items.length}개
                    </div>
                    {simPlan.notes && <div className="muted mt-1">{String(simPlan.notes).slice(0, 80)}</div>}
                    <div className="caption mt-1">
                      {simPlan.items.slice(0, 5).map((it: any) => it.name || it.code).join(', ')}
                      {simPlan.items.length > 5 ? ` 외 ${simPlan.items.length - 5}개` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <Button size="sm" className="reports-action-btn reports-action-btn--sim" variant="secondary" onClick={navigateSimulator} title="시뮬레이터 열기" aria-label="시뮬레이터 열기" data-action-label="시뮬레이터 열기">
                      <FlaskConical size={14} />
                      <span className="reports-action-btn__label">시뮬레이터 열기</span>
                    </Button>
                    <Button size="sm" className="reports-action-btn reports-action-btn--sim" variant="ghost" onClick={sendSimPlanTelegram} disabled={simSending} title="텔레그램 전송" aria-label="텔레그램 전송" data-action-label="텔레그램 전송">
                      <Send size={14} />
                      <span className="reports-action-btn__label">텔레그램 전송</span>
                    </Button>
                  </div>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <table className="xls-table reports-sheet__list" style={{ width: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '21%' }} />
          <col style={{ width: '43%' }} />
          <col style={{ width: '28%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr className="xls-header-row">
            <th className="xls-th">기능</th>
            <th className="xls-th">설명</th>
            <th className="xls-th">실행</th>
            <th className="xls-th">상태</th>
          </tr>
        </thead>
        {REPORT_SECTIONS.map((section) => (
          <tbody key={section.key} className="reports-output-group">
            <tr className="reports-output-group__heading">
              <th colSpan={4}>
                <span>{section.label}</span>
                <small>{section.desc}</small>
              </th>
            </tr>
            {REPORT_ACTIONS.filter((item) => item.section === section.key).map((r, idx) => {
              const s = states[r.key]
              return (
                <tr key={r.key} className={`xls-row${idx % 2 === 1 ? ' xls-row--even' : ''}`}>
                <td className="xls-cell xls-cell--wrap" style={{ fontWeight: 600 }}>{r.label}</td>
                <td className="xls-cell xls-cell--wrap">{r.desc}</td>
                <td className="xls-cell">
                  {r.kind === 'download' ? (
                    <div className="reports-action-btns">
                      <Button
                        size="sm"
                        className="reports-action-btn"
                        variant="secondary"
                        onClick={() => runDownload(r.key, r.endpoint, r.fileName)}
                        disabled={s?.loading}
                        title="다운로드"
                        aria-label="다운로드"
                        data-action-label={s?.loading ? '처리 중' : '다운로드'}
                      >
                        <Download size={14} />
                        <span className="reports-action-btn__label">{s?.loading ? '처리 중…' : '다운로드'}</span>
                      </Button>
                      <Button
                        size="sm"
                        className="reports-action-btn"
                        variant="secondary"
                        onClick={() => runPreview(r.endpoint, r.label)}
                        title="미리보기"
                        aria-label="미리보기"
                        data-action-label="미리보기"
                      >
                        <Eye size={14} />
                        <span className="reports-action-btn__label">미리보기</span>
                      </Button>
                      <Button
                        size="sm"
                        className="reports-action-btn"
                        variant="secondary"
                        onClick={() => runShare(r.endpoint)}
                        disabled={states['share']?.loading}
                        title="공유"
                        aria-label="공유"
                        data-action-label="공유"
                      >
                        <Share2 size={14} />
                        <span className="reports-action-btn__label">공유</span>
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      className="reports-action-btn"
                      variant="secondary"
                      onClick={() => runTrigger(r.key, r.endpoint, r.method)}
                      disabled={s?.loading}
                      title="실행"
                      aria-label="실행"
                      data-action-label={s?.loading ? '처리 중' : '실행'}
                    >
                      <Play size={14} />
                      <span className="reports-action-btn__label">{s?.loading ? '처리 중…' : '실행'}</span>
                    </Button>
                  )}
                </td>
                <td className="xls-cell" style={{ color: s?.msg ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)', fontSize: 10 }}>
                  {s?.msg || '대기'}
                </td>
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
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
      <ReportPreviewModal
        open={preview.open}
        onClose={() => setPreview((prev) => ({ ...prev, open: false }))}
        title={preview.title}
        url={preview.url}
        generatedAt={preview.generatedAt}
      />
    </section>
  )
}

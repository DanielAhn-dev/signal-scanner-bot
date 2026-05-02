import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ToastProvider'
import PdfDrawer from '../../components/PdfDrawer'
import ShareModal from '../../components/ShareModal'

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
    key: 'public-candidate-pdf',
    label: '공유용 후보 PDF',
    desc: '개인 보유/자금 정보를 제거한 버전을 다운로드합니다. (/리포트 공개추천 대응)',
    kind: 'download',
    endpoint: '/api/ui/report-pdf?topic=공개추천',
    method: 'GET',
    fileName: 'public_candidate_report.pdf',
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
]

export default function ReportsPage() {
  const [states, setStates] = useState<Record<string, { loading: boolean; msg?: string }>>({})
  const toast = useToast()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerUrl, setDrawerUrl] = useState<string | null>(null)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerTitle, setDrawerTitle] = useState('리포트 웹보기')
  const [shareInfo, setShareInfo] = useState<{ shareId?: string; url: string; code: string; expiresAt?: string; topic?: string } | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareTopic, setShareTopic] = useState<string>('추천')
  const [shareList, setShareList] = useState<Array<{ shareId: string; publicToken: string; topic: string; expiresAt: string; createdAt?: string; revokedAt?: string | null; accessCount?: number; lastAccessedAt?: string | null }>>([])
  const [shareListLoading, setShareListLoading] = useState(false)
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null)

  const loadShareList = async (topic = shareTopic) => {
    setShareListLoading(true)
    try {
      const base = import.meta.env.VITE_API_BASE || ''
      const uiKey = import.meta.env.VITE_UI_READ_KEY
      const endpoint = `/api/ui/report-share?topic=${encodeURIComponent(topic)}`
      const url = base ? `${base.replace(/\/$/, '')}${endpoint}` : endpoint
      const headers: Record<string, string> = {}
      if (uiKey) headers['x-ui-key'] = uiKey
      const res = await fetch(url, { headers })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || '공유 목록 조회 실패')
      setShareList(Array.isArray(json?.data) ? json.data : [])
    } catch (e: any) {
      toast.show(String(e?.message || e))
    } finally {
      setShareListLoading(false)
    }
  }

  const revokeShare = async (shareId: string) => {
    setRevokingShareId(shareId)
    try {
      const base = import.meta.env.VITE_API_BASE || ''
      const uiKey = import.meta.env.VITE_UI_READ_KEY
      const endpoint = `/api/ui/report-share?shareId=${encodeURIComponent(shareId)}`
      const url = base ? `${base.replace(/\/$/, '')}${endpoint}` : endpoint
      const headers: Record<string, string> = {}
      if (uiKey) headers['x-ui-key'] = uiKey
      const res = await fetch(url, { method: 'DELETE', headers })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || '공유 철회 실패')
      toast.show('공유 링크를 철회했습니다.')
      await loadShareList(shareTopic)
    } catch (e: any) {
      toast.show(String(e?.message || e))
    } finally {
      setRevokingShareId(null)
    }
  }

  useEffect(() => {
    if (!shareOpen) return
    void loadShareList(shareTopic)
  }, [shareOpen, shareTopic])

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
      const base = import.meta.env.VITE_API_BASE || ''
      const url = base
        ? `${base.replace(/\/$/, '')}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
        : endpoint

      const headers: Record<string, string> = {}
      const uiKey = import.meta.env.VITE_UI_READ_KEY
      if (uiKey) headers['x-ui-key'] = uiKey

      const res = await fetch(url, { method: 'GET', headers })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `다운로드 실패 (${res.status})`)
      }

      const blob = await res.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = fileName
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

  const openWebView = async (endpoint: string, label: string) => {
    setDrawerOpen(true)
    setDrawerLoading(true)
    setDrawerTitle(`${label} 웹보기`)
    try {
      const base = import.meta.env.VITE_API_BASE || ''
      const uiKey = import.meta.env.VITE_UI_READ_KEY || ''
      // use web-only HTML view endpoint instead of PDF for better readability
      const webEndpoint = endpoint.replace('report-pdf', 'report-web')
      const topicMatch = webEndpoint.match(/[?&]topic=([^&]+)/)
      const topic = topicMatch ? decodeURIComponent(topicMatch[1]) : '추천'

      // Snapshot prewarm: try fast-path first, but do not block the UI if generation is slow.
      try {
        const snapshotUrl = base
          ? `${base.replace(/\/$/, '')}/api/ui/report-snapshot`
          : '/api/ui/report-snapshot'
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (uiKey) headers['x-ui-key'] = uiKey

        const controller = new AbortController()
        const timer = window.setTimeout(() => controller.abort(), 1200)
        await fetch(snapshotUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ topic }),
          signal: controller.signal,
        }).catch(() => undefined)
        window.clearTimeout(timer)
      } catch {
        // Best-effort prewarm only.
      }

      const hasQuery = webEndpoint.includes('?')
      const endpointWithAuth = uiKey
        ? `${webEndpoint}${hasQuery ? '&' : '?'}ui_key=${encodeURIComponent(uiKey)}`
        : webEndpoint
      const url = base
        ? `${base.replace(/\/$/, '')}${endpointWithAuth.startsWith('/') ? endpointWithAuth : `/${endpointWithAuth}`}`
        : endpointWithAuth

      // load the web view directly into iframe (no blob)
      setDrawerUrl(prev => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
        return url
      })
    } catch (e: any) {
      toast.show(String(e?.message || e))
      setDrawerUrl(null)
    }
  }

  const runShare = async (endpoint: string) => {
    setStates(s => ({ ...s, ['share']: { loading: true } }))
    try {
      const base = import.meta.env.VITE_API_BASE || ''
      const url = base ? `${base.replace(/\/$/, '')}/api/ui/report-share` : '/api/ui/report-share'
      const params = new URLSearchParams()
      const topicMatch = endpoint.match(/topic=([^&]+)/)
      const topic = topicMatch ? decodeURIComponent(topicMatch[1]) : '추천'
      setShareTopic(topic)
      const uiKey = import.meta.env.VITE_UI_READ_KEY
      const headers: Record<string,string> = { 'Content-Type': 'application/json' }
      if (uiKey) headers['x-ui-key'] = uiKey

      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ topic }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || '공유 생성 실패')
      // show share modal with url and code
      setShareInfo({ shareId: json.shareId, url: json.url, code: json.code, expiresAt: json.expiresAt, topic: json.topic })
      setShareList(Array.isArray(json?.list) ? json.list : shareList)
      setShareOpen(true)
      toast.show('공유 URL 생성됨 ✓')
      try { await navigator.clipboard?.writeText(json.url) } catch {}
      setStates(s => ({ ...s, ['share']: { loading: false, msg: '공유 URL 생성됨' } }))
    } catch (e: any) {
      setStates(s => ({ ...s, ['share']: { loading: false, msg: String(e?.message || e) } }))
      toast.show(String(e?.message || e))
    }
  }

  return (
    <section className="container-app">
      <h1 className="title-xl">리포트</h1>

      <div className="card mb-4">
        <div className="muted">텔레그램 명령(/리포트, /브리핑, /guidepdf)에 대응하는 기능을 웹에서 실행/다운로드합니다.</div>
      </div>

      <div className="cards-list">
        {REPORT_ACTIONS.map(r => {
          const s = states[r.key]
          return (
            <div key={r.key} className="card">
              <div className="flex-between">
                <div>
                  <div className="title-md">{r.label}</div>
                  <div className="muted mt-1">{r.desc}</div>
                  {s?.msg && (
                    <div className="caption mt-2" style={{ color: 'var(--color-text-secondary)' }}>{s.msg}</div>
                  )}
                </div>
                {r.kind === 'download' ? (
                  <div style={{ display: 'flex', gap: 8, marginLeft: 8, alignItems: 'center' }}>
                    <Button variant="secondary" onClick={() => runDownload(r.key, r.endpoint, r.fileName)} disabled={s?.loading}>
                      {s?.loading ? '처리 중…' : '다운로드'}
                    </Button>
                    <Button variant="secondary" onClick={() => openWebView(r.endpoint, r.label)}>웹보기</Button>
                    <Button variant="secondary" onClick={() => runShare(r.endpoint)} disabled={states['share']?.loading}>공유</Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => runTrigger(r.key, r.endpoint, r.method)}
                    disabled={s?.loading}
                  >
                    {s?.loading ? '처리 중…' : '실행'}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <ShareModal
        open={shareOpen}
        onClose={() => { setShareOpen(false); setShareInfo(null) }}
        url={shareInfo?.url}
        code={shareInfo?.code}
        expiresAt={shareInfo?.expiresAt}
        shares={shareList}
        loading={shareListLoading}
        onRefresh={() => { void loadShareList(shareTopic) }}
        onRevoke={revokeShare}
        revokingId={revokingShareId}
      />
      <PdfDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false)
          setDrawerLoading(false)
          if (drawerUrl && drawerUrl.startsWith('blob:')) URL.revokeObjectURL(drawerUrl)
          setDrawerUrl(null)
        }}
        title={drawerTitle}
        pdfUrl={drawerUrl}
        loading={drawerLoading}
        onFrameLoad={() => setDrawerLoading(false)}
        onFrameError={() => {
          setDrawerLoading(false)
          toast.show('웹보기를 불러오지 못했습니다.')
        }}
      />
    </section>
  )
}

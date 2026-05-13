import React, { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { apiFetch } from '../../lib/api'

type AccessInfo = {
  chat_id: number | null
  is_admin: boolean
  has_advanced_access: boolean
}

type DirectoryRow = {
  chat_id: number
  telegram_username?: string | null
  telegram_first_name?: string | null
  web_nickname?: string | null
  telegram_is_active?: boolean | null
  last_active_at?: string | null
  is_allowed: boolean
  is_admin?: boolean
  access_nickname?: string | null
  access_note?: string | null
  web_client_count: number
}

type UnlinkedWebUser = {
  client_id: string
  nickname?: string | null
}

type DirectoryPagination = {
  total: number
  page: number
  page_size: number
  total_pages: number
  has_next: boolean
}

const DEFAULT_PAGE_SIZE = 50

function formatLastActive(value?: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('ko-KR')
}

function displayName(row: DirectoryRow): string {
  return row.access_nickname || row.web_nickname || row.telegram_first_name || row.telegram_username || '-'
}

export default function AdminUsers() {
  const [accessInfo, setAccessInfo] = useState<AccessInfo | null>(null)
  const [rows, setRows] = useState<DirectoryRow[]>([])
  const [unlinkedWebUsers, setUnlinkedWebUsers] = useState<UnlinkedWebUser[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | undefined>()
  const [pagination, setPagination] = useState<DirectoryPagination>({
    total: 0,
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
    total_pages: 1,
    has_next: false,
  })

  const [targetChatId, setTargetChatId] = useState('')
  const [targetNickname, setTargetNickname] = useState('')
  const [targetNote, setTargetNote] = useState('')

  const isAdmin = !!accessInfo?.is_admin

  const load = async (search = '', nextPage?: number) => {
    setLoading(true)
    setStatus(undefined)
    try {
      const me = await apiFetch('/api/ui/access-users?mode=me', { cacheMs: 0, timeoutMs: 10_000 })
      const meInfo = (me?.data ?? null) as AccessInfo | null
      setAccessInfo(meInfo)

      if (!meInfo?.is_admin) {
        setRows([])
        setUnlinkedWebUsers([])
        setPagination({ total: 0, page: 1, page_size: DEFAULT_PAGE_SIZE, total_pages: 1, has_next: false })
        return
      }

      const q = encodeURIComponent(search.trim())
      const page = Math.max(1, Number(nextPage || pagination.page || 1))
      const pageSize = pagination.page_size || DEFAULT_PAGE_SIZE
      const list = await apiFetch(`/api/ui/access-users?mode=directory${q ? `&q=${q}` : ''}&page=${page}&page_size=${pageSize}`, { cacheMs: 0, timeoutMs: 10_000 })
      const data = list?.data ?? {}
      setRows(Array.isArray(data?.rows) ? data.rows : [])
      setUnlinkedWebUsers(Array.isArray(data?.unlinked_web_users) ? data.unlinked_web_users : [])
      const pg = data?.pagination ?? null
      if (pg) {
        setPagination({
          total: Number(pg.total || 0),
          page: Number(pg.page || 1),
          page_size: Number(pg.page_size || pageSize),
          total_pages: Number(pg.total_pages || 1),
          has_next: !!pg.has_next,
        })
      }
    } catch (e: any) {
      setStatus(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load('')
  }, [])

  const stats = useMemo(() => {
    const total = pagination.total
    const allowed = rows.filter((r) => r.is_allowed).length
    return {
      total,
      allowed,
      blocked: total - allowed,
      unlinkedWeb: unlinkedWebUsers.length,
    }
  }, [rows, unlinkedWebUsers, pagination.total])

  const upsertAllowedUser = async () => {
    const normalized = String(targetChatId || '').trim().replace(/[^0-9]/g, '')
    if (!normalized) {
      setStatus('관리 대상 Chat ID를 입력해 주세요.')
      return
    }

    setLoading(true)
    setStatus(undefined)
    try {
      await apiFetch('/api/ui/access-users', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({
          chat_id: Number(normalized),
          nickname: targetNickname.trim() || undefined,
          note: targetNote.trim() || undefined,
          is_enabled: true,
        }),
      })
      setTargetChatId('')
      setTargetNickname('')
      setTargetNote('')
      setStatus('허용 사용자 저장 완료')
      await load(query, pagination.page)
    } catch (e: any) {
      setStatus(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const toggleAllowed = async (row: DirectoryRow) => {
    setLoading(true)
    setStatus(undefined)
    try {
      await apiFetch('/api/ui/access-users', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({
          chat_id: row.chat_id,
          nickname: row.access_nickname || row.web_nickname || row.telegram_first_name || undefined,
          note: row.access_note || undefined,
          is_enabled: !row.is_allowed,
          is_admin: !!row.is_admin,
        }),
      })
      setStatus(`Chat ID ${row.chat_id} ${row.is_allowed ? '차단' : '허용'} 완료`)
      await load(query, pagination.page)
    } catch (e: any) {
      setStatus(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const toggleAdmin = async (row: DirectoryRow) => {
    setLoading(true)
    setStatus(undefined)
    try {
      await apiFetch('/api/ui/access-users', {
        method: 'PATCH',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({
          chat_id: row.chat_id,
          is_admin: !row.is_admin,
        }),
      })
      setStatus(`Chat ID ${row.chat_id} 관리자 ${row.is_admin ? '해제' : '지정'} 완료`)
      await load(query, pagination.page)
    } catch (e: any) {
      setStatus(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  // 초기 접근 권한 확인 중 (accessInfo가 아직 null이면 로딩 중)
  if (accessInfo === null) {
    return (
      <div className="access-denied-page">
        <div className="access-denied-card">
          <div className="auth-status-spinner" aria-hidden style={{ margin: '0 auto 12px' }} />
          <p className="access-denied-desc">접근 권한 확인 중…</p>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="access-denied-page">
        <div className="access-denied-card">
          <div className="access-denied-icon" aria-hidden>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h1 className="access-denied-title">접근 권한 없음</h1>
          <p className="access-denied-desc">이 페이지는 관리자 계정만 접근할 수 있습니다.</p>
        </div>
      </div>
    )
  }

  return (
    <section className="container-app">
      <div className="admin-users-header">
        <div>
          <h1 className="title-xl" style={{ marginBottom: 6 }}>사용자 관리</h1>
          <p className="muted">웹/텔레그램 사용자 목록을 통합 조회하고 허용된 사용자만 기능을 사용하도록 제어합니다.</p>
        </div>
      </div>

      <div className="cards-grid cols-3 admin-users-stats">
        <div className="card">
          <div className="caption">통합 사용자</div>
          <div className="admin-users-stat-value">{stats.total}</div>
        </div>
        <div className="card">
          <div className="caption">허용</div>
          <div className="admin-users-stat-value admin-users-stat-allowed">{stats.allowed}</div>
        </div>
        <div className="card">
          <div className="caption">차단</div>
          <div className="admin-users-stat-value admin-users-stat-blocked">{stats.blocked}</div>
        </div>
      </div>

      <div className="cards-list" style={{ marginTop: 12 }}>
        <div className="card">
          <label className="block muted">허용 사용자 추가/갱신</label>
          <div className="grid-two mt-2" style={{ alignItems: 'end' }}>
            <Input label="Chat ID" value={targetChatId} onChange={(e: any) => setTargetChatId(e.target.value)} placeholder="예: 123456789" />
            <Input label="표시명 (선택)" value={targetNickname} onChange={(e: any) => setTargetNickname(e.target.value)} placeholder="예: 운영팀" />
          </div>
          <div className="mt-2">
            <Input label="메모(선택)" value={targetNote} onChange={(e: any) => setTargetNote(e.target.value)} placeholder="권한 부여 사유" />
          </div>
          <div className="mt-3 flex-gap-sm">
            <Button onClick={upsertAllowedUser} disabled={loading} variant="primary">{loading ? '처리중…' : '허용 사용자 저장'}</Button>
          </div>
        </div>

        <div className="card">
          <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="block muted" style={{ margin: 0 }}>통합 사용자 목록</label>
            <div className="admin-users-search-wrap">
              <Input
                label=""
                value={query}
                onChange={(e: any) => setQuery(e.target.value)}
                placeholder="Chat ID, 닉네임, username 검색"
              />
              <Button variant="secondary" onClick={() => load(query, 1)} disabled={loading}>{loading ? '조회중…' : '검색'}</Button>
            </div>
          </div>

          <div className="admin-users-table-wrap mt-2">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Chat ID</th>
                  <th>사용자명</th>
                  <th>웹 연동</th>
                  <th>텔레그램 상태</th>
                  <th>마지막 활동</th>
                  <th>권한</th>
                  <th>관리자</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.chat_id}>
                    <td data-label="Chat ID">{row.chat_id}</td>
                    <td data-label="사용자명">{displayName(row)}</td>
                    <td data-label="웹 연동">{row.web_client_count > 0 ? `연동 ${row.web_client_count}` : '미연동'}</td>
                    <td data-label="텔레그램 상태">{row.telegram_is_active === false ? '비활성' : '활성/미확인'}</td>
                    <td data-label="마지막 활동">{formatLastActive(row.last_active_at)}</td>
                    <td data-label="권한">{row.is_allowed ? '허용' : '차단'}</td>
                    <td data-label="관리자">{row.is_admin ? '관리자' : '-'}</td>
                    <td data-label="작업">
                      <div className="flex-gap-sm">
                        <Button
                          variant={row.is_allowed ? 'ghost' : 'primary'}
                          disabled={loading}
                          onClick={() => toggleAllowed(row)}
                        >
                          {row.is_allowed ? '차단' : '허용'}
                        </Button>
                        <Button
                          variant={row.is_admin ? 'ghost' : 'secondary'}
                          disabled={loading}
                          onClick={() => toggleAdmin(row)}
                        >
                          {row.is_admin ? '관리자 해제' : '관리자 지정'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">조회된 사용자가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pagination-wrap">
            <Button
              variant="ghost"
              disabled={loading || pagination.page <= 1}
              onClick={() => load(query, pagination.page - 1)}
            >
              이전
            </Button>
            <span className="page-info">
              {pagination.page} / {pagination.total_pages} 페이지 · 전체 {pagination.total}명
            </span>
            <Button
              variant="ghost"
              disabled={loading || !pagination.has_next}
              onClick={() => load(query, pagination.page + 1)}
            >
              다음
            </Button>
          </div>
          {status && <p className="muted mt-2">{status}</p>}
        </div>

        <div className="card">
          <label className="block muted">텔레그램 미연동 웹 사용자</label>
          <div className="mt-2 admin-users-unlinked-list">
            {unlinkedWebUsers.length === 0 && <div className="muted">없음</div>}
            {unlinkedWebUsers.map((u) => (
              <div key={u.client_id} className="admin-users-unlinked-row">
                <span>{u.nickname || '-'}</span>
                <span className="caption">{u.client_id}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

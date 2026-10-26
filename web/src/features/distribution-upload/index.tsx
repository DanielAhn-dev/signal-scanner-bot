import React, { useCallback, useEffect, useRef, useState } from 'react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { useToast } from '../../components/ToastProvider'
import { apiFetch } from '../../lib/api'
import { formatKstDateTime } from '../../lib/format'

type PreviewItem =
  | { fileName: string; ok: false; error: string }
  | {
      fileName: string
      ok: true
      nameHint: string
      code: string | null
      stockName: string | null
      codeSource: 'isin' | 'name' | 'none'
      candidates: Array<{ code: string; name: string }>
      rows: number
      firstDate: string
      lastDate: string
      lastPerShare: number
      diff: { added: number; changed: number; same: number } | null
      warnings: string[]
    }

type StoredProduct = { code: string; name: string | null; count: number; firstDate: string; lastDate: string; lastPerShare: number; updatedAt: string | null }
type Picked = { file: File; base64: string }

const MAX_FILES = 10

async function toBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}

const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`

/** 운용사 분배금 엑셀 올리기 — 관리자 전용. 가이드의 분배율·안정성은 여기 저장된 이력으로 계산한다. */
export default function DistributionUpload() {
  const toast = useToast()
  const [picked, setPicked] = useState<Picked[]>([])
  const [preview, setPreview] = useState<PreviewItem[] | null>(null)
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [stored, setStored] = useState<StoredProduct[] | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [dragOver, setDragOver] = useState(false)

  const loadStored = useCallback(async () => {
    try {
      const res = await apiFetch('/api/ui/distribution-upload?mode=list', { cacheMs: 0, timeoutMs: 20_000 })
      setStored(res?.data?.products ?? [])
    } catch (e: any) {
      setMsg(e?.message || '저장된 분배금을 불러오지 못했습니다.')
    }
  }, [])
  useEffect(() => { void loadStored() }, [loadStored])

  const post = (body: Record<string, unknown>) =>
    apiFetch('/api/ui/distribution-upload', { method: 'POST', body: JSON.stringify(body), cacheMs: 0, retries: 0, timeoutMs: 45_000 })

  const runPreview = async (files: Picked[]) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMsg('')
    try {
      const res = await post({ action: 'preview', files: files.map((f) => ({ name: f.file.name, base64: f.base64 })) })
      const items: PreviewItem[] = res?.data?.items ?? []
      setPreview(items)
      const next: Record<string, string> = {}
      for (const it of items) if (it.ok && it.code) next[it.fileName] = it.code
      setCodes(next)
    } catch (e: any) {
      setMsg(e?.message || '미리보기에 실패했습니다.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const addFiles = async (list: FileList | File[]) => {
    const files = Array.from(list).slice(0, MAX_FILES)
    if (!files.length) return
    setMsg('')
    setPreview(null)
    try {
      const read = await Promise.all(files.map(async (file) => ({ file, base64: await toBase64(file) })))
      setPicked(read)
      await runPreview(read)
    } catch {
      setMsg('파일을 읽지 못했습니다.')
    }
  }

  const savable = (preview ?? []).filter((it): it is Extract<PreviewItem, { ok: true }> => it.ok && !!codes[it.fileName])

  const save = async () => {
    if (busyRef.current || !savable.length) return
    busyRef.current = true
    setBusy(true)
    setMsg('')
    try {
      const byName = new Map(picked.map((p) => [p.file.name, p]))
      const files = savable.map((it) => ({ name: it.fileName, base64: byName.get(it.fileName)?.base64 ?? '', code: codes[it.fileName] }))
      const res = await post({ action: 'save', files })
      const results: Array<{ fileName: string; ok: boolean; error?: string; written?: number; stockName?: string }> = res?.data?.results ?? []
      const okCount = results.filter((r) => r.ok).length
      const bad = results.filter((r) => !r.ok)
      toast.show(bad.length ? `${okCount}개 저장, ${bad.length}개 실패` : `${okCount}개 상품을 저장했습니다.`, bad.length ? 6000 : 3500)
      if (bad.length) setMsg(bad.map((b) => `${b.fileName}: ${b.error}`).join('\n'))
      else {
        setPicked([])
        setPreview(null)
      }
      await loadStored()
    } catch (e: any) {
      setMsg(e?.message || '저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: 12, wordBreak: 'keep-all' }}>
      <h3 className="title-sm">분배금 올리기</h3>
      <p className="muted" style={{ marginTop: 4 }}>
        운용사 사이트에서 받은 분배금 엑셀(.xls·.xlsx)을 올리면 상품을 알아보고 저장합니다. 가이드의 분배율·분배 안정성이 이 이력으로 바뀝니다.
        같은 파일을 다시 올려도 중복되지 않습니다.
      </p>

      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files) }}
        style={{
          display: 'block', marginTop: 10, padding: 16, textAlign: 'center', cursor: 'pointer',
          border: `1px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border-default)'}`, borderRadius: 8,
        }}
      >
        파일을 끌어다 놓거나 눌러서 고르기 (최대 {MAX_FILES}개)
        <input
          type="file"
          multiple
          accept=".xls,.xlsx,.html,.htm"
          style={{ display: 'none' }}
          onChange={(e) => { void addFiles(e.target.files ?? []); e.target.value = '' }}
        />
      </label>

      {msg && <p style={{ color: 'var(--color-error)', whiteSpace: 'pre-line', marginTop: 8 }}>{msg}</p>}
      {busy && <p className="muted" style={{ marginTop: 8 }}>처리 중…</p>}

      {preview && (
        <div style={{ marginTop: 12 }}>
          <h3 className="title-sm">미리보기</h3>
          {preview.map((it) =>
            !it.ok ? (
              <div key={it.fileName} style={{ margin: '8px 0', color: 'var(--color-error)' }}>
                {it.fileName} — {it.error}
              </div>
            ) : (
              <div key={it.fileName} style={{ margin: '10px 0', paddingBottom: 8, borderBottom: '1px solid var(--color-border-default)' }}>
                <div><strong>{it.fileName}</strong></div>
                <div className="muted">
                  {it.rows}건 · {it.firstDate} ~ {it.lastDate} · 최근 {won(it.lastPerShare)}
                  {it.diff && <> · 새로 {it.diff.added} · 바뀜 {it.diff.changed} · 같음 {it.diff.same}</>}
                </div>
                <div style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {it.code && it.codeSource !== 'none' ? (
                    <span>상품: <strong>{it.stockName}</strong> ({it.code}) <span className="muted">· {it.codeSource === 'isin' ? '파일 안 코드' : '이름이 정확히 같음'}</span></span>
                  ) : (
                    <>
                      <span style={{ color: 'var(--color-warning)' }}>상품을 확정하지 못했습니다 ({it.nameHint})</span>
                      {it.candidates.length > 0 && (
                        <select
                          value={codes[it.fileName] ?? ''}
                          onChange={(e) => setCodes((c) => ({ ...c, [it.fileName]: e.target.value }))}
                          aria-label={`${it.fileName} 상품 고르기`}
                        >
                          <option value="">후보에서 고르기</option>
                          {it.candidates.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                        </select>
                      )}
                      <Input
                        placeholder="코드 직접 입력"
                        value={codes[it.fileName] ?? ''}
                        onChange={(e) => setCodes((c) => ({ ...c, [it.fileName]: e.target.value.trim().toUpperCase() }))}
                      />
                    </>
                  )}
                </div>
                {it.warnings.map((w, i) => <div key={i} style={{ color: 'var(--color-warning)', fontSize: 12 }}>⚠ {w}</div>)}
              </div>
            ),
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="primary" onClick={() => void save()} disabled={busy || savable.length === 0}>
              {savable.length}개 저장
            </Button>
            <Button variant="secondary" onClick={() => { setPicked([]); setPreview(null); setMsg('') }} disabled={busy}>취소</Button>
          </div>
        </div>
      )}

      <h3 className="title-sm" style={{ marginTop: 20 }}>저장된 분배금</h3>
      {stored == null ? <p className="muted">불러오는 중…</p> : stored.length === 0 ? <p className="muted">아직 저장된 분배금이 없습니다.</p> : (
        <div style={{ fontSize: 'var(--font-size-sm)' }}>
          {stored.map((p) => (
            <div key={p.code} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '4px 0', borderBottom: '1px solid var(--color-border-default)' }}>
              <strong style={{ minWidth: 220 }}>{p.name ?? p.code} <span className="muted">({p.code})</span></strong>
              <span>{p.count}건</span>
              <span className="muted">{p.firstDate} ~ {p.lastDate}</span>
              <span>최근 {won(p.lastPerShare)}</span>
              {p.updatedAt && <span className="muted">갱신 {formatKstDateTime(p.updatedAt)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

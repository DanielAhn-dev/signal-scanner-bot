import React, { useState } from 'react'
import Modal from './Modal'

type CreditShortRow = {
  code: string
  date: string
  shortRatio?: number
  shortBalance?: number
  shortVolume?: number
}

type Props = {
  isOpen: boolean
  onClose: () => void
  onSave?: (data: { rows: CreditShortRow[] }) => Promise<{ saved: number; dropped: number; updatedStocks: number }>
}

export default function CreditShortForm({ isOpen, onClose, onSave }: Props) {
  const [rawRows, setRawRows] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [success, setSuccess] = useState(false)
  const [savedCount, setSavedCount] = useState(0)

  const handleReset = () => {
    setRawRows('')
    setFileName('')
    setError('')
    setWarning('')
    setSuccess(false)
    setSavedCount(0)
  }

  const handleClose = () => {
    handleReset()
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setWarning('')
    setSuccess(false)
    setSavedCount(0)

    if (!rawRows.trim()) {
      setError('업로드할 데이터 행을 입력하세요')
      return
    }

    const parsed = parseRows(rawRows)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }

    if (parsed.skipped > 0) {
      setWarning(`빈 지표 행 ${parsed.skipped}개는 자동 제외되었습니다.`)
    }

    setLoading(true)
    try {
      let saveSummary: { saved: number; dropped: number; updatedStocks: number } | null = null
      if (onSave) {
        saveSummary = await onSave({ rows: parsed.rows })
      }

      const totalDropped = (saveSummary?.dropped || 0) + parsed.skipped
      if (totalDropped > 0) {
        setWarning(`엄선 조건/빈 값으로 ${totalDropped}개 행이 제외되었습니다.`)
      }
      setSavedCount(saveSummary?.saved ?? parsed.rows.length)
      setSuccess(true)
      setTimeout(() => handleClose(), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('')
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.csv') && !file.name.toLowerCase().endsWith('.txt')) {
      setError('CSV 또는 TXT 파일만 업로드할 수 있습니다')
      return
    }

    try {
      const text = await file.text()
      if (!text.trim()) {
        setError('파일이 비어 있습니다')
        return
      }
      setRawRows(text)
      setFileName(file.name)
    } catch {
      setError('파일을 읽을 수 없습니다')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="공매도 데이터 입력">
      <div className="p-6 space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
            {savedCount}개 행 저장 완료. 차트에 반영됩니다.
          </div>
        )}

        {warning && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm">
            {warning}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              파일 선택 업로드 (.csv, .txt)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={handleFileSelected}
                disabled={loading}
                className="block w-full text-sm text-gray-700"
              />
              {fileName && (
                <button
                  type="button"
                  onClick={() => { setFileName(''); setRawRows('') }}
                  className="px-3 py-1.5 text-xs text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                  disabled={loading}
                >
                  초기화
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              파일을 선택하면 아래 입력창에 자동 로드됩니다.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              종목별 데이터 붙여넣기 또는 CSV 내용 입력
            </label>
            <textarea
              rows={10}
              value={rawRows}
              onChange={(e) => setRawRows(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              placeholder={[
                'code,date,shortRatio,shortBalance,shortVolume',
                '005930,2026-05-12,4.5,15200000,340000',
                '000660,2026-05-12,3.1,9800000,210000',
              ].join('\n')}
            />
            <p className="text-xs text-gray-500 mt-1">
              형식: code,date,shortRatio,shortBalance,shortVolume (헤더 행 허용, 세 지표 중 하나 이상 입력)
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs text-blue-700">
              <strong>팁:</strong> 종목코드는 6자리 숫자 또는 A005930 형태 모두 입력 가능하며,
              날짜는 YYYY-MM-DD 또는 YYYYMMDD를 지원합니다.
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50 font-medium"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 font-medium"
            >
              {loading ? '저장 중...' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

function parseRows(raw: string): { ok: true; rows: CreditShortRow[]; skipped: number } | { ok: false; error: string } {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) {
    return { ok: false, error: '데이터 행이 없습니다' }
  }

  const rows: CreditShortRow[] = []
  let skipped = 0
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const parts = line.includes('\t') ? line.split('\t') : line.split(',')
    const cells = parts.map((v) => v.trim().replace(/^["']|["']$/g, ''))

    // header row skip
    if (i === 0 && /^code$/i.test(cells[0] || '')) {
      continue
    }

    if (cells.length < 3) {
      return { ok: false, error: `${i + 1}행 형식 오류: code,date,shortRatio[,shortBalance,shortVolume]` }
    }

    const rawCode = (cells[0] || '').replace(/^A/i, '')
    const code = rawCode.padStart(6, '0')
    if (!/^\d{6}$/.test(code)) {
      return { ok: false, error: `${i + 1}행 code 오류: ${cells[0]}` }
    }

    const rawDate = cells[1] || ''
    const date = normalizeDate(rawDate)
    if (!date) {
      return { ok: false, error: `${i + 1}행 date 오류: ${rawDate}` }
    }

    const shortRatio = toNullableNumber(cells[2])
    const shortBalance = toNullableNumber(cells[3] || '')
    const shortVolume = toNullableNumber(cells[4] || '')

    if (shortRatio === undefined || shortBalance === undefined || shortVolume === undefined) {
      return { ok: false, error: `${i + 1}행 지표는 숫자여야 합니다` }
    }

    if (shortRatio == null && shortBalance == null && shortVolume == null) {
      skipped += 1
      continue
    }

    rows.push({
      code,
      date,
      ...(shortRatio != null ? { shortRatio } : {}),
      ...(shortBalance != null ? { shortBalance } : {}),
      ...(shortVolume != null ? { shortVolume } : {}),
    })
  }

  if (!rows.length) {
    return { ok: false, error: '유효한 데이터 행이 없습니다 (공매도 지표가 있는 행이 필요합니다)' }
  }

  return { ok: true, rows, skipped }
}

function normalizeDate(value: string): string | null {
  const v = value.trim()
  if (/^\d{8}$/.test(v)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return null
}

function toNullableNumber(value: string): number | null | undefined {
  const v = value.trim()
  if (!v) return null
  const n = Number(v)
  if (Number.isNaN(n)) return undefined
  return n
}
